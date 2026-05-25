import * as THREE from "three";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { errorMessage } from "../../../../utils/errorHandling";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import {
  occFilletEdgeSetsWithInstance,
  occFullRoundFilletWithInstance,
  occRuleFilletAllEdgesWithInstance,
  occRuleFilletBetweenFacesWithInstance,
  type FullRoundSideFaces,
  type OccFilletEdgeSet,
} from "../../../../engine/occ/ops/fillet";
import type { BRepBody } from "../../../../engine/occ/brepBody";
import { occChamferWithInstance } from "../../../../engine/occ/ops/chamfer";
import { collectTangentChainEdges } from "../../../../engine/occ/ops/adjacency";
import { getOccSync } from "../../../../engine/occ/loader";
import { createRegisteredOccMesh } from "../../../../engine/occ/registeredMesh";
import { storedEdgeIds, parseOccEdgeSelection } from "../../../../utils/occEdgeUtils";
import { disposeMeshDeferred } from "../../../../engine/occ/picking";
import { BODY_MATERIAL } from "../../../../components/viewport/scene/bodyMaterial";

const DEFAULT_FILLET_RADIUS = 2;
const DEFAULT_CHAMFER_DISTANCE = 2;

function resolveOccFilletOptions(params?: Record<string, unknown>): {
  continuity?: 'G1' | 'G2';
  isRollingBallCorner?: boolean;
} {
  return {
    continuity: params?.isG2 === true ? 'G2' : 'G1',
    isRollingBallCorner: params?.isRollingBallCorner !== false,
  };
}

function expandTangentChain(
  occ: ReturnType<typeof getOccSync>,
  srcBody: BRepBody,
  edgeIds: number[],
): number[] {
  if (!occ || edgeIds.length === 0) return edgeIds;
  try {
    const expanded = collectTangentChainEdges(occ.oc, srcBody, edgeIds);
    if (expanded.length > edgeIds.length) return expanded;
    return edgeIds;
  } catch (e) {
    console.warn('[fillet.propagate] tangent-chain walk failed:', e);
    return edgeIds;
  }
}

function resolveOccFilletEdgeSets(
  numericEdgeIds: number[],
  srcBody: BRepBody,
  params?: Record<string, unknown>,
  fallbackRadius = DEFAULT_FILLET_RADIUS,
): OccFilletEdgeSet[] {
  if (!params) return [{ edgeIds: numericEdgeIds, radius: fallbackRadius }];

  // FILLET-4: when propagate=true, walk BRep topology to include tangent-
  // connected edges. OCC's BRepFilletAPI_MakeFillet does not auto-propagate.
  const propagate = params.propagate === true;
  const occ = propagate ? getOccSync() : null;
  const expand = (ids: number[]): number[] =>
    propagate && occ ? expandTangentChain(occ, srcBody, ids) : ids;

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
      const expandedIds = expand(setNumericIds);
      if (s.type === 'chord-length' && typeof s.chordLength === 'number') {
        sets.push({ edgeIds: expandedIds, chordLength: s.chordLength });
      } else if (s.type === 'variable' && typeof s.radius === 'number' && typeof s.endRadius === 'number') {
        sets.push({ edgeIds: expandedIds, startRadius: s.radius, endRadius: s.endRadius });
      } else if (s.type === 'asymmetric') {
        // FILLET-1: per-set isFlipped swaps offsetOne ↔ offsetTwo.
        // FILLET-3: per-face asymmetric — isAsymmetric routes to Add_4(d1, d2, edge, face).
        let r1 = typeof s.offsetOne === 'number' ? Math.max(s.offsetOne, 0.001) : (params.radius as number) ?? DEFAULT_FILLET_RADIUS;
        let r2 = typeof s.offsetTwo === 'number' ? Math.max(s.offsetTwo, 0.001) : r1;
        if (s.isFlipped === true) [r1, r2] = [r2, r1];
        sets.push({ edgeIds: expandedIds, startRadius: r1, endRadius: r2, isAsymmetric: true });
      } else {
        sets.push({ edgeIds: expandedIds, radius: typeof s.radius === 'number' ? s.radius : (params.radius as number) ?? DEFAULT_FILLET_RADIUS });
      }
    }
    if (sets.length > 0) return sets;
  }

  const mode = typeof params.mode === 'string' ? params.mode : 'constant';
  const fallbackR = typeof params.radius === 'number' ? params.radius : fallbackRadius;
  const expandedTopLevelIds = expand(numericEdgeIds);

  if (mode === 'asymmetric') {
    // FILLET-1: swap offsetOne/offsetTwo when isFlipped checkbox is on.
    // FILLET-3: emit isAsymmetric so the OCC builder uses Add_4(d1, d2, edge, face)
    // when the binding is available; falls back to Add_2(avg) inside the builder.
    let r1 = typeof params.offsetOne === 'number' ? Math.max(params.offsetOne, 0.001) : fallbackR;
    let r2 = typeof params.offsetTwo === 'number' ? Math.max(params.offsetTwo, 0.001) : r1;
    if (params.isFlipped === true) [r1, r2] = [r2, r1];
    return [{ edgeIds: expandedTopLevelIds, startRadius: r1, endRadius: r2, isAsymmetric: true }];
  }
  if (mode === 'chord-length') {
    const chord = typeof params.chordLength === 'number' ? params.chordLength : fallbackR;
    return [{ edgeIds: expandedTopLevelIds, chordLength: chord }];
  }
  if (mode === 'variable') {
    const start = typeof params.startRadius === 'number' ? params.startRadius : fallbackR;
    const end = typeof params.endRadius === 'number' ? params.endRadius : start;
    return [{ edgeIds: expandedTopLevelIds, startRadius: start, endRadius: end }];
  }
  return [{ edgeIds: expandedTopLevelIds, radius: fallbackR }];
}

/**
 * Resolve the side-face group for full-round fillet from live store state,
 * dialog params, or replayed feature params.
 *
 * Priority order:
 *  1. params.side{1|2}OccFaceIds (multi-face per side, array)
 *  2. feature.params.side{1|2}OccFaceIds (replay multi-face)
 *  3. params.side{1|2}OccFaceId (legacy single face)
 *  4. feature.params.side{1|2}OccFaceId (replay legacy single)
 *  5. live store state (single face id)
 *
 * Returns `null` when no face has been picked, signalling auto-detect.
 */
function pickSideGroup(
  dialogParams: Record<string, unknown> | undefined,
  featureParams: Record<string, unknown> | undefined,
  slot: 'side1' | 'side2',
  liveStateOccFaceId: number | null | undefined,
): number[] | null {
  const arrKey = `${slot}OccFaceIds` as const;
  const singleKey = `${slot}OccFaceId` as const;
  const fromArr = (src: Record<string, unknown> | undefined): number[] | null => {
    if (!src) return null;
    const v = src[arrKey];
    if (Array.isArray(v) && v.every((x) => Number.isInteger(x))) return v as number[];
    return null;
  };
  const fromSingle = (src: Record<string, unknown> | undefined): number | null => {
    if (!src) return null;
    const v = src[singleKey];
    return Number.isInteger(v) ? (v as number) : null;
  };
  const arr = fromArr(dialogParams) ?? fromArr(featureParams);
  if (arr && arr.length > 0) return arr;
  const single = fromSingle(dialogParams) ?? fromSingle(featureParams) ?? liveStateOccFaceId ?? null;
  if (Number.isInteger(single)) return [single as number];
  return null;
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

  /**
   * Install an OCC result body onto a feature: tessellate, register the mesh,
   * update store state, free the old WASM shape. Shared between standard
   * fillet/chamfer, full-round, and rule-fillet paths.
   */
  const installResultMesh = (
    tool: string,
    featureId: string,
    srcBody: BRepBody,
    resultBody: BRepBody,
    statusMessage: string,
    pushUndo: boolean,
  ): boolean => {
    const occ = getOccSync();
    if (!occ) {
      return markOccEdgeModificationError(featureId, tool, "OCC kernel is no longer available");
    }
    const srcFeatureId = srcBody.sourceFeatureId;
    const srcFeature = srcFeatureId
      ? get().features.find((feature) => feature.id === srcFeatureId)
      : undefined;
    const srcMesh = srcFeature?.mesh;
    const material = srcMesh instanceof THREE.Mesh ? srcMesh.material : BODY_MATERIAL;
    let newMesh: THREE.Mesh;
    try {
      resultBody.sourceFeatureId = featureId;
      newMesh = createRegisteredOccMesh(occ.oc, resultBody, material, featureId);
    } catch (err) {
      return markOccEdgeModificationError(
        featureId,
        tool,
        `OCC tessellation failed: ${errorMessage(err, "unknown error")}`,
      );
    }
    const currentFeature = get().features.find((feature) => feature.id === featureId);
    const prevMesh = currentFeature?.mesh instanceof THREE.Mesh ? currentFeature.mesh : null;
    const oldBodyId = prevMesh?.userData['brepBodyId'] as string | undefined;
    if (pushUndo) get().pushUndo();
    set((state) => ({
      features: state.features.map((feature) =>
        feature.id === featureId
          ? { ...feature, mesh: newMesh, healthState: "healthy" as const, healthMessage: undefined }
          : feature,
      ),
      statusMessage,
    }));
    if (prevMesh && prevMesh.geometry !== newMesh.geometry) {
      disposeMeshDeferred(prevMesh);
      if (oldBodyId) globalBRepBodyRegistry.delete(oldBodyId);
    }
    return true;
  };

  const applyOccEdgeModification = ({
    tool,
    featureId,
    edgeIds,
    radius,
    filletEdgeSets,
    continuity,
    isRollingBallCorner,
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
    isRollingBallCorner?: boolean;
    distance?: number;
    distance2?: number;
    pushUndo?: boolean;
    fullRoundFaces?: { centerFaceId: number; sideFaces: FullRoundSideFaces };
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
                fullRoundFaces.sideFaces,
                { sourceFeatureId: featureId },
              )
            : occFilletEdgeSetsWithInstance(
                occ.oc,
                srcBody,
                effectiveFilletEdgeSets,
                { sourceFeatureId: featureId, continuity, isRollingBallCorner },
              ))
        : occChamferWithInstance(occ.oc, srcBody, numericEdgeIds, distance ?? 0, {
            distance2:
              distance2 !== undefined && distance2 !== distance ? distance2 : undefined,
            sourceFeatureId: featureId,
          });
    if (!result) {
      return markOccEdgeModificationError(featureId, tool, "OCC operation failed for the selected edge set");
    }

    const statusMessage =
      tool === "Fillet"
        ? `Filleted ${numericEdgeIds.length} OCC edge(s)${continuity === 'G2' ? ' (G2)' : ''}`
        : `Chamfered ${numericEdgeIds.length} OCC edge(s) at d=${distance}`;
    return installResultMesh(tool, featureId, srcBody, result, statusMessage, pushUndo);
  };

  return {
    // 3D edge fillet using exact OCC topology edge IDs.
    commitFillet: (radius, segments, featureId?, filletParams?) => {
      void segments;
      const feature = featureId
        ? get().features.find((candidate) => candidate.id === featureId)
        : undefined;

      // ── Full-round fillet path: uses center + two side face groups, not edge IDs ──
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
        // FILLET-8: side groups may be either single-face (legacy single OccFaceId)
        // or arrays of face IDs (multi-face per side). When neither single nor
        // multi is provided, fall through to auto-side inference.
        const side1Group = pickSideGroup(filletParams, feature?.params, 'side1', filletFullRoundSide1OccFaceId);
        const side2Group = pickSideGroup(filletParams, feature?.params, 'side2', filletFullRoundSide2OccFaceId);
        const sideFaces: FullRoundSideFaces =
          side1Group && side2Group ? [side1Group, side2Group] : null;

        if (!featureId) { get().setStatusMessage('Full-Round Fillet: requires a feature id'); return; }
        if (!centerOccBodyId || !Number.isInteger(centerOccFaceId)) {
          get().setStatusMessage('Full-Round Fillet: select center face first');
          return;
        }
        const occ = getOccSync();
        if (!occ) { get().setStatusMessage('Full-Round Fillet: OCC kernel is still loading'); return; }
        const srcBody = globalBRepBodyRegistry.get(centerOccBodyId);
        if (!srcBody) { get().setStatusMessage('Full-Round Fillet: source body is no longer available'); return; }

        const resultBody = occFullRoundFilletWithInstance(
          occ.oc, srcBody,
          centerOccFaceId!,
          sideFaces,
          { sourceFeatureId: featureId },
        );
        if (!resultBody) {
          markOccEdgeModificationError(featureId, 'Full-Round Fillet', 'OCC operation failed');
          return;
        }
        installResultMesh('Full-Round Fillet', featureId, srcBody, resultBody, 'Full-round fillet applied', false);
        return;
      }

      // ── Rule fillet path: AllEdges (pick face → fillet all its edges)
      //                     BetweenFaces (intersect two face sets) ──
      if (mode === 'rule-fillet') {
        const ruleType = (filletParams?.ruleType ?? feature?.params.ruleType) as
          | 'all-edges'
          | 'between-faces'
          | undefined;
        if (!featureId) { get().setStatusMessage('Rule Fillet: requires a feature id'); return; }
        const occ = getOccSync();
        if (!occ) { get().setStatusMessage('Rule Fillet: OCC kernel is still loading'); return; }
        const centerOccBodyId =
          (filletParams?.centerOccBodyId as string | undefined) ??
          (feature?.params.centerOccBodyId as string | undefined) ??
          (get().filletFullRoundCenterOccBodyId ?? undefined);
        if (!centerOccBodyId) {
          get().setStatusMessage('Rule Fillet: pick a face on a body first');
          return;
        }
        const srcBody = globalBRepBodyRegistry.get(centerOccBodyId);
        if (!srcBody) { get().setStatusMessage('Rule Fillet: source body is no longer available'); return; }
        const { continuity, isRollingBallCorner } = resolveOccFilletOptions(filletParams);

        let resultBody = null as ReturnType<typeof occRuleFilletAllEdgesWithInstance>;
        if (ruleType === 'between-faces') {
          const groupA = pickSideGroup(filletParams, feature?.params, 'side1', get().filletFullRoundSide1OccFaceId);
          const groupB = pickSideGroup(filletParams, feature?.params, 'side2', get().filletFullRoundSide2OccFaceId);
          if (!groupA || !groupB) {
            get().setStatusMessage('Rule Fillet (Between Faces): pick both face sets first');
            return;
          }
          resultBody = occRuleFilletBetweenFacesWithInstance(
            occ.oc, srcBody, groupA, groupB, Math.max(radius, 0.001),
            { sourceFeatureId: featureId, continuity, isRollingBallCorner },
          );
        } else {
          // AllEdges: collect every edge of the picked face(s).
          const centerOccFaceId =
            (filletParams?.centerOccFaceId as number | undefined) ??
            (feature?.params.centerOccFaceId as number | undefined) ??
            (get().filletFullRoundCenterOccFaceId ?? undefined);
          const faceIds: number[] = [];
          if (Array.isArray(filletParams?.ruleFaceIds)) {
            for (const f of filletParams!.ruleFaceIds as unknown[]) {
              if (Number.isInteger(f)) faceIds.push(f as number);
            }
          } else if (Array.isArray(feature?.params.ruleFaceIds)) {
            for (const f of feature!.params.ruleFaceIds as unknown[]) {
              if (Number.isInteger(f)) faceIds.push(f as number);
            }
          }
          if (faceIds.length === 0 && Number.isInteger(centerOccFaceId)) {
            faceIds.push(centerOccFaceId as number);
          }
          if (faceIds.length === 0) {
            get().setStatusMessage('Rule Fillet (All Edges): pick a face first');
            return;
          }
          resultBody = occRuleFilletAllEdgesWithInstance(
            occ.oc, srcBody, faceIds, Math.max(radius, 0.001),
            { sourceFeatureId: featureId, continuity, isRollingBallCorner },
          );
        }

        if (!resultBody) {
          markOccEdgeModificationError(featureId, 'Rule Fillet', 'OCC operation failed (no edges collected?)');
          return;
        }
        installResultMesh('Rule Fillet', featureId, srcBody, resultBody, 'Rule fillet applied', false);
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
      const { continuity, isRollingBallCorner } = resolveOccFilletOptions(filletParams);

      // Full-round with explicit face IDs: use occFullRoundFilletWithInstance
      const centerFaceId = typeof filletParams?.centerFaceId === 'number' ? filletParams.centerFaceId : undefined;
      const side1FromParams = pickSideGroup(filletParams, feature?.params, 'side1', null);
      const side2FromParams = pickSideGroup(filletParams, feature?.params, 'side2', null);
      const inlineSideFaces: FullRoundSideFaces | undefined =
        side1FromParams && side2FromParams ? [side1FromParams, side2FromParams] : undefined;
      const fullRoundFaces =
        centerFaceId !== undefined && inlineSideFaces
          ? { centerFaceId, sideFaces: inlineSideFaces }
          : undefined;

      applyOccEdgeModification({
        tool: "Fillet",
        featureId,
        edgeIds,
        filletEdgeSets,
        continuity,
        isRollingBallCorner,
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

      // Full-round / rule-fillet replay routes through commitFillet
      if (feature.type === "fillet" && (params.mode === 'full-round' || params.mode === 'rule-fillet')) {
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
        const { continuity, isRollingBallCorner } = resolveOccFilletOptions(params);
        const replayCenterFaceId = typeof params.centerFaceId === 'number' ? params.centerFaceId : undefined;
        const replaySide1 = pickSideGroup(params, undefined, 'side1', null);
        const replaySide2 = pickSideGroup(params, undefined, 'side2', null);
        const replaySideFaces: FullRoundSideFaces | undefined =
          replaySide1 && replaySide2 ? [replaySide1, replaySide2] : undefined;
        const replayFullRoundFaces = replayCenterFaceId !== undefined && replaySideFaces
          ? { centerFaceId: replayCenterFaceId, sideFaces: replaySideFaces }
          : undefined;
        applyOccEdgeModification({
          tool: "Fillet",
          featureId,
          edgeIds,
          filletEdgeSets,
          continuity,
          isRollingBallCorner,
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
