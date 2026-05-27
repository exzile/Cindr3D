/**
 * OCC body rehydration after page refresh.
 *
 * After a full page refresh the WASM heap is wiped, so the globalBRepBodyRegistry
 * is empty even though feature meshes are still in the React scene.  Edge-op tools
 * (fillet, chamfer) need a live BRepBody in the registry to map topology hits to
 * OCC edge IDs.  This module rebuilds those bodies on-demand from stored feature +
 * sketch data so edge selection works without requiring the user to re-commit.
 *
 * Only covers solid, non-thin, new-body/new-component extrudes — the subset that
 * buildOccNewBodyExtrudeMesh originally produced bodies for.
 */

import type { Feature, Sketch } from '../../../../types/cad';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { buildOccNewBodyExtrudeMesh } from './extrudeCommitOccNewBody';
import type { ExtrudeDirection } from './extrudeCommitHelpers';
import type { ExtrudeOperation } from './extrudeCommitOperation';

/**
 * Rebuild the OCC BRep body for a single solid extrude feature and register it.
 *
 * Returns true if the body is now in the registry (either it was already there or
 * rehydration succeeded), false if it was skipped or failed.
 *
 * Note on `extrudeSymmetricFullLength`:
 *   The stored `distance` encodes the geometry unambiguously —
 *     symmetricFullLength=true  → stored = absDistance / 2  (per-half)
 *     symmetricFullLength=false → stored = absDistance       (full total)
 *   Passing `false` here with the stored distance always reproduces the correct
 *   `occDistance` inside resolveOccExtrudeDistance because:
 *     occDistance = storedDistance * 2  (the "false" formula)
 *   which equals the original occDistance in both cases.
 */
export async function rehydrateExtrudeOccBody(
  feature: Feature,
  sketches: readonly Sketch[],
): Promise<boolean> {
  if (feature.type !== 'extrude') return false;

  const p = feature.params;
  const thin = p.thin as boolean | undefined;
  const operation = p.operation as ExtrudeOperation | undefined;
  const resolvedBodyKind = (feature.bodyKind ?? 'solid') as 'solid' | 'surface';

  // Only rehydrate solid non-thin new-body / new-component extrudes.
  if (resolvedBodyKind !== 'solid' || thin) return false;
  if (operation !== 'new-body' && operation !== 'new-component') return false;

  // Already in registry — nothing to do.
  if (globalBRepBodyRegistry.getByFeature(feature.id).length > 0) return true;

  const sketchId = feature.sketchId;
  if (!sketchId) return false;
  const sourceSketch = sketches.find((s) => s.id === sketchId);
  if (!sourceSketch) return false;

  const direction = ((p.direction as string | undefined) ?? 'positive') as ExtrudeDirection;
  const absDistance = (p.distance as number | undefined) ?? 0;
  const absDistance2 = (p.distance2 as number | undefined) ?? 0;
  const startType = (p.startType as string | undefined) ?? 'profile';
  const startOffset = (p.startOffset as number | undefined) ?? 0;
  const taperAngle = (p.taperAngle as number | undefined) ?? 0;
  const taperAngle2 = p.taperAngle2 as number | undefined;
  const profileIndex = p.profileIndex as number | undefined;
  const profileIndices = p.profileIndices as number[] | undefined;

  try {
    const result = await buildOccNewBodyExtrudeMesh({
      resolvedBodyKind: 'solid',
      extrudeThinEnabled: false,
      effectiveOperation: operation,
      profileIndices,
      sourceSketch,
      // sketchForOp is only used for the plane frame (createOffsetOccFrame).
      // All profiles of a sketch share the same plane, so sourceSketch is correct.
      sketchForOp: sourceSketch,
      profileIndex,
      featureId: feature.id,
      finalDirection: direction,
      absDistance,
      absDistance2,
      // See function-level comment — false is always correct for rehydration.
      extrudeSymmetricFullLength: false,
      extrudeStartType: startType,
      extrudeStartOffset: startOffset,
      extrudeTaperAngle: taperAngle,
      extrudeTaperAngle2: taperAngle2,
    });

    if (result.featureMesh) {
      // The body is now in the registry (side effect of createRegisteredOccMesh).
      // We only needed the body — free the display geometry we'll never render.
      result.featureMesh.geometry.dispose();
    }

    return result.needsStoredMesh;
  } catch {
    return false;
  }
}

/**
 * Rehydrate OCC bodies for all visible solid extrude features that are missing
 * from the registry.  Safe to call repeatedly — skips features already present.
 *
 * Returns the number of bodies that were successfully rehydrated.
 */
export async function rehydrateMissingExtrudeOccBodies(
  features: readonly Feature[],
  sketches: readonly Sketch[],
): Promise<number> {
  const candidates = features.filter(
    (f) =>
      f.type === 'extrude' &&
      (f.bodyKind ?? 'solid') === 'solid' &&
      !(f.params.thin as boolean | undefined) &&
      (f.params.operation === 'new-body' || f.params.operation === 'new-component') &&
      f.visible &&
      !f.suppressed &&
      globalBRepBodyRegistry.getByFeature(f.id).length === 0,
  );

  if (candidates.length === 0) return 0;

  const results = await Promise.all(
    candidates.map((f) => rehydrateExtrudeOccBody(f, sketches)),
  );

  return results.filter(Boolean).length;
}
