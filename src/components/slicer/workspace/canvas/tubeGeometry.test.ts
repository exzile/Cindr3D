import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildChainTube, TUBE_RADIAL_SEGMENTS } from './tubeGeometry';
import type { TubeChain } from '../../../../types/slicer-preview.types';

/**
 * Slicer preview geometry tests.
 *
 * `buildChainTube` is the function the slicer preview uses to convert
 * each polyline of extrusion moves into the mitered tube BufferGeometry
 * that gets rendered in the workspace viewport. These tests pin the
 * geometric contract:
 *
 *  - The tube's centerline X/Y must follow the input chain points
 *    (otherwise printed walls render in the wrong location).
 *  - The tube's length along XY must match the polyline's total length
 *    (within rounding) for fill-types that aren't end-trimmed.
 *  - Each vertex ring sits at the expected Z (centered on the layer).
 *  - The bead width (Y/Z extent of each ring) matches the chain's `lw`
 *    field — so width-mode preview colors and the visual size match the
 *    actual extrusion line width.
 *  - Closed chains wrap (last ring connects to first); open chains
 *    don't (endpoints are flat).
 *
 * These match what users see in the preview viewport: line locations,
 * lengths, and widths all come from this function.
 */

const RADIAL = TUBE_RADIAL_SEGMENTS;
const ringSize = RADIAL + 1;

function getRingCenter(positions: Float32Array, ringIdx: number): THREE.Vector3 {
  // Average of the RADIAL unique vertices = the ring's center on the chain.
  // The buffer stores ringSize = RADIAL + 1 vertices per ring (the first +
  // last are duplicated to avoid a UV seam); averaging all RADIAL+1 would
  // double-count the seam vertex and bias the centroid by 1/(RADIAL+1)
  // of the bead radius. Average exactly RADIAL = symmetric around centroid.
  const start = ringIdx * ringSize * 3;
  let cx = 0, cy = 0, cz = 0;
  for (let r = 0; r < RADIAL; r++) {
    cx += positions[start + r * 3 + 0];
    cy += positions[start + r * 3 + 1];
    cz += positions[start + r * 3 + 2];
  }
  return new THREE.Vector3(cx / RADIAL, cy / RADIAL, cz / RADIAL);
}

function ringSpan(positions: Float32Array, ringIdx: number, axis: 0 | 1 | 2): number {
  const start = ringIdx * ringSize * 3;
  let lo = Infinity, hi = -Infinity;
  for (let r = 0; r < ringSize; r++) {
    const v = positions[start + r * 3 + axis];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

function makeChain(
  points: Array<[number, number]>,
  lw: number,
  isClosed: boolean,
  type = 'wall-outer',
): TubeChain {
  const pts = points.map(([x, y]) => ({ x, y, lw }));
  const segCount = isClosed ? pts.length : pts.length - 1;
  const segColors: Array<[number, number, number]> = Array.from(
    { length: segCount }, () => [1, 0, 0] as [number, number, number],
  );
  const moveRefs = Array.from({ length: segCount }, () => ({
    type, speed: 60, extrusion: 0.001, lineWidth: lw, length: 1,
  }));
  return { type, points: pts, segColors, moveRefs, isClosed };
}

describe('buildChainTube — geometric contract', () => {
  it('returns null for chains with fewer than 2 points', () => {
    const chain = makeChain([[0, 0]], 0.4, false);
    expect(buildChainTube(chain, 0.2, 0.2)).toBeNull();
  });

  it('places the first ring center at the chain start point (untrimmed type)', () => {
    // Use 'support' so neither fill-trim nor open-wall trim apply.
    const chain = makeChain([[5, 5], [15, 5]], 0.4, false, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    expect(geo).not.toBeNull();
    const positions = geo!.getAttribute('position').array as Float32Array;
    const ring0 = getRingCenter(positions, 0);
    expect(ring0.x).toBeCloseTo(5, 5);
    expect(ring0.y).toBeCloseTo(5, 5);
  });

  it('places the last ring center at the chain end point (untrimmed type)', () => {
    const chain = makeChain([[5, 5], [15, 5]], 0.4, false, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const ringN = getRingCenter(positions, 1);
    expect(ringN.x).toBeCloseTo(15, 5);
    expect(ringN.y).toBeCloseTo(5, 5);
  });

  it('open wall chains keep endpoint centers exact and retain bead width', () => {
    // Keep the centerline and width faithful to the G-code endpoint. Tapering
    // wall endpoints makes near-seam fragments read as dents in stacked views.
    const chain = makeChain([[5, 5], [15, 5]], 0.4, false, 'wall-outer');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const ring0 = getRingCenter(positions, 0);
    const ringN = getRingCenter(positions, 1);
    expect(ring0.x).toBeCloseTo(5, 5);
    expect(ringN.x).toBeCloseTo(15, 5);
    expect(ringSpan(positions, 0, 1)).toBeCloseTo(0.4, 4);
    expect(ringSpan(positions, 1, 1)).toBeCloseTo(0.4, 4);
  });

  it('fill chains render at their exact gcode endpoints (no trim)', () => {
    const chain = makeChain([[5, 5], [15, 5]], 0.4, false, 'infill');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const ring0 = getRingCenter(positions, 0);
    const ringN = getRingCenter(positions, 1);
    expect(ring0.x).toBeCloseTo(5, 5);
    expect(ringN.x).toBeCloseTo(15, 5);
  });

  it('a 4-segment open INFILL polyline produces only continuous tube rings', () => {
    // Use 'infill' so the apex-cap path applies — caps are gated to
    // fill-type chains only (skin / infill / gap-fill / bridge), not
    // walls, to avoid sprinkling apex pyramids along the perimeter
    // when libArachne walls fail the loop-closure check.
    const chain = makeChain(
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 5]],
      0.4, false, 'infill',
    );
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const expectedVertices = 5 * ringSize;
    expect(positions.length).toBe(expectedVertices * 3);
  });

  it('open WALL chain has NO apex caps (skipped to avoid perimeter-dot artefact)', () => {
    const chain = makeChain([[0, 0], [10, 0], [10, 10]], 0.4, false, 'wall-outer');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    // 3 rings × ringSize verts × 3 floats — no apex vertex.
    expect(positions.length).toBe(3 * ringSize * 3);
  });

  it('open TOP/BOTTOM skin chains have NO apex caps (avoids chunky skin line-end artefacts)', () => {
    const chain = makeChain([[0, 0], [10, 0], [10, 10]], 0.4, false, 'top-bottom');
    const geo = buildChainTube(chain, 0.2, 0.2, { usePressedRoadTemplate: false });
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(positions.length).toBe(3 * ringSize * 3);
  });

  it('keeps the pressed-road template available for first-layer skin preview', () => {
    const chain = makeChain([[0, 0], [10, 0], [10, 10]], 0.4, false, 'top-bottom');
    const geo = buildChainTube(chain, 0.2, 0.2, { usePressedRoadTemplate: true });
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(positions.length).toBe(48 * 3);
    expect(geo!.getAttribute('vertexId').count).toBe(48);
  });

  it('can render wall chains through the Orca-style segment template', () => {
    const chain = makeChain([[0, 0], [10, 0], [10, 10]], 0.4, false, 'wall-inner');
    const geo = buildChainTube(chain, 0.2, 0.2, { useSegmentTemplate: true });
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(positions.length).toBe(48 * 3);
    expect(geo!.getAttribute('segmentHwaA').itemSize).toBe(4);
  });

  it('keeps Orca segment-template angles through mixed role chains', () => {
    const chain = makeChain([[0, 0], [10, 0], [10, 10]], 0.4, false, 'mixed');
    chain.moveRefs[0].type = 'wall-outer';
    chain.moveRefs[1].type = 'wall-inner';
    chain.segColors[0] = [1, 0.25, 0];
    chain.segColors[1] = [0, 0.6, 0.1];

    const geo = buildChainTube(chain, 0.2, 0.2, { useSegmentTemplate: true });
    const hwaB = geo!.getAttribute('segmentHwaB').array as Float32Array;

    expect(hwaB[2]).toBeCloseTo(Math.PI / 2, 4);
  });

  it('places Orca segment-template positions at the bead center Z', () => {
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false, 'wall-inner');
    const geo = buildChainTube(chain, 0.2, 1.0, { useSegmentTemplate: true });
    const positionsA = geo!.getAttribute('segmentPositionA').array as Float32Array;
    const positionsB = geo!.getAttribute('segmentPositionB').array as Float32Array;

    expect(positionsA[2]).toBeCloseTo(0.9, 5);
    expect(positionsB[2]).toBeCloseTo(0.9, 5);
  });

  it('can render gap-fill chains through the Orca-style segment template', () => {
    const chain = makeChain([[0, 0], [1, 0], [1.5, 0.25]], 0.25, false, 'gap-fill');
    const geo = buildChainTube(chain, 0.2, 0.2, { useSegmentTemplate: true });
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(positions.length).toBe(48 * 3);
    expect(geo!.getAttribute('segmentPositionA').itemSize).toBe(3);
  });

  it('center-Z of each ring equals the bead center (baseZ - layerHeight/2)', () => {
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false);
    const layerH = 0.2;
    const baseZ = 1.0;
    const geo = buildChainTube(chain, layerH, baseZ);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const expectedZ = baseZ - layerH / 2;
    expect(getRingCenter(positions, 0).z).toBeCloseTo(expectedZ, 5);
    expect(getRingCenter(positions, 1).z).toBeCloseTo(expectedZ, 5);
  });

  it('ring vertical extent (Z span) equals layerHeight', () => {
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false);
    const layerH = 0.3;
    const geo = buildChainTube(chain, layerH, 0.5);
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(ringSpan(positions, 0, 2)).toBeCloseTo(layerH, 4);
  });

  it('ring horizontal extent (perpendicular to chain) equals lineWidth', () => {
    // Chain along +X; perpendicular extent = Y span of the ring = lw.
    const chain = makeChain([[0, 0], [10, 0]], 0.45, false, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(ringSpan(positions, 0, 1)).toBeCloseTo(0.45, 4);
    expect(ringSpan(positions, 1, 1)).toBeCloseTo(0.45, 4);
  });

  it('ring widths interpolate per-vertex line widths', () => {
    // Vary lw along the chain; the tube must widen accordingly.
    const points: Array<{ x: number; y: number; lw: number }> = [
      { x: 0, y: 0, lw: 0.3 },
      { x: 10, y: 0, lw: 0.6 },
    ];
    const chain: TubeChain = {
      type: 'support',
      points,
      segColors: [[1, 1, 1]],
      moveRefs: [{ type: 'support', speed: 60, extrusion: 0.001, lineWidth: 0.3, length: 10 }],
      isClosed: false,
    };
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(ringSpan(positions, 0, 1)).toBeCloseTo(0.3, 4);
    expect(ringSpan(positions, 1, 1)).toBeCloseTo(0.6, 4);
  });

  it('total chain length (sum of ring-to-ring distances on XY) matches the input polyline exactly (no trim)', () => {
    // Now that we render gcode-precise endpoints, the tube length
    // equals the input polyline length exactly (30mm = 10 + 20).
    const chain = makeChain([[0, 0], [10, 0], [10, 20]], 0.4, false, 'infill');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const r0 = getRingCenter(positions, 0);
    const r1 = getRingCenter(positions, 1);
    const r2 = getRingCenter(positions, 2);
    const totalXY = r0.distanceTo(r1) + r1.distanceTo(r2);
    expect(totalXY).toBeCloseTo(30, 4);
  });

  it('untrimmed move types (e.g. travel never reaches here) have no end shrink for non-fill non-wall types', () => {
    // Use a type not in TRIMMED_FILL_TYPES and not a wall — e.g. 'support'.
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const r0 = getRingCenter(positions, 0);
    const r1 = getRingCenter(positions, 1);
    expect(r0.x).toBeCloseTo(0, 5);
    expect(r1.x).toBeCloseTo(10, 5);
  });

  it('closed chains generate a wrapping tube (n rings for n points, indices wrap)', () => {
    const chain = makeChain([[0, 0], [10, 0], [10, 10], [0, 10]], 0.4, true);
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(positions.length).toBe(4 * ringSize * 3);
    const indexAttr = geo!.getIndex();
    expect(indexAttr).not.toBeNull();
    // Closed chain → loopCount = n (4); each loop has RADIAL × 2 triangles
    // × 3 indices = 6 × RADIAL indices per loop.
    expect(indexAttr!.count).toBe(4 * RADIAL * 6);
  });

  it('open INFILL chains generate one fewer body loop than closed (n-1 segments)', () => {
    const open = buildChainTube(
      makeChain([[0, 0], [10, 0], [10, 10], [0, 10]], 0.4, false, 'infill'),
      0.2, 0.2,
    )!;
    const indices = open.getIndex();
    const bodyIndices = 3 * RADIAL * 6;
    expect(indices!.count).toBe(bodyIndices);
  });

  it('rings stay perpendicular to the chain direction (no twist)', () => {
    // Right-angle bend at (10,0). The ring at the corner uses the bisector
    // of in/out directions, but the ring at (0,0) should be perpendicular
    // to the +X chain direction → ring spans along Y.
    const chain = makeChain([[0, 0], [10, 0], [10, 10]], 0.4, false, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    // Ring 0 (at (0,0)): chain goes +X, perpendicular = Y.
    expect(ringSpan(positions, 0, 0)).toBeLessThan(1e-3); // no spread along X
    expect(ringSpan(positions, 0, 1)).toBeCloseTo(0.4, 4);
    // Ring 2 (at (10,10)): chain comes from +Y direction, perpendicular = X.
    expect(ringSpan(positions, 2, 0)).toBeCloseTo(0.4, 4);
    expect(ringSpan(positions, 2, 1)).toBeLessThan(1e-3);
  });
});

describe('buildChainTube — special path shapes', () => {
  it('handles a 180° U-turn (in-dir exactly opposite out-dir) without producing NaNs', () => {
    // Three colinear points where the middle one reverses direction.
    const chain = makeChain([[0, 0], [10, 0], [0, 0]], 0.4, false, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    expect(geo).not.toBeNull();
    const positions = geo!.getAttribute('position').array as Float32Array;
    for (let i = 0; i < positions.length; i++) {
      expect(Number.isFinite(positions[i])).toBe(true);
    }
  });

  it('handles a 90° corner with miter clamped at 1.0 (no over-stretch)', () => {
    const chain = makeChain([[0, 0], [10, 0], [10, 10]], 0.4, false, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    // Middle ring at the corner: span perpendicular to bisector (45°).
    // With MITER_MAX = 1.0 the bead width perpendicular to the bisector
    // stays equal to lw = 0.4 — no stretching past it.
    const span = ringSpan(positions, 1, 0); // X span at corner
    expect(span).toBeGreaterThan(0.2);
    expect(span).toBeLessThan(0.5);
  });

  it('subdivides a dense circular polygon (smooths out per-vertex tabs)', () => {
    // Build a 12-vertex circle approximation. Average segment length:
    //   2π × radius / 12 with radius = 0.6mm → ~0.314mm avg
    //   lw = 0.4mm → segment/lw = 0.79 < TUBE_SUBDIVISION_LW_RATIO (3)
    //   so subdivision should kick in.
    const radius = 0.6;
    const N = 12;
    const points: Array<[number, number]> = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      points.push([Math.cos(a) * radius, Math.sin(a) * radius]);
    }
    const chain = makeChain(points, 0.4, true, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    // After subdivision the ring count should be a multiple of N (from
    // SUBDIVISION_FACTOR=3 → 36 sample points). Without subdivision it
    // would be exactly N (12) rings.
    const rings = positions.length / 3 / ringSize;
    expect(rings).toBeGreaterThan(N);
  });

  it('subdivides dense circular wall paths so outer walls preview round', () => {
    const radius = 0.6;
    const N = 12;
    const points: Array<[number, number]> = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      points.push([Math.cos(a) * radius, Math.sin(a) * radius]);
    }
    const chain = makeChain(points, 0.4, true, 'wall-outer');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const rings = positions.length / 3 / ringSize;
    expect(rings).toBeGreaterThan(N);
  });

  it('does NOT subdivide a sparse polygon (rectangle / sharp corners preserved)', () => {
    // A 4-point rectangle with 10mm sides. avgLen = 10mm, lw = 0.4mm,
    // ratio = 25 — far above the subdivision threshold of 3.
    const chain = makeChain([[0, 0], [10, 0], [10, 5], [0, 5]], 0.4, true, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const rings = positions.length / 3 / ringSize;
    expect(rings).toBe(4);
  });

  it('skips zero-length segments at the chain start (degenerate polyline)', () => {
    // First two points coincide. Real `dir` returns null and the tangent
    // falls back to the next valid direction; output must not have NaNs.
    const chain = makeChain([[5, 5], [5, 5], [10, 5]], 0.4, false, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    expect(geo).not.toBeNull();
    const positions = geo!.getAttribute('position').array as Float32Array;
    for (let i = 0; i < positions.length; i++) {
      expect(Number.isFinite(positions[i])).toBe(true);
    }
  });

  it('returns a non-null geometry for a closed triangle (smallest possible loop)', () => {
    const chain = makeChain([[0, 0], [10, 0], [5, 8.66]], 0.4, true, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    expect(geo).not.toBeNull();
    const indices = geo!.getIndex();
    // Closed → loopCount = 3, RADIAL × 6 indices per loop
    expect(indices!.count).toBe(3 * RADIAL * 6);
  });

  it('layerHeight scales the Z extent linearly', () => {
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false, 'support');
    const thin = buildChainTube(chain, 0.1, 0.5)!;
    const thick = buildChainTube(chain, 0.4, 0.5)!;
    const thinSpan = ringSpan(thin.getAttribute('position').array as Float32Array, 0, 2);
    const thickSpan = ringSpan(thick.getAttribute('position').array as Float32Array, 0, 2);
    expect(thickSpan).toBeCloseTo(thinSpan * 4, 4);
  });

  it('baseZ shifts the entire tube up/down without changing its shape', () => {
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false, 'support');
    const z1 = buildChainTube(chain, 0.2, 0.5)!;
    const z2 = buildChainTube(chain, 0.2, 1.5)!;
    const center1 = getRingCenter(z1.getAttribute('position').array as Float32Array, 0);
    const center2 = getRingCenter(z2.getAttribute('position').array as Float32Array, 0);
    expect(center2.z - center1.z).toBeCloseTo(1.0, 4);
    expect(center2.x).toBeCloseTo(center1.x, 4);
    expect(center2.y).toBeCloseTo(center1.y, 4);
  });
});

describe('buildChainTube — color attribution', () => {
  it('sets a color attribute with one color triple per vertex', () => {
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false);
    const geo = buildChainTube(chain, 0.2, 0.2);
    const colorAttr = geo!.getAttribute('color');
    const positionAttr = geo!.getAttribute('position');
    expect(colorAttr.itemSize).toBe(3);
    expect(colorAttr.count).toBe(positionAttr.count);
  });

  it('first ring uses the first segment color (open chain)', () => {
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false);
    chain.segColors[0] = [0.2, 0.4, 0.6];
    const geo = buildChainTube(chain, 0.2, 0.2);
    const colors = geo!.getAttribute('color').array as Float32Array;
    // Ring 0, vertex 0:
    expect(colors[0]).toBeCloseTo(0.2, 4);
    expect(colors[1]).toBeCloseTo(0.4, 4);
    expect(colors[2]).toBeCloseTo(0.6, 4);
  });
});
