import * as THREE from "three";
import type { Feature, Sketch, SketchEntity, SketchPlane } from "../../../../types/cad";
import { GeometryEngine } from "../../../../engine/GeometryEngine";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { BODY_MATERIAL } from "../../../../components/viewport/scene/bodyMaterial";

export function createMeshEditActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
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
        const partMesh = new THREE.Mesh(geo, BODY_MATERIAL);
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
  };
}
