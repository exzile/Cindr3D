import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import {
  occFullRoundFilletWithInstance,
  occRuleFilletAllEdgesWithInstance,
  occRuleFilletBetweenFacesWithInstance,
  type FullRoundSideFaces,
} from "../../../../engine/occ/ops/fillet";
import { getSelectableEdges } from "../../../../engine/occ/ops/selectableEdges";
import { getOccSync } from "../../../../engine/occ/loader";
import { parseOccEdgeSelection, storedEdgeIds } from "../../../../utils/occEdgeUtils";
import { errorMessage } from "../../../../utils/errorHandling";
import {
  DEFAULT_FILLET_RADIUS,
  resolveOccChamferDistances,
  resolveOccFilletOptions,
} from "./edgeModHelpers";
import { createOccEdgeModificationHelpers } from "./edgeModApply";

// ── Validity-probe result cache ────────────────────────────────────────────────
// Caches the last OCC probe result keyed on (tool, featureId, bodyId, bodyRevision,
// sorted edge ids, relevant params). When the user adjusts a radius/distance value
// that was already probed — especially when repeatedly hitting the same bad value
// during slider dragging — the cached failure is returned instantly without any OCC
// Build() call, eliminating even the single-build hitch the dry-run short-circuit
// left behind. Auto-invalidates when the body revision changes (body rebuild).
//
// Max 32 entries (LRU via insertion-order deletion). Cleared on page load.
const PROBE_CACHE_MAX = 32;
const _probeCache = new Map<string, { ok: boolean; message?: string }>();

function _probeCacheKey(
  tool: string,
  featureId: string,
  bodyId: string,
  bodyRevision: number,
  sortedEdgeIds: string,
  paramSig: string,
): string {
  return `${tool}|${featureId}|${bodyId}@${bodyRevision}|${sortedEdgeIds}|${paramSig}`;
}

function _getProbeCacheResult(key: string): { ok: boolean; message?: string } | undefined {
  return _probeCache.get(key);
}

function _setProbeCacheResult(key: string, result: { ok: boolean; message?: string }): void {
  if (_probeCache.size >= PROBE_CACHE_MAX) {
    // Evict the oldest entry (Map preserves insertion order)
    const oldest = _probeCache.keys().next().value;
    if (oldest !== undefined) _probeCache.delete(oldest);
  }
  _probeCache.set(key, result);
}

/** Clear the probe cache (call after undo/redo or any model mutation that invalidates prior results). */
export function clearEdgeModProbeCache(): void {
  _probeCache.clear();
}

function pickSideGroup(
  dialogParams: Record<string, unknown> | undefined,
  featureParams: Record<string, unknown> | undefined,
  slot: "side1" | "side2",
  liveStateOccFaceId: number | null | undefined,
): number[] | null {
  const arrKey = `${slot}OccFaceIds` as const;
  const singleKey = `${slot}OccFaceId` as const;
  const fromArr = (src: Record<string, unknown> | undefined): number[] | null => {
    if (!src) return null;
    const value = src[arrKey];
    if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) return value as number[];
    return null;
  };
  const fromSingle = (src: Record<string, unknown> | undefined): number | null => {
    if (!src) return null;
    const value = src[singleKey];
    return Number.isInteger(value) ? (value as number) : null;
  };
  const arr = fromArr(dialogParams) ?? fromArr(featureParams);
  if (arr && arr.length > 0) return arr;
  const single = fromSingle(dialogParams) ?? fromSingle(featureParams) ?? liveStateOccFaceId ?? null;
  if (Number.isInteger(single)) return [single as number];
  return null;
}

export function createEdgeModActions({
  set,
  get,
}: CADSliceContext): Partial<CADState> {
  const { applyOccEdgeModification, installResultMesh, markOccEdgeModificationError } =
    createOccEdgeModificationHelpers({ set, get });

  return {
    commitFillet: (radius, segments, featureId?, filletParams?) => {
      void segments;
      const feature = featureId
        ? get().features.find((candidate) => candidate.id === featureId)
        : undefined;
      const mode = (filletParams?.mode ?? feature?.params.mode) as string | undefined;

      if (mode === "full-round") {
        const {
          filletFullRoundCenterOccBodyId,
          filletFullRoundCenterOccFaceId,
          filletFullRoundSide1OccFaceId,
          filletFullRoundSide2OccFaceId,
        } = get();
        const centerOccBodyId =
          filletFullRoundCenterOccBodyId ??
          (filletParams?.centerOccBodyId as string | undefined) ??
          (feature?.params.centerOccBodyId as string | undefined);
        const centerOccFaceId =
          filletFullRoundCenterOccFaceId ??
          (filletParams?.centerOccFaceId as number | undefined) ??
          (feature?.params.centerOccFaceId as number | undefined);
        const side1Group = pickSideGroup(
          filletParams,
          feature?.params,
          "side1",
          filletFullRoundSide1OccFaceId,
        );
        const side2Group = pickSideGroup(
          filletParams,
          feature?.params,
          "side2",
          filletFullRoundSide2OccFaceId,
        );
        const sideFaces: FullRoundSideFaces =
          side1Group && side2Group ? [side1Group, side2Group] : null;

        if (!featureId) {
          get().setStatusMessage("Full-Round Fillet: requires a feature id");
          return;
        }
        if (!centerOccBodyId || !Number.isInteger(centerOccFaceId)) {
          get().setStatusMessage("Full-Round Fillet: select center face first");
          return;
        }
        const occ = getOccSync();
        if (!occ) {
          get().setStatusMessage("Full-Round Fillet: OCC kernel is still loading");
          return;
        }
        const srcBody = globalBRepBodyRegistry.get(centerOccBodyId);
        if (!srcBody) {
          get().setStatusMessage("Full-Round Fillet: source body is no longer available");
          return;
        }

        const { continuity, tangencyWeight, isRollingBallCorner } = resolveOccFilletOptions(
          filletParams ?? feature?.params,
        );
        const resultBody = occFullRoundFilletWithInstance(
          occ.oc,
          srcBody,
          centerOccFaceId!,
          sideFaces,
          { sourceFeatureId: featureId, continuity, tangencyWeight, isRollingBallCorner },
        );
        if (!resultBody) {
          markOccEdgeModificationError(featureId, "Full-Round Fillet", "OCC operation failed");
          return;
        }
        installResultMesh(
          "Full-Round Fillet",
          featureId,
          srcBody,
          resultBody,
          "Full-round fillet applied",
          false,
        );
        return;
      }

      if (mode === "rule-fillet") {
        const ruleType = (filletParams?.ruleType ?? feature?.params.ruleType) as
          | "all-edges"
          | "between-faces"
          | undefined;
        if (!featureId) {
          get().setStatusMessage("Rule Fillet: requires a feature id");
          return;
        }
        const occ = getOccSync();
        if (!occ) {
          get().setStatusMessage("Rule Fillet: OCC kernel is still loading");
          return;
        }
        const centerOccBodyId =
          (filletParams?.centerOccBodyId as string | undefined) ??
          (feature?.params.centerOccBodyId as string | undefined) ??
          (get().filletFullRoundCenterOccBodyId ?? undefined);
        if (!centerOccBodyId) {
          get().setStatusMessage("Rule Fillet: pick a face on a body first");
          return;
        }
        const srcBody = globalBRepBodyRegistry.get(centerOccBodyId);
        if (!srcBody) {
          get().setStatusMessage("Rule Fillet: source body is no longer available");
          return;
        }
        const { continuity, tangencyWeight, isRollingBallCorner } = resolveOccFilletOptions(
          filletParams ?? feature?.params,
        );
        const topologyFilter =
          (filletParams?.ruleFilletTopology as 'all' | 'convex' | 'concave' | undefined) ??
          (feature?.params.ruleFilletTopology as 'all' | 'convex' | 'concave' | undefined);
        // Build edge meta for topology filtering (memoized on body.revision — cheap).
        const edgeMeta = topologyFilter && topologyFilter !== 'all'
          ? getSelectableEdges(occ.oc, srcBody)
          : undefined;
        const ruleOpts = {
          sourceFeatureId: featureId,
          continuity,
          tangencyWeight,
          isRollingBallCorner,
          ...(topologyFilter && topologyFilter !== 'all' ? { topologyFilter, edgeMeta } : {}),
        };

        let resultBody: ReturnType<typeof occRuleFilletAllEdgesWithInstance>;
        if (ruleType === "between-faces") {
          const groupA = pickSideGroup(filletParams, feature?.params, "side1", get().filletFullRoundSide1OccFaceId);
          const groupB = pickSideGroup(filletParams, feature?.params, "side2", get().filletFullRoundSide2OccFaceId);
          if (!groupA || !groupB) {
            get().setStatusMessage("Rule Fillet (Between Faces): pick both face sets first");
            return;
          }
          resultBody = occRuleFilletBetweenFacesWithInstance(
            occ.oc,
            srcBody,
            groupA,
            groupB,
            Math.max(radius, 0.001),
            ruleOpts,
          );
        } else {
          const centerOccFaceId =
            (filletParams?.centerOccFaceId as number | undefined) ??
            (feature?.params.centerOccFaceId as number | undefined) ??
            (get().filletFullRoundCenterOccFaceId ?? undefined);
          const faceIds: number[] = [];
          if (Array.isArray(filletParams?.ruleFaceIds)) {
            for (const faceId of filletParams.ruleFaceIds as unknown[]) {
              if (Number.isInteger(faceId)) faceIds.push(faceId as number);
            }
          } else if (Array.isArray(feature?.params.ruleFaceIds)) {
            for (const faceId of feature.params.ruleFaceIds as unknown[]) {
              if (Number.isInteger(faceId)) faceIds.push(faceId as number);
            }
          }
          if (faceIds.length === 0 && Number.isInteger(centerOccFaceId)) {
            faceIds.push(centerOccFaceId as number);
          }
          if (faceIds.length === 0) {
            get().setStatusMessage("Rule Fillet (All Edges): pick a face first");
            return;
          }
          resultBody = occRuleFilletAllEdgesWithInstance(
            occ.oc,
            srcBody,
            faceIds,
            Math.max(radius, 0.001),
            ruleOpts,
          );
        }

        if (!resultBody) {
          markOccEdgeModificationError(featureId, "Rule Fillet", "OCC operation failed (no edges collected?)");
          return;
        }
        installResultMesh("Rule Fillet", featureId, srcBody, resultBody, "Rule fillet applied", false);
        return;
      }

      const edgeIds =
        get().filletEdgeIds.length > 0
          ? get().filletEdgeIds
          : storedEdgeIds(feature?.params.edgeIds);
      const wantsSetback = filletParams?.setback === true && typeof filletParams?.setbackDistance === "number";
      if (wantsSetback) {
        console.warn(
          "[commitFillet] setback requested but BRepFilletAPI_MakeFillet::SetParams is not bound " +
          "in the WASM build; applying standard fillet instead",
        );
        if (featureId) {
          set({ statusMessage: "Fillet setback requires additional OCC binding support; using standard fillet instead" });
        }
      }

      const { continuity, tangencyWeight, isRollingBallCorner } = resolveOccFilletOptions(
        filletParams ?? feature?.params,
      );

      const centerFaceId = typeof filletParams?.centerFaceId === "number" ? filletParams.centerFaceId : undefined;
      const side1FromParams = pickSideGroup(filletParams, feature?.params, "side1", null);
      const side2FromParams = pickSideGroup(filletParams, feature?.params, "side2", null);
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
        radius,
        filletParams,
        continuity,
        tangencyWeight,
        isRollingBallCorner,
        fullRoundFaces,
      });
    },

    commitChamfer: (distance, distance2, featureId?, chamferParams?) => {
      const feature = featureId
        ? get().features.find((candidate) => candidate.id === featureId)
        : undefined;

      const chamferMode = typeof chamferParams?.mode === "string"
        ? chamferParams.mode
        : (feature?.params.mode as string | undefined);
      if (chamferMode === "three-face") {
        set({ statusMessage: "Three-face chamfer is not yet supported; use Equal Distance or Two Distance mode" });
        return;
      }

      const edgeIds =
        get().chamferEdgeIds.length > 0
          ? get().chamferEdgeIds
          : storedEdgeIds(feature?.params.edgeIds);
      const shouldPropagateChamfer = chamferParams?.propagate === true
        || (chamferParams === undefined && feature?.params.propagate === true);

      const cornerType = typeof chamferParams?.cornerType === "string"
        ? chamferParams.cornerType
        : (feature?.params.cornerType as string | undefined);
      if (cornerType === "miter") {
        console.warn(
          '[commitChamfer] cornerType="miter" requested; BRepFilletAPI_MakeChamfer does not ' +
          "expose a corner-type enum in the WASM build; using OCC default behavior",
        );
      }

      // OCC-14.6: extract raw angle for DistanceAndAngle mode so AddDA can be used
      // instead of the tan-conversion approximation in occChamferWithInstance.
      const rawAngle = chamferMode === 'dist-angle'
        ? (typeof chamferParams?.angle === 'number'
            ? chamferParams.angle
            : (typeof feature?.params.angle === 'number' ? feature.params.angle as number : undefined))
        : undefined;

      applyOccEdgeModification({
        tool: "Chamfer",
        featureId,
        edgeIds,
        distance,
        // When using exact AddDA, distance2 is ignored (angle takes priority).
        distance2: rawAngle === undefined ? distance2 : undefined,
        angle: rawAngle,
        propagate: shouldPropagateChamfer,
      });
    },

    replayEdgeModificationFeature: (featureId: string) => {
      const { features } = get();
      const feature = features.find((candidate) => candidate.id === featureId);
      if (!feature || (feature.type !== "fillet" && feature.type !== "chamfer")) return;

      const params = feature.params;

      if (feature.type === "fillet" && (params.mode === "full-round" || params.mode === "rule-fillet")) {
        const radius = typeof params.radius === "number" ? params.radius : DEFAULT_FILLET_RADIUS;
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
        const radius = typeof params.radius === "number" ? params.radius : DEFAULT_FILLET_RADIUS;
        const { continuity, tangencyWeight, isRollingBallCorner } = resolveOccFilletOptions(params);
        const replayCenterFaceId = typeof params.centerFaceId === "number" ? params.centerFaceId : undefined;
        const replaySide1 = pickSideGroup(params, undefined, "side1", null);
        const replaySide2 = pickSideGroup(params, undefined, "side2", null);
        const replaySideFaces: FullRoundSideFaces | undefined =
          replaySide1 && replaySide2 ? [replaySide1, replaySide2] : undefined;
        const replayFullRoundFaces = replayCenterFaceId !== undefined && replaySideFaces
          ? { centerFaceId: replayCenterFaceId, sideFaces: replaySideFaces }
          : undefined;

        applyOccEdgeModification({
          tool: "Fillet",
          featureId,
          edgeIds,
          radius,
          filletParams: params as Record<string, unknown>,
          continuity,
          tangencyWeight,
          isRollingBallCorner,
          pushUndo: true,
          fullRoundFaces: replayFullRoundFaces,
        });
        return;
      }

      if (params.mode === "three-face") {
        set({ statusMessage: "Three-face chamfer is not yet supported; use Equal Distance or Two Distance mode" });
        return;
      }

      const [replayDistance, replayDistance2] = resolveOccChamferDistances(params);
      // OCC-14.6: for dist-angle mode, pass the raw angle so AddDA is used on replay.
      const replayMode = typeof params.mode === 'string' ? params.mode : 'equal-dist';
      const replayAngle = replayMode === 'dist-angle' && typeof params.angle === 'number'
        ? params.angle as number
        : undefined;
      applyOccEdgeModification({
        tool: "Chamfer",
        featureId,
        edgeIds,
        distance: replayDistance,
        distance2: replayAngle === undefined ? replayDistance2 : undefined,
        angle: replayAngle,
        propagate: params.propagate === true,
        pushUndo: true,
      });
    },

    probeEdgeModification: (args) => {
      const { tool, edgeIds, radius, distance, distance2, angle, propagate, filletParams } = args;
      // Nothing selected → nothing to validate; treat as valid (no red flash).
      if (edgeIds.length === 0) return { ok: true };
      // OCC kernel not ready yet — don't flag a not-yet-loadable op as invalid.
      if (!getOccSync()) return { ok: true };

      // Use the feature being edited so siblings exclude it correctly; for a brand
      // new fillet/chamfer (no feature yet) use a synthetic id the apply pipeline
      // treats as "not in the timeline" (so it combines existing siblings, exactly
      // as the eventual commit will).
      const featureId = get().editingFeatureId ?? "__edgeModPreview__";

      // ── Probe result cache ────────────────────────────────────────────────────
      // Build a cache key from the body's current revision + sorted edge ids +
      // relevant parameters. A body rebuild increments revision, auto-invalidating
      // any cached result for that body. Avoids even the single primary-path Build()
      // call when the same failing value is probed again (e.g. slider snapping back,
      // or re-opening a dialog with a radius that previously failed).
      const sel = parseOccEdgeSelection(edgeIds);
      const bodyId = sel?.bodyId ?? '';
      const bodyRevision = bodyId ? (globalBRepBodyRegistry.get(bodyId)?.revision ?? -1) : -1;
      const sortedEdgeIds = [...edgeIds].sort().join(',');
      let paramSig: string;
      if (tool === "Fillet") {
        paramSig = `r=${radius ?? '?'},m=${filletParams?.mode ?? 'const'},c=${filletParams?.continuity ?? 'G1'}`;
      } else {
        paramSig = `d=${distance ?? '?'},d2=${distance2 ?? '?'},a=${angle ?? '?'},p=${propagate ? 1 : 0}`;
      }
      const cacheKey = _probeCacheKey(tool, featureId, bodyId, bodyRevision, sortedEdgeIds, paramSig);
      const cached = _getProbeCacheResult(cacheKey);
      if (cached !== undefined) return cached;

      if (tool === "Fillet") {
        const mode = filletParams?.mode as string | undefined;
        // Face-picker modes don't go through the edge-list apply path — skip.
        if (mode === "full-round" || mode === "rule-fillet") return { ok: true };
        const { continuity, tangencyWeight, isRollingBallCorner } =
          resolveOccFilletOptions(filletParams);
        let message: string | undefined;
        let result: { ok: boolean; message?: string };
        try {
          const ok = applyOccEdgeModification({
            tool: "Fillet",
            featureId,
            edgeIds,
            radius,
            filletParams,
            continuity,
            tangencyWeight,
            isRollingBallCorner,
            dryRun: true,
            onDryRunError: (m) => { message = m; },
          });
          result = { ok, message };
        } catch (err) {
          result = { ok: false, message: errorMessage(err, "OCC could not solve this fillet") };
        }
        _setProbeCacheResult(cacheKey, result);
        return result;
      }

      // Chamfer (three-face mode is gated by the dialog before it reaches here).
      let message: string | undefined;
      let result: { ok: boolean; message?: string };
      try {
        const ok = applyOccEdgeModification({
          tool: "Chamfer",
          featureId,
          edgeIds,
          distance,
          distance2: angle === undefined ? distance2 : undefined,
          angle,
          propagate,
          dryRun: true,
          onDryRunError: (m) => { message = m; },
        });
        result = { ok, message };
      } catch (err) {
        result = { ok: false, message: errorMessage(err, "OCC could not solve this chamfer") };
      }
      _setProbeCacheResult(cacheKey, result);
      return result;
    },
  };
}
