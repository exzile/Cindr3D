import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildChainTube, TUBE_RADIAL_SEGMENTS } from './tubeGeometry';
import type { TubeChain } from '../../../../types/slicer-preview.types';

const RADIAL = TUBE_RADIAL_SEGMENTS;
const ringSize = RADIAL + 1;

function getRingCenter(positions: Float32Array, ringIdx: number): THREE.Vector3 {
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
  for (let r = 0; r < RADIAL; r++) {
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
  type = 'support',
): TubeChain {
  const pts = points.map(([x, y]) => ({ x, y, lw }));
  const segCount = isClosed ? pts.length : pts.length - 1;
  const segColors: Array<[number, number, number]> = Array.from(
    { length: segCount }, () => [0.5, 0.5, 0.5] as [number, number, number],
  );
  const moveRefs = Array.from({ length: segCount }, () => ({
    type, speed: 60, extrusion: 0.001, lineWidth: lw, length: 1,
  }));
  return { type, points: pts, segColors, moveRefs, isClosed };
}

describe('Preview tube — ring center precision (untrimmed type)', () => {
  const POSITIONS: Array<[number, number]> = [
    [0, 0], [10, 0], [-5, 7], [3.14, 2.718], [25, 25], [100.123, 50.456],
  ];
  it.each(POSITIONS)('first ring center at (%f, %f) matches input within 1µm', async (px, py) => {
    const chain = makeChain([[px, py], [px + 5, py + 5]], 0.4, false, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const ring = getRingCenter(positions, 0);
    expect(ring.x).toBeCloseTo(px, 5);
    expect(ring.y).toBeCloseTo(py, 5);
  });
});

describe('Preview tube — line width precision', () => {
  const WIDTHS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0] as const;
  it.each(WIDTHS)('ring perpendicular span equals lw=%fmm exactly', (lw) => {
    const chain = makeChain([[0, 0], [10, 0]], lw, false);
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(ringSpan(positions, 0, 1)).toBeCloseTo(lw, 4);
    expect(ringSpan(positions, 1, 1)).toBeCloseTo(lw, 4);
  });

  const LAYER_HS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4] as const;
  it.each(LAYER_HS)('ring vertical span equals layerHeight=%fmm exactly', (lh) => {
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false);
    const geo = buildChainTube(chain, lh, 1);
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(ringSpan(positions, 0, 2)).toBeCloseTo(lh, 4);
  });
});

describe('Preview tube — chain length preservation', () => {
  const LENGTHS = [1, 5, 10, 25, 50] as const;
  it.each(LENGTHS)('untrimmed chain of length %fmm produces a tube of equal centerline length', (length) => {
    const chain = makeChain([[0, 0], [length, 0]], 0.4, false, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const r0 = getRingCenter(positions, 0);
    const r1 = getRingCenter(positions, 1);
    expect(r0.distanceTo(r1)).toBeCloseTo(length, 4);
  });

  it('multi-segment chain length sums correctly', () => {
    // Sum of segment lengths: 5 + 5 + 7 = 17
    const chain = makeChain([[0, 0], [5, 0], [5, 5], [12, 5]], 0.4, false, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const centers = [
      getRingCenter(positions, 0),
      getRingCenter(positions, 1),
      getRingCenter(positions, 2),
      getRingCenter(positions, 3),
    ];
    const total =
      centers[0].distanceTo(centers[1]) +
      centers[1].distanceTo(centers[2]) +
      centers[2].distanceTo(centers[3]);
    expect(total).toBeCloseTo(17, 4);
  });
});

describe('Preview tube — Orca-style solid skin ends', () => {
  it('does not trim open top-bottom tube ring centers before adding point caps', () => {
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false, 'top-bottom');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const start = getRingCenter(positions, 0);
    const end = getRingCenter(positions, 1);

    expect(start.x).toBeCloseTo(0, 5);
    expect(start.y).toBeCloseTo(0, 5);
    expect(end.x).toBeCloseTo(10, 5);
    expect(end.y).toBeCloseTo(0, 5);
  });

  it('renders sparse infill tube ring centers at exact gcode endpoints (no trim)', () => {
    // We removed the previous trim hack — every fill-type tube now
    // ends at the gcode coordinate, matching OrcaSlicer / PrusaSlicer.
    // The deliberate skin/infill overlap into walls is therefore
    // visually accurate (matches what's actually printed).
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false, 'infill');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const start = getRingCenter(positions, 0);
    const end = getRingCenter(positions, 1);

    expect(start.x).toBeCloseTo(0, 5);
    expect(end.x).toBeCloseTo(10, 5);
  });
});

describe('Preview tube — Z position precision', () => {
  const BASE_ZS = [0.2, 0.5, 1.0, 2.5, 10.0] as const;
  it.each(BASE_ZS)('ring centerline Z = baseZ - layerHeight/2 for baseZ=%fmm', (baseZ) => {
    const layerH = 0.2;
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false);
    const geo = buildChainTube(chain, layerH, baseZ);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const center = getRingCenter(positions, 0);
    expect(center.z).toBeCloseTo(baseZ - layerH / 2, 5);
  });
});

describe('Preview tube — angle preservation', () => {
  const ANGLES = [0, 30, 45, 60, 90, 135, 180, 225, 270] as const;
  it.each(ANGLES)('chain at %d° produces ring centers along the same direction', (degrees) => {
    const rad = (degrees * Math.PI) / 180;
    const length = 10;
    const chain = makeChain([[0, 0], [Math.cos(rad) * length, Math.sin(rad) * length]], 0.4, false, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const r0 = getRingCenter(positions, 0);
    const r1 = getRingCenter(positions, 1);
    const dx = r1.x - r0.x;
    const dy = r1.y - r0.y;
    const measured = Math.atan2(dy, dx);
    let diff = measured - rad;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    expect(Math.abs(diff)).toBeLessThan(0.01);
  });
});

describe('Preview tube — layered Z stacking', () => {
  it('two tubes at adjacent layer Zs differ by exactly layerHeight at their ring centers', () => {
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false);
    const layerH = 0.2;
    const layer0 = buildChainTube(chain, layerH, 0.2)!;
    const layer1 = buildChainTube(chain, layerH, 0.4)!;
    const c0 = getRingCenter(layer0.getAttribute('position').array as Float32Array, 0);
    const c1 = getRingCenter(layer1.getAttribute('position').array as Float32Array, 0);
    expect(c1.z - c0.z).toBeCloseTo(layerH, 5);
  });

  it('a stack of 10 layers spans 10 × layerHeight in Z', () => {
    const chain = makeChain([[0, 0], [10, 0]], 0.4, false);
    const layerH = 0.2;
    const baseZs = Array.from({ length: 10 }, (_, i) => layerH * (i + 1));
    const centers = baseZs.map((z) => {
      const tube = buildChainTube(chain, layerH, z)!;
      return getRingCenter(tube.getAttribute('position').array as Float32Array, 0);
    });
    expect(centers[centers.length - 1].z - centers[0].z).toBeCloseTo(layerH * 9, 4);
  });
});

describe('Preview tube — closed-loop precision', () => {
  it('a closed square chain produces 4 rings with equal corner distances', () => {
    const chain = makeChain([[0, 0], [10, 0], [10, 10], [0, 10]], 0.4, true, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const c0 = getRingCenter(positions, 0);
    const c1 = getRingCenter(positions, 1);
    const c2 = getRingCenter(positions, 2);
    const c3 = getRingCenter(positions, 3);
    expect(c0.distanceTo(c1)).toBeCloseTo(10, 4);
    expect(c1.distanceTo(c2)).toBeCloseTo(10, 4);
    expect(c2.distanceTo(c3)).toBeCloseTo(10, 4);
    // Closed wraps: c3 → c0 should also be 10mm
    expect(c3.distanceTo(c0)).toBeCloseTo(10, 4);
  });

  const RADII = [3, 5, 8, 10] as const;
  it.each(RADII)('closed circular polygon (R=%dmm) ring centers lie on a circle of radius R', (radius) => {
    const N = 32;
    const points: Array<[number, number]> = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      points.push([Math.cos(a) * radius, Math.sin(a) * radius]);
    }
    const chain = makeChain(points, 0.4, true, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    // 32 points = exactly 32 sample rings (with N>3 + dense circle, subdivision enabled but still preserves overall radius).
    // Test that EVERY ring lies near the expected radius.
    const ringCount = positions.length / (3 * ringSize);
    let maxDev = 0;
    for (let i = 0; i < ringCount; i++) {
      const c = getRingCenter(positions, i);
      const r = Math.hypot(c.x, c.y);
      maxDev = Math.max(maxDev, Math.abs(r - radius));
    }
    expect(maxDev).toBeLessThan(0.1);
  });
});

// Open FILL-type chains (infill / top-bottom / bridge / ironing /
// gap-fill) get a Cura/Orca-style apex cap at each end: one extra
// vertex displaced one halfWidth past the tube end along the line's
// own direction, fanned to the anchor ring with RADIAL triangles.
// Closed chains and OPEN WALL chains do NOT get caps — wall caps were
// dotting the perimeter at certain zoom levels when libArachne walls
// failed the loop-closure heuristic in `GCodeTubePreview`.

describe('Preview tube — vertex count consistency', () => {
  it('vertex count for open INFILL chain = body rings × ringSize + 2 apex verts', () => {
    const chain = makeChain([[0, 0], [10, 0], [20, 5]], 0.4, false, 'infill');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(positions.length).toBe((3 * ringSize + 2) * 3);
  });

  it('open SUPPORT chain has no apex caps (caps gated to fill types only)', () => {
    const chain = makeChain([[0, 0], [10, 0], [20, 5]], 0.4, false, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(positions.length).toBe(3 * ringSize * 3);
  });

  it.each([2, 3, 4, 5, 8, 16] as const)('open INFILL chain of %d points produces N×ringSize body verts + 2 cap apex verts', (n) => {
    const points: Array<[number, number]> = Array.from({ length: n }, (_, i) => [i * 5, 0] as [number, number]);
    const chain = makeChain(points, 0.4, false, 'infill');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(positions.length).toBe((n * ringSize + 2) * 3);
  });
});

describe('Preview tube — index buffer correctness', () => {
  it('index buffer for open INFILL = body loops × RADIAL × 6 + 2 × cap fans (RADIAL triangles each)', () => {
    const chain = makeChain([[0, 0], [10, 0], [20, 0]], 0.4, false, 'infill');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const indices = geo!.getIndex();
    const bodyIndices = 2 * RADIAL * 6;
    const capIndices = 2 * RADIAL * 3;
    expect(indices!.count).toBe(bodyIndices + capIndices);
  });

  it('index buffer has 6 × N × RADIAL for closed N-point chains', () => {
    const chain = makeChain([[0, 0], [10, 0], [10, 10], [0, 10]], 0.4, true, 'support');
    const geo = buildChainTube(chain, 0.2, 0.2);
    const indices = geo!.getIndex();
    expect(indices!.count).toBe(4 * RADIAL * 6);
  });

  it('every index is within the position buffer range', () => {
    const chain = makeChain([[0, 0], [10, 0], [20, 0], [30, 5]], 0.4, false);
    const geo = buildChainTube(chain, 0.2, 0.2);
    const positions = geo!.getAttribute('position').array as Float32Array;
    const indices = geo!.getIndex()!.array;
    const vertexCount = positions.length / 3;
    for (let i = 0; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(0);
      expect(indices[i]).toBeLessThan(vertexCount);
    }
  });
});
