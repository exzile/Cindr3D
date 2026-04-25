import * as THREE from 'three';
import type { TubeChain } from '../../../../types/slicer-preview.types';

// ---------------------------------------------------------------------------
// Extrusion-tube rendering primitives
// ---------------------------------------------------------------------------
//
// A real 3D print is continuous extrusion — as the nozzle moves along the
// g-code path the plastic forms an unbroken tube. Rendering each segment as
// an independent cylinder never looks right: flat cylinder ends at every chain
// interior form visible discontinuities, and across many layers those
// discontinuities stack into bead-column patterns on cylindrical features.
//
// Instead we group consecutive extrusion moves of the same type whose
// endpoints chain together into a "chain" (a continuous polyline) and build
// a single tube BufferGeometry per chain with MITERED joints — at every
// interior vertex the tube's cross-section rotates into the bisector of the
// incoming and outgoing segments, so adjacent segments share one vertex ring
// and there is NO visible discontinuity. This matches how Cura, OrcaSlicer,
// and PrusaSlicer render their g-code preview.

/** Cross-section resolution for each chain tube. 8 radial segments gives a
 *  smooth elliptical tube without exploding triangle count (RADIAL × 2
 *  triangles per segment; typical layer ~1000 segments → ~16k triangles). */
export const TUBE_RADIAL_SEGMENTS = 8;

/** Miter scaling clamp. Set to 1.0 (no miter stretching at all).
 *
 *  Why not miter? Wall-inner and wall-outer are centred exactly one line-width
 *  apart, so their perpendicular envelopes are flush — wall-inner's outer
 *  edge touches wall-outer's inner edge at every point. ANY miter stretch
 *  (1/cos(β/2) > 1) pushes wall-inner's tube past wall-outer's inner edge
 *  and the inner wall's colour shows through the outer wall as visible
 *  streaks at polygon vertices. Even a 30° bend gives 1.035× stretch, which
 *  is enough to show when stacked across 100+ layers.
 *
 *  With MITER_MAX = 1.0 each vertex ring has radius exactly lw/2. At gentle
 *  bends the tube has a sub-0.03 mm empty wedge at the outer corner — far
 *  below one pixel at normal viewing — and tube walls NEVER poke into their
 *  neighbour. Sharp bends (> 60°) are already handled by chain-splitting in
 *  GCodeTubePreview, so they never enter the miter path at all. */
const MITER_MAX = 1.0;

/** Visual end-trim for fill-type tubes. The slicer intentionally extends
 *  infill and top-bottom lines slightly into the inner wall
 *  (infillWallOverlap) so the real print bonds well — but in the preview
 *  those stubs poke past the green wall and read as fill bleeding through.
 *  Trimming each *un-shared* fill endpoint by a fraction of the bead width
 *  pulls the tube end back to the wall's inner edge without affecting the
 *  stored g-code. Only types in this set are trimmed; walls keep their full
 *  g-code length so the visible wall ring stays exact. */
export const TRIMMED_FILL_TYPES = new Set(['infill', 'top-bottom', 'bridge', 'ironing']);
const FILL_END_TRIM_FACTOR = 0.5;

/** Shared material for the extrusion-tube meshes. `vertexColors: true` lets
 *  each chain carry per-point colours via its BufferGeometry's colour
 *  attribute (used by the speed / flow / width / layer-time modes). Tagged
 *  `shared` so the disposal path in LayerLines skips it. */
export const TUBE_MATERIAL = Object.assign(
  new THREE.MeshLambertMaterial({ vertexColors: true }),
  { userData: { shared: true } },
);

/**
 * Build an elliptical-cross-section mitered tube BufferGeometry for a chain.
 * `layerHeight` is the vertical extent of the bead (Z). `baseZ` is the layer
 * top Z. Returns null for chains that can't form a tube (< 2 points).
 */
export function buildChainTube(
  chain: TubeChain,
  layerHeight: number,
  baseZ: number,
): THREE.BufferGeometry | null {
  const n = chain.points.length;
  if (n < 2) return null;

  const RADIAL = TUBE_RADIAL_SEGMENTS;
  const ringSize = RADIAL + 1;         // duplicate vertex to avoid seam artefacts
  const vExt = layerHeight / 2;
  const centerZ = baseZ - vExt;

  type Vec2 = { x: number; y: number };
  const tangents: Vec2[] = new Array(n);
  const perps: Vec2[] = new Array(n);
  const miterX: number[] = new Array(n);

  const dir = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): Vec2 | null => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) return null;
    return { x: dx / l, y: dy / l };
  };

  // Step 1: per-vertex tangent (bisector of in/out dirs) + miter compensation.
  // Miter = 1 / cos(β/2) stretches the perpendicular axis so adjacent tube
  // segments meet flush at the bisector plane (no flat-end gap at the corner).
  for (let i = 0; i < n; i++) {
    let inDir: Vec2 | null = null;
    if (i > 0) inDir = dir(chain.points[i - 1], chain.points[i]);
    else if (chain.isClosed) inDir = dir(chain.points[n - 1], chain.points[0]);

    let outDir: Vec2 | null = null;
    if (i < n - 1) outDir = dir(chain.points[i], chain.points[i + 1]);
    else if (chain.isClosed) outDir = dir(chain.points[n - 1], chain.points[0]);

    const ix = inDir?.x ?? 0, iy = inDir?.y ?? 0;
    const ox = outDir?.x ?? 0, oy = outDir?.y ?? 0;
    let tx = ix + ox, ty = iy + oy;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-6) {
      // in/out exactly oppose (180° U-turn) — fall back to either dir alone.
      tx = (ix !== 0 || iy !== 0) ? ix : ox;
      ty = (ix !== 0 || iy !== 0) ? iy : oy;
      const tl2 = Math.hypot(tx, ty) || 1;
      tangents[i] = { x: tx / tl2, y: ty / tl2 };
    } else {
      tangents[i] = { x: tx / tl, y: ty / tl };
    }
    perps[i] = { x: -tangents[i].y, y: tangents[i].x };

    let miter = 1;
    if (inDir && outDir) {
      const dotInOut = ix * ox + iy * oy;
      const cosHalf = Math.sqrt(Math.max(0.01, (1 + dotInOut) / 2));
      miter = Math.min(MITER_MAX, 1 / cosHalf);
    }
    miterX[i] = miter;
  }

  // Step 2: apply fill-end trim on open chain ends for fill-type chains.
  const trim = !chain.isClosed && TRIMMED_FILL_TYPES.has(chain.type);
  const pts = chain.points.map((p) => ({ x: p.x, y: p.y, lw: p.lw }));
  if (trim && n >= 2) {
    const d0 = dir(chain.points[0], chain.points[1]);
    if (d0) {
      const req = chain.points[0].lw * FILL_END_TRIM_FACTOR;
      const segLen = Math.hypot(
        chain.points[1].x - chain.points[0].x,
        chain.points[1].y - chain.points[0].y,
      );
      const t = Math.min(req, segLen * 0.4);
      pts[0].x = chain.points[0].x + d0.x * t;
      pts[0].y = chain.points[0].y + d0.y * t;
    }
    const dn = dir(chain.points[n - 2], chain.points[n - 1]);
    if (dn) {
      const req = chain.points[n - 1].lw * FILL_END_TRIM_FACTOR;
      const segLen = Math.hypot(
        chain.points[n - 1].x - chain.points[n - 2].x,
        chain.points[n - 1].y - chain.points[n - 2].y,
      );
      const t = Math.min(req, segLen * 0.4);
      pts[n - 1].x = chain.points[n - 1].x - dn.x * t;
      pts[n - 1].y = chain.points[n - 1].y - dn.y * t;
    }
  }

  // Step 3: per-RING colour = avg of adjacent segment colours for smooth
  // transitions.
  const segN = chain.segColors.length;
  const ringColor = (ringIdx: number): [number, number, number] => {
    if (chain.isClosed) {
      const prev = (ringIdx - 1 + segN) % segN;
      const curr = ringIdx % segN;
      const cp = chain.segColors[prev];
      const cc = chain.segColors[curr];
      return [(cp[0] + cc[0]) * 0.5, (cp[1] + cc[1]) * 0.5, (cp[2] + cc[2]) * 0.5];
    }
    if (ringIdx === 0) return chain.segColors[0];
    if (ringIdx >= segN) return chain.segColors[segN - 1];
    const cp = chain.segColors[ringIdx - 1];
    const cc = chain.segColors[ringIdx];
    return [(cp[0] + cc[0]) * 0.5, (cp[1] + cc[1]) * 0.5, (cp[2] + cc[2]) * 0.5];
  };

  // Step 4: build vertex rings.
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const perp = perps[i];
    const hExt = (p.lw / 2) * miterX[i];
    const [cr, cg, cb] = ringColor(i);

    for (let r = 0; r <= RADIAL; r++) {
      const angle = (r / RADIAL) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      positions.push(
        p.x + cosA * perp.x * hExt,
        p.y + cosA * perp.y * hExt,
        centerZ + sinA * vExt,
      );
      // Outward radial normal (not miter-scaled — lighting stays round).
      normals.push(cosA * perp.x, cosA * perp.y, sinA);
      colors.push(cr, cg, cb);
    }
  }

  // Step 5: index triangles connecting adjacent rings. Closed chains wrap.
  const indices: number[] = [];
  const loopCount = chain.isClosed ? n : n - 1;
  for (let i = 0; i < loopCount; i++) {
    const iNext = (i + 1) % n;
    for (let r = 0; r < RADIAL; r++) {
      const a = i * ringSize + r;
      const b = i * ringSize + r + 1;
      const c = iNext * ringSize + r;
      const d = iNext * ringSize + r + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}
