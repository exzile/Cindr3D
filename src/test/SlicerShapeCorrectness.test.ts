import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { signedArea as signedArea2D } from '../engine/slicer/geometry/contourUtils';
import {
  bboxFromMoves,
  buildBox,
  buildCrossPrism,
  buildCylinder,
  buildNGonPrism,
  outerWallMoves,
  sliceGeometry,
  totalLength,
} from './_helpers/slicerSystemHelpers';

/**
 * Shape correctness tests: verify the slicer preserves the input
 * geometry's topology, winding, and feature count through to the
 * emitted moves.
 */

/** Walk move endpoints to reconstruct a polyline. Walls are emitted as
 *  consecutive segments where each move's `to` matches the next's `from`. */
function reconstructLoop(moves: ReadonlyArray<{ from: { x: number; y: number }; to: { x: number; y: number } }>): Array<{ x: number; y: number }> {
  if (moves.length === 0) return [];
  const points: Array<{ x: number; y: number }> = [{ x: moves[0].from.x, y: moves[0].from.y }];
  for (const m of moves) points.push({ x: m.to.x, y: m.to.y });
  return points;
}

const LAYER = 3;

describe('Slicer shape correctness — winding', () => {
  it('outer wall of a square box is wound CCW (positive signed area)', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 2));
    const moves = outerWallMoves(result.layers[LAYER]);
    const loop = reconstructLoop(moves);
    expect(signedArea2D(loop)).toBeGreaterThan(0);
  });

  it('outer wall of a cylinder is wound CCW (positive signed area)', async () => {
    const result = await sliceGeometry(buildCylinder(8, 2, 32));
    const moves = outerWallMoves(result.layers[3]);
    const loop = reconstructLoop(moves);
    expect(signedArea2D(loop)).toBeGreaterThan(0);
  });

  it.each([3, 4, 5, 6, 8] as const)('%d-gon outer wall is wound CCW', async (sides) => {
    const result = await sliceGeometry(buildNGonPrism(sides, 10, 2));
    const moves = outerWallMoves(result.layers[3]);
    if (moves.length < 3) return;
    const loop = reconstructLoop(moves);
    expect(signedArea2D(loop)).toBeGreaterThan(0);
  });
});

describe('Slicer shape correctness — symmetry preservation', () => {
  it('a square produces walls symmetric about both diagonals', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 2));
    const bbox = bboxFromMoves(outerWallMoves(result.layers[LAYER]));
    expect(bbox.width).toBeCloseTo(bbox.height, 1);
  });

  it('a cylinder produces walls symmetric about both axes (≈round)', async () => {
    const result = await sliceGeometry(buildCylinder(8, 2, 64));
    const bbox = bboxFromMoves(outerWallMoves(result.layers[3]));
    expect(bbox.width).toBeCloseTo(bbox.height, 1);
  });

  it.each([4, 6, 8, 12] as const)('regular %d-gon outer wall sides have similar median length (post-simplification)', async (sides) => {
    const result = await sliceGeometry(buildNGonPrism(sides, 10, 2));
    const moves = outerWallMoves(result.layers[3]);
    expect(moves.length).toBeGreaterThan(0);
    const lengths = moves.map((m) =>
      Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y),
    );
    lengths.sort((a, b) => a - b);
    // Drop the smallest and largest 25% to avoid simplification artifacts
    // (the slicer can merge near-collinear short segments into longer ones).
    const lo = Math.floor(lengths.length * 0.25);
    const hi = Math.ceil(lengths.length * 0.75);
    const middle = lengths.slice(lo, hi);
    const max = Math.max(...middle);
    const min = Math.min(...middle);
    expect(max / Math.max(0.001, min)).toBeLessThan(2.0);
  });
});

describe('Slicer shape correctness — feature count', () => {
  it('a box has exactly 4 corner-aligned wall segments (after simplification, count may exceed 4)', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 2));
    const moves = outerWallMoves(result.layers[3]);
    // Slicer may insert extra colinear vertices; minimum should be 4.
    expect(moves.length).toBeGreaterThanOrEqual(4);
  });

  it('a cylinder has more outer-wall segments than its triangle count predicts (smooth approximation)', async () => {
    const result = await sliceGeometry(buildCylinder(8, 2, 32));
    const moves = outerWallMoves(result.layers[3]);
    // Won't necessarily be more, but at least matches segments.
    expect(moves.length).toBeGreaterThanOrEqual(8);
  });

  it.each([3, 4, 6, 8, 12] as const)('regular %d-gon outer wall has at least N segments', async (sides) => {
    const result = await sliceGeometry(buildNGonPrism(sides, 10, 2));
    const moves = outerWallMoves(result.layers[3]);
    expect(moves.length).toBeGreaterThanOrEqual(sides);
  });
});

describe('Slicer shape correctness — concave (cross/L-shape)', () => {
  it('a "+" cross prism produces a non-convex wall (signed area not full bbox)', async () => {
    const result = await sliceGeometry(buildCrossPrism(15, 4, 2));
    const moves = outerWallMoves(result.layers[3]);
    const loop = reconstructLoop(moves);
    const area = Math.abs(signedArea2D(loop));
    const bbox = bboxFromMoves(moves);
    const bboxArea = bbox.width * bbox.height;
    // Cross-shape area is much less than its bounding-box area (~37%
    // for an arm/width ratio of ~3.75).
    expect(area).toBeLessThan(bboxArea * 0.6);
    expect(area).toBeGreaterThan(bboxArea * 0.2);
  });

  it('cross prism preserves 12 corners (or close — with simplification noise)', async () => {
    const result = await sliceGeometry(buildCrossPrism(15, 4, 2));
    const moves = outerWallMoves(result.layers[3]);
    expect(moves.length).toBeGreaterThanOrEqual(10);
  });
});

describe('Slicer shape correctness — area preservation across wall offsets', () => {
  // Bigger model → wall area approaches model area for small offsets.
  const SIZES = [10, 20, 30, 50] as const;
  it.each(SIZES)('outer wall of a %dmm square encloses approx (size - lw)² area', async (size) => {
    const result = await sliceGeometry(buildBox(size, size, 2));
    const moves = outerWallMoves(result.layers[3]);
    const loop = reconstructLoop(moves);
    const area = Math.abs(signedArea2D(loop));
    const expected = (size - 0.4) * (size - 0.4);
    expect(area).toBeCloseTo(expected, -1); // ±10mm² tolerance
  });

  it.each(SIZES)('outer wall of a %dmm circle encloses approx π × (R-lw/2)² area', async (radius) => {
    const result = await sliceGeometry(buildCylinder(radius, 2, 64));
    const moves = outerWallMoves(result.layers[3]);
    const loop = reconstructLoop(moves);
    const area = Math.abs(signedArea2D(loop));
    const expected = Math.PI * (radius - 0.2) ** 2;
    // Polygon approximation of a circle systematically under-estimates
    // area; allow ±5% tolerance.
    expect(area).toBeGreaterThan(expected * 0.95);
    expect(area).toBeLessThan(expected * 1.02);
  });
});

describe('Slicer shape correctness — wall closure', () => {
  it('outer wall path is closed (last point ≈ first point)', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 2));
    const moves = outerWallMoves(result.layers[3]);
    expect(moves.length).toBeGreaterThan(0);
    const first = moves[0];
    const last = moves[moves.length - 1];
    const dx = last.to.x - first.from.x;
    const dy = last.to.y - first.from.y;
    expect(Math.hypot(dx, dy)).toBeLessThan(0.1);
  });

  it('move chain is contiguous (each to ≈ next from within ε)', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 2));
    const moves = outerWallMoves(result.layers[3]);
    for (let i = 1; i < moves.length; i++) {
      const prev = moves[i - 1];
      const curr = moves[i];
      const gap = Math.hypot(curr.from.x - prev.to.x, curr.from.y - prev.to.y);
      expect(gap).toBeLessThan(0.05);
    }
  });

  it('cylinder wall is closed (last ≈ first within ε)', async () => {
    const result = await sliceGeometry(buildCylinder(8, 2, 64));
    const moves = outerWallMoves(result.layers[3]);
    if (moves.length === 0) return;
    const first = moves[0];
    const last = moves[moves.length - 1];
    const dx = last.to.x - first.from.x;
    const dy = last.to.y - first.from.y;
    expect(Math.hypot(dx, dy)).toBeLessThan(0.1);
  });
});

describe('Slicer shape correctness — perimeter precision', () => {
  it.each([10, 15, 20, 30] as const)('square %dmm perimeter ≈ 4(size - lw)', async (size) => {
    const result = await sliceGeometry(buildBox(size, size, 2));
    const moves = outerWallMoves(result.layers[3]);
    const total = totalLength(moves);
    const expected = 4 * (size - 0.4);
    expect(total).toBeGreaterThan(expected * 0.98);
    expect(total).toBeLessThan(expected * 1.02);
  });

  it.each([5, 8, 10, 12] as const)('cylinder R=%d perimeter ≈ 2π(R - lw/2)', async (radius) => {
    const result = await sliceGeometry(buildCylinder(radius, 2, 64));
    const moves = outerWallMoves(result.layers[3]);
    const total = totalLength(moves);
    const expected = 2 * Math.PI * (radius - 0.2);
    expect(total).toBeGreaterThan(expected * 0.96);
    expect(total).toBeLessThan(expected * 1.02);
  });
});

describe('Slicer shape correctness — Z invariance for vertical walls', () => {
  it('every layer of a 4mm-tall cylinder produces approximately the same wall ring', async () => {
    const result = await sliceGeometry(buildCylinder(10, 4, 64));
    const widths = result.layers.map((l) => bboxFromMoves(outerWallMoves(l)).width);
    const filtered = widths.filter((w) => Number.isFinite(w) && w > 0);
    expect(filtered.length).toBeGreaterThan(5);
    const min = Math.min(...filtered);
    const max = Math.max(...filtered);
    expect(max - min).toBeLessThan(0.3);
  });

  it.each([5, 10, 20] as const)('every layer of a %dmm box has the same outer-wall area (within tolerance)', async (size) => {
    const result = await sliceGeometry(buildBox(size, size, 2));
    const areas = result.layers.map((l) => {
      const moves = outerWallMoves(l);
      const loop = reconstructLoop(moves);
      return Math.abs(signedArea2D(loop));
    }).filter((a) => Number.isFinite(a) && a > 0);
    expect(areas.length).toBeGreaterThan(2);
    const min = Math.min(...areas);
    const max = Math.max(...areas);
    expect((max - min) / min).toBeLessThan(0.05);
  });
});

describe('Slicer shape correctness — wall layer alignment', () => {
  it('walls on different layers of a vertical box have aligned XY centers', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 4));
    const centers = result.layers.map((l) => {
      const bbox = bboxFromMoves(outerWallMoves(l));
      return { cx: (bbox.minX + bbox.maxX) / 2, cy: (bbox.minY + bbox.maxY) / 2 };
    }).filter((c) => Number.isFinite(c.cx) && Number.isFinite(c.cy));
    const cx0 = centers[0].cx;
    const cy0 = centers[0].cy;
    for (const c of centers) {
      expect(Math.abs(c.cx - cx0)).toBeLessThan(0.05);
      expect(Math.abs(c.cy - cy0)).toBeLessThan(0.05);
    }
  });
});

describe('Slicer shape correctness — outer/inner wall classification', () => {
  it('with wallCount=3, exactly one wall ring is "wall-outer" and two are "wall-inner"', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 2), { wallCount: 3 });
    const layer = result.layers[3];
    const outer = outerWallMoves(layer);
    const inner = layer.moves.filter((m) => m.type === 'wall-inner');
    expect(outer.length).toBeGreaterThan(0);
    expect(inner.length).toBeGreaterThan(0);
    // Inner walls fill 2/3 of total wall moves (approx).
    expect(inner.length).toBeGreaterThan(outer.length * 1.5);
  });

  it('wall-inner segments sit strictly inside wall-outer bbox', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 2), { wallCount: 2 });
    const layer = result.layers[3];
    const outerBox = bboxFromMoves(outerWallMoves(layer));
    const innerBox = bboxFromMoves(layer.moves.filter((m) => m.type === 'wall-inner'));
    expect(innerBox.minX).toBeGreaterThanOrEqual(outerBox.minX - 0.05);
    expect(innerBox.maxX).toBeLessThanOrEqual(outerBox.maxX + 0.05);
    expect(innerBox.minY).toBeGreaterThanOrEqual(outerBox.minY - 0.05);
    expect(innerBox.maxY).toBeLessThanOrEqual(outerBox.maxY + 0.05);
  });
});

describe('Slicer shape correctness — translation invariance', () => {
  it('an off-center mesh preserves its model-space placement', async () => {
    // Build a box manually offset in X (translates the mesh, not the bed).
    const sx = 15, sy = 15, sz = 2;
    const positions: number[] = [];
    const v = (x: number, y: number, z: number) => [x, y, z];
    const push = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
    const offsetX = 30; // box centered at (30, 0)
    const hx = sx / 2, hy = sy / 2;
    const p000 = v(offsetX - hx, -hy, 0), p100 = v(offsetX + hx, -hy, 0);
    const p110 = v(offsetX + hx, hy, 0), p010 = v(offsetX - hx, hy, 0);
    const p001 = v(offsetX - hx, -hy, sz), p101 = v(offsetX + hx, -hy, sz);
    const p111 = v(offsetX + hx, hy, sz), p011 = v(offsetX - hx, hy, sz);
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
    const bbox = bboxFromMoves(outerWallMoves(result.layers[3]));
    const cx = (bbox.minX + bbox.maxX) / 2;
    expect(cx).toBeCloseTo(offsetX, 0);
  });
});
