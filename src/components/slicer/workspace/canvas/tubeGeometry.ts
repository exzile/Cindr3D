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

/** Polygon-to-curve subdivision factor for the chain tube. Each polygon
 *  segment is sampled at this many additional points using a centripetal
 *  Catmull-Rom curve through the polygon vertices. Higher = smoother tubes
 *  on circular features (eliminates the per-vertex "tab" pattern caused by
 *  abrupt tangent changes at polygon corners) at the cost of more triangles
 *  per chain. 3 sub-points per segment turns an 18-vertex hexagon-like
 *  polygon into a 54-point smooth curve.
 *
 *  We only subdivide when the chain has more than 4 points AND its average
 *  segment length is shorter than 1.5×lw (i.e. it's a curve approximation,
 *  not a sparse polygon with intentional sharp corners). Sharp-cornered
 *  shapes (rectangles, slot ends) are NOT subdivided because Catmull-Rom
 *  rounds their corners off. */
const TUBE_SUBDIVISION_FACTOR = 3;
// Min 3 — even tiny 3-vertex chains (small thread peaks, gap-fill stubs) get
// smoothed. Catmull-Rom needs at least 3 control points to make a curve, so
// this is the floor.
const TUBE_SUBDIVISION_MIN_POINTS = 3;
// Allow longer-segment polygons (up to 3 × lw avg segment) — for a 0.45 mm
// line width that's 1.35 mm, which is around the segment length our slicer
// produces for short curve approximations. Larger ratios let real polygon
// corners (rectangles, slot ends) get rounded off, which we don't want, so
// 3 is a safe upper bound that still catches subdivided arcs.
const TUBE_SUBDIVISION_LW_RATIO = 3;

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
const OPEN_WALL_END_TRIM_FACTOR = 0.18;

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
/** Decide whether to subdivide a chain. Subdivision smooths circular features
 *  (eliminates the per-vertex tab pattern) but rounds off sharp polygon
 *  corners. We only subdivide chains that look like curve approximations:
 *  enough points AND short average segment relative to lineWidth. */
function shouldSubdivide(chain: TubeChain): boolean {
  if (chain.points.length < TUBE_SUBDIVISION_MIN_POINTS) return false;
  let totalLen = 0;
  let count = 0;
  for (let i = 0; i < chain.points.length - 1; i++) {
    totalLen += Math.hypot(
      chain.points[i + 1].x - chain.points[i].x,
      chain.points[i + 1].y - chain.points[i].y,
    );
    count++;
  }
  if (chain.isClosed && chain.points.length > 1) {
    const last = chain.points[chain.points.length - 1];
    const first = chain.points[0];
    totalLen += Math.hypot(first.x - last.x, first.y - last.y);
    count++;
  }
  if (count === 0) return false;
  const avgLen = totalLen / count;
  // Pick an average lw across the chain.
  let avgLw = 0;
  for (const p of chain.points) avgLw += p.lw;
  avgLw /= chain.points.length;
  return avgLen < avgLw * TUBE_SUBDIVISION_LW_RATIO;
}

/** Subdivide a chain via centripetal Catmull-Rom interpolation. Each polygon
 *  segment gets `TUBE_SUBDIVISION_FACTOR` extra in-between sample points,
 *  with line widths and colours linearly interpolated. The result is a much
 *  smoother polyline that the existing tube builder turns into a clean
 *  swept tube without per-vertex tabs.
 *
 *  Catmull-Rom rounds off sharp corners — we only call this on chains that
 *  passed `shouldSubdivide`, which excludes shapes with sparse vertices. */
function subdivideChain(chain: TubeChain): TubeChain {
  const n = chain.points.length;
  const pts = chain.points.map((p) => new THREE.Vector3(p.x, p.y, 0));
  const curve = new THREE.CatmullRomCurve3(pts, chain.isClosed, 'centripetal');
  const segCount = chain.isClosed ? n : n - 1;
  const totalSamples = segCount * TUBE_SUBDIVISION_FACTOR + (chain.isClosed ? 0 : 1);
  const sampledPoints: TubeChain['points'] = [];
  const sampledSegColors: TubeChain['segColors'] = [];
  const sampledMoveRefs: TubeChain['moveRefs'] = [];
  // Sample TUBE_SUBDIVISION_FACTOR sub-points per polygon segment. For each
  // sub-point, find which original segment it belongs to and interpolate
  // the line width / colour / hover ref from that segment.
  for (let i = 0; i < totalSamples; i++) {
    const tGlobal = chain.isClosed
      ? (i / totalSamples)
      : (i / (totalSamples - 1));
    const idxFloat = tGlobal * segCount;
    const segIdx = Math.min(segCount - 1, Math.floor(idxFloat));
    const segFrac = Math.min(1, Math.max(0, idxFloat - segIdx));
    const pt = curve.getPoint(tGlobal);
    const fromIdx = segIdx;
    const toIdx = (segIdx + 1) % n;
    const fromLw = chain.points[fromIdx].lw;
    const toLw = chain.points[toIdx].lw;
    const lw = fromLw * (1 - segFrac) + toLw * segFrac;
    sampledPoints.push({ x: pt.x, y: pt.y, lw });
    // Sub-points within the same polygon segment share the segment's colour
    // and move ref. We emit one sample per (sub-position, segment) pair.
    if (i < totalSamples - (chain.isClosed ? 0 : 1)) {
      const segColor = chain.segColors[segIdx] ?? chain.segColors[chain.segColors.length - 1];
      const segRef = chain.moveRefs[segIdx] ?? chain.moveRefs[chain.moveRefs.length - 1];
      sampledSegColors.push(segColor);
      sampledMoveRefs.push(segRef);
    }
  }
  return {
    type: chain.type,
    points: sampledPoints,
    segColors: sampledSegColors,
    moveRefs: sampledMoveRefs,
    isClosed: chain.isClosed,
  };
}

function isWallType(type: string): boolean {
  return type === 'wall-outer' || type === 'wall-inner';
}

export function buildChainTube(
  chain: TubeChain,
  layerHeight: number,
  baseZ: number,
): THREE.BufferGeometry | null {
  // Smooth circular-feature chains via Catmull-Rom subdivision before
  // building the tube. This removes the per-vertex "tab" pattern caused by
  // abrupt tangent changes at polygon corners — the issue OrcaSlicer hides
  // by using Arachne variable-width walls (which we don't have), and we
  // hide by rendering the polygon as a smooth interpolated curve.
  const sourceChain: TubeChain = shouldSubdivide(chain) ? subdivideChain(chain) : chain;
  const n = sourceChain.points.length;
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
    if (i > 0) inDir = dir(sourceChain.points[i - 1], sourceChain.points[i]);
    else if (sourceChain.isClosed) inDir = dir(sourceChain.points[n - 1], sourceChain.points[0]);

    let outDir: Vec2 | null = null;
    if (i < n - 1) outDir = dir(sourceChain.points[i], sourceChain.points[i + 1]);
    else if (sourceChain.isClosed) outDir = dir(sourceChain.points[n - 1], sourceChain.points[0]);

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
  const trim = !sourceChain.isClosed && (TRIMMED_FILL_TYPES.has(sourceChain.type) || isWallType(sourceChain.type));
  const trimFactor = TRIMMED_FILL_TYPES.has(sourceChain.type) ? FILL_END_TRIM_FACTOR : OPEN_WALL_END_TRIM_FACTOR;
  const pts = sourceChain.points.map((p) => ({ x: p.x, y: p.y, lw: p.lw }));
  if (trim && n >= 2) {
    const d0 = dir(sourceChain.points[0], sourceChain.points[1]);
    if (d0) {
      const req = sourceChain.points[0].lw * trimFactor;
      const segLen = Math.hypot(
        sourceChain.points[1].x - sourceChain.points[0].x,
        sourceChain.points[1].y - sourceChain.points[0].y,
      );
      const t = Math.min(req, segLen * 0.4);
      pts[0].x = sourceChain.points[0].x + d0.x * t;
      pts[0].y = sourceChain.points[0].y + d0.y * t;
    }
    const dn = dir(sourceChain.points[n - 2], sourceChain.points[n - 1]);
    if (dn) {
      const req = sourceChain.points[n - 1].lw * trimFactor;
      const segLen = Math.hypot(
        sourceChain.points[n - 1].x - sourceChain.points[n - 2].x,
        sourceChain.points[n - 1].y - sourceChain.points[n - 2].y,
      );
      const t = Math.min(req, segLen * 0.4);
      pts[n - 1].x = sourceChain.points[n - 1].x - dn.x * t;
      pts[n - 1].y = sourceChain.points[n - 1].y - dn.y * t;
    }
  }

  // Step 3: per-RING colour = avg of adjacent segment colours for smooth
  // transitions.
  const segN = sourceChain.segColors.length;
  const ringColor = (ringIdx: number): [number, number, number] => {
    if (sourceChain.isClosed) {
      const prev = (ringIdx - 1 + segN) % segN;
      const curr = ringIdx % segN;
      const cp = sourceChain.segColors[prev];
      const cc = sourceChain.segColors[curr];
      return [(cp[0] + cc[0]) * 0.5, (cp[1] + cc[1]) * 0.5, (cp[2] + cc[2]) * 0.5];
    }
    if (ringIdx === 0) return sourceChain.segColors[0];
    if (ringIdx >= segN) return sourceChain.segColors[segN - 1];
    const cp = sourceChain.segColors[ringIdx - 1];
    const cc = sourceChain.segColors[ringIdx];
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
  const loopCount = sourceChain.isClosed ? n : n - 1;
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

  // Step 6: pointed pyramid end caps for OPEN chains. Without these,
  // an open tube (infill scanline, top/bottom skin line, gap-fill bead,
  // bridge) ends in a FLAT disk that visually "pokes" past adjacent
  // walls when the slicer applies infill/skin overlap (the deliberate
  // few-tens-of-microns of bonding between fill and walls).
  //
  // Cura, OrcaSlicer, and PrusaSlicer all cap their open extrusion tube
  // ends with a SINGLE forward-displaced apex vertex fanned to the
  // cross-section ring (a flat-sided pyramid) — see
  //   • Cura `plugins/SimulationView/layers3d.shader` (geometry41core)
  //   • OrcaSlicer `src/libvgcode/src/SegmentTemplate.cpp` (vertices
  //     2 and 7 are the "POINTY_CAPS" apexes)
  //   • PrusaSlicer `src/slic3r/GUI/LibVGCode/` (vendored libvgcode).
  //
  // The apex sits one halfWidth past the tube end along the line's own
  // direction. This costs RADIAL triangles per cap (8 with our default)
  // — much cheaper than a hemisphere and visually identical at preview
  // scale because the cap is only ever ~halfWidth long.
  //
  // Closed chains never need caps (they wrap onto themselves). Walls
  // are already trimmed back via OPEN_WALL_END_TRIM_FACTOR.
  if (!sourceChain.isClosed && n >= 2) {
    appendApexCap(positions, normals, colors, indices, {
      isStart: true,
      anchorRingStart: 0,
      tipPoint: pts[0],
      tangent: dir(pts[0], pts[1]),
      lw: pts[0].lw * miterX[0],
      radial: RADIAL,
      ringColor: ringColor(0),
      centerZ,
    });
    appendApexCap(positions, normals, colors, indices, {
      isStart: false,
      anchorRingStart: (n - 1) * ringSize,
      tipPoint: pts[n - 1],
      tangent: dir(pts[n - 2], pts[n - 1]),
      lw: pts[n - 1].lw * miterX[n - 1],
      radial: RADIAL,
      ringColor: ringColor(n - 1),
      centerZ,
    });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

interface ApexCapParams {
  /** True for the start of the chain (cap extends in -tangent direction
   *  away from the chain interior); false for the end (cap extends in
   *  +tangent direction). */
  isStart: boolean;
  /** Index of the first vertex of the anchor ring in the global
   *  `positions` buffer. */
  anchorRingStart: number;
  tipPoint: { x: number; y: number };
  tangent: { x: number; y: number } | null;
  /** Effective half-bead-width at this end (already miter-scaled). */
  lw: number;
  radial: number;
  ringColor: [number, number, number];
  centerZ: number;
}

/**
 * Append a Cura/Orca/Prusa-style pointed pyramid cap to the tube
 * geometry. One apex vertex sits `halfWidth` past the tube's open end
 * along the line's own direction; `radial` triangles fan from the apex
 * to consecutive cross-section ring vertices.
 *
 * Mirrors:
 *   • Cura layers3d geometry shader's apex displacement
 *     (`g_vertex_offset_horz_head`, single point, RADIAL=4 base).
 *   • OrcaSlicer SegmentTemplate vertices 2 and 7 (POINTY_CAPS).
 *   • PrusaSlicer libvgcode (vendored).
 *
 * Looks identical at preview scale to a hemisphere but with an order
 * of magnitude fewer triangles — and matches the visual language users
 * expect from Cura/Orca/Prusa.
 */
function appendApexCap(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  p: ApexCapParams,
): void {
  if (!p.tangent) return;
  const hExt = p.lw / 2;
  // Direction the apex displaces from the anchor-ring centre. Start
  // caps reach BACKWARD past the chain's first point; end caps reach
  // forward past the last point.
  const sgn = p.isStart ? -1 : +1;
  const tx = p.tangent.x * sgn;
  const ty = p.tangent.y * sgn;

  const apexIndex = positions.length / 3;
  const ax = p.tipPoint.x + tx * hExt;
  const ay = p.tipPoint.y + ty * hExt;
  const az = p.centerZ;
  positions.push(ax, ay, az);
  // Apex normal points along the tangent axis — gives the cap a soft
  // shaded tip when lit from above.
  normals.push(tx, ty, 0);
  colors.push(p.ringColor[0], p.ringColor[1], p.ringColor[2]);

  // Fan triangles from the apex to each consecutive pair of ring
  // vertices. ringSize includes a duplicate seam vertex (r = 0 and
  // r = RADIAL coincide), so we iterate r in [0, RADIAL) and connect
  // (r, r+1) which covers the full circumference.
  for (let r = 0; r < p.radial; r++) {
    const a = p.anchorRingStart + r;
    const b = p.anchorRingStart + r + 1;
    if (p.isStart) {
      // Start cap: apex is BEFORE the anchor ring along the chain
      // direction, so reverse winding to keep the cap normals facing
      // outward.
      indices.push(apexIndex, a, b);
    } else {
      indices.push(apexIndex, b, a);
    }
  }
}
