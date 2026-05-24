import * as THREE from "three";
import type { Feature } from "../../../../types/cad";
import { GeometryEngine } from "../../../../engine/GeometryEngine";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { recomputeBooleanDependents, runBoolean } from "./featureBooleanUtils";
import { errorMessage } from "../../../../utils/errorHandling";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import {
  occFilletEdgeSetsWithInstance,
  type OccFilletEdgeSet,
} from "../../../../engine/occ/ops/fillet";
import type { BRepBody } from "../../../../engine/occ/brepBody";
import { occChamferWithInstance } from "../../../../engine/occ/ops/chamfer";
import { tessellateWithInstance, tessellationToGeometry } from "../../../../engine/occ/tessellate";
import { getOccSync } from "../../../../engine/occ/loader";
import { attachTessellationToMesh } from "../../../../engine/occ/picking";
import { occMirrorWithInstance, type OccMirrorPlane } from "../../../../engine/occ/ops/mirror";
import { occScaleWithInstance } from "../../../../engine/occ/ops/scale";
import { performOccBooleanMultiWithInstance } from "../../../../engine/occ/ops/booleanCore";

function getBooleanParentIds(feature: Feature): string[] {
  const fromArray = feature.params.booleanParentIds;
  if (Array.isArray(fromArray))
    return fromArray.filter((id): id is string => typeof id === "string");
  return [feature.params.targetId, feature.params.toolId].filter(
    (id): id is string => typeof id === "string",
  );
}

function keepsParentsHidden(feature: Feature): boolean {
  return feature.type === "combine" && feature.params.keepTools === false;
}

function parentIsHiddenByAnotherCombine(
  features: Feature[],
  parentId: string,
  excludeCombineId: string,
): boolean {
  return features.some(
    (feature) =>
      feature.id !== excludeCombineId &&
      keepsParentsHidden(feature) &&
      getBooleanParentIds(feature).includes(parentId),
  );
}

function storedEdgeIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === "string");
  }
  if (typeof value !== "string") return [];
  if (value.includes("\u001f")) return value.split("\u001f").filter(Boolean);
  return value.split(",").filter(Boolean);
}

type OccEdgeSelection = {
  bodyId: string;
  edgeIds: number[];
};

function parseOccEdgeSelection(edgeIds: string[]): OccEdgeSelection | null {
  if (edgeIds.length === 0) return null;
  const parsed = edgeIds.map((id) => {
    const parts = id.split(":");
    if (parts[0] !== "occ" || !parts[1]) return null;
    const edgeId = Number(parts[2]);
    if (!Number.isInteger(edgeId)) return null;
    return { bodyId: parts[1], edgeId };
  });
  if (parsed.some((item) => item === null)) return null;
  const bodyId = parsed[0]!.bodyId;
  if (!parsed.every((item) => item!.bodyId === bodyId)) return null;
  return { bodyId, edgeIds: parsed.map((item) => item!.edgeId) };
}

function mirrorPlaneFromString(plane: string): OccMirrorPlane {
  const origin = new THREE.Vector3(0, 0, 0);
  if (plane === 'XY') return { origin, normal: new THREE.Vector3(0, 0, 1) };
  if (plane === 'XZ') return { origin, normal: new THREE.Vector3(0, 1, 0) };
  return { origin, normal: new THREE.Vector3(1, 0, 0) }; // YZ
}

function resolveOccFilletOptions(params?: Record<string, unknown>): { continuity?: 'G1' | 'G2' } {
  return { continuity: params?.isG2 === true ? 'G2' : 'G1' };
}

function resolveOccFilletEdgeSets(
  numericEdgeIds: number[],
  srcBody: BRepBody,
  params?: Record<string, unknown>,
  fallbackRadius = 2,
): OccFilletEdgeSet[] {
  if (!params) return [{ edgeIds: numericEdgeIds, radius: fallbackRadius }];

  // Multi-set collection: each set carries its own type and radii.
  if (Array.isArray(params.edgeSets) && (params.edgeSets as unknown[]).length > 0) {
    const sets: OccFilletEdgeSet[] = [];
    for (const s of params.edgeSets as Record<string, unknown>[]) {
      const rawIds = Array.isArray(s.edgeIds) ? (s.edgeIds as string[]) : [];
      const setNumericIds = rawIds
        .map((id) => {
          const parts = String(id).split(':');
          if (parts[0] !== 'occ' || !parts[2]) return null;
          const n = Number(parts[2]);
          return Number.isInteger(n) && srcBody.edgeIds.has(n) ? n : null;
        })
        .filter((n): n is number => n !== null);
      if (setNumericIds.length === 0) continue;
      if (s.type === 'chord-length' && typeof s.chordLength === 'number') {
        sets.push({ edgeIds: setNumericIds, chordLength: s.chordLength });
      } else if (s.type === 'variable' && typeof s.radius === 'number' && typeof s.endRadius === 'number') {
        sets.push({ edgeIds: setNumericIds, startRadius: s.radius, endRadius: s.endRadius });
      } else if (s.type === 'asymmetric') {
        const r1 = typeof s.offsetOne === 'number' ? Math.max(s.offsetOne, 0.001) : (params.radius as number) ?? 2;
        const r2 = typeof s.offsetTwo === 'number' ? Math.max(s.offsetTwo, 0.001) : r1;
        sets.push({ edgeIds: setNumericIds, startRadius: r1, endRadius: r2 });
      } else {
        sets.push({ edgeIds: setNumericIds, radius: typeof s.radius === 'number' ? s.radius : (params.radius as number) ?? 2 });
      }
    }
    if (sets.length > 0) return sets;
  }

  const mode = typeof params.mode === 'string' ? params.mode : 'constant';
  const fallbackR = typeof params.radius === 'number' ? params.radius : fallbackRadius;

  if (mode === 'asymmetric') {
    // Map Fusion offsetOne/offsetTwo → OCC Add_3(r1, r2, edge).
    // Add_3 varies radius along the edge length (start vertex → end vertex),
    // which approximates per-face asymmetric setback when both offsets differ.
    const r1 = typeof params.offsetOne === 'number' ? Math.max(params.offsetOne, 0.001) : fallbackR;
    const r2 = typeof params.offsetTwo === 'number' ? Math.max(params.offsetTwo, 0.001) : r1;
    return [{ edgeIds: numericEdgeIds, startRadius: r1, endRadius: r2 }];
  }
  if (mode === 'full-round') {
    // UI auto-selects the center face's edges and computes the inradius; we
    // pass those edges + radius to occFilletEdgeSetsWithInstance which applies
    // the spanning fillet. occFullRoundFilletWithInstance is available for the
    // future face-picker path that supplies centerFaceId + sideFaceIds directly.
    return [{ edgeIds: numericEdgeIds, radius: fallbackR }];
  }
  if (mode === 'chord-length') {
    const chord = typeof params.chordLength === 'number' ? params.chordLength : fallbackR;
    return [{ edgeIds: numericEdgeIds, chordLength: chord }];
  }
  if (mode === 'variable') {
    const start = typeof params.startRadius === 'number' ? params.startRadius : fallbackR;
    const end = typeof params.endRadius === 'number' ? params.endRadius : start;
    return [{ edgeIds: numericEdgeIds, startRadius: start, endRadius: end }];
  }
  return [{ edgeIds: numericEdgeIds, radius: fallbackR }];
}

function resolveOccChamferDistances(params: Record<string, unknown>): [number, number] {
  const distance = typeof params.distance === "number" ? params.distance : 2;
  const mode = typeof params.mode === "string" ? params.mode : "equal-dist";
  let distance2 = typeof params.distance2 === "number" ? params.distance2 : distance;
  if (mode === "dist-angle") {
    const angle = typeof params.angle === "number" ? params.angle : 45;
    distance2 = Math.max(
      0.01,
      distance * Math.tan((THREE.MathUtils.clamp(angle, 1, 89) * Math.PI) / 180),
    );
  } else if (mode !== "two-dist") {
    distance2 = distance;
  }
  return params.isFlipped ? [distance2, distance] : [distance, distance2];
}

function syncActiveConfigurationSuppression(
  state: CADState,
  entries: Record<string, boolean>,
): CADState["designConfigurations"] {
  const updatedAt = Date.now();
  return state.designConfigurations.map((configuration) =>
    configuration.id === state.activeDesignConfigurationId
      ? {
          ...configuration,
          featureSuppression: {
            ...configuration.featureSuppression,
            ...entries,
          },
          updatedAt,
        }
      : configuration,
  );
}

export function createFeatureMeshActions({
  set,
  get,
}: CADSliceContext): Partial<CADState> {
  const markOccEdgeModificationError = (featureId: string | undefined, tool: string, message: string): false => {
    const statusMessage = `${tool}: ${message}`;
    if (!featureId) {
      set({ statusMessage });
      return false;
    }
    set((state) => ({
      features: state.features.map((feature) =>
        feature.id === featureId
          ? {
              ...feature,
              healthState: "error" as const,
              healthMessage: message,
            }
          : feature,
      ),
      statusMessage,
    }));
    return false;
  };

  const applyOccEdgeModification = ({
    tool,
    featureId,
    edgeIds,
    radius,
    filletEdgeSets,
    continuity,
    distance,
    distance2,
    pushUndo = false,
  }: {
    tool: "Fillet" | "Chamfer";
    featureId?: string;
    edgeIds: string[];
    radius?: number;
    filletEdgeSets?: OccFilletEdgeSet[];
    continuity?: 'G1' | 'G2';
    distance?: number;
    distance2?: number;
    pushUndo?: boolean;
  }): boolean => {
    if (!featureId) {
      return markOccEdgeModificationError(undefined, tool, "OCC edge operations require a feature id");
    }
    const occ = getOccSync();
    if (!occ) {
      return markOccEdgeModificationError(featureId, tool, "OCC kernel is still loading; try again in a moment");
    }
    const selection = parseOccEdgeSelection(edgeIds);
    if (!selection) {
      return markOccEdgeModificationError(
        featureId,
        tool,
        "Only OCC topology edge selections are supported on this branch",
      );
    }
    const srcBody = globalBRepBodyRegistry.get(selection.bodyId);
    if (!srcBody) {
      return markOccEdgeModificationError(featureId, tool, "Selected OCC source body is no longer available");
    }
    const numericEdgeIds = selection.edgeIds.filter((edgeId) =>
      srcBody.edgeIds.has(edgeId),
    );
    if (numericEdgeIds.length === 0) {
      return markOccEdgeModificationError(featureId, tool, "Selected OCC edges no longer exist on the source body");
    }

    const effectiveFilletEdgeSets: OccFilletEdgeSet[] =
      filletEdgeSets ?? [{ edgeIds: numericEdgeIds, radius: radius ?? 2 }];

    const result =
      tool === "Fillet"
        ? occFilletEdgeSetsWithInstance(
            occ.oc,
            srcBody,
            effectiveFilletEdgeSets,
            { sourceFeatureId: featureId, continuity },
          )
        : occChamferWithInstance(occ.oc, srcBody, numericEdgeIds, distance ?? 0, {
            distance2:
              distance2 !== undefined && distance2 !== distance ? distance2 : undefined,
            sourceFeatureId: featureId,
          });
    if (!result) {
      return markOccEdgeModificationError(featureId, tool, "OCC operation failed for the selected edge set");
    }

    result.sourceFeatureId = featureId;
    globalBRepBodyRegistry.add(result);
    const tess = tessellateWithInstance(occ.oc, result);
    const geo = tessellationToGeometry(tess);
    const srcFeatureId = srcBody.sourceFeatureId;
    const srcFeature = srcFeatureId
      ? get().features.find((feature) => feature.id === srcFeatureId)
      : undefined;
    const srcMesh = srcFeature?.mesh;
    const material =
      srcMesh instanceof THREE.Mesh
        ? srcMesh.material
        : new THREE.MeshStandardMaterial({ color: 0x4488cc });
    const newMesh = new THREE.Mesh(geo, material);
    attachTessellationToMesh(newMesh, tess, result.id);
    newMesh.userData.pickable = true;
    newMesh.userData.featureId = featureId;
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;

    const currentFeature = get().features.find((feature) => feature.id === featureId);
    const previousGeo =
      currentFeature?.mesh instanceof THREE.Mesh
        ? currentFeature.mesh.geometry
        : null;
    if (pushUndo) get().pushUndo();
    set((state) => ({
      features: state.features.map((feature) =>
        feature.id === featureId
          ? {
              ...feature,
              mesh: newMesh,
              healthState: "healthy" as const,
              healthMessage: undefined,
            }
          : feature,
      ),
      statusMessage:
        tool === "Fillet"
          ? `Filleted ${numericEdgeIds.length} OCC edge(s)${continuity === 'G2' ? ' (G2)' : ''}`
          : `Chamfered ${numericEdgeIds.length} OCC edge(s) at d=${distance}`,
    }));
    if (previousGeo && previousGeo !== geo) setTimeout(() => previousGeo.dispose(), 0);
    return true;
  };

  return {
    // D119 Tessellate
    tessellateFeature: (featureId) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("No mesh found on selected feature");
        return;
      }
      const geom = GeometryEngine.extractMeshGeometry(
        feature.mesh as THREE.Mesh | THREE.Group,
      );
      if (!geom) {
        get().setStatusMessage("No mesh found on selected feature");
        return;
      }
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x8899aa,
        metalness: 0.3,
        roughness: 0.4,
        side: THREE.DoubleSide,
      });
      const newMesh = new THREE.Mesh(geom, mat);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
      const n =
        features.filter((f) => f.params.kind === "tessellate").length + 1;
      const newFeature: Feature = {
        id: crypto.randomUUID(),
        name: `Tessellate ${n}`,
        type: "primitive",
        params: { kind: "tessellate" },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: newMesh,
        bodyKind: "mesh",
      };
      set((state) => ({
        features: [...state.features, newFeature],
        statusMessage: "Feature tessellated as mesh body",
      }));
    },
    // D125 Mesh Reduce
    reduceMesh: (featureId, reductionPercent) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("Mesh Reduce: selected feature has no mesh");
        return;
      }
      // Build a new simplified mesh rather than mutating the existing one in-place.
      // Mutating geometry on a Zustand-owned object bypasses set() and leaves
      // React unaware of the change. Instead we clone, simplify, then replace
      // the feature in state via set().
      const applyToMesh = async (m: THREE.Mesh): Promise<THREE.Mesh> => {
        const newGeom = await GeometryEngine.simplifyGeometry(
          m.geometry,
          reductionPercent,
        );
        const clone = new THREE.Mesh(newGeom, m.material);
        clone.castShadow = m.castShadow;
        clone.receiveShadow = m.receiveShadow;
        Object.assign(clone.userData, m.userData);
        return clone;
      };
      const featureMesh = feature.mesh as THREE.Object3D;
      // Re-validate the feature/mesh AFTER the await Ã¢â‚¬â€ by the time the simplify
      // promise resolves, the user could have deleted the feature, replaced its
      // mesh, or kicked off another reduce. Without this guard the post-await
      // set() would write the new mesh into whatever feature row currently has
      // the matching id, and dispose a mesh that's already been replaced.
      const stillValid = (
        currentMesh: THREE.Object3D | null | undefined,
      ): boolean => {
        const live = get().features.find((f) => f.id === featureId);
        return !!live && live.mesh === currentMesh;
      };
      const onErr = (err: unknown) => {
        get().setStatusMessage(
          `Mesh Reduce failed: ${errorMessage(err, "unknown error")}`,
        );
      };
      if (featureMesh instanceof THREE.Mesh) {
        applyToMesh(featureMesh)
          .then((newMesh) => {
            if (!stillValid(featureMesh)) {
              // Stale Ã¢â‚¬â€ drop the freshly built mesh so we don't leak it
              newMesh.geometry.dispose();
              return;
            }
            const oldMesh = feature.mesh;
            set((state) => ({
              features: state.features.map((f) =>
                f.id === featureId ? { ...f, mesh: newMesh } : f,
              ),
            }));
            // Dispose old geometry AFTER removing from state
            if (oldMesh instanceof THREE.Mesh) oldMesh.geometry.dispose();
            get().setStatusMessage(`Mesh reduced by ${reductionPercent}%`);
          })
          .catch(onErr);
      } else if (featureMesh instanceof THREE.Group) {
        const meshes: THREE.Mesh[] = [];
        featureMesh.traverse((child) => {
          if (child instanceof THREE.Mesh) meshes.push(child);
        });
        Promise.all(meshes.map(applyToMesh))
          .then((newMeshes) => {
            if (!stillValid(featureMesh)) {
              // Stale Ã¢â‚¬â€ drop all freshly built meshes' geometries
              for (const m of newMeshes) m.geometry.dispose();
              return;
            }
            const oldGroup = feature.mesh;
            const newGroup = new THREE.Group();
            newMeshes.forEach((m) => newGroup.add(m));
            set((state) => ({
              features: state.features.map((f) =>
                f.id === featureId
                  ? { ...f, mesh: newGroup as unknown as THREE.Mesh }
                  : f,
              ),
            }));
            // Dispose old geometries AFTER removal
            if (oldGroup instanceof THREE.Group) {
              oldGroup.traverse((child) => {
                if (child instanceof THREE.Mesh) child.geometry.dispose();
              });
            }
            get().setStatusMessage(`Mesh reduced by ${reductionPercent}%`);
          })
          .catch(onErr);
      } else {
        get().setStatusMessage("Mesh Reduce: feature is not simplifiable");
      }
    },
    // D115 Reverse Normals
    reverseNormals: (featureId) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("Reverse Normal: selected feature has no mesh");
        return;
      }
      const featureMesh = feature.mesh as THREE.Object3D;
      if (featureMesh instanceof THREE.Mesh) {
        GeometryEngine.reverseNormals(featureMesh.geometry);
      } else if (featureMesh instanceof THREE.Group) {
        featureMesh.traverse((child) => {
          if (child instanceof THREE.Mesh)
            GeometryEngine.reverseNormals(child.geometry);
        });
      }
      // Mutating mesh.geometry in place doesn't notify Zustand subscribers Ã¢â‚¬â€ replace
      // the features array reference so the timeline / re-renderers see the change.
      set((state) => ({
        features: state.features.map((f) =>
          f.id === featureId ? { ...f } : f,
        ),
      }));
      get().setStatusMessage("Normals reversed");
    },
    // UTL1 Ã¢â‚¬â€ Show All / Hide
    showAllFeatures: () =>
      set((state) => ({
        features: state.features.map((f) => ({ ...f, visible: true })),
        statusMessage: "All features shown",
      })),
    hideFeature: (id) =>
      set((state) => ({
        features: state.features.map((f) =>
          f.id === id ? { ...f, visible: false } : f,
        ),
        statusMessage: "Feature hidden",
      })),

    // MSH8 Ã¢â‚¬â€ commitReverseNormal: clone geometry with flipped normals
    commitReverseNormal: (featureId) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("Reverse Normal: no mesh on selected feature");
        return;
      }
      const srcMesh = feature.mesh as THREE.Mesh;
      if (!(srcMesh instanceof THREE.Mesh)) {
        get().setStatusMessage("Reverse Normal: feature is not a mesh");
        return;
      }
      const newMesh = GeometryEngine.reverseMeshNormals(srcMesh);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
      // Dispose the previous geometry Ã¢â‚¬â€ reverseMeshNormals returns a fresh
      // mesh with cloned geometry, so the source's BufferGeometry is now orphan.
      const oldMesh = feature.mesh;
      set((state) => ({
        features: state.features.map((f) =>
          f.id === featureId ? { ...f, mesh: newMesh } : f,
        ),
        statusMessage: "Mesh normals reversed",
      }));
      if (oldMesh instanceof THREE.Mesh) oldMesh.geometry.dispose();
    },

    // MSH7 Ã¢â‚¬â€ commitMeshCombine: merge all listed feature meshes into one
    commitMeshCombine: (featureIds) => {
      const { features } = get();
      const meshes: THREE.Mesh[] = [];
      for (const fid of featureIds) {
        const f = features.find((x) => x.id === fid);
        if (f?.mesh instanceof THREE.Mesh) meshes.push(f.mesh as THREE.Mesh);
      }
      if (meshes.length < 2) {
        get().setStatusMessage("Mesh Combine: need at least 2 mesh features");
        return;
      }
      const combined = GeometryEngine.combineMeshes(meshes);
      combined.castShadow = true;
      combined.receiveShadow = true;
      const n =
        features.filter((f) => f.name.startsWith("Mesh Combine")).length + 1;
      const newFeature: Feature = {
        id: crypto.randomUUID(),
        name: `Mesh Combine ${n}`,
        type: "import",
        params: {
          featureKind: "mesh-combine",
          sourceIds: featureIds.join(","),
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: combined,
        bodyKind: "mesh",
      };
      set((state) => ({
        features: [...state.features, newFeature],
        statusMessage: "Meshes combined",
      }));
    },

    // MSH11 Ã¢â‚¬â€ commitMeshTransform: apply translate/rotate/scale to a mesh
    commitMeshTransform: (featureId, params) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("Mesh Transform: no mesh on selected feature");
        return;
      }
      const srcMesh = feature.mesh as THREE.Mesh;
      if (!(srcMesh instanceof THREE.Mesh)) {
        get().setStatusMessage("Mesh Transform: feature is not a mesh");
        return;
      }
      // Validate inputs before mutating Ã¢â‚¬â€ scale=0 collapses the mesh permanently
      // and there's no rollback path. NaN/Infinity rotations propagate into
      // the geometry and corrupt every downstream raycast.
      const finite = (v: number) => Number.isFinite(v);
      if (
        !finite(params.tx) ||
        !finite(params.ty) ||
        !finite(params.tz) ||
        !finite(params.rx) ||
        !finite(params.ry) ||
        !finite(params.rz) ||
        !finite(params.scale) ||
        params.scale === 0
      ) {
        get().setStatusMessage(
          "Mesh Transform: invalid params (translate/rotate must be finite, scale != 0)",
        );
        return;
      }
      get().pushUndo();
      const newMesh = GeometryEngine.transformMesh(srcMesh, params);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
      const oldMesh = feature.mesh;
      set((state) => ({
        features: state.features.map((f) =>
          f.id === featureId ? { ...f, mesh: newMesh } : f,
        ),
        statusMessage: "Mesh transformed",
      }));
      // Defer disposal so undo can still reference the old geometry.
      // setTimeout(0) ensures the set() completes and state is stable first.
      if (oldMesh instanceof THREE.Mesh) {
        const geo = oldMesh.geometry;
        setTimeout(() => geo.dispose(), 0);
      }
    },

    // SLD13 Ã¢â‚¬â€ commitScale: scale a feature mesh by sx/sy/sz
    commitScale: (featureId, sx, sy, sz) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("Scale: no mesh on selected feature");
        return;
      }
      const srcMesh = feature.mesh as THREE.Mesh;
      if (!(srcMesh instanceof THREE.Mesh)) {
        get().setStatusMessage("Scale: feature is not a mesh");
        return;
      }
      // Validate before mutating Ã¢â‚¬â€ any zero axis flattens the mesh permanently.
      if (
        !Number.isFinite(sx) ||
        !Number.isFinite(sy) ||
        !Number.isFinite(sz) ||
        sx === 0 ||
        sy === 0 ||
        sz === 0
      ) {
        get().setStatusMessage("Scale: factors must be finite and non-zero");
        return;
      }
      // OCC path: use exact BRep scale when source has an OCC body
      const scaleOccBodyId = srcMesh.userData['brepBodyId'] as string | undefined;
      if (scaleOccBodyId) {
        const occ = getOccSync();
        const scaleBody = occ ? globalBRepBodyRegistry.get(scaleOccBodyId) : undefined;
        if (occ && scaleBody) {
          const scaleFactor = (sx === sy && sy === sz)
            ? sx
            : { x: sx, y: sy, z: sz };
          const newFeatureId = featureId;
          const scaleResult = occScaleWithInstance(occ.oc, scaleBody, new THREE.Vector3(0, 0, 0), scaleFactor, { sourceFeatureId: newFeatureId });
          if (scaleResult) {
            scaleResult.sourceFeatureId = newFeatureId;
            globalBRepBodyRegistry.add(scaleResult);
            const tess = tessellateWithInstance(occ.oc, scaleResult);
            const geo = tessellationToGeometry(tess);
            const scaledMesh = new THREE.Mesh(geo, srcMesh.material);
            attachTessellationToMesh(scaledMesh, tess, scaleResult.id);
            scaledMesh.userData.pickable = true;
            scaledMesh.userData.featureId = newFeatureId;
            scaledMesh.castShadow = true;
            scaledMesh.receiveShadow = true;
            const oldScaleGeom = srcMesh.geometry;
            get().pushUndo();
            set((state) => ({
              features: recomputeBooleanDependents(
                state.features.map((f) => f.id === featureId ? { ...f, mesh: scaledMesh } : f),
                [featureId],
              ),
              statusMessage: `Scaled (OCC) ${sx}×${sy}×${sz}`,
            }));
            setTimeout(() => oldScaleGeom.dispose(), 0);
            return;
          }
        }
      }

      get().pushUndo();
      const newMesh = GeometryEngine.scaleMesh(srcMesh, sx, sy, sz);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
      const oldGeom = srcMesh.geometry;
      set((state) => {
        const features = state.features.map((f) =>
          f.id === featureId ? { ...f, mesh: newMesh } : f,
        );
        return {
          features: recomputeBooleanDependents(features, [featureId]),
          statusMessage: `Scaled ${sx}×${sy}×${sz}`,
        };
      });
      // Defer so the undo snapshot can still reference the old geometry if needed.
      setTimeout(() => oldGeom.dispose(), 0);
    },

    // Align tool — geometry-pair picking state
    alignPickStage: "idle",
    alignPickKind: "face",
    alignSource: null,
    alignTarget: null,
    setAlignPickStage: (stage) => set({ alignPickStage: stage }),
    setAlignPickKind: (kind) => set({ alignPickKind: kind }),
    setAlignSource: (pick) => set({ alignSource: pick }),
    setAlignTarget: (pick) => set({ alignTarget: pick }),
    resetAlign: () =>
      set({ alignPickStage: "idle", alignSource: null, alignTarget: null }),

    // Align tool — compute rigid transform from picked source→target geometry
    // and apply it to the source body (primitive via params, else bake mesh).
    commitAlign: (opts) => {
      const { alignSource, alignTarget, features } = get();
      if (!alignSource || !alignTarget) {
        get().setStatusMessage(
          "Align: pick a source and a target geometry first",
        );
        return;
      }
      if (!alignSource.featureId) {
        get().setStatusMessage("Align: source must be on a body");
        return;
      }
      const feature = features.find((f) => f.id === alignSource.featureId);
      if (!feature) {
        get().setStatusMessage("Align: source body not found");
        return;
      }

      const srcPt = new THREE.Vector3(...alignSource.point);
      const tgtPt = new THREE.Vector3(...alignTarget.point);

      const wantRotation =
        opts.moveType === "rotate" ||
        (opts.moveType === "align" && opts.allowRotation);

      // Rotation aligning source direction → desired target direction.
      const rot = new THREE.Quaternion();
      if (wantRotation && alignSource.dir && alignTarget.dir) {
        const sDir = new THREE.Vector3(...alignSource.dir).normalize();
        let tDir = new THREE.Vector3(...alignTarget.dir).normalize();
        // Faces mate when normals oppose (flip = same dir). Edges align when
        // directions match (flip = reversed).
        const bothFaces =
          alignSource.kind === "face" && alignTarget.kind === "face";
        if (bothFaces ? !opts.flip : opts.flip) tDir = tDir.negate();
        if (sDir.lengthSq() > 1e-9 && tDir.lengthSq() > 1e-9) {
          rot.setFromUnitVectors(sDir, tDir);
        }
      }

      // World transform M applied to the source body:
      //  align     : T(tgt) · R · T(-src)   (rotate about src point, move to tgt)
      //  rotate    : T(src) · R · T(-src)   (rotate in place about src point)
      //  translate : T(tgt - src)           (pure translation, no rotation)
      const M = new THREE.Matrix4();
      if (opts.moveType === "translate") {
        M.makeTranslation(
          tgtPt.x - srcPt.x,
          tgtPt.y - srcPt.y,
          tgtPt.z - srcPt.z,
        );
      } else {
        const pivotBack = new THREE.Matrix4().makeTranslation(
          -srcPt.x,
          -srcPt.y,
          -srcPt.z,
        );
        const Rm = new THREE.Matrix4().makeRotationFromQuaternion(rot);
        const dest = opts.moveType === "rotate" ? srcPt : tgtPt;
        const post = new THREE.Matrix4().makeTranslation(
          dest.x,
          dest.y,
          dest.z,
        );
        M.multiplyMatrices(post, Rm).multiply(pivotBack);
      }

      get().pushUndo();

      // Primitive bodies are regenerated from params each render — write the
      // transform back into x/y/z + rx/ry/rz instead of baking geometry.
      if (
        feature.type === "primitive" &&
        !(feature.mesh instanceof THREE.Mesh)
      ) {
        const p = feature.params;
        const curPos = new THREE.Vector3(
          (p.x as number) || 0,
          (p.y as number) || 0,
          (p.z as number) || 0,
        );
        const curQuat = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            THREE.MathUtils.degToRad((p.rx as number) || 0),
            THREE.MathUtils.degToRad((p.ry as number) || 0),
            THREE.MathUtils.degToRad((p.rz as number) || 0),
            "XYZ",
          ),
        );
        const curMat = new THREE.Matrix4().compose(
          curPos,
          curQuat,
          new THREE.Vector3(1, 1, 1),
        );
        const newMat = new THREE.Matrix4().multiplyMatrices(M, curMat);
        const outPos = new THREE.Vector3();
        const outQuat = new THREE.Quaternion();
        const outScale = new THREE.Vector3();
        newMat.decompose(outPos, outQuat, outScale);
        const e = new THREE.Euler().setFromQuaternion(outQuat, "XYZ");
        get().updateFeatureParams(feature.id, {
          ...p,
          x: outPos.x,
          y: outPos.y,
          z: outPos.z,
          rx: THREE.MathUtils.radToDeg(e.x),
          ry: THREE.MathUtils.radToDeg(e.y),
          rz: THREE.MathUtils.radToDeg(e.z),
        });
        set({
          statusMessage: `Aligned ${feature.name}`,
          alignPickStage: "idle",
          alignSource: null,
          alignTarget: null,
        });
        return;
      }

      // Mesh-backed bodies — bake the world matrix into a cloned geometry.
      if (feature.mesh instanceof THREE.Mesh) {
        const srcMesh = feature.mesh;
        const geom = srcMesh.geometry.clone();
        geom.applyMatrix4(M);
        // Topology polylines are in the pre-transform local frame; delete them so
        // the lazy picker re-extracts from the new world-baked vertex positions.
        delete geom.userData.topology;
        delete geom.userData._topoV;
        geom.computeVertexNormals();
        const newMesh = new THREE.Mesh(geom, srcMesh.material);
        newMesh.userData = { ...srcMesh.userData };
        newMesh.castShadow = true;
        newMesh.receiveShadow = true;
        const oldGeom = srcMesh.geometry;
        set((state) => ({
          features: recomputeBooleanDependents(
            state.features.map((f) =>
              f.id === feature.id ? { ...f, mesh: newMesh } : f,
            ),
            [feature.id],
          ),
          statusMessage: `Aligned ${feature.name}`,
          alignPickStage: "idle",
          alignSource: null,
          alignTarget: null,
        }));
        setTimeout(() => oldGeom.dispose(), 0);
        return;
      }

      get().setStatusMessage("Align: unsupported body type (no mesh)");
    },

    // 3D edge fillet using exact OCC topology edge IDs.
    commitFillet: (radius, segments, featureId?, filletParams?) => {
      void segments;
      const feature = featureId
        ? get().features.find((candidate) => candidate.id === featureId)
        : undefined;
      const edgeIds =
        get().filletEdgeIds.length > 0
          ? get().filletEdgeIds
          : storedEdgeIds(feature?.params.edgeIds);
      const occ = getOccSync();
      const selection = occ ? parseOccEdgeSelection(edgeIds) : null;
      const srcBody = selection ? globalBRepBodyRegistry.get(selection.bodyId) : undefined;
      const numericEdgeIds = srcBody
        ? selection!.edgeIds.filter((id) => srcBody.edgeIds.has(id))
        : [];
      const filletEdgeSets = srcBody
          ? resolveOccFilletEdgeSets(numericEdgeIds, srcBody, filletParams, radius)
        : undefined;
      const { continuity } = resolveOccFilletOptions(filletParams);
      applyOccEdgeModification({
        tool: "Fillet",
        featureId,
        edgeIds,
        filletEdgeSets,
        continuity,
      });
    },
    // 3D edge chamfer using exact OCC topology edge IDs.
    commitChamfer: (distance, distance2, featureId?, chamferParams?) => {
      void chamferParams;
      const feature = featureId
        ? get().features.find((candidate) => candidate.id === featureId)
        : undefined;
      const edgeIds =
        get().chamferEdgeIds.length > 0
          ? get().chamferEdgeIds
          : storedEdgeIds(feature?.params.edgeIds);
      applyOccEdgeModification({
        tool: "Chamfer",
        featureId,
        edgeIds,
        distance,
        distance2,
      });
    },
    // Replay an existing fillet/chamfer feature with updated OCC params.
    replayEdgeModificationFeature: (featureId: string) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature || (feature.type !== "fillet" && feature.type !== "chamfer"))
        return;

      const params = feature.params;
      const edgeIds = storedEdgeIds(params.edgeIds);
      if (edgeIds.length === 0) {
        get().setStatusMessage(`${feature.type}: no edgeIds stored`);
        return;
      }

      if (feature.type === "fillet") {
        const occ = getOccSync();
        const selection = occ ? parseOccEdgeSelection(edgeIds) : null;
        const srcBody = selection ? globalBRepBodyRegistry.get(selection.bodyId) : undefined;
        const numericEdgeIds = srcBody
          ? selection!.edgeIds.filter((id) => srcBody.edgeIds.has(id))
          : [];
        const filletEdgeSets = srcBody
          ? resolveOccFilletEdgeSets(numericEdgeIds, srcBody, params)
          : undefined;
        const { continuity } = resolveOccFilletOptions(params);
        applyOccEdgeModification({
          tool: "Fillet",
          featureId,
          edgeIds,
          filletEdgeSets,
          continuity,
          pushUndo: true,
        });
        return;
      }

      const [distance, distance2] = resolveOccChamferDistances(params);
      applyOccEdgeModification({
        tool: "Chamfer",
        featureId,
        edgeIds,
        distance,
        distance2,
        pushUndo: true,
      });
    },
    // SLD12 Ã¢â‚¬â€ commitCombine: boolean op on two feature meshes
    commitCombine: (targetFeatureId, toolFeatureId, operation, keepTool) => {
      const { features } = get();
      const toolFeatureIds = Array.isArray(toolFeatureId) ? toolFeatureId : [toolFeatureId];
      const targetFeature = features.find((f) => f.id === targetFeatureId);
      const toolFeatures = toolFeatureIds
        .map((id) => features.find((f) => f.id === id))
        .filter((f): f is Feature => !!f);
      if (!targetFeature?.mesh || !(targetFeature.mesh instanceof THREE.Mesh)) {
        get().setStatusMessage("Combine: target has no mesh");
        return;
      }
      if (toolFeatures.length === 0 || toolFeatures.some((f) => !(f.mesh instanceof THREE.Mesh))) {
        get().setStatusMessage("Combine: tool has no mesh");
        return;
      }
      const tgtMesh = targetFeature.mesh as THREE.Mesh;
      const toolMeshes = toolFeatures.map((feature) => feature.mesh as THREE.Mesh);
      const featureId = crypto.randomUUID();
      const occ = getOccSync();
      const targetOccBodyId = tgtMesh.userData['brepBodyId'] as string | undefined;
      const targetOccBody = occ && targetOccBodyId ? globalBRepBodyRegistry.get(targetOccBodyId) : undefined;
      const toolOccBodies = occ
        ? toolMeshes
            .map((mesh) => globalBRepBodyRegistry.get(mesh.userData['brepBodyId'] as string))
            .filter((body): body is BRepBody => !!body)
        : [];
      if (occ && targetOccBody && toolOccBodies.length === toolMeshes.length) {
        const occOp = operation === 'join' ? 'union' : operation === 'cut' ? 'subtract' : 'intersect';
        const occResult = performOccBooleanMultiWithInstance(
          occ.oc,
          occOp,
          targetOccBody,
          toolOccBodies,
          { sourceFeatureId: featureId },
        );
        if (!occResult) {
          get().setStatusMessage(`Combine (${operation}) failed: OCC boolean failed`);
          return;
        }
        get().pushUndo();
        occResult.sourceFeatureId = featureId;
        globalBRepBodyRegistry.add(occResult);
        const tess = tessellateWithInstance(occ.oc, occResult);
        const geo = tessellationToGeometry(tess);
        const occMesh = new THREE.Mesh(geo, tgtMesh.material);
        attachTessellationToMesh(occMesh, tess, occResult.id);
        occMesh.userData.pickable = true;
        occMesh.userData.featureId = featureId;
        occMesh.castShadow = true;
        occMesh.receiveShadow = true;
        const n = features.filter((f) => f.type === "combine").length + 1;
        const combineFeature: Feature = {
          id: featureId,
          name: `Combine ${n} (${operation})`,
          type: "combine",
          params: {
            operation,
            keepTools: keepTool,
            targetId: targetFeatureId,
            toolId: toolFeatureIds[0],
            toolIds: toolFeatureIds,
            booleanParentIds: [targetFeatureId, ...toolFeatureIds],
            recomputeOnParentChange: true,
          },
          mesh: occMesh,
          visible: true,
          suppressed: false,
          timestamp: Date.now(),
          bodyKind: targetFeature.bodyKind,
        };
        set((state) => {
          const parentIds = [targetFeatureId, ...toolFeatureIds];
          const updated = state.features.map((f) =>
            !keepTool && parentIds.includes(f.id)
              ? { ...f, suppressed: true }
              : f,
          );
          const suppressionEntries: Record<string, boolean> = {
            [combineFeature.id]: false,
            ...Object.fromEntries(parentIds.map((id) => [id, !keepTool])),
          };
          return {
            features: [...updated, combineFeature],
            designConfigurations: syncActiveConfigurationSuppression(
              state,
              suppressionEntries,
            ),
            statusMessage: `Combine (${operation}) created with ${toolFeatureIds.length} tool bodies (OCC)`,
          };
        });
        return;
      }
      let resultGeom: THREE.BufferGeometry;
      // CSG can throw on degenerate / non-manifold inputs. Catch + report so
      // the user gets a status message instead of a silent broken state, and
      // the partially-built result (if any) doesn't end up in the scene.
      // pushUndo is called AFTER the try/catch so a failed CSG doesn't leave
      // an orphaned snapshot on the undo stack.
      try {
        resultGeom = toolMeshes.reduce(
          (acc, toolMesh) =>
            runBoolean(new THREE.Mesh(acc, tgtMesh.material), toolMesh, operation),
          tgtMesh.geometry as THREE.BufferGeometry,
        );
      } catch (err) {
        get().setStatusMessage(
          `Combine (${operation}) failed: ${errorMessage(err, "unknown CSG error")}`,
        );
        return;
      }
      get().pushUndo();
      const newMesh = new THREE.Mesh(resultGeom, tgtMesh.material);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
      const n = features.filter((f) => f.type === "combine").length + 1;
      const combineFeature: Feature = {
        id: featureId,
        name: `Combine ${n} (${operation})`,
        type: "combine",
        params: {
          operation,
          keepTools: keepTool,
          targetId: targetFeatureId,
          toolId: toolFeatureIds[0],
          toolIds: toolFeatureIds,
          booleanParentIds: [targetFeatureId, ...toolFeatureIds],
          recomputeOnParentChange: true,
        },
        mesh: newMesh,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: targetFeature.bodyKind,
      };
      set((state) => {
        const updated = state.features.map((f) =>
          !keepTool && (f.id === targetFeatureId || toolFeatureIds.includes(f.id))
            ? { ...f, suppressed: true }
            : f,
        );
        const suppressionEntries: Record<string, boolean> = {
          [combineFeature.id]: false,
          [targetFeatureId]: !keepTool,
          ...Object.fromEntries(toolFeatureIds.map((id) => [id, !keepTool])),
        };
        return {
          features: [...updated, combineFeature],
          designConfigurations: syncActiveConfigurationSuppression(
            state,
            suppressionEntries,
          ),
          statusMessage: `Combine (${operation}) created with editable parents`,
        };
      });
      // Free GPU buffers for suppressed source meshes. THREE.js dispose() only
      // triggers the renderer to release WebGL buffers — the CPU-side Float32Arrays
      // remain, so recomputeBooleanDependents can still read geometry for CSG.
      if (!keepTool) {
        setTimeout(() => {
          tgtMesh.geometry.dispose();
          toolMeshes.forEach((toolMesh) => toolMesh.geometry.dispose());
        }, 0);
      }
    },

    // SLD17 Ã¢â‚¬â€ commitMirrorFeature: mirror a feature's mesh across a plane
    commitMirrorFeature: (featureId, plane) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("Mirror Feature: no mesh on selected feature");
        return;
      }
      const srcMesh = feature.mesh as THREE.Mesh;
      if (!(srcMesh instanceof THREE.Mesh)) {
        get().setStatusMessage("Mirror Feature: feature is not a mesh");
        return;
      }
      // OCC path: use exact BRep mirror when source has an OCC body
      const occBodyId = srcMesh.userData['brepBodyId'] as string | undefined;
      if (occBodyId) {
        const occ = getOccSync();
        const srcBody = occ ? globalBRepBodyRegistry.get(occBodyId) : undefined;
        if (occ && srcBody) {
          const newFeatureId = crypto.randomUUID();
          const occResult = occMirrorWithInstance(occ.oc, srcBody, mirrorPlaneFromString(plane), { sourceFeatureId: newFeatureId });
          if (occResult) {
            occResult.sourceFeatureId = newFeatureId;
            globalBRepBodyRegistry.add(occResult);
            const tess = tessellateWithInstance(occ.oc, occResult);
            const geo = tessellationToGeometry(tess);
            const occMirroredMesh = new THREE.Mesh(geo, srcMesh.material);
            attachTessellationToMesh(occMirroredMesh, tess, occResult.id);
            occMirroredMesh.userData.pickable = true;
            occMirroredMesh.userData.featureId = newFeatureId;
            occMirroredMesh.castShadow = true;
            occMirroredMesh.receiveShadow = true;
            const nOcc = features.filter((f) => f.name.startsWith('Mirror Feature')).length + 1;
            const occMirrorFeature: Feature = {
              id: newFeatureId,
              name: `Mirror Feature ${nOcc}`,
              type: 'mirror',
              params: { featureKind: 'mirror-feature', sourceId: featureId, plane },
              visible: true,
              suppressed: false,
              timestamp: Date.now(),
              mesh: occMirroredMesh,
              bodyKind: feature.bodyKind,
            };
            get().pushUndo();
            set((state) => ({
              features: [...state.features, occMirrorFeature],
              statusMessage: `Feature mirrored on ${plane} plane (OCC)`,
            }));
            return;
          }
        }
      }

      get().pushUndo();
      const mirrored = GeometryEngine.mirrorMesh(srcMesh, plane);
      mirrored.castShadow = true;
      mirrored.receiveShadow = true;
      const n =
        features.filter((f) => f.name.startsWith("Mirror Feature")).length + 1;
      const newFeature: Feature = {
        id: crypto.randomUUID(),
        name: `Mirror Feature ${n}`,
        type: "mirror",
        params: { featureKind: "mirror-feature", sourceId: featureId, plane },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: mirrored,
        bodyKind: feature.bodyKind,
      };
      set((state) => ({
        features: [...state.features, newFeature],
        statusMessage: `Feature mirrored on ${plane} plane`,
      }));
    },

    // SLD12-edit — re-run CSG on an existing combine feature with new params.
    // Atomically updates params + mesh in one pushUndo so the edit is a single
    // undo step (avoids double-snapshot from separate updateFeatureParams + CSG).
    recommitCombine: (featureId, params) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature || feature.type !== "combine") {
        get().setStatusMessage("Combine (edit): feature not found");
        return;
      }
      const { operation, keepTools, targetId, toolId } = params;
      const toolIds = params.toolIds?.length ? params.toolIds : [toolId];
      const targetFeature = features.find((f) => f.id === targetId);
      const toolFeatures = toolIds
        .map((id) => features.find((f) => f.id === id))
        .filter((f): f is Feature => !!f);
      if (!targetFeature?.mesh || !(targetFeature.mesh instanceof THREE.Mesh)) {
        get().setStatusMessage("Combine (edit): target has no mesh");
        return;
      }
      if (toolFeatures.length === 0 || toolFeatures.some((toolFeature) => !(toolFeature.mesh instanceof THREE.Mesh))) {
        get().setStatusMessage("Combine (edit): tool has no mesh");
        return;
      }
      const tgtMesh = targetFeature.mesh as THREE.Mesh;
      const toolMeshes = toolFeatures.map((toolFeature) => toolFeature.mesh as THREE.Mesh);
      let resultGeom: THREE.BufferGeometry;
      try {
        resultGeom = toolMeshes.reduce(
          (acc, toolMesh) =>
            runBoolean(new THREE.Mesh(acc, tgtMesh.material), toolMesh, operation),
          tgtMesh.geometry as THREE.BufferGeometry,
        );
      } catch (err) {
        get().setStatusMessage(
          `Combine (edit) failed: ${errorMessage(err, "unknown CSG error")}`,
        );
        return;
      }
      get().pushUndo();
      const newMesh = new THREE.Mesh(resultGeom, tgtMesh.material);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
      const oldMesh = feature.mesh;
      set((state) => {
        const oldParentIds = getBooleanParentIds(feature);
        const nextParentIds = [targetId, ...toolIds];
        const affectedParentIds = Array.from(
          new Set([...oldParentIds, ...nextParentIds]),
        );
        const features = state.features.map((f) => {
          if (f.id === featureId) {
            return {
              ...f,
              mesh: newMesh,
              params: {
                ...f.params,
                operation,
                keepTools,
                targetId,
                toolId: toolIds[0],
                toolIds,
                booleanParentIds: [targetId, ...toolIds],
                recomputeOnParentChange: true,
              },
            };
          }
          if (affectedParentIds.includes(f.id)) {
            const isNextParent = nextParentIds.includes(f.id);
            const shouldSuppress = isNextParent
              ? !keepTools
              : parentIsHiddenByAnotherCombine(state.features, f.id, featureId);
            return { ...f, suppressed: shouldSuppress };
          }
          return f;
        });
        const suppressionEntries: Record<string, boolean> = {
          [featureId]: false,
        };
        for (const id of affectedParentIds) {
          suppressionEntries[id] = !!features.find(
            (candidate) => candidate.id === id,
          )?.suppressed;
        }
        return {
          features,
          designConfigurations: syncActiveConfigurationSuppression(
            state,
            suppressionEntries,
          ),
          statusMessage: `Combine (${operation}) updated`,
        };
      });
      if (oldMesh instanceof THREE.Mesh) {
        const geo = oldMesh.geometry;
        setTimeout(() => geo.dispose(), 0);
      }
    },

    toggleFeatureVisibility: (id) =>
      set((state) => ({
        features: state.features.map((f) =>
          f.id === id ? { ...f, visible: !f.visible } : f,
        ),
      })),
    toggleFeatureSuppressed: (id) =>
      set((state) => {
        const features = state.features.map((f) =>
          f.id === id ? { ...f, suppressed: !f.suppressed } : f,
        );
        const target = features.find((feature) => feature.id === id);
        return {
          features,
          designConfigurations: state.designConfigurations.map(
            (configuration) =>
              configuration.id === state.activeDesignConfigurationId && target
                ? {
                    ...configuration,
                    featureSuppression: {
                      ...configuration.featureSuppression,
                      [id]: !!target.suppressed,
                    },
                    updatedAt: Date.now(),
                  }
                : configuration,
          ),
        };
      }),
  };
}
