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
import { GeometryEngine } from '../../engine/GeometryEngine';

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

// ---------------------------------------------------------------------------
// Edge-ID parsing
// ---------------------------------------------------------------------------

/**
 * Parses picked edge IDs from the store and returns the group with the most
 * edges (i.e. the feature/mesh the user picked the most edges on).
 *
 * Edge ID format:
 *   `${featureId}|${meshUuid}:${ax,ay,az}:${bx,by,bz}`  (new)
 *   `${meshUuid}:${ax,ay,az}:${bx,by,bz}`               (legacy)
 */
export function parseEdgeIds(edgeIds: string[]): ParsedEdges | null {
  const byKey = new Map<string, ParsedEdges>();

  for (const id of edgeIds) {
    let featureId: string | null = null;
    let rest = id;
    const pipeIdx = id.indexOf('|');
    if (pipeIdx > 0) { featureId = id.slice(0, pipeIdx); rest = id.slice(pipeIdx + 1); }
    const parts = rest.split(':');
    if (parts.length < 3) continue;
    const meshUuid = parts[0];
    const a = parts[1].split(',').map(Number);
    const b = parts[2].split(',').map(Number);
    if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((n) => !Number.isFinite(n))) continue;
    const key = featureId ?? meshUuid;
    const edge: PickedEdge = {
      a: new THREE.Vector3(a[0], a[1], a[2]),
      b: new THREE.Vector3(b[0], b[1], b[2]),
    };
    const existing = byKey.get(key);
    if (existing) { existing.edges.push(edge); }
    else { byKey.set(key, { featureId, meshUuid, edges: [edge] }); }
  }

  let target: ParsedEdges | null = null;
  let best = 0;
  for (const [, v] of byKey) {
    if (v.edges.length > best) { best = v.edges.length; target = v; }
  }
  return target;
}

// ---------------------------------------------------------------------------
// Triangle list + position tolerance
// ---------------------------------------------------------------------------

/** Build a flat triangle list from a NON-INDEXED, world-space geometry. */
export function buildTriangleList(srcGeo: THREE.BufferGeometry): THREE.Vector3[][] {
  const src = srcGeo.attributes.position.array as ArrayLike<number>;
  const tris: THREE.Vector3[][] = [];
  for (let i = 0; i < src.length; i += 9) {
    tris.push([
      new THREE.Vector3(src[i],     src[i + 1], src[i + 2]),
      new THREE.Vector3(src[i + 3], src[i + 4], src[i + 5]),
      new THREE.Vector3(src[i + 6], src[i + 7], src[i + 8]),
    ]);
  }
  return tris;
}

/** Position-equality predicate scaled to the geometry's bounding-box diagonal. */
export function makeNear(srcGeo: THREE.BufferGeometry): (p: THREE.Vector3, q: THREE.Vector3) => boolean {
  srcGeo.computeBoundingBox();
  const diag = srcGeo.boundingBox
    ? srcGeo.boundingBox.min.distanceTo(srcGeo.boundingBox.max)
    : 1;
  const eps = Math.max(diag * 1e-4, 1e-5);
  const epsSq = eps * eps;
  return (p: THREE.Vector3, q: THREE.Vector3) => p.distanceToSquared(q) <= epsSq;
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
): ResolvedEdge | null {
  const adj: { tri: THREE.Vector3[]; ia: number; ib: number; ic: number }[] = [];
  for (const tri of tris) {
    let ia = -1; let ib = -1;
    for (let k = 0; k < 3; k++) {
      if (ia < 0 && near(tri[k], e.a)) ia = k;
      else if (ib < 0 && near(tri[k], e.b)) ib = k;
    }
    if (ia >= 0 && ib >= 0) adj.push({ tri, ia, ib, ic: 3 - ia - ib });
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
  const tris = buildTriangleList(srcGeo);
  const near = makeNear(srcGeo);

  const acc = new THREE.Vector3();
  let n = 0;
  for (const e of edges) {
    const re = resolveEdge(tris, e, near);
    if (!re) continue;
    // Interior bisector (u1+u2) points into the solid; negate for exterior.
    acc.add(re.u1.clone().add(re.u2).normalize().negate());
    n++;
  }
  if (n === 0 || acc.lengthSq() < 1e-9) return null;
  return acc.normalize();
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
): THREE.BufferGeometry | null {
  const tris = buildTriangleList(srcGeo);
  const near = makeNear(srcGeo);

  // Running solid: start from a clone of the source so we never mutate the
  // caller's geometry; subtract each edge cutter in turn.
  let solid: THREE.BufferGeometry = srcGeo.clone();
  let cut = 0;

  for (const e of edges) {
    const re = resolveEdge(tris, e, near);
    if (!re) { console.warn(`[${tag}] edge did not resolve to 2 faces — skipped`); continue; }
    // Small overhang past the edge ends so the boolean is clean at the ends
    // without visibly notching the adjacent faces.
    const eps = Math.max(re.length * 1e-3, 1e-4);
    const cutter = makeCutter(re, eps);
    if (!cutter) { console.warn(`[${tag}] degenerate dihedral — edge skipped`); continue; }
    // three-bvh-csg can throw on degenerate / non-manifold inputs. Catch so
    // one bad edge doesn't abort the whole commit (which would also skip the
    // dialog's onClose).
    let next: THREE.BufferGeometry | null = null;
    try {
      next = GeometryEngine.csgSubtract(solid, cutter);
    } catch (err) {
      console.error(`[${tag}] csgSubtract threw — edge skipped:`, err);
    }
    cutter.dispose();
    if (!next) continue;
    solid.dispose();
    solid = next;
    cut++;
  }

  if (cut === 0) {
    console.warn(`[${tag}] no edges cut → returning null`);
    solid.dispose();
    return null;
  }

  // Guard against an empty result (e.g. size so large the cutter removed the
  // entire body) — storing an empty mesh looks like the body vanished.
  const posCount = (solid.attributes.position as THREE.BufferAttribute | undefined)?.count ?? 0;
  if (posCount === 0) {
    console.warn(`[${tag}] CSG produced empty geometry (size too large?) → null`);
    solid.dispose();
    return null;
  }

  solid.computeVertexNormals();
  solid.computeBoundingBox();
  solid.computeBoundingSphere();
  return solid;
}
