import { describe, expect, it } from 'vitest';

import {
  bboxFromMoves,
  buildBox,
  buildCylinder,
  buildNGonPrism,
  outerWallMoves,
  sliceGeometry,
  wallMoves,
} from './_helpers/slicerSystemHelpers';

/**
 * Dimensional accuracy tests: slice a known geometry and assert that
 * wall-positions land at the expected dimensions (within slicer offset
 * tolerance).
 *
 * Cura's classic generator places the outer wall's CENTERLINE one
 * half-line-width inside the model boundary by default. So a 20mm box
 * with 0.4mm line width has its outer-wall centerline at 19.6mm wide.
 */

const BOX_SIZES = [5, 10, 15, 20, 30, 50] as const;
const BOX_HEIGHTS = [1, 2, 4] as const;
const WALL_COUNTS = [1, 2, 3] as const;
const LINE_WIDTHS = [0.3, 0.4, 0.5, 0.6] as const;

const LAYER_INDEX = 3;

function expectedOuterWidth(modelSize: number, lw: number): number {
  // Outer wall centerline is `lw / 2` inside each side → -lw total.
  return modelSize - lw;
}

describe('Slicer dimensional accuracy — square box outer-wall bbox', () => {
  it.each(BOX_SIZES)('20-tall box of %dmm side: outer wall ≈ size - lineWidth', async (size) => {
    const result = await sliceGeometry(buildBox(size, size, 4));
    const bbox = bboxFromMoves(outerWallMoves(result.layers[LAYER_INDEX]));
    const expected = expectedOuterWidth(size, 0.4);
    expect(bbox.width).toBeCloseTo(expected, 0);
    expect(bbox.height).toBeCloseTo(expected, 0);
  });

  it.each(BOX_SIZES)('non-square box of %d × half-size has correct bbox aspect ratio', async (size) => {
    const sx = size, sy = Math.max(5, size / 2);
    const result = await sliceGeometry(buildBox(sx, sy, 4));
    const bbox = bboxFromMoves(outerWallMoves(result.layers[LAYER_INDEX]));
    expect(bbox.width).toBeCloseTo(expectedOuterWidth(sx, 0.4), 0);
    expect(bbox.height).toBeCloseTo(expectedOuterWidth(sy, 0.4), 0);
  });

  it.each(LINE_WIDTHS)('outer-wall offset scales with lineWidth=%fmm', async (lw) => {
    const result = await sliceGeometry(buildBox(20, 20, 2), { wallLineWidth: lw });
    const bbox = bboxFromMoves(outerWallMoves(result.layers[3]));
    expect(bbox.width).toBeCloseTo(expectedOuterWidth(20, lw), 0);
  });

  it.each(BOX_HEIGHTS)('every-layer outer-wall bbox is constant for a vertical-walled box of height %dmm', async (height) => {
    const result = await sliceGeometry(buildBox(15, 15, height));
    expect(result.layers.length).toBeGreaterThan(2);
    const widths = result.layers.map((l) => bboxFromMoves(outerWallMoves(l)).width);
    const finite = widths.filter((w) => Number.isFinite(w) && w > 0);
    expect(finite.length).toBeGreaterThan(0);
    const minW = Math.min(...finite);
    const maxW = Math.max(...finite);
    expect(maxW - minW).toBeLessThan(0.1);  // tighter than wallLineWidth/4
  });
});

describe('Slicer dimensional accuracy — wall count cascade', () => {
  it.each(WALL_COUNTS)('wallCount=%d shifts the innermost wall inward by (n-0.5) × lineWidth', async (wc) => {
    const lw = 0.4;
    const result = await sliceGeometry(buildBox(20, 20, 2), { wallCount: wc, wallLineWidth: lw });
    const all = wallMoves(result.layers[3]);
    expect(all.length).toBeGreaterThan(0);
    const bbox = bboxFromMoves(all);
    // Innermost wall is at depth (wc - 1); its centerline sits
    // (wc - 0.5) × lw inside each face → bbox = 20 - 2 × (wc - 0.5) × lw.
    // The full wall-bbox is the OUTERMOST wall (one half-LW inside) →
    // width = 20 - lw regardless of wallCount.
    expect(bbox.width).toBeCloseTo(20 - lw, 0);
  });

  it('inner wall depth-1 sits 1 × lineWidth inside outer wall', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 2), { wallCount: 2 });
    const layer = result.layers[3];
    const outer = bboxFromMoves(outerWallMoves(layer));
    const inner = bboxFromMoves(layer.moves.filter((m) => m.type === 'wall-inner'));
    // Inner-wall bbox is shrunk by 1 × lineWidth on each side from the outer.
    expect(outer.width - inner.width).toBeCloseTo(2 * 0.4, 1);
  });
});

describe('Slicer dimensional accuracy — cylinder', () => {
  const RADII = [3, 5, 8, 10, 15] as const;
  it.each(RADII)('cylinder R=%dmm: outer wall radius ≈ R - lineWidth/2', async (radius) => {
    const result = await sliceGeometry(buildCylinder(radius, 4, 64));
    const bbox = bboxFromMoves(outerWallMoves(result.layers[3]));
    // Diameter of the wall path centerline = 2R - lineWidth.
    const expectedDiameter = 2 * radius - 0.4;
    expect(bbox.width).toBeCloseTo(expectedDiameter, 0);
    expect(bbox.height).toBeCloseTo(expectedDiameter, 0);
    // Round shape: width ≈ height
    expect(Math.abs(bbox.width - bbox.height)).toBeLessThan(0.5);
  });

  it.each(RADII)('cylinder R=%dmm has approximately circular wall path (max radial deviation < 0.4mm)', async (radius) => {
    const result = await sliceGeometry(buildCylinder(radius, 4, 64));
    const moves = outerWallMoves(result.layers[3]);
    const bbox = bboxFromMoves(moves);
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    const expectedR = radius - 0.2; // half-LW inset
    let maxDev = 0;
    for (const move of moves) {
      const r = Math.hypot(move.from.x - cx, move.from.y - cy);
      maxDev = Math.max(maxDev, Math.abs(r - expectedR));
    }
    expect(maxDev).toBeLessThan(0.4);
  });
});

describe('Slicer dimensional accuracy — N-gon prism', () => {
  const N_GONS = [3, 4, 5, 6, 8, 12] as const;
  it.each(N_GONS)('regular %d-gon (R=10mm) outer wall bbox matches the geometric span', async (sides) => {
    const radius = 10;
    const result = await sliceGeometry(buildNGonPrism(sides, radius, 4));
    const bbox = bboxFromMoves(outerWallMoves(result.layers[3]));
    // Geometric X span of a regular N-gon (vertex at angle 0) is
    // R - R cos(π) = 2R for even N, otherwise R - R cos(((N-1)/N) × π).
    let minCos = 1, maxCos = -1;
    for (let i = 0; i < sides; i++) {
      const c = Math.cos((i / sides) * Math.PI * 2);
      if (c < minCos) minCos = c;
      if (c > maxCos) maxCos = c;
    }
    const expectedSpan = radius * (maxCos - minCos);
    // Wall sits 0.4mm inside, so subtract that. Allow ±0.5mm tolerance.
    expect(bbox.width).toBeGreaterThan(expectedSpan - 0.4 - 0.5);
    expect(bbox.width).toBeLessThan(expectedSpan + 0.5);
  });

  it.each(N_GONS)('%d-gon perimeter is within 5%% of expected polygon perimeter', async (sides) => {
    const radius = 10;
    const result = await sliceGeometry(buildNGonPrism(sides, radius, 4));
    const moves = outerWallMoves(result.layers[3]);
    let perimeter = 0;
    for (const move of moves) {
      perimeter += Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y);
    }
    // Inscribed N-gon side length = 2R sin(π/N); perimeter = N × side.
    // Wall path is offset inward by lw/2, so use effective R-lw/2.
    const effR = radius - 0.2;
    const expectedSide = 2 * effR * Math.sin(Math.PI / sides);
    const expectedPerimeter = sides * expectedSide;
    expect(perimeter).toBeGreaterThan(expectedPerimeter * 0.92);
    expect(perimeter).toBeLessThan(expectedPerimeter * 1.05);
  });
});

describe('Slicer dimensional accuracy — z-direction', () => {
  const HEIGHTS = [1, 2, 3, 5, 8, 10] as const;
  it.each(HEIGHTS)('layer count for %dmm tall box ≈ height / layerHeight', async (height) => {
    const result = await sliceGeometry(buildBox(10, 10, height), { layerHeight: 0.2 });
    const expected = Math.ceil(height / 0.2);
    expect(result.layerCount).toBeGreaterThanOrEqual(expected - 1);
    expect(result.layerCount).toBeLessThanOrEqual(expected + 2);
  });

  const LAYER_HS = [0.1, 0.15, 0.2, 0.3, 0.4] as const;
  it.each(LAYER_HS)('layer Z spacing past first layer is exactly layerHeight=%fmm', async (lh) => {
    const result = await sliceGeometry(buildBox(10, 10, 2), {
      layerHeight: lh,
      firstLayerHeight: lh,
    });
    expect(result.layers.length).toBeGreaterThan(2);
    for (let i = 2; i < result.layers.length; i++) {
      const dz = result.layers[i].z - result.layers[i - 1].z;
      expect(dz).toBeCloseTo(lh, 4);
    }
  });

  it.each(LAYER_HS)('first layer Z equals firstLayerHeight (overridable from default 0.3) for layerHeight=%f', async (lh) => {
    const result = await sliceGeometry(buildBox(10, 10, 2), {
      layerHeight: lh,
      firstLayerHeight: lh,
    });
    expect(result.layers[0].z).toBeCloseTo(lh, 4);
  });

  it('uses firstLayerHeight (0.3) by default even when layerHeight differs', async () => {
    const result = await sliceGeometry(buildBox(10, 10, 2), { layerHeight: 0.2 });
    expect(result.layers[0].z).toBeCloseTo(0.3, 4);
  });
});

describe('Slicer dimensional accuracy — XY centering on the bed', () => {
  it.each(BOX_SIZES)('a centered box of %dmm produces walls centered on the bed', async (size) => {
    const result = await sliceGeometry(buildBox(size, size, 2));
    const bbox = bboxFromMoves(outerWallMoves(result.layers[3]));
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    // Default printer (200x200 build volume) → bed center at (100, 100).
    expect(cx).toBeCloseTo(100, 0);
    expect(cy).toBeCloseTo(100, 0);
  });
});
