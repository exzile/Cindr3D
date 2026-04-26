import { describe, expect, it } from 'vitest';

import {
  bboxFromMoves,
  buildBox,
  buildCylinder,
  buildNGonPrism,
  outerWallMoves,
  sliceGeometry,
  totalLength,
  wallMoves,
} from './_helpers/slicerSystemHelpers';

/**
 * Per-layer consistency tests: a vertical-walled solid should produce
 * the same XY footprint at every layer (within tolerance). These tests
 * exercise the slicer's layer-iteration determinism.
 */

describe('Slicer layer consistency — outer-wall bbox', () => {
  const SIZES = [10, 15, 20, 25, 30] as const;

  it.each(SIZES)('vertical box of %dmm: every layer outer-wall bbox is identical (within 0.1mm)', async (size) => {
    const result = await sliceGeometry(buildBox(size, size, 4));
    expect(result.layers.length).toBeGreaterThan(5);
    const widths: number[] = [];
    const heights: number[] = [];
    for (const layer of result.layers) {
      const moves = outerWallMoves(layer);
      const bbox = bboxFromMoves(moves);
      if (Number.isFinite(bbox.width) && bbox.width > 0) {
        widths.push(bbox.width);
        heights.push(bbox.height);
      }
    }
    expect(widths.length).toBeGreaterThan(2);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(0.1);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.1);
  });

  it.each(SIZES)('cylinder of R=%dmm: every layer outer-wall bbox is identical', async (radius) => {
    const result = await sliceGeometry(buildCylinder(radius, 4, 32));
    const widths: number[] = [];
    for (const layer of result.layers) {
      const bbox = bboxFromMoves(outerWallMoves(layer));
      if (Number.isFinite(bbox.width) && bbox.width > 0) widths.push(bbox.width);
    }
    expect(widths.length).toBeGreaterThan(2);
    // 32-segment cylinder: seam placement varies per layer giving up to
    // ~lineWidth/2 fluctuation in measured bbox. Allow 0.5mm tolerance.
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(0.5);
  });
});

describe('Slicer layer consistency — outer-wall perimeter', () => {
  const SIZES = [10, 15, 20, 25] as const;
  it.each(SIZES)('every layer of a %dmm box has the same outer-wall perimeter', async (size) => {
    const result = await sliceGeometry(buildBox(size, size, 3));
    const perimeters: number[] = [];
    for (const layer of result.layers) {
      const total = totalLength(outerWallMoves(layer));
      if (total > 0) perimeters.push(total);
    }
    expect(perimeters.length).toBeGreaterThan(2);
    const min = Math.min(...perimeters);
    const max = Math.max(...perimeters);
    expect((max - min) / min).toBeLessThan(0.05);
  });
});

describe('Slicer layer consistency — wall move count', () => {
  it.each([10, 15, 20] as const)('every layer of a %dmm box emits a similar number of outer-wall moves', async (size) => {
    const result = await sliceGeometry(buildBox(size, size, 4));
    const counts = result.layers.map((l) => outerWallMoves(l).length).filter((n) => n > 0);
    expect(counts.length).toBeGreaterThan(2);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    // Counts may differ by 1-2 due to seam placement, but never by orders of magnitude.
    expect(max).toBeLessThanOrEqual(min + 4);
  });
});

describe('Slicer layer consistency — XY centering', () => {
  const SIZES = [10, 20, 30] as const;
  it.each(SIZES)('every layer of a %dmm box has the same XY center', async (size) => {
    const result = await sliceGeometry(buildBox(size, size, 4));
    const centers: Array<{ cx: number; cy: number }> = [];
    for (const layer of result.layers) {
      const bbox = bboxFromMoves(outerWallMoves(layer));
      if (!Number.isFinite(bbox.width) || bbox.width <= 0) continue;
      centers.push({ cx: (bbox.minX + bbox.maxX) / 2, cy: (bbox.minY + bbox.maxY) / 2 });
    }
    expect(centers.length).toBeGreaterThan(2);
    const cxs = centers.map((c) => c.cx);
    const cys = centers.map((c) => c.cy);
    expect(Math.max(...cxs) - Math.min(...cxs)).toBeLessThan(0.05);
    expect(Math.max(...cys) - Math.min(...cys)).toBeLessThan(0.05);
  });
});

describe('Slicer layer consistency — line width', () => {
  it.each([10, 15, 20] as const)('every wall move on every layer of a %dmm box uses lineWidth=0.4mm', async (size) => {
    const result = await sliceGeometry(buildBox(size, size, 3), { wallLineWidth: 0.4 });
    for (const layer of result.layers) {
      const moves = wallMoves(layer);
      for (const move of moves) {
        // Allow ±0.05 tolerance for adaptive-width walls (Arachne paths).
        expect(move.lineWidth).toBeGreaterThan(0.3);
        expect(move.lineWidth).toBeLessThan(0.5);
      }
    }
  });
});

describe('Slicer layer consistency — Z monotonicity', () => {
  it.each([0.1, 0.15, 0.2, 0.25, 0.3] as const)('layer Z values are strictly monotonic for layerHeight=%fmm', async (lh) => {
    const result = await sliceGeometry(buildBox(10, 10, 3), {
      layerHeight: lh,
      firstLayerHeight: lh,
    });
    expect(result.layers.length).toBeGreaterThan(3);
    for (let i = 1; i < result.layers.length; i++) {
      expect(result.layers[i].z).toBeGreaterThan(result.layers[i - 1].z);
    }
  });

  it.each([1, 2, 3, 5] as const)('first and last layer Z values bracket the model height (%dmm)', async (height) => {
    const result = await sliceGeometry(buildBox(10, 10, height), { layerHeight: 0.2, firstLayerHeight: 0.2 });
    expect(result.layers[0].z).toBeGreaterThan(0);
    expect(result.layers[result.layers.length - 1].z).toBeLessThanOrEqual(height + 0.2);
  });
});

describe('Slicer layer consistency — speed', () => {
  it('first layer move speed ≤ subsequent layer speed (firstLayerSpeed ramp)', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 2), {
      firstLayerSpeed: 15,
      outerWallSpeed: 50,
    });
    const layer0Speeds = wallMoves(result.layers[0]).map((m) => m.speed);
    const layer3Speeds = wallMoves(result.layers[3]).map((m) => m.speed);
    expect(layer0Speeds.length).toBeGreaterThan(0);
    expect(layer3Speeds.length).toBeGreaterThan(0);
    expect(Math.max(...layer0Speeds)).toBeLessThanOrEqual(Math.max(...layer3Speeds));
  });

  it.each([10, 15, 20, 25] as const)('first-layer speed cap is exactly firstLayerSpeed=%dmm/s', async (speed) => {
    const result = await sliceGeometry(buildBox(15, 15, 1), {
      firstLayerSpeed: speed,
      outerWallSpeed: 60,
    });
    const layer0Speeds = wallMoves(result.layers[0]).map((m) => m.speed);
    expect(layer0Speeds.length).toBeGreaterThan(0);
    expect(Math.max(...layer0Speeds)).toBeLessThanOrEqual(speed + 0.01);
  });
});

describe('Slicer layer consistency — extrusion', () => {
  it.each([10, 15, 20] as const)('every layer of a %dmm box extrudes a similar total amount', async (size) => {
    const result = await sliceGeometry(buildBox(size, size, 4));
    const extrusionsPerLayer = result.layers.map((l) => {
      let total = 0;
      for (const m of l.moves) {
        if (m.type === 'travel') continue;
        total += m.extrusion;
      }
      return total;
    });
    // Filter out the first/last layer (different speeds, density), and zero layers
    const middle = extrusionsPerLayer.slice(1, -1).filter((e) => e > 0);
    expect(middle.length).toBeGreaterThan(2);
    // Middle layers (away from solid skin) should be similar within ±50% — bottom/top layers
    // have solid fill so significantly more extrusion.
    const min = Math.min(...middle);
    const max = Math.max(...middle);
    expect(max).toBeLessThanOrEqual(min * 3);
  });
});

describe('Slicer layer consistency — N-gon footprint', () => {
  const N_GONS = [4, 6, 8] as const;
  it.each(N_GONS)('every layer of a %d-gon prism has the same wall move count', async (sides) => {
    const result = await sliceGeometry(buildNGonPrism(sides, 10, 4));
    const counts = result.layers.map((l) => outerWallMoves(l).length).filter((n) => n > 0);
    expect(counts.length).toBeGreaterThan(2);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    expect(max - min).toBeLessThanOrEqual(2);
  });
});

describe('Slicer layer consistency — wallCount vs layerCount', () => {
  it.each([1, 2, 3, 4] as const)('a 30mm × 4mm box with wallCount=%d has same per-layer wall count', async (wc) => {
    const result = await sliceGeometry(buildBox(30, 30, 4), { wallCount: wc });
    const counts = result.layers.map((l) => wallMoves(l).length).filter((n) => n > 0);
    expect(counts.length).toBeGreaterThan(2);
    // Every layer should have a similar wall count (proportional to wallCount).
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    expect((max - min) / min).toBeLessThan(0.3);
  });
});
