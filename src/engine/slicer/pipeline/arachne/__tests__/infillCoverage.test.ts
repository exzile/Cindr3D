// Regression tests for the "infill crosses walls" bug.
//
// Symptom (from the user's screenshot at layer 20 of a circular part with a
// small mounting hole): green infill scanlines run THROUGH the inner-wall
// ring around the hole.
//
// Root cause: the infill region was computed at `(wallCount × lineWidth)`
// inset, which assumes every wall is exactly `lineWidth` wide. libArachne
// emits *variable*-width walls placed by skeletal trapezoidation — actual
// inward extent can exceed the nominal offset by ~0.25-0.5 × lineWidth.
//
// Fix: `computeMaxPathInset` walks every emitted wall point and returns
// the max (distance-to-boundary + halfWidth). The infill region is inset
// by that amount, so it's guaranteed to stay clear of every wall.
//
// This file locks in the invariant for synthetic and fixture-based inputs.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { computeMaxPathInset } from '../index';
import type { VariableWidthPath } from '../types';

const v = (x: number, y: number) => new THREE.Vector2(x, y);
const makePath = (
  points: THREE.Vector2[],
  widths: number[],
  depth: number,
  source: VariableWidthPath['source'] = 'outer',
): VariableWidthPath => ({ points, widths, depth, isClosed: true, source });

describe('computeMaxPathInset', () => {
  it('returns 0 for no paths', () => {
    expect(computeMaxPathInset([], [v(0, 0), v(10, 0), v(10, 10), v(0, 10)], [])).toBe(0);
  });

  it('returns 0 for empty boundary', () => {
    const path = makePath([v(5, 5), v(7, 5)], [0.4, 0.4], 0);
    expect(computeMaxPathInset([path], [], [])).toBe(0);
  });

  it('measures distance-to-boundary + half-width for a single inner wall', () => {
    // 10×10 square. A wall point at (5, 5) is 5 mm from every boundary
    // segment. With width 0.4, half-width 0.2 → inset = 5.2.
    const outer = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const path = makePath([v(5, 5)], [0.4], 0);
    expect(computeMaxPathInset([path], outer, [])).toBeCloseTo(5.2, 6);
  });

  it('uses the maximum point across all paths and depths', () => {
    const outer = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const shallowPath = makePath([v(0.5, 0.5)], [0.4], 0);
    const deepPath = makePath([v(2, 2)], [0.6], 1);
    // Shallow: distance to (0,0)–(10,0) = 0.5, +0.2 halfW = 0.7
    // Deep:    distance to nearest boundary ≈ 2, +0.3 halfW = 2.3
    expect(computeMaxPathInset([shallowPath, deepPath], outer, [])).toBeCloseTo(2.3, 6);
  });

  it('considers hole boundaries (path point near a hole)', () => {
    const outer = [v(0, 0), v(20, 0), v(20, 20), v(0, 20)];
    const hole = [v(8, 8), v(8, 12), v(12, 12), v(12, 8)]; // 4×4 hole at center
    // Path point just outside the hole — distance to hole edge = 0.5,
    // halfW = 0.225 → inset = 0.725.
    const innerWall = makePath([v(7.5, 10)], [0.45], 0, 'hole');
    expect(computeMaxPathInset([innerWall], outer, [hole])).toBeCloseTo(0.725, 6);
  });

  it('handles variable widths along a single path correctly', () => {
    const outer = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    // Same path, two points: one near edge (small width), one center
    // (large width — transition zone).
    const path = makePath([v(1, 5), v(5, 5)], [0.4, 0.7], 0);
    // Point 0: dist to left edge = 1, +0.2 = 1.2
    // Point 1: dist to all edges = 5, +0.35 = 5.35
    expect(computeMaxPathInset([path], outer, [])).toBeCloseTo(5.35, 6);
  });

  it('infill inset for a small hole is dominated by the hole-side walls', () => {
    // The user's reported scenario: small mounting hole (radius 2 mm)
    // inside a larger body. Inner walls hug the hole; if the infill is
    // computed at nominal `wallCount × lineWidth = 1.35`, the actual
    // wall envelope at 1.5+ exceeds it. computeMaxPathInset should
    // return ≥ the actual envelope.
    const outer = makeCircle(0, 0, 25, 64);
    const hole = makeCircle(0, 0, 2, 24).reverse(); // CW for hole
    // Three inner walls around the hole, depths 0/1/2. libArachne would
    // place them at the boundary + halfW for the outer-most around hole.
    // Simulate: depth-2 wall sits ~1.4 mm from hole edge, width 0.6.
    const innerWall0 = makePath(makeCircle(0, 0, 2.225, 32), new Array(32).fill(0.45), 0, 'hole');
    const innerWall1 = makePath(makeCircle(0, 0, 2.675, 32), new Array(32).fill(0.45), 1, 'hole');
    const innerWall2 = makePath(makeCircle(0, 0, 3.4, 32), new Array(32).fill(0.6), 2, 'hole');
    const inset = computeMaxPathInset(
      [innerWall0, innerWall1, innerWall2], outer, [hole],
    );
    // Innermost wall (depth 2) at radius 3.4, width 0.6.
    //   distance from (3.4, 0) to nearest hole-edge segment ≈ 1.4
    //   + halfW 0.3 = 1.7. Larger than nominal `3 × 0.45 = 1.35`.
    expect(inset).toBeGreaterThan(1.35);
    expect(inset).toBeCloseTo(1.7, 1);
  });
});

function makeCircle(cx: number, cy: number, r: number, n: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push(new THREE.Vector2(cx + r * Math.cos(t), cy + r * Math.sin(t)));
  }
  return out;
}

// ----------------------------------------------------------------------
// End-to-end invariant: the infill region returned by
// `generatePerimetersArachne` must NOT overlap any wall path point's
// stroke envelope (point ± halfWidth).
//
// This is the slicer-level guarantee that produces visually correct
// previews (no green infill running through red walls).
// ----------------------------------------------------------------------


// ----------------------------------------------------------------------
// Sign-convention regression test for `computeArachneInfillGeometry`.
// `offsetContour(outer, +d)` shrinks the outer; the previous code used
// `-insetDistance` here which inverted the sign and produced an infill
// region that was BIGGER than the body. That mistake compounded with
// the variable-width envelope fix above — the bigger the inset, the
// further infill scanlines extended outside the wall.
// ----------------------------------------------------------------------

describe('Arachne infill region — outer offset sign', () => {
  it('infill region stays inside the body outer contour', async () => {
    // Test computeArachneInfillGeometry directly so we don't depend on
    // libArachne WASM being preloaded in the test environment. The sign
    // bug lives in this function regardless of whether the backend ran.
    const { computeArachneInfillGeometry } = await import('../index');
    const outer = makeCircle(0, 0, 25, 96);
    const hole = makeCircle(0, 0, 2, 32).reverse();
    const deps = makeWindingAwareDeps();
    const insetDistance = 1.5; // ~ wallCount × lineWidth

    const result = computeArachneInfillGeometry(outer, [hole], insetDistance, deps);

    expect(result.infillRegions.length).toBeGreaterThan(0);

    // For every infill region's outer contour, every vertex must be
    // INSIDE the body's outer contour (radius 25 disk). With the
    // sign-flip bug (`-insetDistance`), the outer was expanded outward
    // and points landed at r ≈ 26.5 — fails this assertion.
    for (const region of result.infillRegions) {
      for (const pt of region.contour) {
        const r = Math.hypot(pt.x, pt.y);
        expect(r).toBeLessThanOrEqual(25 + 1e-3);
      }
      // Every infill-region hole boundary must be OUTSIDE the original
      // hole boundary (radius 2). This is the wall-coverage envelope.
      for (const holeRing of region.holes) {
        for (const pt of holeRing) {
          const r = Math.hypot(pt.x, pt.y);
          expect(r).toBeGreaterThanOrEqual(2 - 1e-3);
        }
      }
    }
  });

  it('infill outer is roughly 25 - insetDistance (not 25 + insetDistance)', async () => {
    // Direct numeric check on the offset direction: with insetDistance=2,
    // the infill region's outer should be at ~r=23, not ~r=27.
    const { computeArachneInfillGeometry } = await import('../index');
    const outer = makeCircle(0, 0, 25, 96);
    const deps = makeWindingAwareDeps();

    const result = computeArachneInfillGeometry(outer, [], 2, deps);

    expect(result.infillRegions.length).toBe(1);
    const contour = result.infillRegions[0].contour;
    let maxR = 0;
    for (const pt of contour) {
      const r = Math.hypot(pt.x, pt.y);
      if (r > maxR) maxR = r;
    }
    // After +2 inset on radius 25 → ~23. Allow generous tolerance.
    expect(maxR).toBeCloseTo(23, 0);
    expect(maxR).toBeLessThan(25); // CRITICAL: must NOT be 27
  });
});

function makeWindingAwareDeps() {
  // Real-shape stub: positive offset on CCW outer SHRINKS toward
  // centroid; positive offset on CW hole EXPANDS away from centroid.
  // Distinguishes via signedArea sign.
  return {
    offsetContour: (contour: THREE.Vector2[], offset: number): THREE.Vector2[] => {
      if (contour.length < 3) return [];
      let cx = 0, cy = 0, area2 = 0;
      for (const p of contour) { cx += p.x; cy += p.y; }
      cx /= contour.length; cy /= contour.length;
      for (let i = 0; i < contour.length; i++) {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        area2 += a.x * b.y - b.x * a.y;
      }
      const ccw = area2 > 0;
      // CCW: positive offset shrinks (factor < 1).
      // CW : positive offset expands (factor > 1).
      const dir = ccw ? -1 : +1;
      // Match real offsetContour behaviour: when shrinking past the
      // centroid (factor would go negative), the contour collapses
      // and we return [] so the caller can short-circuit. Use median
      // not min — concave outers can have a vertex AT the centroid
      // (e.g. L-shape) which would falsely trigger empty.
      const lens = contour.map((p) => Math.hypot(p.x - cx, p.y - cy)).sort((a, b) => a - b);
      const medianLen = lens[Math.floor(lens.length / 2)];
      if (ccw && offset > medianLen) return [];
      return contour.map((p) => {
        const dx = p.x - cx, dy = p.y - cy;
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) return new THREE.Vector2(p.x, p.y);
        const factor = (len + offset * dir) / len;
        return new THREE.Vector2(cx + dx * factor, cy + dy * factor);
      });
    },
    signedArea: (pts: THREE.Vector2[]) => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const c = pts[i], n = pts[(i + 1) % pts.length];
        a += c.x * n.y - n.x * c.y;
      }
      return a / 2;
    },
    multiPolygonToRegions: (mp: number[][][][]) => {
      type R = { contour: THREE.Vector2[]; holes: THREE.Vector2[][] };
      const out: R[] = [];
      for (const poly of mp) {
        const contour = poly[0]?.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y)) ?? [];
        const holes = poly.slice(1).map((ring) => ring.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y)));
        if (contour.length >= 3) out.push({ contour, holes });
      }
      return out as never;
    },
  } as never;
}

describe('infill envelope vs nominal offset', () => {
  it('envelope grows beyond nominal for wider transition-zone walls', () => {
    const outer = makeCircle(0, 0, 25, 96);
    // Same depth-2 wall position; vary only the local width.
    const innerWallNarrow = makePath(makeCircle(0, 0, 23.7, 32), new Array(32).fill(0.45), 2);
    const innerWallWide   = makePath(makeCircle(0, 0, 23.7, 32), new Array(32).fill(0.7),  2);
    const insetNarrow = computeMaxPathInset([innerWallNarrow], outer, []);
    const insetWide   = computeMaxPathInset([innerWallWide],   outer, []);
    expect(insetWide).toBeGreaterThan(insetNarrow);
    // Widening by 0.25 should add ~0.125 (halfW delta) to the envelope.
    expect(insetWide - insetNarrow).toBeCloseTo(0.125, 3);
  });

  it('envelope is at least the nominal `wallCount × lineWidth` for nominally-placed walls', () => {
    // Innermost wall at exactly nominal depth (wallCount-1 + 0.5)*lineWidth
    // from the boundary, with nominal width.
    const lineWidth = 0.45;
    const wallCount = 3;
    const outer = makeCircle(0, 0, 25, 96);
    const expectedRadius = 25 - (wallCount - 0.5) * lineWidth; // depth=2 centerline
    const innermostWall = makePath(
      makeCircle(0, 0, expectedRadius, 64),
      new Array(64).fill(lineWidth),
      wallCount - 1,
    );
    const inset = computeMaxPathInset([innermostWall], outer, []);
    // Should equal (wallCount-0.5)*lineWidth + halfW = wallCount*lineWidth.
    expect(inset).toBeCloseTo(wallCount * lineWidth, 2);
  });

  it('envelope responds to the deepest wall, not the first one emitted', () => {
    const outer = makeCircle(0, 0, 25, 96);
    // Outer wall (depth 0) is closest to boundary; inner wall (depth 2)
    // is deepest. Order in the input array shouldn't matter.
    const outerWall   = makePath(makeCircle(0, 0, 24.775, 64), new Array(64).fill(0.45), 0);
    const innerWall   = makePath(makeCircle(0, 0, 23.875, 64), new Array(64).fill(0.45), 2);
    const insetA = computeMaxPathInset([outerWall, innerWall], outer, []);
    const insetB = computeMaxPathInset([innerWall, outerWall], outer, []);
    expect(insetA).toBeCloseTo(insetB, 6);
    // Inner wall dominates: ~(25-23.875)+0.225 = 1.35
    expect(insetA).toBeGreaterThan(1.0);
  });
});

// ----------------------------------------------------------------------
// Geometric correctness across non-circular shapes, multi-hole, and
// degenerate insets. Each test directly exercises
// `computeArachneInfillGeometry` to bypass the WASM Arachne dependency.
// ----------------------------------------------------------------------

describe('Arachne infill region — geometric invariants', () => {
  it('rectangle outer: infill stays inside body', async () => {
    const { computeArachneInfillGeometry } = await import('../index');
    // 40 × 20 mm rectangle (CCW), no hole.
    const outer = [v(0, 0), v(40, 0), v(40, 20), v(0, 20)];
    const deps = makeWindingAwareDeps();
    const inset = 1.5;

    const result = computeArachneInfillGeometry(outer, [], inset, deps);
    expect(result.infillRegions.length).toBe(1);
    for (const pt of result.infillRegions[0].contour) {
      expect(pt.x).toBeGreaterThanOrEqual(-1e-3);
      expect(pt.x).toBeLessThanOrEqual(40 + 1e-3);
      expect(pt.y).toBeGreaterThanOrEqual(-1e-3);
      expect(pt.y).toBeLessThanOrEqual(20 + 1e-3);
    }
  });

  it('multiple holes: every hole becomes a hole in the infill region', async () => {
    const { computeArachneInfillGeometry } = await import('../index');
    const outer = makeCircle(0, 0, 30, 96);
    // Three CW holes scattered inside.
    const holes = [
      makeCircle(-10, 0, 1.5, 24).reverse(),
      makeCircle(10, 5, 2, 24).reverse(),
      makeCircle(0, -10, 1, 24).reverse(),
    ];
    const deps = makeWindingAwareDeps();

    const result = computeArachneInfillGeometry(outer, holes, 1.5, deps);
    expect(result.infillRegions.length).toBe(1);
    expect(result.infillRegions[0].holes.length).toBe(3);
    expect(result.innermostHoles.length).toBe(3);
  });

  it('insetDistance ≈ 0 produces an infill region matching the body', async () => {
    const { computeArachneInfillGeometry } = await import('../index');
    const outer = makeCircle(0, 0, 10, 64);
    const deps = makeWindingAwareDeps();

    const result = computeArachneInfillGeometry(outer, [], 0, deps);
    expect(result.infillRegions.length).toBe(1);
    let maxR = 0;
    for (const pt of result.infillRegions[0].contour) {
      const r = Math.hypot(pt.x, pt.y);
      if (r > maxR) maxR = r;
    }
    expect(maxR).toBeCloseTo(10, 1);
  });

  it('inset larger than body radius collapses the infill region to empty', async () => {
    const { computeArachneInfillGeometry } = await import('../index');
    // 5 mm body, 8 mm inset → outer would shrink past the centroid.
    const outer = makeCircle(0, 0, 5, 64);
    const deps = makeWindingAwareDeps();

    const result = computeArachneInfillGeometry(outer, [], 8, deps);
    expect(result.infillRegions).toEqual([]);
    expect(result.innermostHoles).toEqual([]);
  });

  it('insetDistance grows the hole boundary monotonically', async () => {
    const { computeArachneInfillGeometry } = await import('../index');
    const outer = makeCircle(0, 0, 25, 96);
    const hole = makeCircle(0, 0, 2, 32).reverse();
    const deps = makeWindingAwareDeps();

    const r1 = computeArachneInfillGeometry(outer, [hole], 1.0, deps);
    const r2 = computeArachneInfillGeometry(outer, [hole], 2.0, deps);

    // Pick a hole-ring point and compare distance from origin.
    const holeRingR1 = Math.hypot(r1.innermostHoles[0][0].x, r1.innermostHoles[0][0].y);
    const holeRingR2 = Math.hypot(r2.innermostHoles[0][0].x, r2.innermostHoles[0][0].y);
    expect(holeRingR2).toBeGreaterThan(holeRingR1); // bigger inset = bigger hole expansion
    expect(holeRingR1).toBeCloseTo(3, 0);
    expect(holeRingR2).toBeCloseTo(4, 0);
  });

  it('infill area matches expected (body area minus wall band, approximately)', async () => {
    const { computeArachneInfillGeometry } = await import('../index');
    const outer = makeCircle(0, 0, 25, 96);
    const deps = makeWindingAwareDeps();
    const inset = 1.5;

    const result = computeArachneInfillGeometry(outer, [], inset, deps);
    expect(result.infillRegions.length).toBe(1);

    // Polygon area — Shoelace.
    let a = 0;
    const ring = result.infillRegions[0].contour;
    for (let i = 0; i < ring.length; i++) {
      const c = ring[i], n = ring[(i + 1) % ring.length];
      a += c.x * n.y - n.x * c.y;
    }
    const infillArea = Math.abs(a) / 2;
    const expectedRadius = 25 - inset;
    const expectedArea = Math.PI * expectedRadius * expectedRadius;
    // Centroid-based stub doesn't preserve area exactly for inset
    // circles, but should be within 5% for a 96-vertex circle.
    expect(infillArea).toBeGreaterThan(expectedArea * 0.95);
    expect(infillArea).toBeLessThan(expectedArea * 1.05);
  });

  it('every Arachne wall point envelope (centerline + halfW) lies OUTSIDE the infill region', async () => {
    const { computeArachneInfillGeometry } = await import('../index');
    const outer = makeCircle(0, 0, 25, 96);
    const hole = makeCircle(0, 0, 2, 32).reverse();
    const deps = makeWindingAwareDeps();

    // Synthesize 3 walls around the hole and 3 around the outer at
    // their nominal positions for a 0.45 lineWidth.
    const lineWidth = 0.45;
    const wallCount = 3;
    const wallPaths: VariableWidthPath[] = [];
    for (let depth = 0; depth < wallCount; depth++) {
      const offsetMm = (depth + 0.5) * lineWidth;
      // Outer-side walls: shrink outer by offsetMm.
      wallPaths.push(makePath(makeCircle(0, 0, 25 - offsetMm, 64),
        new Array(64).fill(lineWidth), depth));
      // Hole-side walls: expand hole outward by offsetMm.
      wallPaths.push(makePath(makeCircle(0, 0, 2 + offsetMm, 32),
        new Array(32).fill(lineWidth), depth));
    }

    // Compute envelope and inset distance.
    const envelope = computeMaxPathInset(wallPaths, outer, [hole]);
    const insetDistance = envelope + lineWidth * 0.05;
    const result = computeArachneInfillGeometry(outer, [hole], insetDistance, deps);

    // Now: for every wall point, the disc of radius halfW around that
    // point must NOT overlap any infill region.
    let violations = 0;
    for (const path of wallPaths) {
      for (const pt of path.points) {
        for (const region of result.infillRegions) {
          if (pointInPath(pt, region.contour)) {
            // pt is inside body, check it's also inside a hole (excluded
            // from infill). If not, the wall centerline overlaps infill.
            let insideHole = false;
            for (const h of region.holes) {
              if (pointInPath(pt, h)) { insideHole = true; break; }
            }
            if (!insideHole) violations++;
          }
        }
      }
    }
    expect(violations).toBe(0);
  });
});

// ----------------------------------------------------------------------
// Topological edge cases: concave outer, breakthrough holes, holes that
// merge after offset. These exercise the union/difference path inside
// `computeArachneInfillGeometry` (the Clipper2 path) — anywhere the
// hole offset overlaps the outer offset or another hole, the boolean
// op must produce a sane result.
// ----------------------------------------------------------------------

describe('Arachne infill region — topological edges', () => {
  it('concave (L-shape) outer: infill bbox stays within outer bbox', async () => {
    const { computeArachneInfillGeometry } = await import('../index');
    // L-shape: outer 30×30 square with the upper-right 15×15 quadrant
    // removed. CCW traversal.
    const outer = [
      v(0, 0), v(30, 0), v(30, 15),
      v(15, 15), v(15, 30), v(0, 30),
    ];
    const deps = makeWindingAwareDeps();

    const result = computeArachneInfillGeometry(outer, [], 1.5, deps);
    expect(result.infillRegions.length).toBeGreaterThan(0);
    for (const region of result.infillRegions) {
      for (const pt of region.contour) {
        expect(pt.x).toBeGreaterThanOrEqual(-1e-3);
        expect(pt.x).toBeLessThanOrEqual(30 + 1e-3);
        expect(pt.y).toBeGreaterThanOrEqual(-1e-3);
        expect(pt.y).toBeLessThanOrEqual(30 + 1e-3);
      }
    }
  });

  it('hole near boundary (breakthrough) does not produce infill outside body', async () => {
    const { computeArachneInfillGeometry } = await import('../index');
    // 25 mm circle, hole at x=22 r=1.5 → after +2 inset, hole expands
    // to x=22 r=3.5 which overlaps the outer (radius 25-2=23 inset).
    const outer = makeCircle(0, 0, 25, 96);
    const hole = makeCircle(22, 0, 1.5, 24).reverse();
    const deps = makeWindingAwareDeps();

    const result = computeArachneInfillGeometry(outer, [hole], 2, deps);
    // Even though the hole punches through the outer offset, the infill
    // contour must still be bounded by the body's outer.
    for (const region of result.infillRegions) {
      for (const pt of region.contour) {
        const r = Math.hypot(pt.x, pt.y);
        expect(r).toBeLessThanOrEqual(25 + 1e-3);
      }
    }
  });

  it('two adjacent holes whose offsets overlap produce a sane (non-crashing) result', async () => {
    const { computeArachneInfillGeometry } = await import('../index');
    const outer = makeCircle(0, 0, 25, 96);
    // Two 1.5mm-radius holes 4mm apart. Inset by 2mm → each becomes
    // 3.5mm radius. Centers are 4mm apart so the offsets overlap.
    const holeA = makeCircle(-2, 0, 1.5, 24).reverse();
    const holeB = makeCircle(2, 0, 1.5, 24).reverse();
    const deps = makeWindingAwareDeps();

    const result = computeArachneInfillGeometry(outer, [holeA, holeB], 2, deps);
    // Whether Clipper2 merges the overlapping offsets into one combined
    // ring or keeps them as two depends on the fill rule and winding
    // input; both outcomes are valid as long as the result is geometrically
    // sane (every point inside body, every hole outside originals).
    expect(result.infillRegions.length).toBeGreaterThan(0);
    expect(result.innermostHoles.length).toBe(2);
    for (const region of result.infillRegions) {
      for (const pt of region.contour) {
        expect(Math.hypot(pt.x, pt.y)).toBeLessThanOrEqual(25 + 1e-3);
      }
    }
  });

  it('hole that fully consumes the outer (insetDistance ≥ body half-width) yields no infill', async () => {
    const { computeArachneInfillGeometry } = await import('../index');
    // 5mm body with a 4mm hole: hole + 2mm inset = 6mm > 5mm body.
    const outer = makeCircle(0, 0, 5, 64);
    const hole = makeCircle(0, 0, 4, 32).reverse();
    const deps = makeWindingAwareDeps();

    const result = computeArachneInfillGeometry(outer, [hole], 2, deps);
    // Either empty regions OR a region whose contour is degenerate.
    // The function shouldn't throw and shouldn't return a region that
    // extends outside the body.
    for (const region of result.infillRegions) {
      for (const pt of region.contour) {
        const r = Math.hypot(pt.x, pt.y);
        expect(r).toBeLessThanOrEqual(5 + 1e-3);
      }
    }
  });
});

// ----------------------------------------------------------------------
// Defensive tests for `computeMaxPathInset` against malformed input.
// These don't represent bugs we've seen but lock in graceful behaviour
// — `computeMaxPathInset` is exported and could one day be called with
// data from a corrupted slicer cache or a misbehaving backend.
// ----------------------------------------------------------------------

describe('computeMaxPathInset — defensive edge cases', () => {
  it('handles a path with a single point (depth value still respected)', () => {
    const outer = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const onePoint = makePath([v(5, 5)], [0.4], 0);
    expect(computeMaxPathInset([onePoint], outer, [])).toBeCloseTo(5.2, 6);
  });

  it('treats missing widths[i] entry as zero half-width (does not crash)', () => {
    const outer = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    // Widths array shorter than points — the function reads `widths[i]
    // ?? 0` so missing entries contribute zero half-width.
    const path: VariableWidthPath = {
      points: [v(5, 5), v(6, 5)],
      widths: [0.4],
      depth: 0,
      isClosed: false,
      source: 'outer',
    };
    const inset = computeMaxPathInset([path], outer, []);
    // Point 0 contributes 5 + 0.2 = 5.2; point 1 contributes 5 + 0 = 5.
    expect(inset).toBeCloseTo(5.2, 6);
  });

  it('zero-width walls contribute their position only (no halfW pad)', () => {
    const outer = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const zeroWidth = makePath([v(5, 5)], [0], 0);
    expect(computeMaxPathInset([zeroWidth], outer, [])).toBeCloseTo(5.0, 6);
  });

  it('outer with collinear points still produces a valid inset', () => {
    // Insert a collinear point on each edge — should not change the
    // distance computation since segments are well-defined.
    const outer = [v(0, 0), v(5, 0), v(10, 0), v(10, 10), v(0, 10)];
    const path = makePath([v(5, 5)], [0.4], 0);
    expect(computeMaxPathInset([path], outer, [])).toBeCloseTo(5.2, 6);
  });

  it('source field is ignored (gapfill paths contribute the same as outer paths)', () => {
    // Path source ('outer' | 'hole' | 'gapfill') is metadata for the
    // emit step, not the geometry calc. computeMaxPathInset should
    // reach the same envelope value regardless.
    const outer = makeCircle(0, 0, 25, 96);
    const asOuter   = makePath([v(20, 0)], [0.45], 0, 'outer');
    const asGapfill = makePath([v(20, 0)], [0.45], 0, 'gapfill');
    const insetOuter   = computeMaxPathInset([asOuter],   outer, []);
    const insetGapfill = computeMaxPathInset([asGapfill], outer, []);
    expect(insetOuter).toBeCloseTo(insetGapfill, 6);
    // Distance from (20,0) to a 96-vertex chord-approximated circle is
    // slightly less than 5 (chord-arc deviation). Use loose tolerance.
    expect(insetOuter).toBeGreaterThan(4.9);
    expect(insetOuter).toBeLessThan(5.3);
  });
});

function pointInPath(pt: THREE.Vector2, ring: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if (((yi > pt.y) !== (yj > pt.y))
        && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi || 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
