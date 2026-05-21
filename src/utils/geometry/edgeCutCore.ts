/**
 * Shared edge-cut core.
 *
 * Fillet and chamfer are the same operation up to the shape of the per-edge
 * cutting tool: pick edges on a triangulated solid, resolve each edge to its
 * two adjacent faces, build a "corner sliver" cutter, and CSG-subtract it.
 * Only the cutter differs (fillet = prism − cylinder; chamfer = triangular
 * wedge prism). Everything else — edge-ID parsing, edge→face resolution,
 * gizmo direction, the CSG driver loop and its degeneracy/empty guards — is
 * identical and lives here so both tools (and their live previews) share one
 * battle-tested implementation.
 */
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { liveBodyMeshes } from '../../store/meshRegistry';
import { weldAndCleanSolid } from '../../engine/geometryEngine/core/solid/weldClean';
export { weldAndCleanSolid } from '../../engine/geometryEngine/core/solid/weldClean';
import {
  csgSubtract as csgSubtractRaw,
  csgSubtractWithTopology,
} from '../../engine/geometryEngine/core/solid/csg';
import { extractEdgeTopology, type BodyTopology, type ModelEdge } from '../../engine/geometryEngine/core/solid/edgeTopology';
import { modelEdgeId } from '../../engine/geometryEngine/core/solid/edgeId';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PickedEdge {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

export interface ParsedEdges {
  /** The featureId prefix from the edge ID, or null for legacy IDs. */
  featureId: string | null;
  /** THREE.js mesh UUID encoded in the edge ID. */
  meshUuid: string;
  /** World-space edge endpoints. */
  edges: PickedEdge[];
}

export interface ResolvedEdge {
  a: THREE.Vector3;
  b: THREE.Vector3;
  edgeDir: THREE.Vector3;
  length: number;
  /** Unit in-face perpendicular into face 1 (⟂ edge, away from edge). */
  u1: THREE.Vector3;
  /** Unit in-face perpendicular into face 2. */
  u2: THREE.Vector3;
}

/**
 * Builds the cutting tool for one resolved edge. `eps` is a small overhang to
 * add past the edge ends so the boolean is clean without notching adjacent
 * faces. Returns null for degenerate edges (the driver skips them).
 */
export type EdgeCutterFn = (re: ResolvedEdge, eps: number) => THREE.BufferGeometry | null;

/**
 * Builds ONE analytic cutting tool for a full circular-rim edge loop (fillet
 * torus / chamfer cone frustum). `re` is a representative resolved edge from
 * the loop, used only for orientation (which face is the cap vs the wall and
 * the dihedral angle). Returns null if the loop can't be handled analytically
 * (caller then falls back to the per-segment path).
 */
export type LoopCutterFn = (
  circle: EdgeLoopCircle,
  re: ResolvedEdge,
) => THREE.BufferGeometry | null;

/** Options bag for computeEdgeCutGeometry (all optional for backwards compat). */
export interface EdgeCutOptions {
  /** When true, expand the selected edges along tangent-continuous chains before cutting. */
  propagate?: boolean;
  /**
   * When set, CSG-subtract a sphere of this radius at each vertex where
   * 3 or more selected edges meet (rolling-ball corner blend).
   */
  cornerRadius?: number;
  /**
   * When set, called at each vertex where exactly 2 per-segment edges meet to
   * build a miter-corner CSG cutter. Used by the chamfer miter corner type
   * (ChamferCornerType === 'miter'). The two resolved edges (reA, reB) share
   * the given vertex; the callback builds a convex-hull wedge that fills the
   * gap between the two bevel faces at the corner intersection line.
   * Returns null to skip the corner (degenerate geometry).
   */
  makeMiterCornerCutter?: (
    vertex: THREE.Vector3,
    reA: ResolvedEdge,
    reB: ResolvedEdge,
    eps: number,
  ) => THREE.BufferGeometry | null;
}

// ---------------------------------------------------------------------------
// Edge-ID parsing
// ---------------------------------------------------------------------------

/**
 * Parses picked edge IDs from the store and returns the edges to cut, grouped
 * onto the single physical body the user is targeting.
 *
 * Edge ID format:
 *   `${featureId}|${meshUuid}:${ax,ay,az}:${bx,by,bz}`  (new)
 *   `${meshUuid}:${ax,ay,az}:${bx,by,bz}`               (legacy)
 *
 * Grouping is keyed STRICTLY by the embedded `meshUuid` — stable for a given
 * THREE.Mesh's lifetime — never by the `featureId` prefix. That prefix is
 * volatile: an edge picked before R3F's `onUpdate` sets
 * `mesh.userData.featureId` comes back as a legacy prefix-less ID, while a
 * later pick on the SAME mesh gets the `${featureId}|` prefix. The old code
 * keyed on `featureId ?? meshUuid`, which split those two picks into separate
 * groups, then returned only the largest group — SILENTLY DROPPING the
 * minority. That is the "have to select, deselect, then select again to
 * chamfer" bug: the dropped edge only takes effect once re-picked with a
 * prefix that happens to match the surviving group. Keying on meshUuid keeps
 * every edge on one body together regardless of prefix drift, so N picked
 * edges yield N parsed edges.
 */
export function parseEdgeIds(edgeIds: string[]): ParsedEdges | null {
  const byMesh = new Map<string, ParsedEdges>();

  for (const id of edgeIds) {
    let featureId: string | null = null;
    let rest = id;
    const pipeIdx = id.indexOf('|');
    if (pipeIdx > 0) { featureId = id.slice(0, pipeIdx); rest = id.slice(pipeIdx + 1); }
    const parts = rest.split(':');
    if (parts.length < 3) continue;
    const meshUuid = parts[0];
    // parts[1..] is an ordered point list. A legacy/segment id has exactly 2
    // points → 1 edge. A FULL model-edge "chain" id has N points → N-1
    // consecutive segments (the whole box edge / hole-rim loop). Decoding the
    // chain into its segments means the cut pipeline chamfers the ENTIRE edge.
    const pts: THREE.Vector3[] = [];
    let parseOk = true;
    for (let pi = 1; pi < parts.length; pi++) {
      // Parse each "x,y,z" coord directly via two indexOf splits instead of
      // `split(',').map(Number).some(...)`. Avoids two transient arrays per
      // point on multi-point chain IDs — circle-rim selections arrive with
      // 30+ points per ID, so this matters when the user picks several.
      const seg = parts[pi];
      const c1 = seg.indexOf(',');
      const c2 = c1 < 0 ? -1 : seg.indexOf(',', c1 + 1);
      if (c2 < 0) { parseOk = false; break; }
      const x = +seg.slice(0, c1);
      const y = +seg.slice(c1 + 1, c2);
      const z = +seg.slice(c2 + 1);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        parseOk = false;
        break;
      }
      pts.push(new THREE.Vector3(x, y, z));
    }
    if (!parseOk || pts.length < 2) continue;
    const segs: PickedEdge[] = [];
    for (let pi = 0; pi < pts.length - 1; pi++) {
      segs.push({ a: pts[pi], b: pts[pi + 1] });
    }
    const existing = byMesh.get(meshUuid);
    if (existing) {
      existing.edges.push(...segs);
      // Prefer a concrete featureId: applyEdgeCut resolves extrude/feature
      // bodies by feature id (the uuid fallback only works for mesh-backed
      // features), so a legacy null prefix must not shadow a real one picked
      // on the same mesh.
      if (existing.featureId === null && featureId !== null) existing.featureId = featureId;
    } else {
      byMesh.set(meshUuid, { featureId, meshUuid, edges: segs });
    }
  }

  if (byMesh.size === 0) return null;

  // Task 15: when the meshUuid is stale but we have a featureId, scan liveBodyMeshes
  // to find the mesh whose userData.featureId matches. This makes edge IDs survive
  // session reloads / mesh remounts where the THREE.js UUID changes but the
  // feature identity is preserved.
  for (const group of byMesh.values()) {
    if (!liveBodyMeshes.has(group.meshUuid) && group.featureId) {
      for (const [uuid, mesh] of liveBodyMeshes.entries()) {
        if ((mesh.userData?.featureId as string | undefined) === group.featureId) {
          // Remap to the current live UUID so the commit path finds the mesh.
          byMesh.delete(group.meshUuid);
          group.meshUuid = uuid;
          byMesh.set(uuid, group);
          break;
        }
      }
    }
  }

  // Common case: every edge is on one physical body — return them all, no drop.
  if (byMesh.size === 1) return byMesh.values().next().value as ParsedEdges;

  // Genuinely ambiguous: edges span multiple distinct meshes. Prefer a group
  // whose mesh is still live (a stale uuid left over from a BodyMesh remount
  // is no longer in the registry); break remaining ties by edge count, first
  // insertion winning — preserving the previous deterministic behaviour.
  let target: ParsedEdges | null = null;
  let best = -1;
  for (const v of byMesh.values()) {
    const score = (liveBodyMeshes.has(v.meshUuid) ? 1e9 : 0) + v.edges.length;
    if (score > best) { best = score; target = v; }
  }
  return target;
}

/**
 * Cheap human-readable label for an edge ID — shown in the Fillet/Chamfer
 * dialogs' selected-edges list. Decodes ONLY the first chord of the ID
 * (`parts[1]` → `parts[2]`), which is what the previous duplicated copies in
 * FilletDialog/ChamferDialog rendered; chained model edges would still show
 * their first chord's endpoints, matching the prior UI exactly. Falls back to
 * `Edge {n}` on any parse failure.
 */
export function parseEdgeLabel(id: string, index: number): string {
  let rest = id;
  const pipe = id.indexOf('|');
  if (pipe > 0) rest = id.slice(pipe + 1);
  const parts = rest.split(':');
  if (parts.length < 3) return `Edge ${index + 1}`;
  const a = parts[1].split(',').map(Number);
  const b = parts[2].split(',').map(Number);
  if (a.length !== 3 || b.length !== 3) return `Edge ${index + 1}`;
  if (a.some((n) => !Number.isFinite(n)) || b.some((n) => !Number.isFinite(n))) return `Edge ${index + 1}`;
  const fmt = (n: number) => n.toFixed(1);
  return `Edge ${index + 1}  (${fmt(a[0])}, ${fmt(a[1])}, ${fmt(a[2])}) → (${fmt(b[0])}, ${fmt(b[1])}, ${fmt(b[2])})`;
}

// ---------------------------------------------------------------------------
// Triangle list + position tolerance
// ---------------------------------------------------------------------------

/**
 * Build a flat triangle list from a world-space geometry. The driver
 * (`computeEdgeCutGeometry`) still expects a NON-INDEXED `srcGeo` because the
 * CSG path operates on the cloned solid in non-indexed form, but read-only
 * consumers (`computeEdgeGizmoDir`) can pass an indexed `srcGeo` and skip the
 * caller-side `.clone().toNonIndexed()` — same triangles emitted either way.
 */
export function buildTriangleList(srcGeo: THREE.BufferGeometry): THREE.Vector3[][] {
  const pa = srcGeo.attributes.position.array as ArrayLike<number>;
  const idxAttr = srcGeo.index;
  const tris: THREE.Vector3[][] = [];
  if (idxAttr) {
    const ia = idxAttr.array as ArrayLike<number>;
    // BufferAttribute.count is items, not array length — same value for
    // itemSize=1 (the index attribute) but use the explicit count anyway in
    // case the underlying array carries spare capacity past `count`.
    const n = idxAttr.count;
    for (let i = 0; i < n; i += 3) {
      const i0 = ia[i] * 3, i1 = ia[i + 1] * 3, i2 = ia[i + 2] * 3;
      tris.push([
        new THREE.Vector3(pa[i0],     pa[i0 + 1], pa[i0 + 2]),
        new THREE.Vector3(pa[i1],     pa[i1 + 1], pa[i1 + 2]),
        new THREE.Vector3(pa[i2],     pa[i2 + 1], pa[i2 + 2]),
      ]);
    }
  } else {
    for (let i = 0; i < pa.length; i += 9) {
      tris.push([
        new THREE.Vector3(pa[i],     pa[i + 1], pa[i + 2]),
        new THREE.Vector3(pa[i + 3], pa[i + 4], pa[i + 5]),
        new THREE.Vector3(pa[i + 6], pa[i + 7], pa[i + 8]),
      ]);
    }
  }
  return tris;
}

/** Position tolerance scaled to the geometry's bounding-box diagonal. */
export function computePositionEps(srcGeo: THREE.BufferGeometry): number {
  // The render pipeline almost always has the bbox computed already (it needs
  // it for frustum culling); only recompute when actually missing. Avoids the
  // redundant O(N) recompute on every parsedAndClustered memo run.
  if (!srcGeo.boundingBox) srcGeo.computeBoundingBox();
  const diag = srcGeo.boundingBox
    ? srcGeo.boundingBox.min.distanceTo(srcGeo.boundingBox.max)
    : 1;
  return Math.max(diag * 1e-4, 1e-5);
}

/** Position-equality predicate scaled to the geometry's bounding-box diagonal. */
export function makeNear(srcGeo: THREE.BufferGeometry): (p: THREE.Vector3, q: THREE.Vector3) => boolean {
  const eps = computePositionEps(srcGeo);
  const epsSq = eps * eps;
  return (p: THREE.Vector3, q: THREE.Vector3) => p.distanceToSquared(q) <= epsSq;
}

// ---------------------------------------------------------------------------
// Spatial triangle index
//
// Maps quantized vertex positions to the set of triangle indices containing
// that position. Allows O(1) candidate lookup instead of O(n) full scan when
// resolving which triangles share a given edge endpoint. Critical for meshes
// with many small edges (e.g. circle rims with 30+ segments) where the O(n)
// scan over all tris makes each edge resolution prohibitively slow.
// ---------------------------------------------------------------------------

// Cell-key packing: hash (cx,cy,cz) into a single number so the spatial index
// can use a Map<number, number[]> instead of Map<string, number[]>. String
// concatenation per lookup was the dominant cost on circle-rim selections
// (~30-100+ vertex lookups per edge × 27 neighbours each). 21-bit signed cell
// indices give ±1M-cell range, more than enough for any tessellated model at
// our eps (diag·1e-4); collisions are NOT possible inside that range because
// each axis fits its own bit field.
const CELL_BITS = 21;
const CELL_MASK = (1 << CELL_BITS) - 1;
const CELL_BIAS = 1 << (CELL_BITS - 1); // bias to make negatives non-negative

// ---------------------------------------------------------------------------
// Per-srcGeo cache (tris + spatial index + eps)
//
// buildTriangleList + buildTriangleIndex + computePositionEps depend only on
// srcGeo's position attribute, which never changes for the lifetime of the
// non-indexed clone EdgeOpPreview caches. Without this WeakMap, every
// debounced preview tick (and every commit's gizmo + commit call chain)
// re-allocated ~3·tris Vector3 instances and ~3·tris Map entries from scratch.
// WeakMap auto-evicts when the source geometry is GC'd; no manual eviction
// required. The driver never mutates srcGeo (it clones for the cut solid),
// so the cache stays valid across calls.
// ---------------------------------------------------------------------------
interface SrcGeoCache {
  tris: THREE.Vector3[][];
  triIdx: Map<number, number[]>;
  eps: number;
  /**
   * Optional O(1) topology fast-path. Built from `srcGeo.userData.topology`
   * when available (bodies that went through `csgSubtractWithTopology`).
   * Key: `${packCell(ax)}|${packCell(bx)}` using eps-quantized endpoints in
   * BOTH directions so lookups succeed regardless of edge orientation.
   */
  topoMap?: Map<string, { u1: THREE.Vector3; u2: THREE.Vector3 }>;
}
const _srcGeoCache = new WeakMap<THREE.BufferGeometry, SrcGeoCache>();

function getOrBuildSrcCache(srcGeo: THREE.BufferGeometry): SrcGeoCache {
  let entry = _srcGeoCache.get(srcGeo);
  if (entry) return entry;
  const tris = buildTriangleList(srcGeo);
  const eps = computePositionEps(srcGeo);
  const triIdx = buildTriangleIndex(tris, eps);
  entry = { tris, triIdx, eps };

  // Build topoMap from pre-computed topology when present.
  const topo = (srcGeo.userData as { topology?: BodyTopology }).topology;
  if (topo?.edges?.length) {
    const inv = 1 / eps;
    const topoMap = new Map<string, { u1: THREE.Vector3; u2: THREE.Vector3 }>();
    for (const me of topo.edges) {
      if (!me.u1 || !me.u2 || me.polyline.length < 2) continue;
      // Use first and last points of the polyline as key anchors.
      const A = me.polyline[0];
      const B = me.polyline[me.polyline.length - 1];
      const kA = packCell(Math.round(A.x * inv), Math.round(A.y * inv), Math.round(A.z * inv));
      const kB = packCell(Math.round(B.x * inv), Math.round(B.y * inv), Math.round(B.z * inv));
      const fwd = `${kA}|${kB}`;
      const rev = `${kB}|${kA}`;
      if (!topoMap.has(fwd)) topoMap.set(fwd, { u1: me.u1, u2: me.u2 });
      if (!topoMap.has(rev)) topoMap.set(rev, { u1: me.u2, u2: me.u1 }); // reversed: swap u1/u2
    }
    entry.topoMap = topoMap;
  }

  _srcGeoCache.set(srcGeo, entry);
  return entry;
}

/** Pack quantized (cx,cy,cz) into a single 53-bit-safe number key. */
function packCell(cx: number, cy: number, cz: number): number {
  // Bias each coord into [0, 2^21) then pack: (cx) | (cy<<21) | (cz<<42).
  // Number.MAX_SAFE_INTEGER is 2^53-1, so 3×21 = 63 bits would overflow — use
  // multiplication for the top field so we stay inside the safe range.
  const ax = (cx + CELL_BIAS) & CELL_MASK;
  const ay = (cy + CELL_BIAS) & CELL_MASK;
  const az = (cz + CELL_BIAS) & CELL_MASK;
  return ax + ay * (1 << CELL_BITS) + az * (1 << (CELL_BITS * 2));
}

/** Build a spatial index mapping quantized vertex positions → triangle indices. */
export function buildTriangleIndex(tris: THREE.Vector3[][], eps: number): Map<number, number[]> {
  const map = new Map<number, number[]>();
  const inv = 1 / eps;
  for (let i = 0; i < tris.length; i++) {
    const tri = tris[i];
    for (let j = 0; j < 3; j++) {
      const v = tri[j];
      const k = packCell(Math.round(v.x * inv), Math.round(v.y * inv), Math.round(v.z * inv));
      const arr = map.get(k);
      if (arr) arr.push(i); else map.set(k, [i]);
    }
  }
  return map;
}

// Scratch set reused across getCandidatesNear calls. resolveEdge runs this
// many times per edge; allocating a fresh Set every call is wasteful.
const _candSeen = new Set<number>();

/**
 * Returns deduplicated triangle indices whose bounding cells overlap the 3×3×3
 * neighbourhood of the cell containing `p`. Covers float-rounding jitter at
 * cell boundaries without scanning the full triangle list. Deduplication is
 * critical: without it the same triangle index appears multiple times in the
 * primary-pass adj array, making adj.length > 2 and causing resolveEdge to
 * return null for valid edges.
 */
function getCandidatesNear(p: THREE.Vector3, map: Map<number, number[]>, eps: number): number[] {
  const inv = 1 / eps;
  const cx = Math.round(p.x * inv), cy = Math.round(p.y * inv), cz = Math.round(p.z * inv);
  _candSeen.clear();
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const arr = map.get(packCell(cx + dx, cy + dy, cz + dz));
        if (arr) for (let i = 0; i < arr.length; i++) _candSeen.add(arr[i]);
      }
  return Array.from(_candSeen);
}

// ---------------------------------------------------------------------------
// Circular-rim detection
//
// A hole-rim (or circular boss) edge selection arrives as N short chord
// segments approximating a circle. Cutting each segment with its own CSG tool
// produces a chaotic triangle soup at every seam (the per-segment cutters are
// straight boxes in slightly-rotated bases). When the whole loop is a single
// planar circle we can instead build ONE analytic cutter (a torus for fillet,
// a cone frustum for chamfer) and subtract it once — a clean Fusion-style
// surface with zero seams. `fitEdgeCircle` recognises that case.
// ---------------------------------------------------------------------------

export interface EdgeLoopCircle {
  /** Circle centre (world space). */
  center: THREE.Vector3;
  /** Circle radius. */
  radius: number;
  /** Unit normal of the circle's plane (the hole / boss axis). */
  axis: THREE.Vector3;
}

/**
 * If the picked edges' endpoints form a single planar circle or circular arc,
 * all points coplanar and equidistant from the centroid), returns its
 * {center, radius, axis}. Otherwise null (box edges, arcs, splines, multi-loop
 * selections all fall back to the per-segment cutter path).
 */
export function fitEdgeCircle(edges: PickedEdge[]): EdgeLoopCircle | null {
  if (edges.length < 8) return null; // too few segments to trust a circle fit

  // Ordered point list = each segment's start (the loop is consecutive
  // segments a→b, b→c, …). Use the a's plus the final b.
  const pts: THREE.Vector3[] = edges.map((e) => e.a);
  pts.push(edges[edges.length - 1].b);

  // Closed-loop check: last point ≈ first point.
  const span = pts[0].distanceTo(pts[Math.floor(pts.length / 2)]);
  if (span < 1e-6) return null;
  if (pts[0].distanceTo(pts[pts.length - 1]) > span * 0.05) return null;
  pts.pop(); // drop the duplicate closing point

  const center = new THREE.Vector3();
  for (const p of pts) center.add(p);
  center.divideScalar(pts.length);

  // Newell's method → robust plane normal for the (near-planar) polygon.
  const axis = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const nxt = pts[(i + 1) % pts.length];
    axis.x += (cur.y - nxt.y) * (cur.z + nxt.z);
    axis.y += (cur.z - nxt.z) * (cur.x + nxt.x);
    axis.z += (cur.x - nxt.x) * (cur.y + nxt.y);
  }
  if (axis.lengthSq() < 1e-12) return null;
  axis.normalize();

  // Validate: every point equidistant from centre (circle) and coplanar.
  let rMin = Infinity;
  let rMax = 0;
  let rSum = 0;
  let maxPlaneDev = 0;
  const w = new THREE.Vector3();
  for (const p of pts) {
    w.subVectors(p, center);
    const planeDev = Math.abs(w.dot(axis));
    if (planeDev > maxPlaneDev) maxPlaneDev = planeDev;
    const r = Math.sqrt(Math.max(0, w.lengthSq() - planeDev * planeDev));
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    rSum += r;
  }
  const rAvg = rSum / pts.length;
  if (rAvg < 1e-6) return null;
  // 5% radius spread and 5%-of-radius planarity tolerances — loose enough for
  // the polyline approximation, tight enough to reject non-circles.
  if ((rMax - rMin) / rAvg > 0.05) return null;
  if (maxPlaneDev > rAvg * 0.05) return null;

  return { center, radius: rAvg, axis };
}

function fitOpenEdgeCircle(edges: PickedEdge[]): EdgeLoopCircle | null {
  if (edges.length < 8) return null;

  const pts: THREE.Vector3[] = edges.map((e) => e.a);
  pts.push(edges[edges.length - 1].b);

  const span = pts[0].distanceTo(pts[Math.floor(pts.length / 2)]);
  if (span < 1e-6) return null;
  if (pts[0].distanceTo(pts[pts.length - 1]) <= span * 0.05) return null;

  const p0 = pts[0];
  const p1 = pts[Math.floor(pts.length / 2)];
  const p2 = pts[pts.length - 1];
  const ab = p1.clone().sub(p0);
  const ac = p2.clone().sub(p0);
  const axis = ab.clone().cross(ac);
  const axisLenSq = axis.lengthSq();
  if (axisLenSq < 1e-10) return null;

  const center = p0.clone().add(
    axis.clone().cross(ab).multiplyScalar(ac.lengthSq())
      .add(ac.clone().cross(axis).multiplyScalar(ab.lengthSq()))
      .multiplyScalar(1 / (2 * axisLenSq)),
  );
  axis.normalize();

  let rMin = Infinity;
  let rMax = 0;
  let rSum = 0;
  let maxPlaneDev = 0;
  const w = new THREE.Vector3();
  for (const p of pts) {
    w.subVectors(p, center);
    const planeDev = Math.abs(w.dot(axis));
    if (planeDev > maxPlaneDev) maxPlaneDev = planeDev;
    const r = Math.sqrt(Math.max(0, w.lengthSq() - planeDev * planeDev));
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    rSum += r;
  }

  const rAvg = rSum / pts.length;
  if (rAvg < 1e-6) return null;
  if ((rMax - rMin) / rAvg > 0.05) return null;
  if (maxPlaneDev > rAvg * 0.05) return null;

  const start = pts[0].clone().sub(center).projectOnPlane(axis).normalize();
  const end = pts[pts.length - 1].clone().sub(center).projectOnPlane(axis).normalize();
  const arcSpan = Math.acos(THREE.MathUtils.clamp(start.dot(end), -1, 1));
  if (arcSpan < Math.PI / 10) return null;

  return { center, radius: rAvg, axis };
}

export function fitEdgeCircleOrArc(edges: PickedEdge[]): EdgeLoopCircle | null {
  return fitEdgeCircle(edges) ?? fitOpenEdgeCircle(edges);
}

// ---------------------------------------------------------------------------
// Per-edge face resolution
//
// Finds the two triangles that share `edge` (by world-space vertex match) and
// returns the unit in-face perpendiculars u1/u2: each is perpendicular to the
// edge, lies in its face's plane, and points AWAY from the edge into the face
// surface.
// ---------------------------------------------------------------------------

export function resolveEdge(
  tris: THREE.Vector3[][],
  e: PickedEdge,
  near: (p: THREE.Vector3, q: THREE.Vector3) => boolean,
  triIdx?: Map<number, number[]>,
  eps?: number,
  topoMap?: Map<string, { u1: THREE.Vector3; u2: THREE.Vector3 }>,
): ResolvedEdge | null {
  // Fast-path: if the caller supplied a topology map (precomputed u1/u2 for
  // every model edge of the CSG result), look up this edge's endpoints directly.
  // Avoids the entire 4-pass fallback chain for Manifold-pipeline bodies.
  if (topoMap && eps != null) {
    const inv = 1 / eps;
    const kA = packCell(Math.round(e.a.x * inv), Math.round(e.a.y * inv), Math.round(e.a.z * inv));
    const kB = packCell(Math.round(e.b.x * inv), Math.round(e.b.y * inv), Math.round(e.b.z * inv));
    const hit = topoMap.get(`${kA}|${kB}`) ?? topoMap.get(`${kB}|${kA}`);
    if (hit) {
      const edgeDir = e.b.clone().sub(e.a);
      const length = edgeDir.length();
      if (length > 1e-9) {
        edgeDir.divideScalar(length);
        return { a: e.a.clone(), b: e.b.clone(), edgeDir, length, u1: hit.u1.clone(), u2: hit.u2.clone() };
      }
    }
  }

  // With a spatial index: only visit triangles in the 3×3×3 neighbourhood of
  // e.a — every triangle containing e.a as a vertex is guaranteed to appear
  // there. Without: fall back to the original linear scan (all tris).
  const candidateIndices: number[] =
    triIdx != null && eps != null
      ? getCandidatesNear(e.a, triIdx, eps)
      : tris.map((_, i) => i);

  // Primary pass: find triangles that share BOTH edge endpoints as exact vertices.
  const adj: { tri: THREE.Vector3[]; ia: number; ib: number; ic: number }[] = [];
  for (const idx of candidateIndices) {
    const tri = tris[idx];
    let ia = -1; let ib = -1;
    for (let k = 0; k < 3; k++) {
      if (ia < 0 && near(tri[k], e.a)) ia = k;
      else if (ib < 0 && near(tri[k], e.b)) ib = k;
    }
    if (ia >= 0 && ib >= 0) adj.push({ tri, ia, ib, ic: 3 - ia - ib });
  }

  // Plane-dedup: three-bvh-csg triangulates flat annular rings (e.g. the top
  // face of an extruded body with a circular hole) into many triangles, some
  // of which contain BOTH rim[i] and rim[i+1] as vertices. Those all appear in
  // the primary pass above, driving adj.length >> 2 and causing resolveEdge to
  // return null even when two real adjacent faces exist. Fix: collapse adj to
  // one representative per distinct face-plane normal before the fallback
  // chain. Real adjacent faces have different normals (≥ a few degrees apart);
  // coplanar CSG-fan duplicates share the same normal within fp-noise.
  // Also handles adj.length=2 where both matches are coplanar (same flat-face
  // triangulation) — reduces to adj.length=1 so the fallbacks can find the
  // second real face.
  if (adj.length >= 2) {
    // For each distinct face plane keep the entry whose ic vertex is FARTHEST
    // from the edge chord. On flat annular rings this selects an outer-boundary
    // ic over an inner-rim ic, giving the correct u2 direction for fillet/chamfer.
    const eDir0 = e.b.clone().sub(e.a); const eLen0 = eDir0.length();
    const eDirN = eLen0 > 1e-9 ? eDir0.clone().divideScalar(eLen0) : new THREE.Vector3(1, 0, 0);
    const _icProj = new THREE.Vector3();
    const icPerpDist = (a: (typeof adj)[0]): number => {
      const ic = a.tri[a.ic];
      const w = ic.clone().sub(e.a);
      const tPar = w.dot(eDirN);
      _icProj.copy(e.a).addScaledVector(eDirN, tPar);
      return ic.distanceTo(_icProj);
    };
    const planes: { na: number; nb: number; nc: number; rep: (typeof adj)[0]; d: number }[] = [];
    for (const a of adj) {
      const e1x = a.tri[1].x - a.tri[0].x, e1y = a.tri[1].y - a.tri[0].y, e1z = a.tri[1].z - a.tri[0].z;
      const e2x = a.tri[2].x - a.tri[0].x, e2y = a.tri[2].y - a.tri[0].y, e2z = a.tri[2].z - a.tri[0].z;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl < 1e-18) continue;
      const ux = nx / nl, uy = ny / nl, uz = nz / nl;
      const d = icPerpDist(a);
      const existing = planes.find((p) => Math.abs(p.na * ux + p.nb * uy + p.nc * uz) > 1 - 1e-4);
      if (!existing) {
        planes.push({ na: ux, nb: uy, nc: uz, rep: a, d });
      } else if (d > existing.d) {
        existing.rep = a; existing.d = d; // prefer farthest ic per plane
      }
    }
    adj.length = 0;
    for (const { rep } of planes) adj.push(rep);
  }

  // Split-edge fallback: when the geometry triangulates two adjacent faces with
  // INCONSISTENT edge subdivision — one face has the full edge (ea→eb) as a
  // single triangle edge, the other face inserts intermediate vertices and splits
  // it into sub-segments — `adj` contains only 1 entry (the unsplit face). The
  // split face has ea as a vertex but pairs it with an intermediate point that
  // lies on the segment rather than at the far endpoint eb.
  //
  // Strategy: if adj.length === 1, compute the edge direction and look for a
  // triangle that (a) has ea as a vertex, (b) is in a different plane from the
  // first adjacent triangle, and (c) has a second vertex that lies exactly on
  // the open segment (ea, eb). The ic vertex (the one off the edge line) is used
  // to derive u2 exactly as in the exact-match case.
  if (adj.length === 1) {
    const f1 = adj[0];
    const edgeVecFull = e.b.clone().sub(e.a);
    const edgeLen = edgeVecFull.length();
    if (edgeLen < 1e-9) return null;
    const edgeDirFull = edgeVecFull.clone().divideScalar(edgeLen);

    // Plane of f1 — we'll skip triangles in the same plane.
    const f1n = new THREE.Vector3().crossVectors(
      f1.tri[1].clone().sub(f1.tri[0]),
      f1.tri[2].clone().sub(f1.tri[0]),
    ).normalize();
    const planeTol = 1 - 1e-4; // normals dot > planeTol → same plane

    const _proj = new THREE.Vector3();
    outerLoop:
    for (const idx of candidateIndices) {
      const tri = tris[idx];
      // Triangle must have ea as a vertex.
      let eaIdx = -1;
      for (let k = 0; k < 3; k++) {
        if (near(tri[k], e.a)) { eaIdx = k; break; }
      }
      if (eaIdx < 0) continue;

      // Triangle must be in a different plane from f1 (otherwise it's on the
      // same face and can't be the second adjacent face).
      const tn = new THREE.Vector3().crossVectors(
        tri[1].clone().sub(tri[0]),
        tri[2].clone().sub(tri[0]),
      );
      const tnLen = tn.length();
      if (tnLen < 1e-18) continue; // degenerate triangle
      tn.divideScalar(tnLen);
      if (Math.abs(tn.dot(f1n)) >= planeTol) continue;

      // Among the non-ea vertices, check if one lies on the open segment (ea, eb).
      // A vertex v is on the segment when:
      //   tPar = (v - ea) · edgeDir ∈ (0, edgeLen)   (strictly between endpoints)
      //   near(v, ea + edgeDir*tPar)                   (perpendicular distance < eps)
      for (let k = 0; k < 3; k++) {
        if (k === eaIdx) continue;
        const w = tri[k].clone().sub(e.a);
        const tPar = w.dot(edgeDirFull);
        if (tPar <= 1e-6 || tPar >= edgeLen - 1e-6) continue;
        _proj.copy(e.a).addScaledVector(edgeDirFull, tPar);
        if (!near(tri[k], _proj)) continue;

        // tri[k] is a split point on the edge → this triangle is the second face.
        const icIdx = [0, 1, 2].find(i => i !== eaIdx && i !== k) as number;
        adj.push({ tri, ia: eaIdx, ib: k, ic: icIdx });
        break outerLoop;
      }
    }
  }

  // Flat-face fallback: handles circle-rim edges where the flat-face
  // triangulation (ear-clipping after CSG + weldAndClean) produces triangles
  // that contain A but NOT B — so the primary pass finds only the cylinder-wall
  // face (which has both A and B) and misses the flat-cap face (A only).
  // Unlike the split-edge fallback above, we don't require the second vertex to
  // lie on the A→B segment; we just need any triangle in a different plane that
  // has A (or B) and an off-edge-line third vertex.
  if (adj.length === 1) {
    const f1b = adj[0];
    const eVec2 = e.b.clone().sub(e.a);
    const eLen2 = eVec2.length();
    if (eLen2 < 1e-9) return null;
    const eDir2 = eVec2.clone().divideScalar(eLen2);
    const f1n2 = new THREE.Vector3().crossVectors(
      f1b.tri[1].clone().sub(f1b.tri[0]),
      f1b.tri[2].clone().sub(f1b.tri[0]),
    ).normalize();
    const planeTol2 = 1 - 1e-4;

    // Extend the candidate set to also cover triangles near B (flat-cap
    // triangle might have B but not A, or lie slightly outside A's grid cell).
    const candB: number[] =
      triIdx != null && eps != null
        ? getCandidatesNear(e.b, triIdx, eps)
        : [];
    const extCandidates = candB.length
      ? Array.from(new Set([...candidateIndices, ...candB]))
      : candidateIndices;

    const _proj2 = new THREE.Vector3();
    // Collect ALL valid flat-face candidates; pick the one whose ic vertex is
    // FARTHEST from the edge chord. For circle-rim edges the ear-clipped
    // annular ring may produce both "ear" triangles (ic = outer-boundary vertex,
    // far from chord, correct u2 = outward) and triangles whose ic vertex is
    // another rim point (close to chord, wrong u2 = inward → fillet cuts into
    // the hole wall). Maximising perpendicular distance reliably selects the
    // outer-boundary ic over any nearby rim ic, giving the correct u2 direction.
    let bestFlatCandidate: { tri: THREE.Vector3[]; ia: number; ib: number; ic: number } | null = null;
    let bestFlatPerpDist = -1;
    for (const idx of extCandidates) {
      const tri = tris[idx];
      // Triangle must have A or B as a vertex.
      let anchorIdx = -1;
      let anchorPt: THREE.Vector3 | null = null;
      for (let k = 0; k < 3; k++) {
        if (near(tri[k], e.a)) { anchorIdx = k; anchorPt = e.a; break; }
        if (near(tri[k], e.b)) { anchorIdx = k; anchorPt = e.b; break; }
      }
      if (anchorIdx < 0 || !anchorPt) continue;

      // Must be in a different plane from f1.
      const tn2 = new THREE.Vector3().crossVectors(
        tri[1].clone().sub(tri[0]),
        tri[2].clone().sub(tri[0]),
      );
      const tnLen2 = tn2.length();
      if (tnLen2 < 1e-18) continue;
      tn2.divideScalar(tnLen2);
      if (Math.abs(tn2.dot(f1n2)) >= planeTol2) continue;

      // Find ic: a vertex that is not at A, not at B, and not on the A→B line.
      for (let k = 0; k < 3; k++) {
        if (near(tri[k], e.a) || near(tri[k], e.b)) continue;
        const w2 = tri[k].clone().sub(anchorPt);
        const tPar2 = w2.dot(eDir2);
        _proj2.copy(anchorPt).addScaledVector(eDir2, tPar2);
        if (near(tri[k], _proj2)) continue; // on edge line → skip
        // Perpendicular distance from ic to the chord — prefer the largest
        // so we select outer-boundary ic vertices over nearby rim vertices.
        const perpDist = tri[k].distanceTo(_proj2);
        if (perpDist > bestFlatPerpDist) {
          bestFlatPerpDist = perpDist;
          bestFlatCandidate = { tri, ia: anchorIdx, ib: 3 - anchorIdx - k, ic: k };
        }
        break; // one ic candidate per triangle
      }
    }
    if (bestFlatCandidate) adj.push(bestFlatCandidate);
  }

  if (adj.length !== 2) return null;

  const edgeDir = e.b.clone().sub(e.a);
  const length = edgeDir.length();
  if (length < 1e-9) return null;
  edgeDir.divideScalar(length);

  const inPlanePerp = (c: THREE.Vector3, base: THREE.Vector3) => {
    const w = c.clone().sub(base);
    return w.sub(edgeDir.clone().multiplyScalar(w.dot(edgeDir))).normalize();
  };

  const f1 = adj[0]; const f2 = adj[1];
  const u1 = inPlanePerp(f1.tri[f1.ic], e.a);
  const u2 = inPlanePerp(f2.tri[f2.ic], e.a);
  if (u1.lengthSq() < 0.5 || u2.lengthSq() < 0.5) return null;

  return { a: e.a.clone(), b: e.b.clone(), edgeDir, length, u1, u2 };
}

// ---------------------------------------------------------------------------
// Gizmo direction
// ---------------------------------------------------------------------------

/**
 * Direction for the on-canvas size handle: perpendicular to the picked
 * edge(s), along the EXTERIOR bisector of the two adjacent faces — i.e.
 * pointing away from the solid, toward where the sharp corner was. Averaged
 * over every edge that resolves. Returns null if none resolve, so the caller
 * can fall back to a default axis.
 *
 * `srcGeo` must be non-indexed, world-space (same as computeEdgeCutGeometry).
 */
export function computeEdgeGizmoDir(
  srcGeo: THREE.BufferGeometry,
  edges: PickedEdge[],
): THREE.Vector3 | null {
  const { tris, triIdx, eps, topoMap } = getOrBuildSrcCache(srcGeo);
  const epsSq = eps * eps;
  const near = (p: THREE.Vector3, q: THREE.Vector3) => p.distanceToSquared(q) <= epsSq;

  const acc = new THREE.Vector3();
  let n = 0;
  for (const e of edges) {
    const re = resolveEdge(tris, e, near, triIdx, eps, topoMap);
    if (!re) continue;
    // Interior bisector (u1+u2) points into the solid; negate for exterior.
    acc.add(re.u1.clone().add(re.u2).normalize().negate());
    n++;
  }
  if (n === 0 || acc.lengthSq() < 1e-9) return null;
  return acc.normalize();
}

// ---------------------------------------------------------------------------
// Edge dedupe + clustering helpers
//
// Both operations used to be O(N²) (linear-scan dedupe / repeated `Array.some`
// connectivity test). Selection sizes are typically small (≤12 for box edges),
// but circle-rim selections balloon to 30-100+ tiny segments and live-preview
// re-registration / tangent-edge propagation can compound that further. The
// O(N²) version cost tens of milliseconds per debounced preview tick on those
// selections; replacing with endpoint spatial-hash makes it linear and keeps
// the visible response inside one frame.
// ---------------------------------------------------------------------------
/** Unordered-pair canonical key for two endpoint cell hashes. */
function unorderedPairKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/**
 * O(N) endpoint-based dedupe. Two edges are duplicates when their {a,b} cell
 * hashes match in either direction. To handle the cell-boundary straddling
 * case (two points within eps but quantized into adjacent cells — what the old
 * O(N²) pairwise `near` would still catch), each endpoint is resolved to a
 * CANONICAL cell key by checking a 3×3×3 neighbourhood for an earlier endpoint
 * that we've already cataloged within eps; if found, this endpoint inherits
 * that cell key. This keeps dedupe correctness byte-equivalent for the inputs
 * the driver actually sees while being linear in N. Same 3-neighbour pattern
 * the spatial triangle index already uses.
 */
export function dedupEdgesByEndpoints(edges: PickedEdge[], eps: number): PickedEdge[] {
  const out: PickedEdge[] = [];
  const seen = new Set<string>();
  const inv = 1 / eps;
  const epsSq = eps * eps;
  // canonical-cell-key map: anchor point cell → canonical key (the first such
  // cell hash encountered). Subsequent endpoints in the cell's 3×3×3 hood
  // within eps reuse that key.
  const canon = new Map<number, { key: number; x: number; y: number; z: number }>();
  const canonicalize = (v: THREE.Vector3): number => {
    const cx = Math.round(v.x * inv), cy = Math.round(v.y * inv), cz = Math.round(v.z * inv);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const k = packCell(cx + dx, cy + dy, cz + dz);
          const hit = canon.get(k);
          if (hit !== undefined) {
            const ddx = hit.x - v.x, ddy = hit.y - v.y, ddz = hit.z - v.z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= epsSq) return hit.key;
          }
        }
    const self = packCell(cx, cy, cz);
    canon.set(self, { key: self, x: v.x, y: v.y, z: v.z });
    return self;
  };
  for (const e of edges) {
    const ka = canonicalize(e.a);
    const kb = canonicalize(e.b);
    if (ka === kb) continue; // zero-length edge guard
    const k = unorderedPairKey(ka, kb);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/**
 * O(N+α(N)) union-find clustering by shared endpoint cell. Replaces the prior
 * "while (changed) for each remaining edge" O(N²) loop. Two endpoints land in
 * the same group when their canonical cell keys match (same 3×3×3 neighbourhood
 * canonicalization the dedup uses, so it tolerates a small straddle across a
 * cell line in the same way the old `near`-based connectivity did).
 */
export function clusterEdgesByEndpointConnectivity(
  edges: PickedEdge[],
  eps: number,
): PickedEdge[][] {
  if (edges.length === 0) return [];
  const inv = 1 / eps;
  const epsSq = eps * eps;
  const n = edges.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const next = parent[x]; parent[x] = r; x = next; }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const canon = new Map<number, { key: number; x: number; y: number; z: number }>();
  const canonicalize = (v: THREE.Vector3): number => {
    const cx = Math.round(v.x * inv), cy = Math.round(v.y * inv), cz = Math.round(v.z * inv);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const k = packCell(cx + dx, cy + dy, cz + dz);
          const hit = canon.get(k);
          if (hit !== undefined) {
            const ddx = hit.x - v.x, ddy = hit.y - v.y, ddz = hit.z - v.z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= epsSq) return hit.key;
          }
        }
    const self = packCell(cx, cy, cz);
    canon.set(self, { key: self, x: v.x, y: v.y, z: v.z });
    return self;
  };

  // First edge owning each canonical endpoint cell — anything else that touches
  // that cell unions into the same group.
  const cellOwner = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const ka = canonicalize(edges[i].a);
    const kb = canonicalize(edges[i].b);
    const ownerA = cellOwner.get(ka);
    if (ownerA === undefined) cellOwner.set(ka, i); else union(i, ownerA);
    const ownerB = cellOwner.get(kb);
    if (ownerB === undefined) cellOwner.set(kb, i); else union(i, ownerB);
  }

  const groups = new Map<number, PickedEdge[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(edges[i]); else groups.set(r, [edges[i]]);
  }
  return [...groups.values()];
}

type TopologyEdgeLike = {
  id?: string;
  kind?: ModelEdge['kind'];
  polyline?: THREE.Vector3[];
};

function cloneTopologyEdge(edge: TopologyEdgeLike): ModelEdge | null {
  const polyline = edge.polyline;
  if (!polyline || polyline.length < 2) return null;
  const pts = polyline.map((p) => p.clone());
  return {
    id: edge.id ?? modelEdgeId(pts),
    polyline: pts,
    kind: edge.kind ?? 'crease',
  };
}

function polylinesMatchApprox(a: THREE.Vector3[], b: THREE.Vector3[], tolSq: number): boolean {
  if (a.length < 2 || b.length < 2) return false;
  const a0 = a[0];
  const a1 = a[a.length - 1];
  const b0 = b[0];
  const b1 = b[b.length - 1];
  return (a0.distanceToSquared(b0) <= tolSq && a1.distanceToSquared(b1) <= tolSq)
    || (a0.distanceToSquared(b1) <= tolSq && a1.distanceToSquared(b0) <= tolSq);
}

function pointSegmentDistSq(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-12) return p.distanceToSquared(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / lenSq, 0, 1);
  return p.distanceToSquared(a.clone().addScaledVector(ab, t));
}

function pointPolylineDistSq(p: THREE.Vector3, polyline: THREE.Vector3[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < polyline.length; i++) {
    best = Math.min(best, pointSegmentDistSq(p, polyline[i], polyline[i + 1]));
  }
  return best;
}

function polylineShadowsRetained(candidate: THREE.Vector3[], retained: ModelEdge[], tolSq: number): boolean {
  if (candidate.length < 2) return false;
  let nearCount = 0;
  for (const p of candidate) {
    if (retained.some((edge) => pointPolylineDistSq(p, edge.polyline) <= tolSq)) nearCount++;
  }
  return nearCount / candidate.length >= 0.65;
}

function mergeRetainedAndResultTopology(
  resultTopology: BodyTopology | undefined,
  retainedEdges: ModelEdge[],
  srcBounds: THREE.Box3 | null,
  includeResultEdges = true,
): BodyTopology | undefined {
  if (!resultTopology?.edges?.length) {
    return retainedEdges.length ? { edges: retainedEdges.map((e) => cloneTopologyEdge(e)!).filter(Boolean) } : resultTopology;
  }
  if (retainedEdges.length === 0) return includeResultEdges ? resultTopology : { edges: [] };
  if (!includeResultEdges) {
    return { edges: retainedEdges.map((e) => cloneTopologyEdge(e)).filter((e): e is ModelEdge => e !== null) };
  }

  const diag = Math.max(srcBounds?.min.distanceTo(srcBounds.max) ?? 1, 1);
  const endpointTolSq = Math.max((diag * 1e-4) ** 2, 1e-10);
  const shadowTolSq = Math.max((diag * 2e-3) ** 2, 1e-8);
  const retained = retainedEdges.map((e) => cloneTopologyEdge(e)).filter((e): e is ModelEdge => e !== null);
  const resultOnly: ModelEdge[] = [];
  for (const edge of resultTopology.edges) {
    const cloned = cloneTopologyEdge(edge);
    if (!cloned) continue;
    if (retained.some((r) => polylinesMatchApprox(r.polyline, cloned.polyline, endpointTolSq))) continue;
    if (polylineShadowsRetained(cloned.polyline, retained, shadowTolSq)) continue;
    resultOnly.push(cloned);
  }
  return { edges: [...retained, ...resultOnly] };
}

// ---------------------------------------------------------------------------
// Tangent-edge propagation (Task 6: "Propagate Along Tangent Edges")
// ---------------------------------------------------------------------------

/**
 * Expands the picked edge set by walking to tangent-connected topology edges.
 * Two edges are considered tangent-connected when they:
 *   1. Share an endpoint (within `eps`)
 *   2. Have directions aligned within ~12° (cos > TANGENT_DOT)
 *
 * Uses BFS from every initially-picked edge. The topology edges stored in
 * `srcGeo.userData.topology.edges` (world-space polylines) are the walk graph.
 */
const TANGENT_DOT = Math.cos((12 * Math.PI) / 180);
export function propagateEdgesAlongTangents(
  picked: PickedEdge[],
  srcGeo: THREE.BufferGeometry,
  eps: number,
): PickedEdge[] {
  const topoEdges = (
    (srcGeo.userData?.displayTopology ?? srcGeo.userData?.topology) as
      | { edges?: Array<{ polyline: THREE.Vector3[] }> }
      | undefined
  )?.edges;
  if (!topoEdges || topoEdges.length === 0) return picked;

  const epsSq = eps * eps;
  const nearV = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceToSquared(b) <= epsSq;

  // Convert topology edges to {a, b, dir} for quick lookup.
  interface TopoEdge { a: THREE.Vector3; b: THREE.Vector3; dir: THREE.Vector3; }
  const allEdges: TopoEdge[] = [];
  for (const te of topoEdges) {
    if (!te.polyline || te.polyline.length < 2) continue;
    const a = te.polyline[0];
    const b = te.polyline[te.polyline.length - 1];
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-9) continue;
    dir.divideScalar(len);
    allEdges.push({ a, b, dir });
  }

  // Seed BFS with the initially-picked edges (as PickedEdge world-coord objects).
  const queue: PickedEdge[] = [...picked];
  const visited = new Set<number>(); // index into allEdges

  // Mark any topology edge already matching a picked edge as visited.
  for (let i = 0; i < allEdges.length; i++) {
    const te = allEdges[i];
    for (const pe of picked) {
      if ((nearV(te.a, pe.a) && nearV(te.b, pe.b)) ||
          (nearV(te.a, pe.b) && nearV(te.b, pe.a))) {
        visited.add(i);
        break;
      }
    }
  }

  const result: PickedEdge[] = [...picked];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const curDir = cur.b.clone().sub(cur.a);
    const curLen = curDir.length();
    if (curLen < 1e-9) continue;
    curDir.divideScalar(curLen);

    for (let i = 0; i < allEdges.length; i++) {
      if (visited.has(i)) continue;
      const te = allEdges[i];
      // Shares an endpoint with cur?
      const sharesA = nearV(te.a, cur.a) || nearV(te.a, cur.b);
      const sharesB = nearV(te.b, cur.a) || nearV(te.b, cur.b);
      if (!sharesA && !sharesB) continue;
      // Tangent direction check: align direction from the shared vertex.
      const dot = Math.abs(te.dir.dot(curDir));
      if (dot < TANGENT_DOT) continue;
      visited.add(i);
      const newEdge: PickedEdge = { a: te.a.clone(), b: te.b.clone() };
      result.push(newEdge);
      queue.push(newEdge);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Generic CSG driver
// ---------------------------------------------------------------------------

/**
 * Cuts the given edges on a NON-INDEXED, world-space solid BufferGeometry by
 * subtracting a per-edge cutter (built by `makeCutter`). Returns a new
 * BufferGeometry, or null if no eligible edges were resolved (degenerate
 * geometry, edge not shared by two faces, radius/distance too large, etc.).
 *
 * - `srcGeo` must be non-indexed (call `.toNonIndexed()` before passing).
 * - The caller is responsible for disposing `srcGeo`.
 * - `tag` is only used for console diagnostics ('fillet' / 'chamfer').
 */
export function computeEdgeCutGeometry(
  srcGeo: THREE.BufferGeometry,
  edges: PickedEdge[],
  makeCutter: EdgeCutterFn,
  tag: string,
  _fast?: boolean,
  makeLoopCutter?: LoopCutterFn,
  options?: EdgeCutOptions,
): THREE.BufferGeometry | null {
  const { tris, triIdx, eps, topoMap } = getOrBuildSrcCache(srcGeo);
  const epsSq = eps * eps;
  const near = (p: THREE.Vector3, q: THREE.Vector3) => p.distanceToSquared(q) <= epsSq;

  // Dedupe edges by GEOMETRY (endpoint pair, either direction, within the
  // edge-match tolerance). Tangent-edge propagation and live-preview
  // re-registration routinely hand the SAME physical edge in multiple times
  // (sometimes slightly jittered); cutting it twice double-bevels it and adds
  // spurious geometry / can over-cut. One cut per distinct edge is correct.
  // Uses a spatial-hash → O(N) instead of the prior O(N²) scan; matters on
  // circle-rim selections that arrive as 30-100+ short segments.
  let uniqueEdges = dedupEdgesByEndpoints(edges, eps);

  // Task 6: Propagate along tangent edges when requested.
  if (options?.propagate) {
    uniqueEdges = dedupEdgesByEndpoints(
      propagateEdgesAlongTangents(uniqueEdges, srcGeo, eps),
      eps,
    );
  }

  // Capture only the source topology edges this cut actually consumes, plus
  // any prior consumed-edge ghosts. The picker can still find already-cut
  // edges later, but a second Fillet/Chamfer won't inherit the entire old body
  // as stale ghost candidates.
  const srcDisplayTopo = (srcGeo.userData?.displayTopology as { edges?: TopologyEdgeLike[] } | undefined)?.edges;
  const srcTopo = (srcGeo.userData?.topology as { edges?: TopologyEdgeLike[] } | undefined)?.edges;
  const displayEdges = Array.isArray(srcDisplayTopo) ? srcDisplayTopo : srcTopo;
  const srcGhost = (srcGeo.userData?.ghostTopology as { edges?: unknown[] } | undefined)?.edges;
  const ghostEdges: unknown[] = [];
  const retainedDisplayEdges: ModelEdge[] = [];
  const displaySegmentWasPicked = (a: THREE.Vector3, b: THREE.Vector3): boolean => {
    for (const e of uniqueEdges) {
      if ((near(a, e.a) && near(b, e.b)) || (near(a, e.b) && near(b, e.a))) return true;
    }
    return false;
  };
  if (Array.isArray(displayEdges)) {
    for (const edge of displayEdges) {
      const polyline = edge.polyline;
      if (!polyline || polyline.length < 2) continue;
      let pickedAny = false;
      let retainedPart: THREE.Vector3[] = [];
      const flushRetainedPart = () => {
        if (retainedPart.length >= 2) {
          const retained = cloneTopologyEdge({ ...edge, polyline: retainedPart });
          if (retained) retainedDisplayEdges.push(retained);
        }
        retainedPart = [];
      };
      for (let i = 0; i + 1 < polyline.length; i++) {
        const a = polyline[i], b = polyline[i + 1];
        if (displaySegmentWasPicked(a, b)) {
          pickedAny = true;
          flushRetainedPart();
        } else {
          if (retainedPart.length === 0) retainedPart.push(a);
          retainedPart.push(b);
        }
      }
      flushRetainedPart();
      if (pickedAny) ghostEdges.push(edge);
    }
  }
  if (Array.isArray(srcGhost)) ghostEdges.push(...srcGhost);

  // Cluster uniqueEdges by endpoint connectivity before deciding which path to
  // use. This handles mixed selections (e.g. a circular rim + a box edge): each
  // connected group is tested for circularity independently, so the loop cutter
  // fires for the rim cluster while the box edge cluster falls through to the
  // per-segment path. Previously fitEdgeCircle was called on ALL uniqueEdges at
  // once — any non-circular edge in the selection defeated the torus path for the
  // entire rim, sending all rim segments through the per-segment path and
  // producing the triangle-soup seams.
  // O(N) via union-find keyed by an endpoint-cell spatial hash.
  const clusters = clusterEdgesByEndpointConnectivity(uniqueEdges, eps);

  let solid: THREE.BufferGeometry = srcGeo.clone();
  let cut = 0;
  let failedSegCount = 0;
  // Counts only per-segment (non-loop-cutter) cuts. The final weldAndCleanSolid
  // is gated on this: loop-cutter results are already clean manifolds (the CSG
  // welds internally), so running weldAndCleanSolid on them is both unnecessary
  // and slow (retriangulateCoplanarRegions on a torus freezes the preview).
  let perSegCut = 0;
  // Edges from non-circular clusters (or loop-cutter fallbacks) accumulate here
  // and are processed by the per-segment CSG driver below.
  const perSegEdges: PickedEdge[] = [];

  for (const cluster of clusters) {
    let handledByLoop = false;
    if (makeLoopCutter) {
      const circle = tag === 'fillet' ? fitEdgeCircleOrArc(cluster) : fitEdgeCircle(cluster);
      if (circle) {
        // Resolve a representative edge for orientation. Try the middle first
        // (away from any seam artefacts), then scan outward for any that resolves.
        let rep: ResolvedEdge | null = null;
        const order = [Math.floor(cluster.length / 2)];
        for (let i = 0; i < cluster.length; i++) if (i !== order[0]) order.push(i);
        for (const idx of order) {
          rep = resolveEdge(tris, cluster[idx], near, triIdx, eps, topoMap);
          if (rep) break;
        }
        if (rep) {
          const loopCutter = makeLoopCutter(circle, rep);
          if (loopCutter) {
            try {
              const result = csgSubtractWithTopology(solid, loopCutter).geometry;
              loopCutter.dispose();
              const posN =
                (result.attributes.position as THREE.BufferAttribute | undefined)?.count ?? 0;
              if (posN > 0) {
                solid.dispose();
                solid = result;
                cut++;
                handledByLoop = true;
              } else {
                result.dispose();
                // Empty result → fall through to per-segment for this cluster.
              }
            } catch (err) {
              loopCutter.dispose();
              console.error(`[${tag}] loop cutter csgSubtract threw — falling back:`, err);
            }
          }
        }
      }
    }
    if (!handledByLoop) perSegEdges.push(...cluster);
  }

  // Miter corner: collect resolved edges per vertex during the per-segment loop.
  // Key: quantized vertex cell string → resolved edges that touch this vertex.
  const miterVtxEdges = options?.makeMiterCornerCutter
    ? new Map<string, { pos: THREE.Vector3; res: ResolvedEdge[] }>()
    : null;
  const miterVtxKey = (v: THREE.Vector3) =>
    `${Math.round(v.x / eps)}_${Math.round(v.y / eps)}_${Math.round(v.z / eps)}`;

  // Per-segment path for non-circular clusters (straight edges, arcs, etc.).
  for (const e of perSegEdges) {
    const re = resolveEdge(tris, e, near, triIdx, eps, topoMap);
    if (!re) { failedSegCount++; continue; }
    // Collect per-vertex resolved-edge data for miter corner computation.
    if (miterVtxEdges) {
      for (const v of [re.a, re.b]) {
        const k = miterVtxKey(v);
        let entry = miterVtxEdges.get(k);
        if (!entry) { entry = { pos: v.clone(), res: [] }; miterVtxEdges.set(k, entry); }
        entry.res.push(re);
      }
    }
    // Small overhang past the edge ends so the boolean is clean at the ends
    // without visibly notching the adjacent faces.
    const edgeEps = Math.max(re.length * 1e-3, 1e-4);
    const cutter = makeCutter(re, edgeEps);
    if (!cutter) { console.warn(`[${tag}] degenerate dihedral — edge skipped`); failedSegCount++; continue; }
    // three-bvh-csg can throw on degenerate / non-manifold inputs. Catch so
    // one bad edge doesn't abort the whole commit (which would also skip the
    // dialog's onClose).
    let next: THREE.BufferGeometry | null = null;
    try {
      // Raw CSG (no weld/topology) for per-segment cuts. The intermediate
      // weldAndCleanSolid below fuses the seam verts before the next cut;
      // the final weldAndCleanSolid(false) after the loop runs retriangulate
      // once for the finished solid. GeometryEngine.csgSubtract runs a full
      // weld + topology on every call — redundant and expensive for N>1 cuts.
      next = csgSubtractRaw(solid, cutter);
    } catch (err) {
      console.error(`[${tag}] csgSubtract threw — edge skipped:`, err);
      failedSegCount++;
    }
    cutter.dispose();
    if (!next) continue;
    solid.dispose();
    // Re-weld after every edge to keep the running solid manifold before the
    // next CSG subtract. Without this, adjacent-segment cutters (e.g. a straight
    // model edge stored as 6 sub-segments, or two box edges sharing a corner)
    // operate on raw triangle soup and produce seam artifacts.
    // In commit mode use fast=false (full retriangulate); in preview mode use
    // fast=true (cheap weld, skip retriangulate) — a final full weld below
    // handles the coplanar fan before the geometry is handed to the renderer.
    try {
      // Always use fast (cheap) weld between sequential CSG cuts — the weld
      // only needs to hand a manifold solid to the next boolean (corner-spike
      // fix); retriangulateCoplanarRegions is cosmetic and only needed once on
      // the final result. Running it after every edge was O(N×retriangulate)
      // in commit mode; the single final weld below (always-on for per-segment
      // paths) gives identical quality in O(1×retriangulate).
      const cleaned = weldAndCleanSolid(next, true);
      next.dispose();
      solid = cleaned;
    } catch (err) {
      console.error(`[${tag}] weld/clean failed — keeping raw CSG result:`, err);
      solid = next;
    }
    cut++;
    perSegCut++;
  }

  if (cut === 0) {
    console.warn(`[${tag}] no edges cut → returning null`);
    solid.dispose();
    return null;
  }

  // Task 10: Miter corner at 2-edge vertices (chamfer cornerType='miter').
  // At each vertex where exactly 2 per-segment chamfer edges meet, the two
  // chamfer bevel planes must be extended to their natural intersection line
  // (the miter). We do this by CSG-subtracting a convex-hull wedge that
  // exactly spans the gap between the two bevel faces at the shared corner.
  if (miterVtxEdges && options?.makeMiterCornerCutter) {
    for (const { pos, res } of miterVtxEdges.values()) {
      if (res.length !== 2) continue; // only exactly-2-edge corners → miter
      const miterCutter = options.makeMiterCornerCutter(pos, res[0], res[1], eps);
      if (!miterCutter) continue;
      try {
        const next = csgSubtractRaw(solid, miterCutter);
        miterCutter.dispose();
        const posCount = (next.attributes.position as THREE.BufferAttribute | undefined)?.count ?? 0;
        if (posCount > 0) {
          solid.dispose();
          solid = next;
        } else {
          next.dispose();
        }
      } catch {
        miterCutter.dispose();
      }
    }
  }

  // Task 7: Rolling-ball corner sphere at multi-edge junctions.
  // When 3+ selected edges share an endpoint, a small triangular gap is left
  // at the corner after independent edge cuts. Subtracting a sphere of the
  // fillet/chamfer radius there fills the gap with a smooth spherical patch —
  // the same "rolling-ball corner" Fusion's isRollingBallCorner applies.
  if (options?.cornerRadius && options.cornerRadius > 0) {
    const r = options.cornerRadius;
    // Count how many unique edges touch each vertex (within eps).
    const vtxCount = new Map<string, { pos: THREE.Vector3; count: number }>();
    const vtxKey = (v: THREE.Vector3) =>
      `${Math.round(v.x / eps)}_${Math.round(v.y / eps)}_${Math.round(v.z / eps)}`;
    for (const e of uniqueEdges) {
      for (const v of [e.a, e.b]) {
        const k = vtxKey(v);
        const entry = vtxCount.get(k);
        if (entry) entry.count++;
        else vtxCount.set(k, { pos: v.clone(), count: 1 });
      }
    }
    for (const { pos, count } of vtxCount.values()) {
      if (count < 3) continue;
      const sphere = new THREE.SphereGeometry(r, 16, 12);
      sphere.translate(pos.x, pos.y, pos.z);
      try {
        const next = csgSubtractRaw(solid, sphere);
        sphere.dispose();
        if ((next.attributes.position as THREE.BufferAttribute | undefined)?.count ?? 0 > 0) {
          solid.dispose();
          solid = next;
        } else {
          next.dispose();
        }
      } catch {
        sphere.dispose();
      }
    }
  }

  // Final full weld for per-segment paths: the cheap intermediate welds leave
  // coplanar fans on flat sides; one full weld here collapses them. Gated on
  // perSegCut, NOT cut: loop-cutter results are already clean manifolds, so
  // running weldAndCleanSolid on them is unnecessary and corrupts the smooth
  // curved geometry. Runs in BOTH commit and preview mode (previously only
  // preview triggered this; commit used full intermediates instead — O(N)
  // retriangulate calls instead of O(1)).
  if (perSegCut > 0) {
    try {
      const cleaned = weldAndCleanSolid(solid, false);
      solid.dispose();
      solid = cleaned;
    } catch (err) {
      console.error(`[${tag}] final weld/clean failed:`, err);
    }
  }

  // Guard against an empty result (e.g. size so large the cutter removed the
  // entire body) — storing an empty mesh looks like the body vanished.
  const posCount = (solid.attributes.position as THREE.BufferAttribute | undefined)?.count ?? 0;
  if (posCount === 0) {
    console.warn(`[${tag}] CSG produced empty geometry (size too large?) → null`);
    solid.dispose();
    return null;
  }

  // Extract topology BEFORE toCreasedNormals destroys the indexed geometry.
  // toCreasedNormals splits vertices at creases → HalfEdgeMap can no longer
  // find sibling triangles by index, so extractEdgeTopology returns empty edges.
  // We run on the still-indexed solid here and carry the result through.
  // Gate on !_fast: the preview/worker path doesn't need topology (it's
  // discarded); the commit path (fast=undefined/false) does.
  //
  // IMPORTANT: always re-extract from the CUT RESULT (solid), never reuse
  // solid.userData.topology. solid is a clone of srcGeo which inherited
  // srcGeo.userData.topology (the PRE-CUT source topology). Reusing that would
  // stamp the source's edge set — which may be empty, wrong, or missing the
  // new fillet/chamfer arcs — on the result. The source topology is captured
  // above as ghostEdges; the result needs its own fresh extraction.
  let savedTopology: ReturnType<typeof extractEdgeTopology> | undefined;
  if (!_fast) {
    try {
      savedTopology = extractEdgeTopology(solid);
      solid.computeBoundingBox();
      savedTopology = mergeRetainedAndResultTopology(
        savedTopology,
        retainedDisplayEdges,
        solid.boundingBox ?? null,
        tag !== 'fillet',
      );
    }
    catch {
      solid.computeBoundingBox();
      savedTopology = mergeRetainedAndResultTopology(undefined, retainedDisplayEdges, solid.boundingBox ?? null) ?? { edges: [] };
    }
  }

  // Crease-aware normals: smooth on the curved fillet/chamfer arc (adjacent
  // facets typically 10–15° apart) while preserving hard edges at the 90°
  // flat-face↔fillet boundary. 40° crease angle comfortably spans both cases.
  try {
    const creased = toCreasedNormals(solid, THREE.MathUtils.degToRad(40));
    if (savedTopology) {
      creased.userData.topology = savedTopology;
      // Mark as current version so the lazy fallback in nearestEdge.ts never
      // clobbers this higher-quality pre-toCreasedNormals extraction.
      creased.userData._topoV = 10;
    }
    if (savedTopology?.edges?.length) creased.userData.displayTopology = { edges: savedTopology.edges };
    else if (retainedDisplayEdges.length) creased.userData.displayTopology = { edges: retainedDisplayEdges };
    if (ghostEdges.length > 0) creased.userData.ghostTopology = { edges: ghostEdges };
    solid.dispose();
    solid = creased;
  } catch {
    solid.computeVertexNormals();
    if (savedTopology) {
      solid.userData.topology = savedTopology;
      solid.userData._topoV = 10;
    }
    if (savedTopology?.edges?.length) solid.userData.displayTopology = { edges: savedTopology.edges };
    else if (retainedDisplayEdges.length) solid.userData.displayTopology = { edges: retainedDisplayEdges };
    if (ghostEdges.length > 0) solid.userData.ghostTopology = { edges: ghostEdges };
  }
  solid.computeBoundingBox();
  solid.computeBoundingSphere();
  // Surface diagnostics for callers (applyEdgeCut reads these for status messages).
  solid.userData.failedEdgeCount = failedSegCount;
  solid.userData.totalEdgeCount = uniqueEdges.length;
  return solid;
}
