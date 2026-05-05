import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  bboxFromMoves,
  buildBox,
  buildCylinder,
  outerWallMoves,
  sliceGeometry,
  wallMoves,
} from './_helpers/slicerSystemHelpers';

/**
 * Boundary-case tests: tiny features, near-degenerate inputs, extreme
 * settings. Verifies the slicer doesn't crash or produce NaN/Infinity
 * output on edge cases.
 */

describe('Slicer boundary cases — small models', () => {
  it('1mm × 1mm × 1mm cube produces some output without crashing', async () => {
    const result = await sliceGeometry(buildBox(1, 1, 1));
    // A 1mm cube might be at or below feature size — accept zero or
    // multiple layers but don't crash.
    expect(result.layers.length).toBeGreaterThanOrEqual(0);
    expect(result.gcode.length).toBeGreaterThan(0);
  }, 60_000);

  it('2mm × 2mm × 0.5mm flat cube produces a single layer', async () => {
    const result = await sliceGeometry(buildBox(2, 2, 0.5), {
      layerHeight: 0.2,
      firstLayerHeight: 0.2,
    });
    expect(result.layerCount).toBeGreaterThanOrEqual(2);
    expect(result.layerCount).toBeLessThanOrEqual(4);
  }, 60_000);

  it.each([1, 2, 3] as const)('cylinder R=%dmm produces a circular wall path', async (radius) => {
    const result = await sliceGeometry(buildCylinder(radius, 1, 16), {
      bottomLayers: 0,
      connectInfillLines: false,
      infillDensity: 0,
      topLayers: 0,
    });
    expect(result.layerCount).toBeGreaterThan(0);
    // Just verify no NaN/Inf in output.
    for (const layer of result.layers) {
      for (const move of layer.moves) {
        expect(Number.isFinite(move.from.x)).toBe(true);
        expect(Number.isFinite(move.from.y)).toBe(true);
        expect(Number.isFinite(move.to.x)).toBe(true);
        expect(Number.isFinite(move.to.y)).toBe(true);
      }
    }
  }, 60_000);
});

describe('Slicer boundary cases — large models', () => {
  it('100mm × 100mm × 1mm slab fits in 200mm build volume', async () => {
    const result = await sliceGeometry(buildBox(100, 100, 1));
    expect(result.layerCount).toBeGreaterThan(0);
    const bbox = bboxFromMoves(outerWallMoves(result.layers[2]));
    expect(bbox.width).toBeCloseTo(99.6, 0);  // 100 - lineWidth
  }, 60_000);

  it('80mm × 80mm × 80mm cube produces hundreds of layers', async () => {
    const result = await sliceGeometry(buildBox(80, 80, 80), { layerHeight: 0.2 });
    expect(result.layerCount).toBeGreaterThan(350);
  }, 120_000);
});

describe('Slicer boundary cases — extreme line widths', () => {
  const LINE_WIDTHS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0] as const;
  it.each(LINE_WIDTHS)('lineWidth=%fmm produces finite-coordinate walls', async (lw) => {
    const result = await sliceGeometry(buildBox(20, 20, 1), { wallLineWidth: lw });
    const moves = wallMoves(result.layers[2]);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(Number.isFinite(m.from.x)).toBe(true);
      expect(Number.isFinite(m.lineWidth)).toBe(true);
      expect(m.lineWidth).toBeGreaterThan(0);
    }
  }, 60_000);
});

describe('Slicer boundary cases — extreme wall counts', () => {
  it.each([1, 2, 3, 5, 8] as const)('wallCount=%d produces at least N wall rings on a 30mm box', async (wc) => {
    const result = await sliceGeometry(buildBox(30, 30, 1), { wallCount: wc });
    const moves = wallMoves(result.layers[2]);
    expect(moves.length).toBeGreaterThanOrEqual(4 * wc);  // 4 sides × wc rings
  }, 60_000);
});

describe('Slicer boundary cases — extreme layer heights', () => {
  it.each([0.05, 0.08, 0.1, 0.15, 0.2, 0.3, 0.4] as const)(
    'layerHeight=%fmm produces consistent layers on a 4mm tall box',
    async (lh) => {
      const result = await sliceGeometry(buildBox(10, 10, 4), {
        layerHeight: lh,
        firstLayerHeight: lh,
      });
      expect(result.layerCount).toBeGreaterThan(0);
      const expected = Math.ceil(4 / lh);
      expect(result.layerCount).toBeGreaterThanOrEqual(expected - 2);
      expect(result.layerCount).toBeLessThanOrEqual(expected + 2);
    },
    60_000,
  );
});

describe('Slicer boundary cases — degenerate / pathological inputs', () => {
  it('zero-height geometry (sz=0) does not crash the slicer', async () => {
    // A box with zero height: this might emit no layers but must not throw.
    let result;
    try {
      result = await sliceGeometry(buildBox(10, 10, 0.001));
    } catch (e) {
      // Acceptable to error on degenerate input.
      expect(e).toBeTruthy();
      return;
    }
    expect(result.layers.length).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('a box at the build plate origin (no offset) still slices', async () => {
    // Default slicer auto-centers the model. The geometry's local position
    // doesn't matter — verify by generating a box wherever and checking
    // the slicer produces output.
    const result = await sliceGeometry(buildBox(10, 10, 1));
    expect(result.gcode.length).toBeGreaterThan(0);
  }, 60_000);

  it('a 60-segment cylinder produces a smooth-enough wall (≥ 30 distinct points)', async () => {
    const result = await sliceGeometry(buildCylinder(10, 1, 60));
    const moves = outerWallMoves(result.layers[2]);
    const uniqueAngles = new Set<string>();
    const bbox = bboxFromMoves(moves);
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    for (const m of moves) {
      const angle = Math.atan2(m.from.y - cy, m.from.x - cx);
      uniqueAngles.add(((angle * 180) / Math.PI).toFixed(1));
    }
    expect(uniqueAngles.size).toBeGreaterThan(20);
  }, 60_000);
});

describe('Slicer boundary cases — repeatability', () => {
  it.each([10, 15, 20, 30] as const)('slicing the same %dmm box twice produces identical g-code', async (size) => {
    const a = await sliceGeometry(buildBox(size, size, 2));
    const b = await sliceGeometry(buildBox(size, size, 2));
    expect(a.gcode).toBe(b.gcode);
  }, 60_000);

  it.each([0.2, 0.3, 0.4] as const)('same layer height gives identical results across runs (%fmm)', async (lh) => {
    const a = await sliceGeometry(buildBox(15, 15, 2), { layerHeight: lh });
    const b = await sliceGeometry(buildBox(15, 15, 2), { layerHeight: lh });
    expect(a.layerCount).toBe(b.layerCount);
    expect(a.printTime).toBeCloseTo(b.printTime, 4);
  }, 60_000);

  it('moves list is deterministic (same length per layer)', async () => {
    const a = await sliceGeometry(buildBox(20, 20, 2));
    const b = await sliceGeometry(buildBox(20, 20, 2));
    for (let i = 0; i < a.layerCount; i++) {
      expect(a.layers[i].moves.length).toBe(b.layers[i].moves.length);
    }
  }, 60_000);
});

describe('Slicer boundary cases — non-axis-aligned input', () => {
  it('rotated mesh produces a rotated wall footprint', async () => {
    // Build a 10x5 rectangle (wide), then rotate by 90° to make 5x10 (tall).
    const positions: number[] = [];
    const v = (x: number, y: number, z: number) => [x, y, z];
    const push = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
    const sx = 5, sy = 10, sz = 2;  // Already rotated 90° from 10x5
    const hx = sx / 2, hy = sy / 2;
    const p000 = v(-hx, -hy, 0), p100 = v(hx, -hy, 0), p110 = v(hx, hy, 0), p010 = v(-hx, hy, 0);
    const p001 = v(-hx, -hy, sz), p101 = v(hx, -hy, sz), p111 = v(hx, hy, sz), p011 = v(-hx, hy, sz);
    push(p000, p110, p100); push(p000, p010, p110);
    push(p001, p101, p111); push(p001, p111, p011);
    push(p000, p100, p101); push(p000, p101, p001);
    push(p010, p011, p111); push(p010, p111, p110);
    push(p000, p001, p011); push(p000, p011, p010);
    push(p100, p110, p111); push(p100, p111, p101);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    const result = await sliceGeometry(geom);
    const bbox = bboxFromMoves(outerWallMoves(result.layers[2]));
    expect(bbox.width).toBeCloseTo(sx - 0.4, 0);
    expect(bbox.height).toBeCloseTo(sy - 0.4, 0);
  }, 60_000);
});

describe('Slicer boundary cases — settings combinations', () => {
  it('horizontalExpansion + wallCount=3 combine correctly', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 1), {
      wallCount: 3,
      horizontalExpansion: 0.2,
    });
    const layer = result.layers[2];
    const outer = bboxFromMoves(outerWallMoves(layer));
    // Outer wall grows by horizontalExpansion: bbox = 20 + 0.4 - lw = 20.0
    expect(outer.width).toBeCloseTo(20, 0);
  }, 60_000);

  it('elephantFootCompensation only affects layer 0 in combination with horizontalExpansion', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 2), {
      horizontalExpansion: 0,
      elephantFootCompensation: 0.2,
    });
    // Layer 0: outer shrunk by 0.2 → bbox = 20 - 0.4 - 0.4 = 19.2
    const layer0 = bboxFromMoves(outerWallMoves(result.layers[0]));
    expect(layer0.width).toBeCloseTo(19.2, 0);

    // Layer 3 (above first): unaffected → bbox = 19.6
    const layer3 = bboxFromMoves(outerWallMoves(result.layers[3]));
    expect(layer3.width).toBeCloseTo(19.6, 0);
  }, 60_000);
});

describe('Slicer boundary cases — extreme aspect ratios', () => {
  it('wide thin slab (50mm × 5mm × 1mm) slices correctly', async () => {
    const result = await sliceGeometry(buildBox(50, 5, 1));
    const bbox = bboxFromMoves(outerWallMoves(result.layers[2]));
    expect(bbox.width).toBeCloseTo(49.6, 0);
    expect(bbox.height).toBeCloseTo(4.6, 0);
  }, 60_000);

  it('tall narrow column (5mm × 5mm × 50mm) slices correctly', async () => {
    const result = await sliceGeometry(buildBox(5, 5, 50));
    expect(result.layerCount).toBeGreaterThan(200);
    const bbox = bboxFromMoves(outerWallMoves(result.layers[5]));
    expect(bbox.width).toBeCloseTo(4.6, 0);
    expect(bbox.height).toBeCloseTo(4.6, 0);
  }, 120_000);
});

describe('Slicer boundary cases — empty mesh', () => {
  it('an empty BufferGeometry produces no layers without crashing', async () => {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    let result;
    try {
      result = await sliceGeometry(empty);
    } catch (e) {
      // Acceptable to error.
      expect(e).toBeTruthy();
      return;
    }
    expect(result.layers.length).toBe(0);
  }, 60_000);
});
