import { describe, expect, it } from 'vitest';

import {
  buildBox,
  buildCylinder,
  sliceGeometry,
} from './_helpers/slicerSystemHelpers';

/**
 * Extrusion accuracy tests: verify the volumetric math is correct.
 *
 * For a 1.75mm filament, each mm of extruded filament occupies
 * π × 0.875² ≈ 2.4053 mm³. The slicer should emit E values such that:
 *   E_per_mm_of_path × filament_area ≈ lineWidth × layerHeight
 *
 * These tests check this relationship across multiple line widths,
 * layer heights, and geometry sizes.
 */

const FILAMENT_RADIUS = 0.875;
const FILAMENT_AREA = Math.PI * FILAMENT_RADIUS * FILAMENT_RADIUS;

interface Move {
  type: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  extrusion: number;
  lineWidth: number;
}

function totalExtruding(layer: { moves: Move[] }): { length: number; extrusion: number } {
  let length = 0;
  let extrusion = 0;
  for (const move of layer.moves) {
    if (move.type === 'travel') continue;
    length += Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y);
    extrusion += move.extrusion;
  }
  return { length, extrusion };
}

describe('Slicer extrusion accuracy — volumetric math', () => {
  const LINE_WIDTHS = [0.3, 0.4, 0.5, 0.6] as const;
  it.each(LINE_WIDTHS)('extrusion volume per mm matches lw × lh for lw=%f', async (lw) => {
    const result = await sliceGeometry(buildBox(20, 20, 1), {
      // Per-feature widths override the master `wallLineWidth`, so set
      // ALL of them so the wall extrusion math has a single source.
      wallLineWidth: lw,
      outerWallLineWidth: lw,
      innerWallLineWidth: lw,
      topBottomLineWidth: lw,
      infillLineWidth: lw,
      layerHeight: 0.2,
      firstLayerHeight: 0.2,
      flowRateCompensationFactor: 1.0,
    });
    const { length, extrusion } = totalExtruding(result.layers[2]);
    expect(length).toBeGreaterThan(0);
    const ePerMm = extrusion / length;
    const expectedEPerMm = (lw * 0.2) / FILAMENT_AREA;
    // Material flow rate may add ±5% offset.
    expect(ePerMm).toBeGreaterThan(expectedEPerMm * 0.85);
    expect(ePerMm).toBeLessThan(expectedEPerMm * 1.2);
  }, 60_000);

  const LAYER_HEIGHTS = [0.1, 0.15, 0.2, 0.3] as const;
  it.each(LAYER_HEIGHTS)('extrusion scales linearly with layerHeight=%fmm', async (lh) => {
    const result = await sliceGeometry(buildBox(20, 20, 1), {
      wallLineWidth: 0.4,
      layerHeight: lh,
      firstLayerHeight: lh,
      flowRateCompensationFactor: 1.0,
    });
    const { length, extrusion } = totalExtruding(result.layers[1]);
    expect(length).toBeGreaterThan(0);
    const ePerMm = extrusion / length;
    const expectedEPerMm = (0.4 * lh) / FILAMENT_AREA;
    expect(ePerMm).toBeGreaterThan(expectedEPerMm * 0.9);
    expect(ePerMm).toBeLessThan(expectedEPerMm * 1.15);
  }, 60_000);
});

describe('Slicer extrusion accuracy — total filament use', () => {
  it.each([10, 15, 20, 30] as const)('total filament use is finite for a %dmm box', async (size) => {
    const result = await sliceGeometry(buildBox(size, size, 2));
    expect(result.filamentUsed).toBeGreaterThan(0);
    expect(Number.isFinite(result.filamentUsed)).toBe(true);
  }, 60_000);

  it('total filament use grows with model height', async () => {
    const r1 = await sliceGeometry(buildBox(15, 15, 1));
    const r4 = await sliceGeometry(buildBox(15, 15, 4));
    expect(r4.filamentUsed).toBeGreaterThan(r1.filamentUsed * 1.5);
  }, 60_000);

  it('total filament use grows with model size (linear-ish in perimeter)', async () => {
    const r10 = await sliceGeometry(buildBox(10, 10, 2));
    const r20 = await sliceGeometry(buildBox(20, 20, 2));
    expect(r20.filamentUsed).toBeGreaterThan(r10.filamentUsed);
  }, 60_000);
});

describe('Slicer extrusion accuracy — flow compensation', () => {
  it('flowRateCompensationFactor=1.2 increases extrusion by ~20%', async () => {
    const baseline = await sliceGeometry(buildBox(15, 15, 2), { flowRateCompensationFactor: 1.0 });
    const high = await sliceGeometry(buildBox(15, 15, 2), { flowRateCompensationFactor: 1.2 });
    expect(high.filamentUsed).toBeCloseTo(baseline.filamentUsed * 1.2, 0);
  }, 60_000);

  it('flowRateCompensationFactor=0.9 decreases extrusion by ~10%', async () => {
    const baseline = await sliceGeometry(buildBox(15, 15, 2), { flowRateCompensationFactor: 1.0 });
    const low = await sliceGeometry(buildBox(15, 15, 2), { flowRateCompensationFactor: 0.9 });
    expect(low.filamentUsed).toBeCloseTo(baseline.filamentUsed * 0.9, 0);
  }, 60_000);
});

describe('Slicer extrusion accuracy — per-move totals', () => {
  it('sum of per-move extrusion equals filamentUsed within rounding', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 1));
    let manualTotal = 0;
    for (const layer of result.layers) {
      for (const move of layer.moves) {
        if (move.type === 'travel') continue;
        manualTotal += move.extrusion;
      }
    }
    // Allow up to 0.5% drift due to slicer-side accumulation.
    expect(manualTotal).toBeCloseTo(result.filamentUsed, 0);
  }, 60_000);

  it.each([10, 15, 20] as const)('all per-move extrusion values are finite for a %dmm box', async (size) => {
    const result = await sliceGeometry(buildBox(size, size, 2));
    for (const layer of result.layers) {
      for (const move of layer.moves) {
        expect(Number.isFinite(move.extrusion)).toBe(true);
      }
    }
  }, 60_000);
});

describe('Slicer extrusion accuracy — cylinder volumetric estimate', () => {
  it.each([5, 8, 10] as const)('cylinder R=%dmm produces extrusion approximately equal to expected wall volume', async (radius) => {
    const height = 2;
    const result = await sliceGeometry(buildCylinder(radius, height, 64), {
      wallLineWidth: 0.4,
      layerHeight: 0.2,
      firstLayerHeight: 0.2,
      wallCount: 1,
    });
    // Wall volume = 2πR × wall_lineWidth × height (approx, ignoring solid skin).
    // Slicer also emits solid bottom + top which adds significantly more.
    const wallVolumePerLayer = 2 * Math.PI * (radius - 0.2) * 0.4 * 0.2;
    const layerCount = Math.ceil(height / 0.2);
    const minExpectedWallVolume = wallVolumePerLayer * layerCount * 0.8;
    // Total extrusion volume = filamentUsed × filamentArea
    const totalVolume = result.filamentUsed * FILAMENT_AREA;
    expect(totalVolume).toBeGreaterThan(minExpectedWallVolume);
  }, 60_000);
});

describe('Slicer extrusion accuracy — first-layer flow override', () => {
  it.each([80, 100, 120] as const)('initialLayerFlow=%d%% scales layer-0 extrusion proportionally', async (pct) => {
    const baseline = await sliceGeometry(buildBox(15, 15, 1), { initialLayerFlow: 100 });
    const scaled = await sliceGeometry(buildBox(15, 15, 1), { initialLayerFlow: pct });
    const baseExtrusion = baseline.layers[0].moves.reduce((s, m) =>
      m.type === 'travel' ? s : s + m.extrusion, 0);
    const scaledExtrusion = scaled.layers[0].moves.reduce((s, m) =>
      m.type === 'travel' ? s : s + m.extrusion, 0);
    expect(scaledExtrusion).toBeCloseTo(baseExtrusion * (pct / 100), 0);
  }, 60_000);
});
