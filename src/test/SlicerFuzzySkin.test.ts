import { describe, expect, it } from 'vitest';

import {
  buildBox,
  outerWallMoves,
  sliceGeometry,
  totalLength,
} from './_helpers/slicerSystemHelpers';

/**
 * Fuzzy skin integration coverage.
 *
 * Verifies:
 *   1. Two slices of the same geometry produce identical fuzzy outputs
 *      (Mulberry32 PRNG seeded by layer index — deterministic).
 *   2. Fuzzy on adds vertices to the wall vs fuzzy off (resampling at
 *      fuzzySkinPointDist intervals always produces ≥ original count).
 *   3. First layer is NEVER fuzzed (bed adhesion gate).
 */
describe('Fuzzy skin (fuzzySkinsEnabled)', () => {
  it('is deterministic across repeat slices', async () => {
    const overrides = {
      fuzzySkinsEnabled: true,
      fuzzySkinThickness: 0.4,
      fuzzySkinPointDist: 0.5,
      // Use classic walls so the loop input to the fuzz pass is stable
      // (Arachne's variable-width path produces different vertex
      // counts that are fine for production but noisy for tests).
      wallGenerator: 'classic' as const,
      wallCount: 1,
    };
    const a = await sliceGeometry(buildBox(20, 20, 4), overrides);
    const b = await sliceGeometry(buildBox(20, 20, 4), overrides);
    // Compare every wall vertex on every layer — must match bit-for-bit.
    expect(a.layers.length).toBe(b.layers.length);
    for (let li = 0; li < a.layers.length; li++) {
      const wa = outerWallMoves(a.layers[li]);
      const wb = outerWallMoves(b.layers[li]);
      expect(wa.length).toBe(wb.length);
      for (let i = 0; i < wa.length; i++) {
        expect(wa[i].to.x).toBeCloseTo(wb[i].to.x, 8);
        expect(wa[i].to.y).toBeCloseTo(wb[i].to.y, 8);
      }
    }
  }, 60_000);

  it('first layer is never fuzzed (bed adhesion gate)', async () => {
    // Slice the same box twice — once with fuzz, once without. The
    // first-layer outer-wall PERIMETER must match between the two
    // (fuzzy-off and fuzzy-on first layer should both be the clean
    // 20mm box outline). Layers 1+ may differ.
    const off = await sliceGeometry(buildBox(20, 20, 4), {
      fuzzySkinsEnabled: false,
      wallGenerator: 'classic' as const,
      wallCount: 1,
    });
    const on = await sliceGeometry(buildBox(20, 20, 4), {
      fuzzySkinsEnabled: true,
      fuzzySkinThickness: 0.4,
      fuzzySkinPointDist: 0.5,
      wallGenerator: 'classic' as const,
      wallCount: 1,
    });
    const offFirstPerim = totalLength(outerWallMoves(off.layers[0]));
    const onFirstPerim = totalLength(outerWallMoves(on.layers[0]));
    // First-layer perimeters should be near-identical (within the
    // simplification tolerance) — fuzzy adds substantial random noise
    // that would push the perimeter materially longer if it were
    // applied.
    expect(Math.abs(offFirstPerim - onFirstPerim)).toBeLessThan(0.5);
  }, 60_000);

  it('produces longer perimeters than non-fuzzed walls on inner layers', async () => {
    const off = await sliceGeometry(buildBox(20, 20, 4), {
      fuzzySkinsEnabled: false,
      wallGenerator: 'classic' as const,
      wallCount: 1,
    });
    const on = await sliceGeometry(buildBox(20, 20, 4), {
      fuzzySkinsEnabled: true,
      fuzzySkinThickness: 0.6,
      fuzzySkinPointDist: 0.4,
      wallGenerator: 'classic' as const,
      wallCount: 1,
    });
    // Pick a middle layer (definitely past the first-layer gate).
    const li = 5;
    if (li >= off.layers.length || li >= on.layers.length) return;
    const offPerim = totalLength(outerWallMoves(off.layers[li]));
    const onPerim = totalLength(outerWallMoves(on.layers[li]));
    // Fuzzy with 0.6mm displacement and 0.4mm spacing zigzags the wall —
    // the printed length should be measurably longer than the clean rect.
    expect(onPerim).toBeGreaterThan(offPerim);
  }, 60_000);
});
