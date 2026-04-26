import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { offsetContour, simplifyClosedContour } from './pathGeometry';
import { signedArea } from './contourUtils';

const v = (x: number, y: number) => new THREE.Vector2(x, y);

function bbox(points: THREE.Vector2[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

describe('offsetContour — sign convention', () => {
  it('returns an empty array for chains with fewer than 3 points', () => {
    expect(offsetContour([], 0.5, signedArea)).toEqual([]);
    expect(offsetContour([v(0, 0), v(10, 0)], 0.5, signedArea)).toEqual([]);
  });

  it('positive offset SHRINKS a CCW outer (square), pulling edges inward', () => {
    const square = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const result = offsetContour(square, 1, signedArea);
    expect(result.length).toBeGreaterThanOrEqual(3);
    const bb = bbox(result);
    // 10×10 square shrunk by 1 on each side → 8×8.
    expect(bb.width).toBeCloseTo(8, 3);
    expect(bb.height).toBeCloseTo(8, 3);
  });

  it('negative offset GROWS a CCW outer', () => {
    const square = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const result = offsetContour(square, -1, signedArea);
    const bb = bbox(result);
    expect(bb.width).toBeCloseTo(12, 3);
    expect(bb.height).toBeCloseTo(12, 3);
  });

  it('positive offset GROWS a CW hole (opposite sign convention)', () => {
    // CW square (hole)
    const hole = [v(2, 2), v(2, 8), v(8, 8), v(8, 2)];
    const result = offsetContour(hole, 1, signedArea);
    const bb = bbox(result);
    // Hole grows from 6×6 to 8×8 (positive offset shifts edges into material).
    expect(bb.width).toBeCloseTo(8, 3);
    expect(bb.height).toBeCloseTo(8, 3);
  });

  it('preserves rectangle proportions when offsetting', () => {
    const rect = [v(0, 0), v(20, 0), v(20, 5), v(0, 5)];
    const result = offsetContour(rect, 0.5, signedArea);
    const bb = bbox(result);
    // 20×5 → shrink by 0.5 each side → 19×4
    expect(bb.width).toBeCloseTo(19, 3);
    expect(bb.height).toBeCloseTo(4, 3);
  });

  it('preserves vertex count for axis-aligned rectangles', () => {
    const square = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    expect(offsetContour(square, 0.5, signedArea)).toHaveLength(4);
  });

  it('zero offset returns a polygon with the same bbox', () => {
    const square = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const bb = bbox(offsetContour(square, 0, signedArea));
    expect(bb.width).toBeCloseTo(10, 5);
    expect(bb.height).toBeCloseTo(10, 5);
  });
});

describe('simplifyClosedContour', () => {
  it('returns the input unchanged when tolerance is 0 or negative', () => {
    const tri = [v(0, 0), v(10, 0), v(5, 10)];
    expect(simplifyClosedContour(tri, 0)).toEqual(tri);
    expect(simplifyClosedContour(tri, -1)).toEqual(tri);
  });

  it('returns a copy (not the same array reference) so callers can mutate safely', () => {
    const tri = [v(0, 0), v(10, 0), v(5, 10)];
    const out = simplifyClosedContour(tri, 0);
    expect(out).not.toBe(tri);
  });

  it('preserves polygons with ≤3 points (cannot simplify further)', () => {
    const tri = [v(0, 0), v(10, 0), v(5, 10)];
    expect(simplifyClosedContour(tri, 5)).toHaveLength(3);
  });

  it('removes nearly-collinear vertices on a long straight edge', () => {
    // 5 points on a square; the 5th sits on the bottom edge between corners 0 and 1.
    const square = [v(0, 0), v(5, 0.001), v(10, 0), v(10, 10), v(0, 10)];
    const result = simplifyClosedContour(square, 0.01);
    // The middle-bottom point (within 0.001 of the line) should be dropped.
    expect(result.length).toBeLessThan(5);
    expect(result.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps real corners that exceed the tolerance', () => {
    // L-shape: every vertex is a sharp corner, none should be removed.
    const lshape = [v(0, 0), v(5, 0), v(5, 5), v(10, 5), v(10, 10), v(0, 10)];
    const result = simplifyClosedContour(lshape, 0.01);
    expect(result.length).toBe(6);
  });

  it('dedupes coincident points before simplifying', () => {
    const dup = [v(0, 0), v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const result = simplifyClosedContour(dup, 0.01);
    // Duplicate at (0,0) gone; the rectangle survives intact.
    expect(result.length).toBe(4);
  });

  it('reduces a dense circle approximation while keeping the rough shape', () => {
    // 60-vertex circle of radius 5
    const circle: THREE.Vector2[] = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      circle.push(v(Math.cos(a) * 5, Math.sin(a) * 5));
    }
    const result = simplifyClosedContour(circle, 0.05);
    // Heavy density → simplification can drop most points; output must
    // still be a closed loop of ≥3 points.
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.length).toBeLessThan(60);
  });

  it('never returns a degenerate <3-point output (falls back to deduped input)', () => {
    // Dense small triangle within tolerance — output must keep ≥3 pts.
    const tri = [v(0, 0), v(0.001, 0), v(0.001, 0.001)];
    const result = simplifyClosedContour(tri, 0.01);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});
