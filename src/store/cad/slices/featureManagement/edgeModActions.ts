import * as THREE from "three";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { errorMessage } from "../../../../utils/errorHandling";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import {
  occFilletEdgeSetsWithInstance,
  occFullRoundFilletWithInstance,
  type OccFilletEdgeSet,
} from "../../../../engine/occ/ops/fillet";
import type { BRepBody } from "../../../../engine/occ/brepBody";
import { occChamferWithInstance } from "../../../../engine/occ/ops/chamfer";
import { getOccSync } from "../../../../engine/occ/loader";
import { createRegisteredOccMesh } from "../../../../engine/occ/registeredMesh";
import { storedEdgeIds, parseOccEdgeSelection } from "../../../../utils/occEdgeUtils";
import { disposeMeshDeferred } from "../../../../engine/occ/picking";
import { BODY_MATERIAL } from "../../../../components/viewport/scene/bodyMaterial";

const DEFAULT_FILLET_RADIUS = 2;
const DEFAULT_CHAMFER_DISTANCE = 2;

function resolveOccFilletOptions(params?: Record<string, unknown>): { continuity?: 'G1' | 'G2' } {
  return { continuity: params?.isG2 === true ? 'G2' : 'G1' };
}

function resolveOccFilletEdgeSets(
  numericEdgeIds: number[],
  srcBody: BRepBody,
  params?: Record<string, unknown>,
  fallbackRadius = DEFAULT_FILLET_RADIUS,
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
        const r1 = typeof s.offsetOne === 'number' ? Math.max(s.offsetOne, 0.001) : (params.radius as number) ?? DEFAULT_FILLET_RADIUS;
        const r2 = typeof s.offsetTwo === 'number' ? Math.max(s.offsetTwo, 0.001) : r1;
        sets.push({ edgeIds: setNumericIds, startRadius: r1, endRadius: r2 });
      } else {
        sets.push({ edgeIds: setNumericIds, radius: typeof s.radius === 'number' ? s.radius : (params.radius as number) ?? DEFAULT_FILLET_RADIUS });
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
  const distance = typeof params.distance === "number" ? params.distance : DEFAULT_CHAMFER_DISTANCE;
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

export function createEdgeModActions({
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
    fullRoundFaces,
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
    fullRoundFaces?: { centerFaceId: number; sideFaceIds: [number, number] };
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
      filletEdgeSets ?? [{ edgeIds: numericEdgeIds, radius: radius ?? DEFAULT_FILLET_RADIUS }];

    const result =
      tool === "Fillet"
        ? (fullRoundFaces
            ? occFullRoundFilletWithInstance(
                occ.oc,
                srcBody,
                fullRoundFaces.centerFaceId,
                fullRoundFaces.sideFaceIds,
                { sourceFeatureId: featureId },
              )
            : occFilletEdgeSetsWithInstance(
                occ.oc,
                srcBody,
                effectiveFilletEdgeSets,
                { sourceFeatureId: featureId, continuity },
              ))
        : occChamferWithInstance(occ.oc, srcBody, numericEdgeIds, distance ?? 0, {
            distance2:
              distance2 !== undefined && distance2 !== distance ? distance2 : undefined,
            sourceFeatureId: featureId,
          });
    if (!result) {
      return markOccEdgeModificationError(featureId, tool, "OCC operation failed for the selected edge set");
    }

    const srcFeatureId = srcBody.sourceFeatureId;
    const srcFeature = srcFeatureId
      ? get().features.find((feature) => feature.id === srcFeatureId)
      : undefined;
    const srcMesh = srcFeature?.mesh;
    // Use the shared BODY_MATERIAL singleton when the source has no stored mesh
    // (e.g. extrudes rendered via ExtrudedBodies). Creating a new material here
    // was a per-fillet leak — BODY_MATERIAL is a module-level singleton that is
    // never disposed, so it is safe to share across all edge-modification meshes.
    const material = srcMesh instanceof THREE.Mesh ? srcMesh.material : BODY_MATERIAL;
    let newMesh: THREE.Mesh;
    try {
      result.sourceFeatureId = featureId;
      newMesh = createRegisteredOccMesh(occ.oc, result, material, featureId);
    } catch (err) {
      return markOccEdgeModificationError(
        featureId,
        tool,
        `OCC tessellation failed: ${errorMessage(err, "unknown error")}`,
      );
    }

    const currentFeature = get().features.find((feature) => feature.id === featureId);
    const prevMesh = currentFeature?.mesh instanceof THREE.Mesh ? currentFeature.mesh : null;
    // Capture the old body ID before set() so we can evict it from the registry
    // after the state update. Without this, each replay leaks one WASM OCC shape.
    const oldBodyId = prevMesh?.userData['brepBodyId'] as string | undefined;
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
    if (prevMesh && prevMesh.geometry !== newMesh.geometry) {
      disposeMeshDeferred(prevMesh);
      if (oldBodyId) globalBRepBodyRegistry.delete(oldBodyId);
    }
    return true;
  };

  return {
    // 3D edge fillet using exact OCC topology edge IDs.
    commitFillet: (radius, segments, featureId?, filletParams?) => {
      void segments;
      const feature = featureId
        ? get().features.find((candidate) => candidate.id === featureId)
        : undefined;

      // ── Full-round fillet path: uses center + two side faces, not edge IDs ──
      const mode = (filletParams?.mode ?? feature?.params.mode) as string | undefined;
      if (mode === 'full-round') {
        const {
          filletFullRoundCenterOccBodyId,
          filletFullRoundCenterOccFaceId,
          filletFullRoundSide1OccFaceId,
          filletFullRoundSide2OccFaceId,
        } = get();
        // Fall back to stored face IDs when replaying a feature (no live state)
        const centerOccBodyId = filletFullRoundCenterOccBodyId ?? (filletParams?.centerOccBodyId as string | undefined) ?? (feature?.params.centerOccBodyId as string | undefined);
        const centerOccFaceId = filletFullRoundCenterOccFaceId ?? (filletParams?.centerOccFaceId as number | undefined) ?? (feature?.params.centerOccFaceId as number | undefined);
        const side1OccFaceId = filletFullRoundSide1OccFaceId ?? (filletParams?.side1OccFaceId as number | undefined) ?? (feature?.params.side1OccFaceId as number | undefined);
        const side2OccFaceId = filletFullRoundSide2OccFaceId ?? (filletParams?.side2OccFaceId as number | undefined) ?? (feature?.params.side2OccFaceId as number | undefined);

        if (!featureId) { get().setStatusMessage('Full-Round Fillet: requires a feature id'); return; }
        if (!centerOccBodyId || !Number.isInteger(centerOccFaceId) || !Number.isInteger(side1OccFaceId) || !Number.isInteger(side2OccFaceId)) {
          get().setStatusMessage('Full-Round Fillet: select center face and both side faces first');
          return;
        }
        const occ = getOccSync();
        if (!occ) { get().setStatusMessage('Full-Round Fillet: OCC kernel is still loading'); return; }
        const srcBody = globalBRepBodyRegistry.get(centerOccBodyId);
        if (!srcBody) { get().setStatusMessage('Full-Round Fillet: source body is no longer available'); return; }

        const resultBody = occFullRoundFilletWithInstance(
          occ.oc, srcBody,
          centerOccFaceId!,
          [side1OccFaceId!, side2OccFaceId!],
          { sourceFeatureId: featureId },
        );
        if (!resultBody) {
          markOccEdgeModificationError(featureId, 'Full-Round Fillet', 'OCC operation failed');
          return;
        }

        const srcFeature = get().features.find((f) => f.id === srcBody.sourceFeatureId);
        const material = srcFeature?.mesh instanceof THREE.Mesh ? srcFeature.mesh.material : BODY_MATERIAL;
        let newMesh: THREE.Mesh;
        try {
          resultBody.sourceFeatureId = featureId;
          newMesh = createRegisteredOccMesh(occ.oc, resultBody, material, featureId);
        } catch (err) {
          markOccEdgeModificationError(featureId, 'Full-Round Fillet', errorMessage(err, 'unknown error'));
          return;
        }
        const currentFeature = get().features.find((f) => f.id === featureId);
        const prevMesh = currentFeature?.mesh instanceof THREE.Mesh ? currentFeature.mesh : null;
        const oldBodyId = prevMesh?.userData['brepBodyId'] as string | undefined;
        set((state) => ({
          features: state.features.map((f) =>
            f.id === featureId
              ? { ...f, mesh: newMesh, healthState: 'healthy' as const, healthMessage: undefined }
              : f,
          ),
          statusMessage: 'Full-round fillet applied',
        }));
        if (prevMesh && prevMesh.geometry !== newMesh.geometry) {
          disposeMeshDeferred(prevMesh);
          if (oldBodyId) globalBRepBodyRegistry.delete(oldBodyId);
        }
        return;
      }

      // ── Standard edge-based fillet path ──
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

      // Full-round with explicit face IDs: use occFullRoundFilletWithInstance
      const centerFaceId = typeof filletParams?.centerFaceId === 'number' ? filletParams.centerFaceId : undefined;
      const rawSideIds = Array.isArray(filletParams?.sideFaceIds) ? filletParams!.sideFaceIds as unknown[] : undefined;
      const sideFaceIds: [number, number] | undefined =
        rawSideIds && rawSideIds.length >= 2 && typeof rawSideIds[0] === 'number' && typeof rawSideIds[1] === 'number'
          ? [rawSideIds[0] as number, rawSideIds[1] as number]
          : undefined;
      const fullRoundFaces = centerFaceId !== undefined && sideFaceIds ? { centerFaceId, sideFaceIds } : undefined;

      applyOccEdgeModification({
        tool: "Fillet",
        featureId,
        edgeIds,
        filletEdgeSets,
        continuity,
        fullRoundFaces,
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

      // Full-round fillet replay uses face IDs stored in params, not edgeIds
      if (feature.type === "fillet" && params.mode === 'full-round') {
        const radius = typeof params.radius === 'number' ? params.radius : DEFAULT_FILLET_RADIUS;
        get().pushUndo();
        get().commitFillet(radius, 0, featureId, params as Record<string, unknown>);
        return;
      }

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
        const replayCenterFaceId = typeof params.centerFaceId === 'number' ? params.centerFaceId : undefined;
        const rawReplaySideIds = Array.isArray(params.sideFaceIds) ? params.sideFaceIds as unknown[] : undefined;
        const replaySideFaceIds: [number, number] | undefined =
          rawReplaySideIds && rawReplaySideIds.length >= 2 && typeof rawReplaySideIds[0] === 'number' && typeof rawReplaySideIds[1] === 'number'
            ? [rawReplaySideIds[0] as number, rawReplaySideIds[1] as number]
            : undefined;
        const replayFullRoundFaces = replayCenterFaceId !== undefined && replaySideFaceIds
          ? { centerFaceId: replayCenterFaceId, sideFaceIds: replaySideFaceIds }
          : undefined;
        applyOccEdgeModification({
          tool: "Fillet",
          featureId,
          edgeIds,
          filletEdgeSets,
          continuity,
          pushUndo: true,
          fullRoundFaces: replayFullRoundFaces,
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
  };
}
