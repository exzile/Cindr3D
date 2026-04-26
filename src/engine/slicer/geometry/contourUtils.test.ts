import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  contourBBox,
  lineContourIntersections,
  pointInContour,
  reorderFromIndex,
  segSegIntersectionT,
  signedArea,
} from './contourUtils';

const v = (x: number, y: number) => new THREE.Vector2(x, y);

describe('signedArea', () => {
  it('returns positive area for a CCW polygon', () => {
    const square = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    expect(signedArea(square)).toBe(100);
  });

  it('returns negative area for a CW polygon', () => {
    const square = [v(0, 0), v(0, 10), v(10, 10), v(10, 0)];
    expect(signedArea(square)).toBe(-100);
  });

  it('returns 0 for a degenerate (collinear) polygon', () => {
    expect(signedArea([v(0, 0), v(5, 0), v(10, 0)])).toBe(0);
  });

  it('handles a triangle (smallest non-degenerate polygon)', () => {
    expect(signedArea([v(0, 0), v(4, 0), v(0, 3)])).toBe(6);
  });

  it('returns 0 for fewer than 3 points (no area)', () => {
    expect(signedArea([])).toBe(0);
    expect(signedArea([v(0, 0)])).toBe(0);
    expect(signedArea([v(0, 0), v(10, 0)])).toBe(0);
  });

  it('matches the shoelace formula on a non-axis-aligned polygon', () => {
    // Triangle (1,1), (4,2), (2,5):
    //   shoelace = 0.5·|1·(2-5) + 4·(5-1) + 2·(1-2)| = 0.5·|-3 + 16 - 2| = 5.5
    expect(signedArea([v(1, 1), v(4, 2), v(2, 5)])).toBeCloseTo(5.5, 6);
  });
});

describe('reorderFromIndex', () => {
  it('returns the contour with the start point shifted', () => {
    const square = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const reordered = reorderFromIndex(square, 2);
    expect(reordered.map((p) => `${p.x},${p.y}`)).toEqual(['10,10', '0,10', '0,0', '10,0']);
  });

  it('startIdx=0 is a no-op (returns the same sequence)', () => {
    const tri = [v(0, 0), v(5, 0), v(0, 5)];
    expect(reorderFromIndex(tri, 0)).toEqual(tri);
  });

  it('preserves length', () => {
    const tri = [v(0, 0), v(5, 0), v(0, 5)];
    expect(reorderFromIndex(tri, 1)).toHaveLength(3);
  });
});

describe('segSegIntersectionT', () => {
  it('returns the t parameter (0..1) where two crossing segments meet on the first segment', () => {
    // Cross at (5,5): segment 1 (0,0)→(10,10), segment 2 (0,10)→(10,0)
    const t = segSegIntersectionT(v(0, 0), v(10, 10), v(0, 10), v(10, 0));
    expect(t).toBeCloseTo(0.5, 6);
  });

  it('returns null for parallel segments (no intersection)', () => {
    expect(segSegIntersectionT(v(0, 0), v(10, 0), v(0, 5), v(10, 5))).toBeNull();
  });

  it('returns null for collinear (degenerate denominator)', () => {
    expect(segSegIntersectionT(v(0, 0), v(10, 0), v(5, 0), v(15, 0))).toBeNull();
  });

  it('returns null when the lines cross outside both segments', () => {
    // Lines cross at (15,15) but neither segment reaches there
    expect(segSegIntersectionT(v(0, 0), v(10, 10), v(0, 30), v(30, 0))).toBeNull();
  });

  it('returns t=0 when first segment starts on the second segment', () => {
    // Segment 1 starts at (5,0); segment 2 is the X axis from (0,0) to (10,0)
    expect(segSegIntersectionT(v(5, 0), v(5, 10), v(0, 0), v(10, 0))).toBeCloseTo(0, 6);
  });
});

describe('lineContourIntersections', () => {
  it('returns one intersection per polygon edge crossed', () => {
    const square = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    // Horizontal scanline through y=5: crosses left edge (x=0) and right edge (x=10)
    const ts = lineContourIntersections(v(-1, 5), v(11, 5), square);
    expect(ts).toHaveLength(2);
  });

  it('returns an empty array when the line misses the polygon entirely', () => {
    const square = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    expect(lineContourIntersections(v(20, 5), v(30, 5), square)).toEqual([]);
  });

  it('returned t values are normalized to the input segment', () => {
    const square = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const ts = lineContourIntersections(v(0, 5), v(10, 5), square);
    // Crosses left edge at t=0 and right edge at t=1.
    expect(ts.sort()).toEqual([0, 1]);
  });
});

describe('pointInContour', () => {
  it('returns true for the centroid of a square', () => {
    const square = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    expect(pointInContour(v(5, 5), square)).toBe(true);
  });

  it('returns false for points outside the polygon', () => {
    const square = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    expect(pointInContour(v(15, 5), square)).toBe(false);
    expect(pointInContour(v(-1, 5), square)).toBe(false);
    expect(pointInContour(v(5, 15), square)).toBe(false);
  });

  it('correctly handles concave (L-shaped) polygons', () => {
    // L-shape: 10×10 square with bottom-right 5×5 corner removed
    const lshape = [v(0, 0), v(5, 0), v(5, 5), v(10, 5), v(10, 10), v(0, 10)];
    expect(pointInContour(v(2, 2), lshape)).toBe(true);   // in long left arm
    expect(pointInContour(v(7, 2), lshape)).toBe(false);  // in removed corner
    expect(pointInContour(v(7, 7), lshape)).toBe(true);   // in top-right square
  });

  it('respects polygon winding (works on both CCW and CW polygons)', () => {
    const ccw = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const cw  = [v(0, 0), v(0, 10), v(10, 10), v(10, 0)];
    expect(pointInContour(v(5, 5), ccw)).toBe(true);
    expect(pointInContour(v(5, 5), cw)).toBe(true);
  });
});

describe('contourBBox', () => {
  it('returns axis-aligned bounding box of a polygon', () => {
    const tri = [v(-3, 4), v(7, -2), v(2, 8)];
    const bb = contourBBox(tri);
    expect(bb.minX).toBe(-3);
    expect(bb.maxX).toBe(7);
    expect(bb.minY).toBe(-2);
    expect(bb.maxY).toBe(8);
  });

  it('handles a degenerate single-point contour', () => {
    const bb = contourBBox([v(5, 7)]);
    expect(bb.minX).toBe(5);
    expect(bb.maxX).toBe(5);
    expect(bb.minY).toBe(7);
    expect(bb.maxY).toBe(7);
  });

  it('matches axis extents for an axis-aligned rectangle exactly', () => {
    const rect = [v(0, 0), v(10, 0), v(10, 5), v(0, 5)];
    const bb = contourBBox(rect);
    expect(bb).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 5 });
  });
});
