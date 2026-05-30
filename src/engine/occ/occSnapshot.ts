/**
 * OCC-7.3 — STEP-based undo/redo snapshots.
 *
 * Replaces the previous practice of stripping BufferGeometry from history
 * snapshots. Now BRepBody objects survive undo/redo as STEP strings (~50-200 KB
 * per body), reconstructed on demand via shapeFromStep.
 */
import { shapeToStep, shapeFromStep } from './stepIO';
import { globalBRepBodyRegistry } from './globalRegistry';
import { getOcc, getOccSync } from './loader';

export interface OccBodySnapshot {
  featureId: string;
  bodyId: string;
  stepString: string;
}

/**
 * Capture all registered BRepBodies as STEP strings.
 * Called by snapshotCADState (OCC-7.3 patch to historyUtils.ts).
 */
export function captureOccSnapshot(): OccBodySnapshot[] {
  const occ = getOccSync();
  if (!occ) return [];

  const snapshot: OccBodySnapshot[] = [];
  const reg = globalBRepBodyRegistry.snapshot();

  for (const bodyId of reg.bodyIds) {
    const body = globalBRepBodyRegistry.get(bodyId);
    if (!body?.sourceFeatureId) continue;

    const result = shapeToStep(occ.oc, body);
    if (result.ok) {
      snapshot.push({
        featureId: body.sourceFeatureId,
        bodyId,
        stepString: result.value,
      });
    }
  }

  return snapshot;
}

/**
 * Restore BRepBodies from a STEP snapshot into the global registry.
 * Called during undo/redo restore (OCC-7.3 patch to historyAndDocumentSlice).
 */
export async function restoreOccSnapshot(snapshots: OccBodySnapshot[]): Promise<void> {
  if (snapshots.length === 0) return;

  // Use getOcc() (not getOccSync) so we wait for the WASM module to finish
  // loading rather than silently bailing if it isn't ready yet — that was the
  // root cause of files loading with an empty registry (OCC-7.4 race fix).
  const occ = await getOcc();

  // Guard: if OCC is not available (test env, or WASM failed to load), bail out
  // without clearing the registry so existing bodies aren't lost.
  if (!occ) return;

  // Clear the existing registry first so stale bodies don't accumulate.
  globalBRepBodyRegistry.clear();

  for (const { featureId, bodyId, stepString } of snapshots) {
    const result = shapeFromStep(occ.oc, stepString);
    if (result.ok) {
      const body = result.value;
      // Restore the original body ID so mesh.userData.brepBodyId keeps working
      // after file load / undo-redo; strict OCC ops require a live registry hit.
      body.id = bodyId;
      body.sourceFeatureId = featureId;
      globalBRepBodyRegistry.add(body);
    }
  }
}
