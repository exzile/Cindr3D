/**
 * Shared fillet geometry utilities.
 *
 * Used by both commitFillet (permanent commit) and FilletPreview (live
 * preview while the dialog is open).  Keeping the algorithm in one place
 * guarantees the preview matches the committed result exactly.
 *
 * ── Why CSG and not vertex-dragging ────────────────────────────────────────
 * Extrude bodies are coarsely triangulated — each flat side face is just two
 * big triangles.  The old "rolling-ball" approach moved the shared edge
 * vertices of the two adjacent triangles, which dragged the *entire* face and
 * sliced a giant diagonal wedge off the body instead of rounding the edge.
 *
 * The correct, Fusion-like result is produced with CSG: for each picked edge
 * we build a "corner sliver" cutting tool — a prism that exactly covers the
 * sharp corner material, minus a cylinder of radius r tangent to both faces —
 * and subtract it from the solid.  Only a thin band along the edge is
 * affected; the rest of every face stays perfectly flat.
 */
import * as THREE from 'three';
import { GeometryEngine } from '../../engine/GeometryEngine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilletEdge {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

export interface ParsedFilletEdges {
  /** The featureId prefix from the edge ID, or null for legacy IDs. */
  featureId: string | null;
  /** THREE.js mesh UUID encoded in the edge ID. */
  meshUuid: string;
  /** World-space edge endpoints. */
  edges: FilletEdge[];
}

// ---------------------------------------------------------------------------
// Edge-ID parsing
// ---------------------------------------------------------------------------

/**
 * Parses filletEdgeIds from the store and returns the group with the most
 * edges (i.e. the feature/mesh the user picked the most edges on).
 *
 * Edge ID format:
 *   `${featureId}|${meshUuid}:${ax,ay,az}:${bx,by,bz}`  (new)
 *   `${meshUuid}:${ax,ay,az}:${bx,by,bz}`               (legacy)
 */
export function parseFilletEdgeIds(filletEdgeIds: string[]): ParsedFilletEdges | null {
  const byKey = new Map<string, ParsedFilletEdges>();

  for (const id of filletEdgeIds) {
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
    const edge: FilletEdge = {
      a: new THREE.Vector3(a[0], a[1], a[2]),
      b: new THREE.Vector3(b[0], b[1], b[2]),
    };
    const existing = byKey.get(key);
    if (existing) { existing.edges.push(edge); }
    else { byKey.set(key, { featureId, meshUuid, edges: [edge] }); }
  }

  let target: ParsedFilletEdges | null = null;
  let best = 0;
  for (const [, v] of byKey) {
    if (v.edges.length > best) { best = v.edges.length; target = v; }
  }
  return target;
}

// ---------------------------------------------------------------------------
// Per-edge face resolution
//
// Finds the two triangles that share `edge` (by world-space vertex match) and
// returns the unit in-face perpendiculars u1/u2: each is perpendicular to the
// edge, lies in its face's plane, and points AWAY from the edge into the face
// surface. This part of the old algorithm was correct — only the geometry
// modification (vertex dragging) was wrong, so it's replaced by CSG below.
// ---------------------------------------------------------------------------

interface ResolvedEdge {
  a: THREE.Vector3;
  b: THREE.Vector3;
  edgeDir: THREE.Vector3;
  length: number;
  u1: THREE.Vector3;
  u2: THREE.Vector3;
}

function resolveEdge(
  tris: THREE.Vector3[][],
  e: FilletEdge,
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
 * Direction for the on-canvas fillet radius handle: perpendicular to the
 * picked edge(s), along the EXTERIOR bisector of the two adjacent faces —
 * i.e. pointing away from the solid, toward where the sharp corner was.
 * Averaged over every edge that resolves. Returns null if none resolve, so
 * the caller can fall back to a default axis.
 *
 * `srcGeo` must be non-indexed, world-space (same as computeFilletGeometry).
 */
export function computeFilletGizmoDir(
  srcGeo: THREE.BufferGeometry,
  edges: FilletEdge[],
): THREE.Vector3 | null {
  const src = srcGeo.attributes.position.array as ArrayLike<number>;
  const tris: THREE.Vector3[][] = [];
  for (let i = 0; i < src.length; i += 9) {
    tris.push([
      new THREE.Vector3(src[i],     src[i + 1], src[i + 2]),
      new THREE.Vector3(src[i + 3], src[i + 4], src[i + 5]),
      new THREE.Vector3(src[i + 6], src[i + 7], src[i + 8]),
    ]);
  }
  srcGeo.computeBoundingBox();
  const diag = srcGeo.boundingBox
    ? srcGeo.boundingBox.min.distanceTo(srcGeo.boundingBox.max)
    : 1;
  const eps = Math.max(diag * 1e-4, 1e-5);
  const near = (p: THREE.Vector3, q: THREE.Vector3) =>
    p.distanceToSquared(q) <= eps * eps;

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
// CSG corner-sliver cutting tool
// ---------------------------------------------------------------------------

/**
 * Builds the cutting tool for one edge: a prism that exactly covers the sharp
 * corner material (set back to the fillet tangent lines on both faces) minus
 * a cylinder of radius r tangent to both faces. Subtracting this from the
 * solid replaces the sharp edge with a smooth radius arc.
 *
 * Returns null for degenerate dihedral angles (nearly flat or nearly folded).
 */
function buildEdgeCutter(re: ResolvedEdge, radius: number, radialSeg: number): THREE.BufferGeometry | null {
  const { a, edgeDir, length, u1, u2 } = re;

  // Angle between the two in-face perpendiculars.
  const cosPhi = THREE.MathUtils.clamp(u1.dot(u2), -1, 1);
  const phi = Math.acos(cosPhi);
  // Skip near-coplanar (no real edge) or fully-folded degenerate cases.
  if (phi < 0.05 || phi > Math.PI - 0.05) return null;

  const half = phi / 2;
  const sinHalf = Math.sin(half);
  const tanHalf = Math.tan(half);
  if (sinHalf < 1e-4 || tanHalf < 1e-4) return null;

  // Setback distance along each face to the fillet tangent line, and the
  // distance from the edge to the cylinder axis along the interior bisector.
  const setback = radius / tanHalf;          // tangent point distance along u1/u2
  const axisDist = radius / sinHalf;          // edge → cylinder axis distance
  const bis = u1.clone().add(u2).normalize(); // interior bisector

  // Small overhang past the edge ends so the boolean is clean at the ends
  // without visibly notching the adjacent faces.
  const eps = Math.max(length * 1e-3, 1e-4);

  // ── Corner prism: spans [0,setback] along u1, [0,setback] along u2, and
  //    [-eps, length+eps] along the edge. Built as a unit box then placed
  //    with a basis matrix (columns u1, edgeDir, u2) anchored at edge start.
  const prism = new THREE.BoxGeometry(setback, length + 2 * eps, setback);
  // Box is centered at local origin; shift so the (u1=0, u2=0) corner sits on
  // the edge line and the edge axis spans [-eps, length+eps].
  prism.translate(setback / 2, length / 2, setback / 2);
  const basis = new THREE.Matrix4().makeBasis(u1, edgeDir, u2);
  basis.setPosition(a.x, a.y, a.z);
  prism.applyMatrix4(basis);

  // ── Fillet cylinder: radius r, axis along the edge, through the point
  //    `a + bis*axisDist`, length = edge length + 2*eps.
  //    radialSeg is the FULL-circle segment count; the visible fillet is only
  //    a ~(180°-φ) arc of it, so we need a generous count for a smooth round.
  const cyl = new THREE.CylinderGeometry(radius, radius, length + 2 * eps, Math.max(24, Math.min(96, radialSeg)));
  // Default cylinder axis is +Y → rotate +Y to edgeDir, then position at the
  // axis midpoint.
  const yAxis = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, edgeDir);
  const axisMid = a.clone()
    .add(bis.clone().multiplyScalar(axisDist))
    .add(edgeDir.clone().multiplyScalar(length / 2));
  const cylMat = new THREE.Matrix4().compose(axisMid, quat, new THREE.Vector3(1, 1, 1));
  cyl.applyMatrix4(cylMat);

  // Cutter = prism − cylinder (the sharp sliver between the corner and the arc).
  const cutter = GeometryEngine.csgSubtract(prism, cyl);
  prism.dispose();
  cyl.dispose();
  return cutter;
}

// ---------------------------------------------------------------------------
// Public: compute the filleted geometry
// ---------------------------------------------------------------------------

/**
 * Rounds the given edges on a NON-INDEXED, world-space solid BufferGeometry
 * using CSG. Returns a new BufferGeometry, or null if no eligible edges were
 * resolved (degenerate geometry, edge not shared by two faces, etc.).
 *
 * - `srcGeo` must be non-indexed (call `.toNonIndexed()` before passing).
 * - The caller is responsible for disposing `srcGeo`.
 * - `segments` controls the cylinder's radial smoothness (clamped 8..64).
 */
export function computeFilletGeometry(
  srcGeo: THREE.BufferGeometry,
  edges: FilletEdge[],
  radius: number,
  segments: number,
): THREE.BufferGeometry | null {
  if (!(radius > 0)) return null;

  // Build the triangle list once for edge→face resolution.
  const src = srcGeo.attributes.position.array as ArrayLike<number>;
  const tris: THREE.Vector3[][] = [];
  for (let i = 0; i < src.length; i += 9) {
    tris.push([
      new THREE.Vector3(src[i],     src[i + 1], src[i + 2]),
      new THREE.Vector3(src[i + 3], src[i + 4], src[i + 5]),
      new THREE.Vector3(src[i + 6], src[i + 7], src[i + 8]),
    ]);
  }

  srcGeo.computeBoundingBox();
  const diag = srcGeo.boundingBox
    ? srcGeo.boundingBox.min.distanceTo(srcGeo.boundingBox.max)
    : 1;
  const eps = Math.max(diag * 1e-4, 1e-5);
  const near = (p: THREE.Vector3, q: THREE.Vector3) =>
    p.distanceToSquared(q) <= eps * eps;

  // Running solid: start from a clone of the source so we never mutate the
  // caller's geometry; subtract each edge cutter in turn.
  let solid: THREE.BufferGeometry = srcGeo.clone();
  let rounded = 0;

  for (const e of edges) {
    const re = resolveEdge(tris, e, near);
    if (!re) { console.warn('[fillet] edge did not resolve to 2 faces — skipped'); continue; }
    // `segments` is the arc-resolution hint (~4). Scale up to a full-circle
    // radial count so the visible fillet arc gets ~3× that many facets.
    const radialSeg = Math.max(24, Math.round(segments) * 12);
    const cutter = buildEdgeCutter(re, radius, radialSeg);
    if (!cutter) { console.warn('[fillet] degenerate dihedral — edge skipped'); continue; }
    // three-bvh-csg can throw on degenerate / non-manifold inputs (same
    // reason commitCombine wraps runBoolean). Catch so one bad edge doesn't
    // abort the whole commit (which would also skip the dialog's onClose).
    let next: THREE.BufferGeometry | null = null;
    try {
      next = GeometryEngine.csgSubtract(solid, cutter);
    } catch (err) {
      console.error('[fillet] csgSubtract threw — edge skipped:', err);
    }
    cutter.dispose();
    if (!next) continue;
    solid.dispose();
    solid = next;
    rounded++;
  }

  if (rounded === 0) {
    console.warn('[fillet] no edges rounded → returning null');
    solid.dispose();
    return null;
  }

  // Guard against an empty result (e.g. radius so large the cutter removed
  // the entire body) — storing an empty mesh looks like the body vanished.
  const posCount = (solid.attributes.position as THREE.BufferAttribute | undefined)?.count ?? 0;
  if (posCount === 0) {
    console.warn('[fillet] CSG produced empty geometry (radius too large?) → null');
    solid.dispose();
    return null;
  }

  solid.computeVertexNormals();
  solid.computeBoundingBox();
  solid.computeBoundingSphere();
  return solid;
}
