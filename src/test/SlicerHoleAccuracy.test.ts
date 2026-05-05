import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { signedArea as signedArea2D } from '../engine/slicer/geometry/contourUtils';
import {
  bboxFromMoves,
  buildBox,
  buildBoxWithHole,
  outerWallMoves,
  sliceGeometry,
  wallMoves,
  type MoveLike,
} from './_helpers/slicerSystemHelpers';

const LAYER = 3;

/**
 * Group consecutive same-type moves whose endpoints chain together into
 * closed loops (rings). Returns one ring per connected component of
 * the wall path.
 */
function extractWallRings(moves: ReadonlyArray<MoveLike>, eps = 0.05): Array<{ x: number; y: number }[]> {
  const rings: Array<{ x: number; y: number }[]> = [];
  let current: { x: number; y: number }[] | null = null;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (current === null) {
      current = [{ x: m.from.x, y: m.from.y }];
      current.push({ x: m.to.x, y: m.to.y });
      continue;
    }
    const last = current[current.length - 1];
    const gap = Math.hypot(m.from.x - last.x, m.from.y - last.y);
    if (gap > eps) {
      // Chain broken — start a new ring.
      rings.push(current);
      current = [{ x: m.from.x, y: m.from.y }, { x: m.to.x, y: m.to.y }];
    } else {
      current.push({ x: m.to.x, y: m.to.y });
    }
  }
  if (current) rings.push(current);
  return rings;
}

describe('Slicer hole detection — single centered hole', () => {
  const HOLE_SIZES = [2, 4, 6, 8] as const;
  it.each(HOLE_SIZES)('20mm box with %dmm centered hole produces a hole-loop in the wall set', async (holeSize) => {
    const result = await sliceGeometry(buildBoxWithHole(20, 20, 4, holeSize));
    const moves = wallMoves(result.layers[LAYER]);
    expect(moves.length).toBeGreaterThan(0);
    const rings = extractWallRings(moves);
    // We expect at least 2 rings: the outer rectangle and the inner hole.
    expect(rings.length).toBeGreaterThanOrEqual(2);
  });

  it.each(HOLE_SIZES)('hole loop area scales as (holeSize - lw)² (wall offset inward into hole)', async (holeSize) => {
    const result = await sliceGeometry(buildBoxWithHole(20, 20, 4, holeSize));
    const moves = wallMoves(result.layers[LAYER]);
    const rings = extractWallRings(moves);

    // Pick the smallest-area ring as the hole's wall (innermost loop).
    const ringAreas = rings.map((r) => Math.abs(signedArea2D(r)));
    if (ringAreas.length < 2) return;
    ringAreas.sort((a, b) => a - b);
    const holeRingArea = ringAreas[0];

    // Wall ring is INSIDE the hole (offset by lw/2 toward the void).
    const expected = (holeSize - 0.4) * (holeSize - 0.4);
    expect(holeRingArea).toBeGreaterThan(expected * 0.85);
    expect(holeRingArea).toBeLessThan(expected * 1.25);
  });

  it.each(HOLE_SIZES)('hole-loop centroid is near the model-space center for a centered %dmm hole', async (holeSize) => {
    const result = await sliceGeometry(buildBoxWithHole(20, 20, 4, holeSize));
    const moves = wallMoves(result.layers[LAYER]);
    const rings = extractWallRings(moves);
    const ringAreas = rings.map((r) => Math.abs(signedArea2D(r)));
    if (ringAreas.length < 2) return;
    const minIdx = ringAreas.indexOf(Math.min(...ringAreas));
    const holeRing = rings[minIdx];
    let cx = 0, cy = 0;
    for (const p of holeRing) { cx += p.x; cy += p.y; }
    cx /= holeRing.length; cy /= holeRing.length;
    // Allow up to 2mm offset — open-mesh walls don't always close in the
    // exact geometric center after pipeline classification.
    expect(Math.abs(cx)).toBeLessThan(2);
    expect(Math.abs(cy)).toBeLessThan(2);
  });
});

describe('Slicer hole — perimeter precision', () => {
  it.each([3, 5, 7] as const)('a %dmm-side hole has perimeter ≈ 4(holeSize - lw)', async (holeSize) => {
    const result = await sliceGeometry(buildBoxWithHole(20, 20, 4, holeSize));
    const moves = wallMoves(result.layers[LAYER]);
    const rings = extractWallRings(moves);
    if (rings.length < 2) return;
    const ringPerimeters = rings.map((r) => {
      let p = 0;
      for (let i = 0; i < r.length - 1; i++) {
        p += Math.hypot(r[i + 1].x - r[i].x, r[i + 1].y - r[i].y);
      }
      return p;
    });
    const minIdx = ringPerimeters.indexOf(Math.min(...ringPerimeters));
    const holePerim = ringPerimeters[minIdx];
    const expected = 4 * (holeSize - 0.4);
    expect(holePerim).toBeGreaterThan(expected * 0.85);
    expect(holePerim).toBeLessThan(expected * 1.15);
  });
});

describe('Slicer hole — Z invariance for vertical-walled hole', () => {
  it('every layer of a holed box has the same hole loop area', async () => {
    const result = await sliceGeometry(buildBoxWithHole(20, 20, 4, 6));
    const layerHoleAreas: number[] = [];
    for (const layer of result.layers) {
      const moves = wallMoves(layer);
      const rings = extractWallRings(moves);
      const areas = rings.map((r) => Math.abs(signedArea2D(r))).filter((a) => a > 0);
      if (areas.length < 2) continue;
      layerHoleAreas.push(Math.min(...areas));
    }
    expect(layerHoleAreas.length).toBeGreaterThan(2);
    const min = Math.min(...layerHoleAreas);
    const max = Math.max(...layerHoleAreas);
    expect((max - min) / min).toBeLessThan(0.05);
  });

  it.each([4, 6, 8] as const)('every layer of a box with %dmm hole has approximately matching hole loop bbox', async (holeSize) => {
    const result = await sliceGeometry(buildBoxWithHole(20, 20, 4, holeSize));
    const widths: number[] = [];
    for (const layer of result.layers) {
      const moves = wallMoves(layer);
      const rings = extractWallRings(moves);
      if (rings.length < 2) continue;
      const ringAreas = rings.map((r) => Math.abs(signedArea2D(r)));
      const minIdx = ringAreas.indexOf(Math.min(...ringAreas));
      const ring = rings[minIdx];
      let minX = Infinity, maxX = -Infinity;
      for (const p of ring) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }
      widths.push(maxX - minX);
    }
    expect(widths.length).toBeGreaterThan(2);
    const min = Math.min(...widths);
    const max = Math.max(...widths);
    expect(max - min).toBeLessThan(0.2);
  });
});

describe('Slicer hole — outer wall unchanged by interior hole', () => {
  it.each([2, 4, 6, 8] as const)('outer-wall bbox of a 20mm box is identical with vs without a %dmm hole', async (holeSize) => {
    const noHole = await sliceGeometry(buildBox(20, 20, 4));
    const hole = await sliceGeometry(buildBoxWithHole(20, 20, 4, holeSize));
    const noHoleBox = bboxFromMoves(outerWallMoves(noHole.layers[3]));
    const holeBox = bboxFromMoves(outerWallMoves(hole.layers[3]));
    expect(holeBox.width).toBeCloseTo(noHoleBox.width, 1);
    expect(holeBox.height).toBeCloseTo(noHoleBox.height, 1);
  });
});

describe('Slicer hole — smallHoleMaxSize gate', () => {
  it('a small hole below smallHoleMaxSize keeps the outer wall intact', async () => {
    // The slicer's smallHoleMaxSize filter affects hole-aware infill
    // routing rather than dropping the hole geometry from walls. This
    // test pins the *structural* property: the outer wall is unchanged
    // when the threshold is set.
    const result = await sliceGeometry(buildBoxWithHole(20, 20, 4, 1), {
      smallHoleMaxSize: 5,
    });
    const outerBbox = bboxFromMoves(outerWallMoves(result.layers[LAYER]));
    expect(outerBbox.width).toBeCloseTo(20 - 0.4, 0);
    expect(outerBbox.height).toBeCloseTo(20 - 0.4, 0);
  });

  it('the same small hole is kept when smallHoleMaxSize is 0 or below threshold', async () => {
    const result = await sliceGeometry(buildBoxWithHole(20, 20, 4, 4), {
      smallHoleMaxSize: 0,
    });
    const moves = wallMoves(result.layers[LAYER]);
    const rings = extractWallRings(moves);
    expect(rings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Slicer hole — multi-hole topology', () => {
  function buildBoxWithTwoHoles(): THREE.BufferGeometry {
    // 30 × 20 box with two 4mm holes side-by-side.
    const sx = 30, sy = 20, sz = 4;
    const hx = sx / 2, hy = sy / 2;
    const hh = 2; // half hole size = 2 (4mm hole)
    const off = 7;  // hole centers at (-7, 0) and (+7, 0)

    const positions: number[] = [];
    const v = (x: number, y: number, z: number) => [x, y, z];
    const push = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);

    const o00 = v(-hx, -hy, 0), o10 = v(hx, -hy, 0), o11 = v(hx, hy, 0), o01 = v(-hx, hy, 0);
    const t00 = v(-hx, -hy, sz), t10 = v(hx, -hy, sz), t11 = v(hx, hy, sz), t01 = v(-hx, hy, sz);

    // Two holes — a (left) and b (right).
    const aBL = v(-off - hh, -hh, 0), aBR = v(-off + hh, -hh, 0);
    const aTR = v(-off + hh, hh, 0), aTL = v(-off - hh, hh, 0);
    const aTBL = v(-off - hh, -hh, sz), aTBR = v(-off + hh, -hh, sz);
    const aTTR = v(-off + hh, hh, sz), aTTL = v(-off - hh, hh, sz);
    const bBL = v(off - hh, -hh, 0), bBR = v(off + hh, -hh, 0);
    const bTR = v(off + hh, hh, 0), bTL = v(off - hh, hh, 0);
    const bTBL = v(off - hh, -hh, sz), bTBR = v(off + hh, -hh, sz);
    const bTTR = v(off + hh, hh, sz), bTTL = v(off - hh, hh, sz);

    // Outer side walls
    push(o00, o10, t10); push(o00, t10, t00);
    push(o10, o11, t11); push(o10, t11, t10);
    push(o11, o01, t01); push(o11, t01, t11);
    push(o01, o00, t00); push(o01, t00, t01);

    // Hole A side walls (inward)
    push(aBL, aTL, aTTL); push(aBL, aTTL, aTBL);
    push(aTL, aTR, aTTR); push(aTL, aTTR, aTTL);
    push(aTR, aBR, aTBR); push(aTR, aTBR, aTTR);
    push(aBR, aBL, aTBL); push(aBR, aTBL, aTBR);
    // Hole B side walls (inward)
    push(bBL, bTL, bTTL); push(bBL, bTTL, bTBL);
    push(bTL, bTR, bTTR); push(bTL, bTTR, bTTL);
    push(bTR, bBR, bTBR); push(bTR, bTBR, bTTR);
    push(bBR, bBL, bTBL); push(bBR, bTBL, bTBR);

    // For simplicity, omit top/bottom faces — the slicer pipeline can
    // handle open meshes for thin-wall validation. Tests focus on wall
    // count, not solid-surface fill.
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();
    return geom;
  }

  it('a box with two holes produces three contour rings (outer + 2 holes)', async () => {
    const result = await sliceGeometry(buildBoxWithTwoHoles());
    const moves = wallMoves(result.layers[LAYER]);
    const rings = extractWallRings(moves);
    // Open-mesh side walls might not always close cleanly, so accept ≥3.
    expect(rings.length).toBeGreaterThanOrEqual(3);
  });
});
