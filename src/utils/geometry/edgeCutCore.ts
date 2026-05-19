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
import { liveBodyMeshes } from '../../store/meshRegistry';
// weldAndCleanSolid moved to engine/geometryEngine/core/solid/weldClean.ts so
// csg.ts can clean a CSG result without the csg → edgeCutCore → GeometryEngine
// → csg import cycle. Imported here for internal use by computeEdgeCutGeometry;
// re-exported below so existing external consumers keep importing it from here.
import { weldAndCleanSolid } from '../../engine/geometryEngine/core/solid/weldClean';
export { weldAndCleanSolid } from '../../engine/geometryEngine/core/solid/weldClean';

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
    for (let pi = 1; pi < parts.length; pi++) {
      const c = parts[pi].split(',').map(Number);
      if (c.length !== 3 || c.some((n) => !Number.isFinite(n))) { pts.length = 0; break; }
      pts.push(new THREE.Vector3(c[0], c[1], c[2]));
    }
    if (pts.length < 2) continue;
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
  // Primary pass: find triangles that share BOTH edge endpoints as exact vertices.
  const adj: { tri: THREE.Vector3[]; ia: number; ib: number; ic: number }[] = [];
  for (const tri of tris) {
    let ia = -1; let ib = -1;
    for (let k = 0; k < 3; k++) {
      if (ia < 0 && near(tri[k], e.a)) ia = k;
      else if (ib < 0 && near(tri[k], e.b)) ib = k;
    }
    if (ia >= 0 && ib >= 0) adj.push({ tri, ia, ib, ic: 3 - ia - ib });
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
    for (const tri of tris) {
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

  // Dedupe edges by GEOMETRY (endpoint pair, either direction, within the
  // edge-match tolerance). Tangent-edge propagation and live-preview
  // re-registration routinely hand the SAME physical edge in multiple times
  // (sometimes slightly jittered); cutting it twice double-bevels it and adds
  // spurious geometry / can over-cut. One cut per distinct edge is correct.
  const uniqueEdges: PickedEdge[] = [];
  for (const e of edges) {
    const dup = uniqueEdges.some(
      (u) =>
        (near(u.a, e.a) && near(u.b, e.b)) ||
        (near(u.a, e.b) && near(u.b, e.a)),
    );
    if (!dup) uniqueEdges.push(e);
  }

  // Running solid: start from a clone of the source so we never mutate the
  // caller's geometry; subtract each edge cutter in turn.
  let solid: THREE.BufferGeometry = srcGeo.clone();
  let cut = 0;

  for (const e of uniqueEdges) {
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
    // Re-weld the soup three-bvh-csg just produced into a clean manifold
    // before the next cutter slices it (and so the final result is clean):
    // this is what eliminates the degenerate sliver/spike at shared corners.
    try {
      const cleaned = weldAndCleanSolid(next);
      next.dispose();
      solid = cleaned;
    } catch (err) {
      console.error(`[${tag}] weld/clean failed — keeping raw CSG result:`, err);
      solid = next;
    }
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