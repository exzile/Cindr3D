/**
 * edgeTopology.ts — explicit model-edge extraction from a CSG result.
 *
 * The live body geometry produced by three-bvh-csg is a triangle soup with no
 * recoverable edge topology once it has been `toNonIndexed()`-split for sharp
 * cut normals. Reconstructing edges from that soup in the picker is provably
 * impossible (it is non-manifold even after aggressive welding).
 *
 * The fix is to extract the edges HERE, at CSG time, where the information
 * still exists, using three-bvh-csg's own position-hashed `HalfEdgeMap`
 * (with `matchDisjointEdges` it resolves the T-junctions that defeat naive
 * adjacency). A "model edge" is then either:
 *   • a boundary half-edge (no sibling — a genuine open rim; rare on solids), or
 *   • a crease: the two triangles sharing the edge meet at a dihedral > 30°.
 * Coplanar triangulation diagonals (dihedral ≈ 0°) are NOT edges and are
 * discarded — this is reliable because adjacency is now correct.
 *
 * Connected, tangent-continuous crease segments are chained into whole model
 * edges (a box edge → one straight polyline corner-to-corner; a hole rim → one
 * closed loop), so selection/highlight/cut operate on complete edges.
 *
 * Output is LOCAL-space (same frame as the geometry) and attached to the body
 * via `geometry.userData.topology`. Rendering is unaffected — this is purely
 * additive metadata.
 */
import * as THREE from 'three';
import { HalfEdgeMap } from 'three-bvh-csg';
import { modelEdgeId } from './edgeId';

type HalfEdgeMapWithDisjointEdges = HalfEdgeMap & {
  matchDisjointEdges: boolean;
  useDrawRange: boolean;
  getDisjointSiblingTriangleIndices(triIndex: number, edgeIndex: number): number[];
};

export interface ModelEdge {
  /** Stable id (canonical endpoint hash) — same regardless of which segment was hit. */
  id: string;
  /** Ordered LOCAL-space polyline. Straight edge → 2 points; arc/loop → many; closed loop repeats the first point. */
  polyline: THREE.Vector3[];
  kind: 'crease' | 'boundary';
}

export interface BodyTopology {
  edges: ModelEdge[];
}

const HARD_EDGE_COS = Math.cos(30 * Math.PI / 180); // crease threshold

interface RawEdge { ka: string; kb: string; kind: 'crease' }

/** Quantized vertex key (bbox-relative) for chaining the extracted segments. */
function keyFn(x: number, y: number, z: number, q: number): string {
  return `${Math.round(x / q)}_${Math.round(y / q)}_${Math.round(z / q)}`;
}

/**
 * Extract the model-edge topology of a CSG result.
 *
 * `geo` may be indexed or non-indexed; positions are read in LOCAL space.
 * HalfEdgeMap hashes by position so welding is not required, and
 * `matchDisjointEdges` stitches the T-junctioned cut seams that otherwise
 * masquerade as boundary edges.
 */
export function extractEdgeTopology(geo: THREE.BufferGeometry): BodyTopology {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos || pos.count < 3) return { edges: [] };

  const index = geo.index;
  const triCount = (index ? index.count : pos.count) / 3 | 0;
  const vi = (t: number, c: number): number =>
    index ? index.getX(t * 3 + c) : t * 3 + c;

  // bbox diagonal → quantization step for the chaining weld.
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const diag = bb.min.distanceTo(bb.max) || 1;
  const q = Math.max(diag * 1e-4, 1e-5);

  // Per-triangle unit normal (local space).
  const nx = new Float64Array(triCount);
  const ny = new Float64Array(triCount);
  const nz = new Float64Array(triCount);
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _e1 = new THREE.Vector3();
  const _e2 = new THREE.Vector3();
  const _n = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    _a.fromBufferAttribute(pos, vi(t, 0));
    _b.fromBufferAttribute(pos, vi(t, 1));
    _c.fromBufferAttribute(pos, vi(t, 2));
    _e1.subVectors(_b, _a);
    _e2.subVectors(_c, _a);
    _n.crossVectors(_e1, _e2);
    const L = _n.length();
    if (L < 1e-12) { nx[t] = 0; ny[t] = 0; nz[t] = 0; continue; }
    nx[t] = _n.x / L; ny[t] = _n.y / L; nz[t] = _n.z / L;
  }

  // ── Coplanar-region segmentation ─────────────────────────────────────────
  // Per-triangle normals on the soup are noisy near the hole, so a raw
  // dihedral mis-flags flat-face fan diagonals as creases (the 5 residual
  // hole-region lines). Instead, group triangles into maximal coplanar regions
  // (connected via a shared WELDED vertex — bridges the CSG cracks/T-junctions
  // within one flat face) and crease-test by REGION normals. A diagonal
  // interior to the flat annular face then has the SAME region on both sides
  // ⇒ never a crease, regardless of soup noise. Box edges (two different flat
  // regions) and the rim (flat region vs dome facets) remain creases.
  const vId = new Int32Array(triCount * 3).fill(-1);
  {
    const km = new Map<string, number>();
    let next = 0;
    for (let t = 0; t < triCount; t++)
      for (let c = 0; c < 3; c++) {
        const i = vi(t, c);
        const k = keyFn(pos.getX(i), pos.getY(i), pos.getZ(i), q);
        let id = km.get(k);
        if (id === undefined) { id = next++; km.set(k, id); }
        vId[t * 3 + c] = id;
      }
  }
  const parent = new Int32Array(triCount);
  for (let t = 0; t < triCount; t++) parent[t] = t;
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const COPLANAR_DOT = Math.cos(2 * Math.PI / 180);
  const offTol = Math.max(diag * 1e-4, 1e-5);
  // vertex-id → triangles touching it
  const vTris = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++)
    for (let c = 0; c < 3; c++) {
      const id = vId[t * 3 + c];
      (vTris.get(id) ?? vTris.set(id, []).get(id)!).push(t);
    }
  // Signed offset of t1's plane measured along t0's normal (so two parallel
  // but offset faces of a thin slab never merge into one region).
  const coplanar = (t0: number, t1: number): boolean => {
    const d = nx[t0] * nx[t1] + ny[t0] * ny[t1] + nz[t0] * nz[t1];
    if (Math.abs(d) < COPLANAR_DOT) return false;
    _a.fromBufferAttribute(pos, vi(t0, 0));
    const o0 = nx[t0] * _a.x + ny[t0] * _a.y + nz[t0] * _a.z;
    _b.fromBufferAttribute(pos, vi(t1, 0));
    const o1 = nx[t0] * _b.x + ny[t0] * _b.y + nz[t0] * _b.z;
    return Math.abs(o0 - o1) <= offTol;
  };
  for (const tris of vTris.values()) {
    for (let i = 1; i < tris.length; i++) {
      if (coplanar(tris[0], tris[i])) union(tris[0], tris[i]);
    }
  }
  // region → area-weighted accumulated normal
  const regN = new Map<number, THREE.Vector3>();
  for (let t = 0; t < triCount; t++) {
    if (nx[t] === 0 && ny[t] === 0 && nz[t] === 0) continue;
    const r = find(t);
    let v = regN.get(r);
    if (!v) { v = new THREE.Vector3(); regN.set(r, v); }
    v.x += nx[t]; v.y += ny[t]; v.z += nz[t];
  }
  for (const v of regN.values()) { const L = v.length(); if (L > 1e-12) v.divideScalar(L); }

  // position-id → set of coplanar-region roots touching it.
  // Used in the crease loop below to rescue genuine face-boundary edges whose
  // triangle edge has no HalfEdgeMap sibling (CSG diagonal triangulation at a
  // box corner): both endpoints of such an edge touch two distinct regions with
  // dihedral > 30° even though no triangle edge is aligned with the boundary.
  const posRegions = new Map<number, Set<number>>();
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    for (let c = 0; c < 3; c++) {
      const pid = vId[t * 3 + c];
      let rs = posRegions.get(pid);
      if (!rs) { rs = new Set<number>(); posRegions.set(pid, rs); }
      rs.add(r);
    }
  }

  const regionCrease = (t0: number, t1: number): boolean => {
    const r0 = find(t0), r1 = find(t1);
    if (r0 === r1) return false;                 // same flat region → not a crease
    const n0 = regN.get(r0), n1 = regN.get(r1);
    if (!n0 || !n1) return false;
    return Math.abs(n0.dot(n1)) < HARD_EDGE_COS; // distinct regions, >30° → crease
  };

  // Position-hashed half-edge map; disjoint matching stitches CSG T-junctions.
  const hem = new HalfEdgeMap() as HalfEdgeMapWithDisjointEdges;
  hem.matchDisjointEdges = true;
  hem.useDrawRange = false;
  try {
    hem.updateFrom(geo);
  } catch {
    return { edges: [] }; // never break the CSG path on a topology hiccup
  }

  // ── Collect crease / boundary segments (deduped by canonical endpoint key) ──
  const rawByKey = new Map<string, RawEdge>();
  const keyPos = new Map<string, THREE.Vector3>();
  const _p0 = new THREE.Vector3();
  const _p1 = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const va = vi(t, e);
      const vb = vi(t, (e + 1) % 3);
      _p0.fromBufferAttribute(pos, va);
      _p1.fromBufferAttribute(pos, vb);
      const ka = keyFn(_p0.x, _p0.y, _p0.z, q);
      const kb = keyFn(_p1.x, _p1.y, _p1.z, q);
      if (ka === kb) continue;
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;

      if (rawByKey.has(ek)) continue;

      const sib = hem.getSiblingTriangleIndex(t, e);
      const disj = hem.getDisjointSiblingTriangleIndices(t, e);

      // The input has been welded + cleaned toward a manifold solid before
      // this runs (csgSubtractWithTopology), which removes the LONG broken-fan
      // diagonals. Residual non-manifoldness around a through-cut still makes
      // matchDisjointEdges phantom-pair a few fan splinters with wall facets,
      // so two complementary guards keep the result clean:

      // (1) A real model edge's two faces have different normals (different
      // coplanar regions). A MANIFOLD sibling in the SAME coplanar region ⇒
      // interior triangulation diagonal ⇒ never a model edge; skip outright
      // and do NOT consult the disjoint match for it.
      if (sib !== -1 && find(t) === find(sib)) continue;

      // Crease ⟺ the edge separates two DIFFERENT coplanar regions whose
      // (robust, region-averaged) normals diverge > 30°.
      let sharp = false;
      if (sib !== -1 && regionCrease(t, sib)) sharp = true;
      // (2) No manifold neighbour. Trust a disjoint (T-junction) pair only
      // when the sibling triangle GEOMETRICALLY owns this edge.
      //
      // ORIGINAL CHECK: a sibling edge exactly spans _p0→_p1 (both endpoints
      // within weld tolerance). This handles the common case where both faces
      // have the same tessellation density.
      //
      // SUB-SEGMENT CHECK: a sibling edge whose BOTH endpoints lie on the
      // infinite line through _p0→_p1 (within a relaxed collinearity tolerance).
      // This handles the case where one face is subdivided into many small
      // triangles by T-junctions (e.g. fillet CSG creates a large diagonal
      // triangle on the top face spanning the whole left-top edge, while the
      // left face has many smaller triangles — no single left-face triangle spans
      // the full edge, but each one IS collinear with it). Both checks still
      // require regionCrease to pass, which filters out same-face diagonals.
      if (!sharp && sib === -1) {
        const tolSq = q * q;
        // Direction vector of the target half-edge (for sub-segment test).
        const _edx = _p1.x - _p0.x, _edy = _p1.y - _p0.y, _edz = _p1.z - _p0.z;
        const _edLenSq = _edx * _edx + _edy * _edy + _edz * _edz;
        // Relaxed tolerance: 10× weld tol, at least 1e-6. Fine enough to reject
        // off-axis fillet arcs, loose enough to accept floating-point jitter on a
        // shared flat face boundary.
        const collinTolSq = Math.max(tolSq * 100, 1e-6);
        for (const ds of disj) {
          if (!regionCrease(t, ds)) continue;
          for (let dc = 0; dc < 3; dc++) {
            const da = vi(ds, dc);
            const db = vi(ds, (dc + 1) % 3);
            const dax = pos.getX(da), day = pos.getY(da), daz = pos.getZ(da);
            const dbx = pos.getX(db), dby = pos.getY(db), dbz = pos.getZ(db);
            // Exact-endpoint match (original check).
            const m00 = (dax - _p0.x) ** 2 + (day - _p0.y) ** 2 + (daz - _p0.z) ** 2;
            const m11 = (dbx - _p1.x) ** 2 + (dby - _p1.y) ** 2 + (dbz - _p1.z) ** 2;
            const m01 = (dax - _p1.x) ** 2 + (day - _p1.y) ** 2 + (daz - _p1.z) ** 2;
            const m10 = (dbx - _p0.x) ** 2 + (dby - _p0.y) ** 2 + (dbz - _p0.z) ** 2;
            if ((m00 <= tolSq && m11 <= tolSq) || (m01 <= tolSq && m10 <= tolSq)) {
              sharp = true;
              break;
            }
            // Sub-segment match: both endpoints of the disjoint sibling's edge
            // must lie on the line through _p0→_p1.
            if (_edLenSq > 1e-12) {
              const onLine = (px: number, py: number, pz: number): boolean => {
                const wx = px - _p0.x, wy = py - _p0.y, wz = pz - _p0.z;
                const tProj = (wx * _edx + wy * _edy + wz * _edz) / _edLenSq;
                const rx = wx - tProj * _edx, ry = wy - tProj * _edy, rz = wz - tProj * _edz;
                return rx * rx + ry * ry + rz * rz <= collinTolSq;
              };
              if (onLine(dax, day, daz) && onLine(dbx, dby, dbz)) {
                sharp = true;
                break;
              }
            }
          }
          if (sharp) break;
        }
      }
      // posRegions fallback — runs for any sib=-1 edge that neither the manifold
      // nor the disjoint check resolved. This covers two failure modes:
      //   (A) disj=0: pure lone half-edge — artifact unless both endpoints
      //       touch a common OTHER region with dihedral > 30°.
      //   (B) disj>0 but ALL disjoint siblings in the SAME region as t
      //       (e.g. the opposite face is subdivided into many small triangles
      //       whose disjoint matches are top-face fragments, not the adjacent
      //       flat face — the actual adjacent face ALSO has T-junction matches
      //       but they share the current region, so regionCrease returns false
      //       for every one).
      //
      // Safety: we only rescue when BOTH endpoints share a COMMON OTHER region
      // with clearly different normal (>30°). Interior diagonals fail this test
      // because their endpoints' regions don't share any common OTHER region.
      if (!sharp && sib === -1) {
        const rThis = find(t);
        const nThis = regN.get(rThis);
        if (nThis) {
          const pidA = vId[t * 3 + e];
          const pidB = vId[t * 3 + (e + 1) % 3];
          const rsA = posRegions.get(pidA);
          const rsB = posRegions.get(pidB);
          if (rsA && rsB) {
            for (const rOther of rsA) {
              if (rOther === rThis || !rsB.has(rOther)) continue;
              const nOther = regN.get(rOther);
              if (nOther && Math.abs(nThis.dot(nOther)) < HARD_EDGE_COS) {
                sharp = true;
                break;
              }
            }
          }
        }
      }

      if (!sharp) continue;

      if (!keyPos.has(ka)) keyPos.set(ka, _p0.clone());
      if (!keyPos.has(kb)) keyPos.set(kb, _p1.clone());
      rawByKey.set(ek, { ka, kb, kind: 'crease' });
    }
  }

  if (rawByKey.size === 0) return { edges: [] };

  // ── Chain crease segments into whole model edges ─────────────────────────
  // Line-clustering (collinear + connected), the only approach proven robust
  // on this non-manifold soup: a straight model edge is the maximal set of
  // crease segments that lie on — and are connected along — one infinite line.
  // It grows straight through soup noise and stops exactly at real corners
  // (the adjacent edge is perpendicular ⇒ off the line), so every
  // box/rectangle edge collapses to its two true extreme endpoints. Curved
  // crease arcs (a hole rim) are not collinear, so they remain per-segment —
  // a documented limitation (rim selects per-arc, not as one loop) pending the
  // manifold-pipeline work; this is acceptable and never produces a spurious
  // surface line because only creases are emitted.
  interface Seg { a: string; b: string; }
  const segs: Seg[] = [];
  const vertSegs = new Map<string, number[]>();
  for (const r of rawByKey.values()) {
    const i = segs.length;
    segs.push({ a: r.ka, b: r.kb });
    (vertSegs.get(r.ka) ?? vertSegs.set(r.ka, []).get(r.ka)!).push(i);
    (vertSegs.get(r.kb) ?? vertSegs.set(r.kb, []).get(r.kb)!).push(i);
  }

  const lexLess = (a: THREE.Vector3, b: THREE.Vector3): boolean =>
    a.x !== b.x ? a.x < b.x : a.y !== b.y ? a.y < b.y : a.z < b.z;
  const PARA_DOT = Math.cos(8 * Math.PI / 180);
  const lineTol = Math.max(diag * 1e-3, 1e-4);
  const lineTolSq = lineTol * lineTol;
  const distSqToLine = (P: THREE.Vector3, O: THREE.Vector3, D: THREE.Vector3): number => {
    const wx = P.x - O.x, wy = P.y - O.y, wz = P.z - O.z;
    const tt = wx * D.x + wy * D.y + wz * D.z;
    return wx * wx + wy * wy + wz * wz - tt * tt;
  };

  const edges: ModelEdge[] = [];
  const used = new Set<number>();
  const _D = new THREE.Vector3();
  const _ed = new THREE.Vector3();
  for (let si = 0; si < segs.length; si++) {
    if (used.has(si)) continue;
    const sA = keyPos.get(segs[si].a)!;
    const sB = keyPos.get(segs[si].b)!;
    _D.subVectors(sB, sA);
    const dl = _D.length();
    const mk = (p0: THREE.Vector3, p1: THREE.Vector3): THREE.Vector3[] =>
      (lexLess(p0, p1) ? [p0.clone(), p1.clone()] : [p1.clone(), p0.clone()]);
    if (dl < 1e-9) {
      used.add(si);
      const pts = mk(sA, sB);
      edges.push({ id: modelEdgeId(pts), polyline: pts, kind: 'crease' });
      continue;
    }
    _D.divideScalar(dl);
    const O = sA;
    const onLine = (s: Seg): boolean => {
      const pa = keyPos.get(s.a)!; const pb = keyPos.get(s.b)!;
      if (distSqToLine(pa, O, _D) > lineTolSq) return false;
      if (distSqToLine(pb, O, _D) > lineTolSq) return false;
      _ed.subVectors(pb, pa);
      const el = _ed.length() || 1;
      return Math.abs(_ed.dot(_D) / el) >= PARA_DOT;
    };
    const cluster: number[] = [si];
    const seen = new Set<number>([si]);
    const stack = [si];
    while (stack.length) {
      const idx = stack.pop()!;
      if (!onLine(segs[idx])) continue;
      for (const vk of [segs[idx].a, segs[idx].b]) {
        for (const ni of vertSegs.get(vk) ?? []) {
          if (seen.has(ni)) continue;
          seen.add(ni);
          if (onLine(segs[ni])) { stack.push(ni); cluster.push(ni); }
        }
      }
    }
    // Collapsing the cluster to its two extreme points (a single straight
    // 2-point edge) is only valid when the cluster is GENUINELY STRAIGHT. The
    // grow tolerance `lineTol` (diag·1e-3) is deliberately loose so a noisy
    // box-edge soup still chains; but on the non-manifold rim of a CSG cut it
    // also chains short arc facets that bow gently within lineTol, then the
    // pMin→pMax collapse turns that arc into a long straight chord that
    // matches NO triangle edge — the spurious diagonal that can't be
    // chamfered (`resolveEdge` finds no two faces).
    //
    // So measure the real perpendicular deviation of every cluster point from
    // the line at the TIGHT weld tolerance `q`. A straight box edge's soup
    // fragments sit on the true line to fp-noise (≪ q) → collapse as before
    // (preserves the resolveEdge split-edge fallback). Anything that bows more
    // than q is a curved/soup run → emit each member segment individually:
    // every segment IS a real mesh triangle edge, so the rim highlights as the
    // true arc and chamfer resolves each facet (the documented
    // "rim selects per-arc" behaviour — never a spurious chord).
    let tMin = Infinity, tMax = -Infinity;
    let pMin = sA, pMax = sB;
    let maxDevSq = 0;
    for (const ci of cluster) {
      used.add(ci);
      for (const vk of [segs[ci].a, segs[ci].b]) {
        const P = keyPos.get(vk)!;
        const tt = (P.x - O.x) * _D.x + (P.y - O.y) * _D.y + (P.z - O.z) * _D.z;
        if (tt < tMin) { tMin = tt; pMin = P; }
        if (tt > tMax) { tMax = tt; pMax = P; }
        const dSq = distSqToLine(P, O, _D);
        if (dSq > maxDevSq) maxDevSq = dSq;
      }
    }
    // Drop edges shorter than the weld tolerance: a weld-collapsed CSG sliver
    // leaves a near-zero-length crease fragment that is not a real model edge
    // and only clutters the picker.
    const qSq = q * q;
    if (cluster.length === 1 || maxDevSq <= qSq) {
      if (pMin.distanceToSquared(pMax) >= qSq) {
        const pts = mk(pMin, pMax);
        edges.push({ id: modelEdgeId(pts), polyline: pts, kind: 'crease' });
      }
    } else {
      for (const ci of cluster) {
        const a = keyPos.get(segs[ci].a)!;
        const b = keyPos.get(segs[ci].b)!;
        if (a.distanceToSquared(b) < qSq) continue;
        const segPts = mk(a, b);
        edges.push({ id: modelEdgeId(segPts), polyline: segPts, kind: 'crease' });
      }
    }
  }

  return { edges };
}
