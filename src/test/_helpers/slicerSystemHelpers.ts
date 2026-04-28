import * as THREE from 'three';

import { Slicer } from '../../engine/slicer/Slicer';
import {
  DEFAULT_MATERIAL_PROFILES,
  DEFAULT_PRINTER_PROFILES,
  DEFAULT_PRINT_PROFILES,
} from '../../types/slicer';

/**
 * Shared geometry + slicer helpers for the system test suites.
 * Centralises the synthetic-mesh constructors and result accessors so
 * each test file stays focused on what it asserts.
 */

export type Geometry = THREE.BufferGeometry;
export type SliceResult = Awaited<ReturnType<Slicer['slice']>>;

export interface MoveLike {
  type: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  speed: number;
  lineWidth: number;
  extrusion: number;
}

export interface BBox2D { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number }

/**
 * Build a synthetic axis-aligned box mesh of given size, centered on the
 * XY origin and rising from z=0 to z=sz.
 */
export function buildBox(sx: number, sy: number, sz: number): Geometry {
  const hx = sx / 2, hy = sy / 2;
  const positions: number[] = [];
  const v = (x: number, y: number, z: number) => [x, y, z];
  const push = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);

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
  return geom;
}

/**
 * Build a synthetic cylinder of given radius and height as a triangle
 * mesh. The walls are vertical (no overhangs), the top + bottom faces
 * are fan-triangulated. `segments` controls the polygon resolution.
 * `holeRadius > 0` produces an annular cylinder (cylinder with a
 * vertical through-hole) — top + bottom become annuli and the inner
 * wall is added with inward-facing normals.
 */
export function buildCylinder(
  radius: number,
  height: number,
  segments = 64,
  holeRadius = 0,
): Geometry {
  const positions: number[] = [];
  const push = (...pts: Array<[number, number, number]>) => {
    for (const p of pts) positions.push(...p);
  };

  // Bottom + top center.
  const bc: [number, number, number] = [0, 0, 0];
  const tc: [number, number, number] = [0, 0, height];

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius;
    const y0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius;
    const y1 = Math.sin(a1) * radius;

    // Side wall — two triangles per quad.
    push([x0, y0, 0], [x1, y1, 0], [x1, y1, height]);
    push([x0, y0, 0], [x1, y1, height], [x0, y0, height]);

    if (holeRadius <= 0) {
      // Solid cylinder: fan-triangulate caps from origin.
      push(bc, [x1, y1, 0], [x0, y0, 0]);
      push(tc, [x0, y0, height], [x1, y1, height]);
    } else {
      const hx0 = Math.cos(a0) * holeRadius;
      const hy0 = Math.sin(a0) * holeRadius;
      const hx1 = Math.cos(a1) * holeRadius;
      const hy1 = Math.sin(a1) * holeRadius;
      // Inner wall — normals point inward.
      push([hx0, hy0, 0], [hx1, hy1, height], [hx1, hy1, 0]);
      push([hx0, hy0, 0], [hx0, hy0, height], [hx1, hy1, height]);
      // Bottom annulus (outer ring – hole).
      push([x0, y0, 0], [hx1, hy1, 0], [x1, y1, 0]);
      push([x0, y0, 0], [hx0, hy0, 0], [hx1, hy1, 0]);
      // Top annulus.
      push([x0, y0, height], [x1, y1, height], [hx1, hy1, height]);
      push([x0, y0, height], [hx1, hy1, height], [hx0, hy0, height]);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Build a regular N-gon prism centered on the origin. Same triangulation
 * pattern as the cylinder but with fewer segments to test sharp corners.
 */
export function buildNGonPrism(sides: number, radius: number, height: number): Geometry {
  return buildCylinder(radius, height, sides);
}

/**
 * Build a cross-shaped prism (an axis-aligned + sign with 4 arms). Has
 * 12 vertices on the bottom + 12 on top, and is non-convex. Good for
 * testing concave-shape preservation through the slicer.
 */
export function buildCrossPrism(armLength: number, armWidth: number, height: number): Geometry {
  const a = armLength;
  const w = armWidth / 2;
  // 12-vertex outline of a "+" sign (CCW when viewed from above).
  const outline: Array<[number, number]> = [
    [-w, -a], [w, -a], [w, -w], [a, -w],
    [a, w], [w, w], [w, a], [-w, a],
    [-w, w], [-a, w], [-a, -w], [-w, -w],
  ];

  const positions: number[] = [];
  const push = (...pts: Array<[number, number, number]>) => {
    for (const p of pts) positions.push(...p);
  };

  // Top face — fan-triangulate from the centroid (0,0).
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    push([0, 0, height], [x0, y0, height], [x1, y1, height]);   // top
    push([0, 0, 0], [x1, y1, 0], [x0, y0, 0]);                 // bottom (CW)
    // Side walls
    push([x0, y0, 0], [x1, y1, 0], [x1, y1, height]);
    push([x0, y0, 0], [x1, y1, height], [x0, y0, height]);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Build a box with a centered hole going all the way through. The hole
 * is a square of side `holeSize` centered on the XY origin.
 */
export function buildBoxWithHole(
  sx: number, sy: number, sz: number,
  holeSize: number,
): Geometry {
  const hx = sx / 2, hy = sy / 2, hh = holeSize / 2;
  const positions: number[] = [];
  const v = (x: number, y: number, z: number) => [x, y, z];
  const push = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);

  // Outer corners
  const o00 = v(-hx, -hy, 0), o10 = v(hx, -hy, 0), o11 = v(hx, hy, 0), o01 = v(-hx, hy, 0);
  const t00 = v(-hx, -hy, sz), t10 = v(hx, -hy, sz), t11 = v(hx, hy, sz), t01 = v(-hx, hy, sz);
  // Hole corners
  const h00 = v(-hh, -hh, 0), h10 = v(hh, -hh, 0), h11 = v(hh, hh, 0), h01 = v(-hh, hh, 0);
  const ht00 = v(-hh, -hh, sz), ht10 = v(hh, -hh, sz), ht11 = v(hh, hh, sz), ht01 = v(-hh, hh, sz);

  // Outer side walls
  push(o00, o10, t10); push(o00, t10, t00);  // front
  push(o10, o11, t11); push(o10, t11, t10);  // right
  push(o11, o01, t01); push(o11, t01, t11);  // back
  push(o01, o00, t00); push(o01, t00, t01);  // left

  // Hole side walls (inward-facing — flip winding)
  push(h00, h01, ht01); push(h00, ht01, ht00);
  push(h01, h11, ht11); push(h01, ht11, ht01);
  push(h11, h10, ht10); push(h11, ht10, ht11);
  push(h10, h00, ht00); push(h10, ht00, ht10);

  // Bottom face: 4 trapezoids around the hole
  // Front strip (y in [-hy, -hh])
  push(o00, h10, h00); push(o00, o10, h10);
  // Right strip (x in [hh, hx])
  push(o10, h11, h10); push(o10, o11, h11);
  // Back strip (y in [hh, hy])
  push(o11, h01, h11); push(o11, o01, h01);
  // Left strip (x in [-hx, -hh])
  push(o01, h00, h01); push(o01, o00, h00);

  // Top face — same trapezoids reversed.
  push(t00, h00, h10); push(t00, h10, t10);
  push(t10, h10, h11); push(t10, h11, t11);
  push(t11, h11, h01); push(t11, h01, t01);
  push(t01, h01, h00); push(t01, h00, t00);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Standard slicer factory. Tests opt into wallGenerator: 'classic' so
 * results are deterministic across libArachne version bumps.
 */
export function makeSlicer(overrides: Record<string, unknown> = {}): Slicer {
  const printer = {
    ...DEFAULT_PRINTER_PROFILES.find((p) => p.id === 'marlin-generic')!,
    buildVolume: { x: 200, y: 200, z: 200 },
  };
  const material = DEFAULT_MATERIAL_PROFILES[0];
  const print = {
    ...DEFAULT_PRINT_PROFILES[0],
    adhesionType: 'none' as const,
    parallelLayerPreparation: false,
    wallGenerator: 'classic' as const,
    wallCount: 1,
    wallLineWidth: 0.4,
    layerHeight: 0.2,
    horizontalExpansion: 0,
    initialLayerHorizontalExpansion: 0,
    elephantFootCompensation: 0,
    ...overrides,
  };
  return new Slicer(printer, material, print);
}

export async function sliceGeometry(
  geom: Geometry,
  overrides: Record<string, unknown> = {},
): Promise<SliceResult> {
  return makeSlicer(overrides).slice([{ geometry: geom, transform: new THREE.Matrix4() }]);
}

export function bboxFromMoves(moves: ReadonlyArray<MoveLike>, types?: string[]): BBox2D {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const filter = types ? new Set(types) : null;
  for (const move of moves) {
    if (filter && !filter.has(move.type)) continue;
    minX = Math.min(minX, move.from.x, move.to.x);
    maxX = Math.max(maxX, move.from.x, move.to.x);
    minY = Math.min(minY, move.from.y, move.to.y);
    maxY = Math.max(maxY, move.from.y, move.to.y);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/** Sum of XY length across a list of moves. */
export function totalLength(moves: ReadonlyArray<MoveLike>): number {
  let total = 0;
  for (const m of moves) {
    total += Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
  }
  return total;
}

export function wallMoves(layer: SliceResult['layers'][number]): MoveLike[] {
  return layer.moves.filter((m) =>
    m.type === 'wall-outer' || m.type === 'wall-inner',
  ) as MoveLike[];
}

export function outerWallMoves(layer: SliceResult['layers'][number]): MoveLike[] {
  return layer.moves.filter((m) => m.type === 'wall-outer') as MoveLike[];
}
