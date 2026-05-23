/**
 * applyEdgeCut — shared commit flow for edge-modification tools.
 *
 * Non-destructive architecture (Phase 0): the CSG result is stored on the
 * fillet/chamfer feature's own mesh, NOT on the parent feature. The parent
 * mesh is never modified or disposed. Rendering skips the parent when it has
 * an active downstream edge-cut feature (one whose mesh is set).
 *
 * Passing spec.featureId activates the non-destructive path. Callers that
 * omit it fall back to the legacy destructive path for backwards compat.
 */
import * as THREE from "three";
import type { ParsedEdges } from "../../../../utils/geometry/edgeCutCore";
import type { CADSliceContext } from "../../sliceContext";
import { recomputeBooleanDependents } from "./featureBooleanUtils";
import { resolveBodySource, type BodySourceLabel } from "./resolveBodySource";

export interface EdgeCutSpec {
  /** 'Fillet' | 'Chamfer' — used in status messages. */
  tool: string;
  /** The picked edge IDs (filletEdgeIds / chamferEdgeIds). */
  edgeIds: string[];
  /** True when the primary size parameter is > 0. */
  sizeValid: boolean;
  /** Shared edge-ID parser (parseFilletEdgeIds / parseChamferEdgeIds). */
  parse: (ids: string[]) => ParsedEdges | null;
  /** Build the cut geometry from a non-indexed world-space source. */
  compute: (
    srcGeo: THREE.BufferGeometry,
    edges: ParsedEdges["edges"],
  ) => THREE.BufferGeometry | null;
  /** Verb for the success message, e.g. `Filleted` / `Chamfered`. */
  pastVerb: string;
  /** Size suffix for the success message, e.g. `r=2` / `d=1.5`. */
  sizeLabel: string;
  /**
   * Non-destructive path: ID of the already-created fillet/chamfer feature
   * node to store the CSG result on. When provided the parent's mesh is never
   * modified; when omitted the legacy path mutates the parent (backwards compat).
   */
  featureId?: string;
}

/**
 * One-line structured debug summary for a fillet/chamfer commit or replay.
 * Format: [op] id=<short-id> <size> edges=<total>→cut=<cut> fail=<fail> src=<src> ms=<ms> → <health>
 * All fields on one line so a single grep/filter shows the full picture.
 */
export function logEdgeCutSummary(
  tag: string,
  featureId: string,
  sizeLabel: string,
  totalEdges: number,
  cutEdges: number,
  failedEdges: number,
  src: "cache" | "parent" | "bodyCache" | "unknown" | BodySourceLabel,
  startMs: number,
  health: "ok" | "warning" | "error",
): void {
  const id = featureId.slice(-6);
  const ms = Math.round(performance.now() - startMs);
  const tag3 = tag.slice(0, 3);
  console.log(
    `[${tag3}] id=..${id} ${sizeLabel} edges=${totalEdges}→cut=${cutEdges} fail=${failedEdges} src=${src} ms=${ms} → ${health}`,
  );
}

/** Session-only source geometry cache keyed by fillet/chamfer feature ID. */
const _srcGeoCache = new Map<string, THREE.BufferGeometry>();
const MAX_SRC_GEO_CACHE = 64;

/** Store pre-fillet source geometry so edit/replay can find it without re-rendering. */
export function cacheEdgeCutSource(
  featureId: string,
  geo: THREE.BufferGeometry,
): void {
  // Dispose any prior entry for this feature (e.g. second commit after edit)
  const prev = _srcGeoCache.get(featureId);
  if (prev) {
    prev.dispose();
    _srcGeoCache.delete(featureId);
  }
  _srcGeoCache.set(featureId, geo);
  while (_srcGeoCache.size > MAX_SRC_GEO_CACHE) {
    const oldest = _srcGeoCache.keys().next().value as string | undefined;
    if (!oldest || oldest === featureId) break;
    evictEdgeCutSource(oldest);
  }
}

export function getCachedEdgeCutSource(
  featureId: string,
): THREE.BufferGeometry | undefined {
  return _srcGeoCache.get(featureId);
}

export function evictEdgeCutSource(featureId: string): void {
  const entry = _srcGeoCache.get(featureId);
  if (entry) {
    entry.dispose();
    _srcGeoCache.delete(featureId);
  }
}

export function clearAllEdgeCutSources(): void {
  for (const geo of _srcGeoCache.values()) geo.dispose();
  _srcGeoCache.clear();
}

export function applyEdgeCut(store: CADSliceContext, spec: EdgeCutSpec): void {
  const { get, set } = store;
  const { tool, edgeIds, sizeValid, parse, compute, pastVerb, sizeLabel } =
    spec;
  const t0 = performance.now();

  if (!sizeValid || edgeIds.length === 0) {
    get().setStatusMessage(`${tool}: select edges + size > 0`);
    return;
  }
  const parsed = parse(edgeIds);
  if (!parsed) {
    get().setStatusMessage(`${tool}: no edges parsed`);
    return;
  }
  const { featureId: targetFid, meshUuid: targetMeshUuid, edges } = parsed;

  const features = get().features;
  const feature = targetFid
    ? features.find((f) => f.id === targetFid)
    : features.find(
        (f) =>
          f.mesh instanceof THREE.Mesh &&
          (f.mesh as THREE.Object3D).uuid === targetMeshUuid,
      );
  if (!feature) {
    get().setStatusMessage(`${tool}: edges not on a solid body`);
    return;
  }

  const src = resolveBodySource(feature, targetMeshUuid);
  if ("error" in src) {
    get().setStatusMessage(`${tool}: ${src.error}`);
    return;
  }
  const { srcGeo, srcMaterial, hasMesh, oldGeomToDispose, srcLabel } = src;

  const newGeo = compute(srcGeo, edges);

  if (!newGeo) {
    srcGeo.dispose();
    get().setStatusMessage(`${tool}: no 2-face edges found`);
    return;
  }

  // ── Non-destructive path ──────────────────────────────────────────────────
  if (spec.featureId) {
    const edgeCutFid = spec.featureId;

    // Cache the source geometry for future edit/replay within this session.
    cacheEdgeCutSource(edgeCutFid, srcGeo.clone());
    srcGeo.dispose();

    const newMesh = new THREE.Mesh(newGeo, srcMaterial);
    // Tag so undo/redo doesn't accidentally carry this mesh onto a non-edge-cut restore.
    newMesh.userData._edgeCutApplied = true;
    newMesh.userData.pickable = true;
    newMesh.userData.featureId = edgeCutFid;
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;

    const failedCount: number =
      (newGeo.userData.failedEdgeCount as number | undefined) ?? 0;
    const totalCount: number =
      (newGeo.userData.totalEdgeCount as number | undefined) ?? edges.length;
    const successCount = totalCount - failedCount;
    const statusMessage =
      failedCount > 0
        ? `${pastVerb} ${successCount} of ${totalCount} edge(s) at ${sizeLabel} (${failedCount} skipped)`
        : `${pastVerb} ${edges.length} edge(s) at ${sizeLabel}`;
    const healthState =
      failedCount > 0 ? ("warning" as const) : ("healthy" as const);
    const healthMessage =
      failedCount > 0
        ? `${failedCount} of ${totalCount} edge(s) could not be processed`
        : undefined;

    logEdgeCutSummary(
      tool,
      edgeCutFid,
      sizeLabel,
      totalCount,
      successCount,
      failedCount,
      srcLabel,
      t0,
      failedCount > 0 ? "warning" : "ok",
    );

    // Capture old geometry BEFORE pushUndo so we can defer-dispose it after state
    // is updated (gives R3F a render cycle to unmount the old mesh first).
    const prevEdgeCutMesh = get().features.find(
      (f) => f.id === edgeCutFid,
    )?.mesh;
    const prevGeo =
      prevEdgeCutMesh instanceof THREE.Mesh ? prevEdgeCutMesh.geometry : null;

    get().pushUndo();
    set((state) => ({
      features: state.features.map((f) => {
        if (f.id === edgeCutFid) {
          return {
            ...f,
            mesh: newMesh,
            parentFeatureId: feature.id,
            healthState,
            healthMessage,
          };
        }
        return f;
      }),
      statusMessage,
    }));
    if (prevGeo && prevGeo !== newGeo) setTimeout(() => prevGeo.dispose(), 0);
    return;
  }

  // ── Legacy destructive path (no featureId provided) ───────────────────────
  srcGeo.dispose();
  get().pushUndo();
  const newMesh = new THREE.Mesh(newGeo, srcMaterial);
  newMesh.userData = hasMesh
    ? { ...(feature.mesh as THREE.Mesh).userData }
    : { pickable: true, featureId: feature.id };
  newMesh.castShadow = true;
  newMesh.receiveShadow = true;

  const statusMessage = `${pastVerb} ${edges.length} edge(s) at ${sizeLabel}`;
  if (hasMesh) {
    set((state) => ({
      features: recomputeBooleanDependents(
        state.features.map((f) =>
          f.id === feature.id ? { ...f, mesh: newMesh } : f,
        ),
        [feature.id],
      ),
      statusMessage,
    }));
    if (oldGeomToDispose) setTimeout(() => oldGeomToDispose.dispose(), 0);
  } else {
    set((state) => ({
      features: state.features.map((f) =>
        f.id === feature.id ? { ...f, mesh: newMesh } : f,
      ),
      statusMessage,
    }));
  }
}
