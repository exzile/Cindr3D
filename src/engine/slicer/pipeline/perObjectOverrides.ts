import type { PrintProfile } from '../../../types/slicer';

/**
 * Per-object override resolver.
 *
 * Cura's per-object override model has three precedence tiers:
 *   1. The active print profile (lowest)
 *   2. Per-object override (`perObjectSettings` on a PlateObject)
 *   3. Modifier-mesh override (e.g. an `infill_mesh` volume that
 *      overlaps this region — highest)
 *
 * The slicer worker applies tier 2 by partitioning printables into
 * per-override groups and constructing an effective profile per group
 * (see SlicerWorker.ts). Tier 3 is applied per-region, by the slicer
 * pipeline at infill/wall emission time, and uses the same precedence
 * rules — a modifier override beats the per-object override which
 * beats the profile default.
 *
 * This module exposes a pure resolver so all three tiers go through the
 * same code path.
 */
export type OverrideMap = Record<string, unknown>;

/**
 * Drop entries whose value is `undefined` — those represent "inherit
 * default" rather than a real override. (UI tristate "(global)" sets
 * the field to undefined.)
 */
export function compactOverrides(overrides: OverrideMap | undefined): OverrideMap | undefined {
  if (!overrides) return undefined;
  const out: OverrideMap = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Compose tiered overrides into a single effective profile object. The
 * later argument wins on conflict, matching Cura's precedence (modifier
 * mesh > per-object > profile).
 *
 * Returns a NEW object so the caller's profile is never mutated.
 */
export function resolveEffectiveProfile<TProfile extends PrintProfile>(
  baseProfile: TProfile,
  perObject?: OverrideMap,
  modifier?: OverrideMap,
): TProfile {
  const out = { ...baseProfile } as Record<string, unknown>;
  const apply = (overrides?: OverrideMap) => {
    if (!overrides) return;
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) continue;
      out[key] = value;
    }
  };
  apply(perObject);
  apply(modifier);
  return out as TProfile;
}

/**
 * Build a stable signature string for an override map so the worker
 * can group printables that share an effective profile. Sorting the
 * keys guarantees `{a, b}` and `{b, a}` produce the same key.
 */
export function overrideSignature(overrides: OverrideMap | undefined): string {
  const compact = compactOverrides(overrides);
  if (!compact) return '__default__';
  const keys = Object.keys(compact).sort();
  const obj: OverrideMap = {};
  for (const key of keys) obj[key] = compact[key];
  return JSON.stringify(obj);
}
