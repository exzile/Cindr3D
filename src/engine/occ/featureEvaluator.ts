/**
 * OCC-7.2 — Feature evaluation pipeline.
 *
 * Maps featureId → BRepBody. Evaluates features lazily; re-evaluates only
 * when a feature's params change OR when an upstream feature's body changes
 * (cascade). Bodies are stored in the globalBRepBodyRegistry.
 *
 * Integrates with the existing Feature[] from cadStore. Each feature type has
 * a corresponding evaluator function registered via `registerFeatureEvaluator`.
 *
 * OCC-7.x will wire this into cadStore subscriptions. For now it's a
 * standalone cache that OCC operation callsites can populate directly.
 */
import type { BRepBody } from './brepBody';
import { globalBRepBodyRegistry } from './globalRegistry';
import type { OcctRaw } from './types';

export type FeatureEvaluatorFn = (
  oc: OcctRaw,
  featureId: string,
  params: Record<string, unknown>,
  upstreamBodies: BRepBody[],
) => BRepBody | null;

const _evaluators = new Map<string, FeatureEvaluatorFn>();

/** Register an evaluator for a feature type (e.g. 'extrude', 'fillet'). */
export function registerFeatureEvaluator(
  featureType: string,
  fn: FeatureEvaluatorFn,
): void {
  _evaluators.set(featureType, fn);
}

/** Params fingerprint — used to detect changes without deep equality. */
function fingerprint(params: Record<string, unknown>): string {
  try { return JSON.stringify(params); } catch { return String(Date.now()); }
}

interface CacheEntry {
  bodyId: string;
  paramsFingerprint: string;
  upstreamRevisions: Map<string, number>;
}

const _cache = new Map<string, CacheEntry>();

function upstreamRevisionMap(upstreamBodies: BRepBody[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of upstreamBodies) m.set(b.id, b.revision);
  return m;
}

function cacheHit(
  entry: CacheEntry,
  newFp: string,
  upstreamBodies: BRepBody[],
): boolean {
  if (entry.paramsFingerprint !== newFp) return false;
  const newRev = upstreamRevisionMap(upstreamBodies);
  if (newRev.size !== entry.upstreamRevisions.size) return false;
  for (const [id, rev] of newRev) {
    if (entry.upstreamRevisions.get(id) !== rev) return false;
  }
  return true;
}

/**
 * Evaluate a feature, returning its BRepBody.
 * Returns null if no evaluator is registered for the feature type,
 * or if evaluation fails.
 */
export function evaluateFeature(
  oc: OcctRaw,
  featureType: string,
  featureId: string,
  params: Record<string, unknown>,
  upstreamBodies: BRepBody[] = [],
): BRepBody | null {
  const fp = fingerprint(params);
  const entry = _cache.get(featureId);

  if (entry && cacheHit(entry, fp, upstreamBodies)) {
    const cachedBody = globalBRepBodyRegistry.get(entry.bodyId);
    if (cachedBody) return cachedBody;
  }

  const evaluator = _evaluators.get(featureType);
  if (!evaluator) return null;

  const result = evaluator(oc, featureId, params, upstreamBodies);
  if (!result) return null;

  // Register and cache
  result.sourceFeatureId = featureId;
  if (entry && entry.bodyId !== result.id) {
    globalBRepBodyRegistry.delete(entry.bodyId);
  }
  globalBRepBodyRegistry.add(result);

  _cache.set(featureId, {
    bodyId: result.id,
    paramsFingerprint: fp,
    upstreamRevisions: upstreamRevisionMap(upstreamBodies),
  });

  return result;
}

/** Invalidate a feature and all downstream dependents. */
export function invalidateFeature(featureId: string, dependentIds: string[] = []): void {
  _cache.delete(featureId);
  globalBRepBodyRegistry.getByFeature(featureId).forEach((b) => {
    globalBRepBodyRegistry.delete(b.id);
  });
  for (const dep of dependentIds) {
    invalidateFeature(dep);
  }
}

/** Clear the entire evaluation cache (e.g. on document close). */
export function clearFeatureEvaluationCache(): void {
  for (const entry of _cache.values()) {
    globalBRepBodyRegistry.delete(entry.bodyId);
  }
  _cache.clear();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearFeatureEvaluationCache();
    _evaluators.clear();
  });
}
