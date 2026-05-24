import * as THREE from "three";
import type {
  Body,
  Component,
  Feature,
  FeatureGroup,
  Sketch,
  SketchEntity,
  SketchPlane,
} from "../../../types/cad";
import { GeometryEngine } from "../../../engine/GeometryEngine";
import { useComponentStore } from "../../componentStore";
import {
  deserializeFeature,
  deserializeSketch,
  serializeFeature,
} from "../persistence";
import { snapshotCADState } from "../historyUtils";
import type { CADSliceContext } from "../sliceContext";
import type { CADState } from "../state";
import { occRectangularPatternWithInstance, occCircularPatternWithInstance } from "../../../engine/occ/ops/pattern";
import { globalBRepBodyRegistry } from "../../../engine/occ/globalRegistry";
import { getOccSync } from "../../../engine/occ/loader";
import { tessellateWithInstance, tessellationToGeometry } from "../../../engine/occ/tessellate";
import { attachTessellationToMesh } from "../../../engine/occ/picking";
import { restoreOccSnapshot, type OccBodySnapshot } from "../../../engine/occ/occSnapshot";
import type { DesignConfiguration } from "../state/coreState";
import { bodyGeometryCache, bodyIdGeometryCache } from "../../meshRegistry";

type HistorySketch = Sketch & {
  planeNormal: [number, number, number] | null;
  planeOrigin: [number, number, number] | null;
};

type HistorySnapshot = {
  features: Feature[];
  sketches: HistorySketch[];
  activeSketch?: HistorySketch | null;
  featureGroups: FeatureGroup[];
  designConfigurations?: DesignConfiguration[];
  activeDesignConfigurationId?: string;
  componentStore?: {
    rootComponentId: string;
    activeComponentId: string | null;
    selectedBodyId: string | null;
    components: Record<
      string,
      Component & { transform: number[] | { elements?: number[] } }
    >;
    bodies: Record<string, Body>;
  };
};

const restoreComponentStoreSnapshot = (
  snapshot: HistorySnapshot["componentStore"],
) => {
  if (!snapshot) return;

  useComponentStore.setState({
    rootComponentId: snapshot.rootComponentId,
    activeComponentId: snapshot.activeComponentId ?? snapshot.rootComponentId,
    selectedBodyId: snapshot.selectedBodyId,
    components: Object.fromEntries(
      Object.entries(snapshot.components).map(([id, component]) => {
        const rawTransform = component.transform;
        const transformArray = Array.isArray(rawTransform)
          ? rawTransform
          : rawTransform?.elements;
        return [
          id,
          {
            ...component,
            transform: Array.isArray(transformArray)
              ? new THREE.Matrix4().fromArray(transformArray)
              : new THREE.Matrix4(),
          },
        ];
      }),
    ),
    bodies: Object.fromEntries(
      Object.entries(snapshot.bodies).map(([id, body]) => [
        id,
        { ...body, mesh: null },
      ]),
    ),
  });
};

const disposeFeatureObjectGeometry = (mesh: Feature["mesh"] | undefined) => {
  if (!mesh) return;
  const disposeMaterial = (
    material: THREE.Material | THREE.Material[] | null | undefined,
  ) => {
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const entry of materials) {
      if (entry.userData?.shared) continue;
      entry.dispose();
    }
  };
  const object = mesh as unknown as THREE.Object3D;
  if (object instanceof THREE.Mesh) {
    object.geometry?.dispose();
    disposeMaterial(object.material);
    return;
  }
  if (object instanceof THREE.Group) {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        disposeMaterial(child.material);
      }
    });
  }
};

export function createHistoryAndDocumentSlice({ set, get }: CADSliceContext) {
  const slice: Partial<CADState> = {
    historyEnabled: true,
    toggleHistoryMode: () => {
      const next = !get().historyEnabled;
      set({
        historyEnabled: next,
        statusMessage: next
          ? "Parametric mode — design history recording resumed"
          : "Direct Modeling mode — design history not captured",
      });
    },

    // ── MM2 — Undo / Redo ────────────────────────────────────────────────────
    undoStack: [],
    redoStack: [],

    pushUndo: () => {
      const state = get();
      const snapshot = snapshotCADState(state);
      const next = [...state.undoStack, snapshot];
      set({
        undoStack: next.length > 50 ? next.slice(next.length - 50) : next,
        redoStack: [],
      });
    },

    undo: () => {
      const state = get();
      if (state.undoStack.length === 0) return;
      const currentSnapshot = snapshotCADState(state);
      const stack = [...state.undoStack];
      const snapshot = stack.pop()!;
      try {
        const parsed = JSON.parse(snapshot) as HistorySnapshot;
        if (!parsed || !Array.isArray(parsed.features)) {
          throw new Error("Invalid snapshot: missing features array");
        }
        if (!Array.isArray(parsed.sketches)) {
          throw new Error("Invalid snapshot: missing sketches array");
        }
        // Carry over the live mesh from the current state when the same feature
        // id is being restored. Parametric features (extrude/revolve) rebuild
        // from sketch+params downstream, but mesh-op / import features have NO
        // source data — without this lookup, undo permanently destroys their
        // geometry. Map lookup keeps undo→redo round-trips loss-free as long as
        // the original mesh is still alive somewhere in the live state.
        const liveMeshById = new Map<string, Feature["mesh"]>();
        for (const f of state.features) {
          if (!f.mesh) continue;
          liveMeshById.set(f.id, f.mesh);
        }
        const restoredSketches = parsed.sketches.map((s) =>
          deserializeSketch(s as unknown as Sketch),
        );
        const restoredActiveSketch = parsed.activeSketch
          ? deserializeSketch(parsed.activeSketch as unknown as Sketch)
          : null;
        restoreComponentStoreSnapshot(parsed.componentStore);
        // Evict src-geo cache and collect mesh geometries for features removed by undo.
        const restoredIds = new Set(parsed.features.map((f: Feature) => f.id));
        const undoRemovedGeos: THREE.BufferGeometry[] = [];
        for (const f of state.features) {
          if (restoredIds.has(f.id)) continue;
          if (f.mesh instanceof THREE.Mesh) {
            const geo = (f.mesh as THREE.Mesh).geometry;
            if (geo) undoRemovedGeos.push(geo);
          }
        }
        set({
          undoStack: stack,
          redoStack: [...state.redoStack, currentSnapshot],
          features: parsed.features.map((f) => {
            const restored = deserializeFeature(f as Feature);
            const live = liveMeshById.get(restored.id);
            // Only reuse a live mesh if its geometry is still valid (not disposed).
            if (
              live instanceof THREE.Mesh &&
              (live as THREE.Mesh).geometry?.attributes?.position
            ) {
              return { ...restored, mesh: live };
            }
            return restored;
          }),
          sketches: restoredSketches,
          activeSketch: restoredActiveSketch,
          featureGroups: parsed.featureGroups,
          designConfigurations:
            parsed.designConfigurations ?? state.designConfigurations,
          activeDesignConfigurationId:
            parsed.activeDesignConfigurationId ??
            state.activeDesignConfigurationId,
          statusMessage: "Undo",
        });
        // OCC-7.3: restore BRepBodies from STEP snapshot if present
        if (Array.isArray((parsed as Record<string, unknown>).occBodies)) {
          void restoreOccSnapshot(
            (parsed as Record<string, unknown>).occBodies as OccBodySnapshot[],
          );
        }
        // Defer-dispose removed geometries after R3F has a cycle to unmount old meshes.
        if (undoRemovedGeos.length > 0)
          setTimeout(() => {
            for (const g of undoRemovedGeos) g.dispose();
          }, 0);
      } catch {
        // Malformed snapshot — POP it so the next undo doesn't hit the same
        // broken entry forever. Without `set({ undoStack: stack })` the failed
        // pop above is undone for the next call.
        set({
          undoStack: stack,
          statusMessage: "Undo: corrupted snapshot skipped",
        });
      }
    },

    redo: () => {
      const state = get();
      if (state.redoStack.length === 0) return;
      const currentSnapshot = snapshotCADState(state);
      const stack = [...state.redoStack];
      const snapshot = stack.pop()!;
      try {
        const parsed = JSON.parse(snapshot) as HistorySnapshot;
        if (!parsed || !Array.isArray(parsed.features)) {
          throw new Error("Invalid snapshot: missing features array");
        }
        if (!Array.isArray(parsed.sketches)) {
          throw new Error("Invalid snapshot: missing sketches array");
        }
        const liveMeshById = new Map<string, Feature["mesh"]>();
        for (const f of state.features) {
          if (!f.mesh) continue;
          liveMeshById.set(f.id, f.mesh);
        }
        const restoredSketches = parsed.sketches.map((s) =>
          deserializeSketch(s as unknown as Sketch),
        );
        const restoredActiveSketch = parsed.activeSketch
          ? deserializeSketch(parsed.activeSketch as unknown as Sketch)
          : null;
        restoreComponentStoreSnapshot(parsed.componentStore);
        // Evict src-geo cache and collect mesh geometries for features removed by redo.
        const restoredIdsRedo = new Set(
          parsed.features.map((f: Feature) => f.id),
        );
        const redoRemovedGeos: THREE.BufferGeometry[] = [];
        for (const f of state.features) {
          if (restoredIdsRedo.has(f.id)) continue;
          if (f.mesh instanceof THREE.Mesh) {
            const geo = (f.mesh as THREE.Mesh).geometry;
            if (geo) redoRemovedGeos.push(geo);
          }
        }
        set({
          redoStack: stack,
          undoStack: [...state.undoStack, currentSnapshot],
          features: parsed.features.map((f) => {
            const restored = deserializeFeature(f as Feature);
            const live = liveMeshById.get(restored.id);
            if (
              live instanceof THREE.Mesh &&
              (live as THREE.Mesh).geometry?.attributes?.position
            ) {
              return { ...restored, mesh: live };
            }
            return restored;
          }),
          sketches: restoredSketches,
          activeSketch: restoredActiveSketch,
          featureGroups: parsed.featureGroups,
          designConfigurations:
            parsed.designConfigurations ?? state.designConfigurations,
          activeDesignConfigurationId:
            parsed.activeDesignConfigurationId ??
            state.activeDesignConfigurationId,
          statusMessage: "Redo",
        });
        if (redoRemovedGeos.length > 0)
          setTimeout(() => {
            for (const g of redoRemovedGeos) g.dispose();
          }, 0);
      } catch {
        // Malformed snapshot — pop it so the user can keep redoing past it.
        set({
          redoStack: stack,
          statusMessage: "Redo: corrupted snapshot skipped",
        });
      }
    },

    // ── SLD7 — Linear Pattern ─────────────────────────────────────────────────
    commitLinearPattern: (featureId, params) => {
      const { features } = get();
      const srcFeature = features.find((f) => f.id === featureId);
      const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
      if (!srcFeature || !srcMesh?.isMesh) {
        get().setStatusMessage(
          "Linear Pattern: no mesh found for selected feature",
        );
        return;
      }

      // OCC path: fuse all copies into a single BRep body
      const occBodyId = srcMesh.userData['brepBodyId'] as string | undefined;
      if (occBodyId) {
        const occ = getOccSync();
        const srcBody = occ ? globalBRepBodyRegistry.get(occBodyId) : undefined;
        if (occ && srcBody) {
          const dirX = new THREE.Vector3(params.dirX, params.dirY, params.dirZ);
          const countX = Math.max(1, Math.round(params.count));
          const spacingX = params.spacing;
          const countY = params.count2 ? Math.max(1, Math.round(params.count2)) : 1;
          const spacingY = params.spacing2 ?? 0;
          const dirY = params.dir2X !== undefined
            ? new THREE.Vector3(params.dir2X, params.dir2Y ?? 0, params.dir2Z ?? 0)
            : new THREE.Vector3(0, dirX.y !== 0 ? 0 : 1, dirX.y !== 0 ? 1 : 0);
          const newFeatureId = crypto.randomUUID();
          const occResult = occRectangularPatternWithInstance(occ.oc, srcBody, countX, spacingX, countY, spacingY, dirX, dirY, { sourceFeatureId: newFeatureId });
          if (occResult) {
            occResult.sourceFeatureId = newFeatureId;
            globalBRepBodyRegistry.add(occResult);
            const tess = tessellateWithInstance(occ.oc, occResult);
            const geo = tessellationToGeometry(tess);
            const patMesh = new THREE.Mesh(geo, srcMesh.material);
            attachTessellationToMesh(patMesh, tess, occResult.id);
            patMesh.userData.pickable = true;
            patMesh.userData.featureId = newFeatureId;
            patMesh.castShadow = true;
            patMesh.receiveShadow = true;
            const nPat = features.filter((f) => f.params?.featureKind === 'rect-pattern').length + 1;
            const patFeature: Feature = {
              id: newFeatureId,
              name: `Pattern ${nPat}`,
              type: 'primitive',
              params: { featureKind: 'rect-pattern', sourceFeatureId: featureId, countX, spacingX, countY, spacingY },
              mesh: patMesh,
              visible: true,
              suppressed: false,
              timestamp: Date.now(),
              bodyKind: srcFeature.bodyKind ?? 'solid',
            };
            get().pushUndo();
            set({ features: [...features, patFeature], statusMessage: `OCC Linear Pattern: ${countX * countY} copies (merged)` });
            return;
          }
        }
      }

      get().pushUndo();
      const copies = GeometryEngine.linearPattern(srcMesh, params);
      const newFeatures: Feature[] = copies.map((copy, idx) => ({
        id: crypto.randomUUID(),
        name: `${srcFeature.name} (Pattern ${idx + 2})`,
        type: "primitive" as Feature["type"],
        params: {
          featureKind: "linear-pattern-copy",
          sourceFeatureId: featureId,
          index: idx + 2,
        },
        mesh: copy,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: srcFeature.bodyKind ?? "solid",
      }));
      set({ features: [...features, ...newFeatures] });
      get().setStatusMessage(`Linear Pattern: created ${copies.length} copies`);
    },

    // ── SLD8 — Circular Pattern ───────────────────────────────────────────────
    commitCircularPattern: (featureId, params) => {
      const { features } = get();
      const srcFeature = features.find((f) => f.id === featureId);
      const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
      if (!srcFeature || !srcMesh?.isMesh) {
        get().setStatusMessage(
          "Circular Pattern: no mesh found for selected feature",
        );
        return;
      }

      // OCC path: fuse all rotation copies into a single BRep body
      const occBodyId = srcMesh.userData['brepBodyId'] as string | undefined;
      if (occBodyId) {
        const occ = getOccSync();
        const srcBody = occ ? globalBRepBodyRegistry.get(occBodyId) : undefined;
        if (occ && srcBody) {
          const axis = {
            origin: new THREE.Vector3(params.originX, params.originY, params.originZ),
            direction: new THREE.Vector3(params.axisX, params.axisY, params.axisZ),
          };
          const count = Math.max(1, Math.round(params.count));
          const totalAngleRad = THREE.MathUtils.degToRad(params.totalAngle);
          const newFeatureId = crypto.randomUUID();
          const occResult = occCircularPatternWithInstance(occ.oc, srcBody, axis, count, totalAngleRad, { sourceFeatureId: newFeatureId });
          if (occResult) {
            occResult.sourceFeatureId = newFeatureId;
            globalBRepBodyRegistry.add(occResult);
            const tess = tessellateWithInstance(occ.oc, occResult);
            const geo = tessellationToGeometry(tess);
            const patMesh = new THREE.Mesh(geo, srcMesh.material);
            attachTessellationToMesh(patMesh, tess, occResult.id);
            patMesh.userData.pickable = true;
            patMesh.userData.featureId = newFeatureId;
            patMesh.castShadow = true;
            patMesh.receiveShadow = true;
            const nPat = features.filter((f) => f.params?.featureKind === 'circ-pattern').length + 1;
            const patFeature: Feature = {
              id: newFeatureId,
              name: `Circular Pattern ${nPat}`,
              type: 'primitive',
              params: { featureKind: 'circ-pattern', sourceFeatureId: featureId, count, totalAngle: params.totalAngle },
              mesh: patMesh,
              visible: true,
              suppressed: false,
              timestamp: Date.now(),
              bodyKind: srcFeature.bodyKind ?? 'solid',
            };
            get().pushUndo();
            set({ features: [...features, patFeature], statusMessage: `OCC Circular Pattern: ${count} copies (merged)` });
            return;
          }
        }
      }

      get().pushUndo();
      const copies = GeometryEngine.circularPattern(srcMesh, params);
      const newFeatures: Feature[] = copies.map((copy, idx) => ({
        id: crypto.randomUUID(),
        name: `${srcFeature.name} (Pattern ${idx + 2})`,
        type: "primitive" as Feature["type"],
        params: {
          featureKind: "circular-pattern-copy",
          sourceFeatureId: featureId,
          index: idx + 2,
        },
        mesh: copy,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: srcFeature.bodyKind ?? "solid",
      }));
      set({ features: [...features, ...newFeatures] });
      get().setStatusMessage(
        `Circular Pattern: created ${copies.length} copies`,
      );
    },

    // ── MSH2 — Plane Cut ─────────────────────────────────────────────────────
    commitPlaneCut: (featureId, planeNormal, planeOffset, keepSide) => {
      if (
        !Number.isFinite(planeOffset) ||
        !Number.isFinite(planeNormal.x) ||
        !Number.isFinite(planeNormal.y) ||
        !Number.isFinite(planeNormal.z)
      ) {
        get().setStatusMessage(
          "Plane Cut: invalid plane parameters (non-finite values)",
        );
        return;
      }
      const { features } = get();
      const srcFeature = features.find((f) => f.id === featureId);
      const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
      if (!srcFeature || !srcMesh?.isMesh) {
        get().setStatusMessage("Plane Cut: no mesh found for selected feature");
        return;
      }
      get().pushUndo();
      const result = GeometryEngine.planeCutMesh(
        srcMesh,
        planeNormal,
        planeOffset,
        keepSide,
      );
      const n =
        features.filter((f) => f.params?.featureKind === "plane-cut").length +
        1;
      const newFeature: Feature = {
        id: crypto.randomUUID(),
        name: `Plane Cut ${n}`,
        type: "split-body" as Feature["type"],
        params: {
          featureKind: "plane-cut",
          sourceFeatureId: featureId,
          normalX: planeNormal.x,
          normalY: planeNormal.y,
          normalZ: planeNormal.z,
          offset: planeOffset,
          keepSide,
        },
        mesh: result,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: srcFeature.bodyKind ?? "mesh",
      };
      const nextFeatures = features.map((f) =>
        f.id === featureId ? { ...f, visible: false } : f,
      );
      set({ features: [...nextFeatures, newFeature] });
      get().setStatusMessage(`Plane Cut ${n}: applied`);
    },

    // ── MSH3 — Make Closed Mesh ──────────────────────────────────────────────
    commitMakeClosedMesh: (featureId) => {
      const { features } = get();
      const srcFeature = features.find((f) => f.id === featureId);
      const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
      if (!srcFeature || !srcMesh?.isMesh) {
        get().setStatusMessage(
          "Make Closed Mesh: no mesh found for selected feature",
        );
        return;
      }
      const result = GeometryEngine.makeClosedMesh(srcMesh);
      const n =
        features.filter((f) => f.params?.featureKind === "make-closed-mesh")
          .length + 1;
      const newFeature: Feature = {
        id: crypto.randomUUID(),
        name: `Closed Mesh ${n}`,
        type: "import" as Feature["type"],
        params: { featureKind: "make-closed-mesh", sourceFeatureId: featureId },
        mesh: result,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: "mesh",
      };
      const nextFeatures = features.map((f) =>
        f.id === featureId ? { ...f, visible: false } : f,
      );
      set({ features: [...nextFeatures, newFeature] });
      get().setStatusMessage(`Closed Mesh ${n}: holes filled`);
    },

    // ── MSH5 — Mesh Smooth ───────────────────────────────────────────────────
    commitMeshSmooth: (featureId, iterations, factor) => {
      const { features } = get();
      const srcFeature = features.find((f) => f.id === featureId);
      const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
      if (!srcFeature || !srcMesh?.isMesh) {
        get().setStatusMessage(
          "Mesh Smooth: no mesh found for selected feature",
        );
        return;
      }
      const result = GeometryEngine.smoothMesh(srcMesh, iterations, factor);
      const n =
        features.filter((f) => f.params?.featureKind === "mesh-smooth").length +
        1;
      const newFeature: Feature = {
        id: crypto.randomUUID(),
        name: `Mesh Smooth ${n}`,
        type: "import" as Feature["type"],
        params: {
          featureKind: "mesh-smooth",
          sourceFeatureId: featureId,
          iterations,
          factor,
        },
        mesh: result,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: "mesh",
      };
      const nextFeatures = features.map((f) =>
        f.id === featureId ? { ...f, visible: false } : f,
      );
      set({ features: [...nextFeatures, newFeature] });
      get().setStatusMessage(`Mesh Smooth ${n}: ${iterations} iterations`);
    },

    // ── MSH10 — Separate ─────────────────────────────────────────────────────
    commitMeshSeparate: (featureId) => {
      const { features } = get();
      const srcFeature = features.find((f) => f.id === featureId);
      const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
      if (!srcFeature || !srcMesh?.isMesh) {
        get().setStatusMessage(
          "Mesh Separate: no mesh found for selected feature",
        );
        return;
      }
      const geos = GeometryEngine.unstitchSurface(srcMesh);
      if (geos.length === 0) {
        get().setStatusMessage("Mesh separate failed: no parts produced");
        return;
      }
      const newFeatures: Feature[] = geos.map((geo, idx) => {
        const mat = new THREE.MeshPhysicalMaterial({
          color: 0x8899aa,
          metalness: 0.3,
          roughness: 0.4,
          side: THREE.DoubleSide,
        });
        const partMesh = new THREE.Mesh(geo, mat);
        partMesh.castShadow = true;
        partMesh.receiveShadow = true;
        return {
          id: crypto.randomUUID(),
          name: `${srcFeature.name} Part ${idx + 1}`,
          type: "split-body" as Feature["type"],
          params: {
            featureKind: "mesh-separate",
            sourceFeatureId: featureId,
            partIndex: idx,
          },
          mesh: partMesh,
          visible: true,
          suppressed: false,
          timestamp: Date.now(),
          bodyKind: srcFeature.bodyKind ?? "mesh",
        };
      });
      const nextFeatures = features
        .filter((f) => f.id !== featureId)
        .concat(newFeatures);
      set({ features: nextFeatures });
      // Dispose the source mesh's geometry — unstitchSurface produced fresh
      // BufferGeometries for each part, so the source is now an orphan.
      // Skip materials tagged userData.shared (singletons from GeometryEngine).
      if (srcMesh.geometry) srcMesh.geometry.dispose();
      const srcMat = srcMesh.material;
      const matArr = Array.isArray(srcMat) ? srcMat : [srcMat];
      for (const mm of matArr) {
        if (mm?.userData?.shared) continue;
        mm?.dispose?.();
      }
      get().setStatusMessage(
        `Mesh Separate: split into ${newFeatures.length} parts`,
      );
    },

    // ── MSH13 — Mesh Section Sketch ──────────────────────────────────────────
    commitMeshSectionSketch: (featureId, plane) => {
      const { features, sketches } = get();
      const srcFeature = features.find((f) => f.id === featureId);
      const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
      if (!srcFeature || !srcMesh?.isMesh) {
        get().setStatusMessage(
          "Mesh Section Sketch: no mesh found for selected feature",
        );
        return;
      }
      const segments = GeometryEngine.meshSectionSketch(srcMesh, plane);
      const entities: SketchEntity[] = segments.map(([a, b]) => ({
        id: crypto.randomUUID(),
        type: "line" as SketchEntity["type"],
        points: [
          { id: crypto.randomUUID(), x: a.x, y: a.y, z: a.z },
          { id: crypto.randomUUID(), x: b.x, y: b.y, z: b.z },
        ],
      }));
      const n =
        sketches.filter((s) => s.name.startsWith("Section Sketch")).length + 1;
      const newSketch: Sketch = {
        id: crypto.randomUUID(),
        name: `Section Sketch ${n}`,
        plane: "XY" as SketchPlane,
        planeNormal: plane.normal.clone(),
        planeOrigin: new THREE.Vector3()
          .copy(plane.normal)
          .multiplyScalar(-plane.constant),
        entities,
        constraints: [],
        dimensions: [],
        fullyConstrained: false,
      };
      set({ sketches: [...sketches, newSketch] });
      get().setStatusMessage(
        `Mesh Section Sketch ${n}: ${entities.length} segments`,
      );
    },

    // ── UTL2 — Save / Load ───────────────────────────────────────────────────
    newDocument: () => {
      // Dispose stored feature meshes before clearing state.
      for (const f of get().features) disposeFeatureObjectGeometry(f.mesh);
      for (const geo of bodyGeometryCache.values()) geo.dispose();
      bodyGeometryCache.clear();
      for (const geo of bodyIdGeometryCache.values()) geo.dispose();
      bodyIdGeometryCache.clear();
      set({
        // Geometry content
        features: [],
        sketches: [],
        featureGroups: [],
        constructionPlanes: [],
        constructionAxes: [],
        constructionPoints: [],
        jointOrigins: [],
        contactSets: [],
        canvasReferences: [],
        parameters: [],
        // History
        undoStack: [],
        redoStack: [],
        // Selection / active state
        selectedEntityIds: [],
        selectedFeatureId: null,
        activeSketch: null,
        activeTool: "select",
        activeDialog: null,
        dialogPayload: null,
        sketchPlaneSelecting: false,
        rollbackIndex: -1,
        statusMessage: "New document",
      });
    },

    getDesignJSON: () => {
      const state = get();
      const saveObj = {
        version: 1,
        features: state.features.map((f) => serializeFeature(f)),
        sketches: state.sketches.map((s) => ({
          ...s,
          planeNormal: s.planeNormal
            ? [s.planeNormal.x, s.planeNormal.y, s.planeNormal.z]
            : null,
          planeOrigin: s.planeOrigin
            ? [s.planeOrigin.x, s.planeOrigin.y, s.planeOrigin.z]
            : null,
        })),
        featureGroups: state.featureGroups,
        historyEnabled: state.historyEnabled,
      };
      return JSON.stringify(saveObj, null, 2);
    },

    saveToFile: (filename = "design.dznd") => {
      const json = get().getDesignJSON();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = filename.endsWith(".dznd")
        ? filename
        : `${filename}.dznd`;
      a.download = safeName;
      a.click();
      URL.revokeObjectURL(url);
      get().setStatusMessage(`Design saved: ${safeName}`);
    },

    loadFromFile: (json: string) => {
      // Dispose stored feature meshes before replacing the document.
      for (const f of get().features) disposeFeatureObjectGeometry(f.mesh);
      for (const geo of bodyGeometryCache.values()) geo.dispose();
      bodyGeometryCache.clear();
      for (const geo of bodyIdGeometryCache.values()) geo.dispose();
      bodyIdGeometryCache.clear();
      try {
        const parsed = JSON.parse(json) as {
          version: number;
          features: Feature[];
          sketches: Array<
            Sketch & {
              planeNormal: [number, number, number] | null;
              planeOrigin: [number, number, number] | null;
            }
          >;
          featureGroups: FeatureGroup[];
          historyEnabled?: boolean;
        };
        if (!parsed || !Array.isArray(parsed.features)) {
          throw new Error("Invalid snapshot: missing features array");
        }
        if (!Array.isArray(parsed.sketches)) {
          throw new Error("Invalid snapshot: missing sketches array");
        }
        set({
          features: (parsed.features ?? []).map((f) => deserializeFeature(f)),
          sketches: (parsed.sketches ?? []).map((s) =>
            deserializeSketch(s as unknown as Sketch),
          ),
          featureGroups: parsed.featureGroups ?? [],
          historyEnabled: parsed.historyEnabled ?? true,
          statusMessage: "Design loaded from file",
        });
      } catch {
        get().setStatusMessage("Load failed: invalid file format");
      }
    },

    // ── SLD1 — Rib (dialog-based) ─────────────────────────────────────────────
  };

  return slice;
}
