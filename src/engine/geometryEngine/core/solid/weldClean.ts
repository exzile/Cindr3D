/**
 * weldClean.ts — weld + clean a three-bvh-csg result into a manifold solid,
 * collapsing the "broken-face fan" back to a minimal triangulation.
 *
 * Pure geometry (THREE only) — extracted verbatim from edgeCutCore.ts (2026-05)
 * so csg.ts can clean a CSG result BEFORE topology extraction without the
 * csg → edgeCutCore → GeometryEngine → csg import cycle. edgeCutCore.ts now
 * re-exports `weldAndCleanSolid` from here; behaviour is byte-identical.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Re-triangulates every connected, coplanar region of a welded triangle soup.
 *
 * Why: a box/extrude side or top face is a coarse 2-triangle quad. When
 * three-bvh-csg subtracts a chamfer/fillet cutter whose setback face is
 * EXACTLY coplanar with that source face, and the cut crosses the quad's
 * internal triangulation diagonal, it does not emit a clean quad-with-notch —
 * it fans the whole flat face into ~12 sliver triangles (one of them a giant
 * skewed triangle = the visible "broken/disappearing face"). Welding alone
 * can't fix this: the fan triangles are all non-degenerate and properly
 * shared, just badly shaped.
 *
 * The fix is purely topological and shape-preserving: a flat face is a flat
 * face no matter how it is triangulated, so we find each maximal connected
 * set of coplanar triangles, recover its boundary polygon (outer loop + any
 * holes — e.g. the notch a fillet/chamfer leaves), and re-triangulate that
 * polygon cleanly with ear-clipping in the face's 2D plane. Real seams are
 * preserved because they are either plane boundaries (different normal → not
 * in the same region) or boundary-loop vertices (kept by ear-clipping);
 * only INTERIOR fan vertices, which carry no shape, are removed.
 *
 * Conservative: any region whose boundary can't be cleanly recovered or
 * re-triangulated is emitted unchanged, so this can only ever match or
 * reduce the triangle count of a flat region, never corrupt it.
 *
 * `posIn` is a flat xyz triangle-soup (9 floats/tri), already welded and
 * degenerate-free. Returns a new flat triangle-soup.
 */
export function retriangulateCoplanarRegions(
  posIn: Float32Array,
  diag: number,
): Float32Array {
  const triCount = (posIn.length / 9) | 0;
  if (triCount === 0) return posIn;

  // ── Weld positions to integer vertex ids for adjacency. Uses makeNear's
  //    edge-match tolerance (diag·1e-4) — the SAME tolerance the driver
  //    already uses to decide two world points are the same edge endpoint —
  //    not the tighter mergeVertices weld tol: three-bvh-csg leaves seam
  //    duplicates a few ·1e-3 apart (e.g. an `eps`-overhang point at 8.002 vs
  //    its mate at 8.000) that the tight weld can't fuse; at this looser tol
  //    they collapse so a face that the boolean split on that seam re-merges
  //    into ONE region (kills the residual non-manifold rim). This only
  //    affects retriangulated flat regions; it never loosens the global weld.
  //    A 3×3×3 neighbour probe makes it robust to points straddling a cell
  //    boundary (plain grid-rounding alone would miss those).
  const q = Math.max(diag * 1e-4, 1e-5);
  const idOf = new Map<string, number>();
  const vx: number[] = [];
  const vy: number[] = [];
  const vz: number[] = [];
  const vid = (x: number, y: number, z: number): number => {
    const cx = Math.round(x / q), cy = Math.round(y / q), cz = Math.round(z / q);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const hit = idOf.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (hit !== undefined) {
            const ddx = vx[hit] - x, ddy = vy[hit] - y, ddz = vz[hit] - z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= q * q) return hit;
          }
        }
    const id = vx.length;
    idOf.set(`${cx},${cy},${cz}`, id);
    vx.push(x); vy.push(y); vz.push(z);
    return id;
  };

  const triV = new Int32Array(triCount * 3);
  const nrm = new Float32Array(triCount * 3); // unit normal per tri
  const planeD = new Float32Array(triCount);
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const cr = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const i0 = vid(posIn[o],     posIn[o + 1], posIn[o + 2]);
    const i1 = vid(posIn[o + 3], posIn[o + 4], posIn[o + 5]);
    const i2 = vid(posIn[o + 6], posIn[o + 7], posIn[o + 8]);
    triV[t * 3] = i0; triV[t * 3 + 1] = i1; triV[t * 3 + 2] = i2;
    e1.set(posIn[o + 3] - posIn[o], posIn[o + 4] - posIn[o + 1], posIn[o + 5] - posIn[o + 2]);
    e2.set(posIn[o + 6] - posIn[o], posIn[o + 7] - posIn[o + 1], posIn[o + 8] - posIn[o + 2]);
    cr.crossVectors(e1, e2);
    const L = cr.length() || 1;
    nrm[t * 3] = cr.x / L; nrm[t * 3 + 1] = cr.y / L; nrm[t * 3 + 2] = cr.z / L;
    planeD[t] = (nrm[t * 3] * posIn[o] + nrm[t * 3 + 1] * posIn[o + 1] + nrm[t * 3 + 2] * posIn[o + 2]);
  }

  // ── Group triangles into connected coplanar regions. Two triangles join a
  //    region when they share a welded edge AND have ~parallel normals AND
  //    the same signed plane offset (so two opposite parallel faces of a thin
  //    slab never merge through a shared rim).
  // Only near-exactly-coplanar triangles may share a region. A flat face the
  // boolean fanned stays mathematically in its plane (coplanar to fp-noise),
  // while a fillet's rounded facet is clearly off-plane — keep the tol tight
  // so the arc never gets swallowed into an adjacent face. The per-region
  // area-preservation guard below is the real safety net (it rejects any
  // region whose collapse would change the surface), so this only needs to
  // be tight enough to keep curved strips out of flat regions.
  const nrmTol = 1e-5;                       // grow only near-exact coplanar
  const dTol = Math.max(diag * 1e-5, 1e-6);  // plane-offset slop
  const region = new Int32Array(triCount).fill(-1);

  // vertex id → list of triangle indices touching it. We grow regions by
  // shared VERTEX (not just shared edge) so a coplanar face that three-bvh-csg
  // split into pieces joined only at a seam-duplicate point still merges into
  // ONE region — otherwise each piece stays a 2-tri "island" whose rim
  // T-junctions its neighbour (the leftover non-manifold edges). The
  // coplanarity test (parallel normal + equal signed offset) still prevents
  // two genuinely different faces that merely touch from merging.
  const vertTris = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    for (let j = 0; j < 3; j++) {
      const id = triV[t * 3 + j];
      const arr = vertTris.get(id);
      if (arr) arr.push(t); else vertTris.set(id, [t]);
    }
  }
  const sameplane = (t1: number, t2: number): boolean => {
    const dot = nrm[t1 * 3] * nrm[t2 * 3] + nrm[t1 * 3 + 1] * nrm[t2 * 3 + 1] + nrm[t1 * 3 + 2] * nrm[t2 * 3 + 2];
    if (dot < 1 - nrmTol) return false;            // not parallel (or anti-parallel)
    return Math.abs(planeD[t1] - planeD[t2]) <= dTol;
  };

  let regionCount = 0;
  const stack: number[] = [];
  for (let s = 0; s < triCount; s++) {
    if (region[s] !== -1) continue;
    const rid = regionCount++;
    region[s] = rid;
    stack.length = 0;
    stack.push(s);
    while (stack.length) {
      const t = stack.pop() as number;
      for (let j = 0; j < 3; j++) {
        const arr = vertTris.get(triV[t * 3 + j]);
        if (!arr) continue;
        for (const nt of arr) {
          if (nt === t || region[nt] !== -1) continue;
          if (!sameplane(t, nt)) continue;
          region[nt] = rid;
          stack.push(nt);
        }
      }
    }
  }

  // ── Per region: recover boundary loops and re-triangulate.
  const regionTris: number[][] = Array.from({ length: regionCount }, () => []);
  for (let t = 0; t < triCount; t++) regionTris[region[t]].push(t);

  // A vertex shared by triangles in >1 region is a real model corner / lies on
  // a seam another (un-retriangulated) face also references. Removing it here
  // would T-junction that neighbour → non-manifold. Such vertices are PINNED:
  // kept in every boundary loop even when locally collinear.
  const vRegions = new Map<number, number>(); // vertex → first region seen
  const pinned = new Set<number>();
  for (let t = 0; t < triCount; t++) {
    const r = region[t];
    for (let j = 0; j < 3; j++) {
      const id = triV[t * 3 + j];
      const prev = vRegions.get(id);
      if (prev === undefined) vRegions.set(id, r);
      else if (prev !== r) pinned.add(id);
    }
  }

  const outFloats: number[] = [];
  const emitOriginal = (t: number) => {
    const o = t * 9;
    for (let k = 0; k < 9; k++) outFloats.push(posIn[o + k]);
  };

  for (let r = 0; r < regionCount; r++) {
    const ts = regionTris[r];
    // A ≤2-tri region is already minimal (a quad or single tri) — nothing to
    // collapse, and re-deriving its rim risks introducing the very seam
    // mismatch we're avoiding. Emit it unchanged.
    if (ts.length <= 2) { for (const t of ts) emitOriginal(t); continue; }

    // PLANARITY GATE. Region growth is transitive over near-parallel facet
    // pairs, so a finely-faceted CURVED surface (a fillet's rounded arc, even
    // a weld-degraded shallow one tangent to its flat neighbour) can get
    // walked into a flat face's region. Flattening it would erase the round.
    //
    // A boolean does NOT rotate a flat face's plane, so a genuine flat CSG
    // fan's triangles all carry the SAME normal to fp-noise (≈1e-7). Any
    // region that absorbed even one arc facet shows a measurably larger
    // normal spread. Reject on (a) per-triangle normal spread from the modal
    // normal OR (b) any vertex out of a tight plane band. A pure flat fan
    // (the chamfer defect) passes both; anything carrying curvature is left
    // untouched so the round survives.
    {
      let nax = 0, nay = 0, naz = 0, cx0 = 0, cy0 = 0, cz0 = 0;
      for (const t of ts) {
        const o = t * 9;
        nax += nrm[t * 3]; nay += nrm[t * 3 + 1]; naz += nrm[t * 3 + 2];
        cx0 += posIn[o] + posIn[o + 3] + posIn[o + 6];
        cy0 += posIn[o + 1] + posIn[o + 4] + posIn[o + 7];
        cz0 += posIn[o + 2] + posIn[o + 5] + posIn[o + 8];
      }
      const nl = Math.hypot(nax, nay, naz) || 1;
      nax /= nl; nay /= nl; naz /= nl;
      const inv = 1 / (ts.length * 3);
      cx0 *= inv; cy0 *= inv; cz0 *= inv;
      // (a) normal-spread: each tri's normal must be within ~0.06° of modal.
      const minDot = 1 - 1e-6;
      // (b) plane band: tight, so a shallow bow still trips it.
      const planeBand = Math.max(diag * 1e-5, 1e-6);
      let curved = false;
      for (const t of ts) {
        const dotN = nrm[t * 3] * nax + nrm[t * 3 + 1] * nay + nrm[t * 3 + 2] * naz;
        if (dotN < minDot) { curved = true; break; }
        const o = t * 9;
        for (let k = 0; k < 9; k += 3) {
          const d = (posIn[o + k] - cx0) * nax + (posIn[o + k + 1] - cy0) * nay + (posIn[o + k + 2] - cz0) * naz;
          if (Math.abs(d) > planeBand) { curved = true; break; }
        }
        if (curved) break;
      }
      if (curved) { for (const t of ts) emitOriginal(t); continue; }
    }

    // Directed boundary half-edges: an edge interior to the region appears
    // once in each direction; a boundary edge appears in one direction only.
    const dirCount = new Map<string, number>();
    const dKey = (u: number, v: number) => `${u}_${v}`;
    for (const t of ts) {
      const a = triV[t * 3], b = triV[t * 3 + 1], c = triV[t * 3 + 2];
      for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
        dirCount.set(dKey(u, v), (dirCount.get(dKey(u, v)) ?? 0) + 1);
      }
    }
    // Net half-edges: an interior edge of the region is traversed once in
    // each direction (net 0); a boundary edge survives once. Each surviving
    // directed edge u→v is a directed boundary segment.
    const bsegs: [number, number][] = [];
    let boundaryOk = true;
    const seen = new Set<string>();
    for (const [k, cnt] of dirCount) {
      if (seen.has(k)) continue;
      const [u, v] = k.split('_').map(Number);
      const rk = dKey(v, u);
      seen.add(k); seen.add(rk);
      const opp = dirCount.get(rk) ?? 0;
      const net = cnt - opp;
      if (net === 0) continue;                       // interior edge
      const fwdU = net > 0 ? u : v;
      const fwdV = net > 0 ? v : u;
      if (Math.abs(net) !== 1) { boundaryOk = false; break; } // non-manifold rim
      bsegs.push([fwdU, fwdV]);
    }
    if (!boundaryOk) { for (const t of ts) emitOriginal(t); continue; }

    // Resolve T-junctions: three-bvh-csg's fan leaves a vertex sitting on the
    // INTERIOR of another triangle's edge. Such an edge cancels on the split
    // side but not the whole side, so it leaks into the boundary set and the
    // loop won't close. Split every boundary segment at any region vertex
    // lying on its interior so the rim becomes a proper closed polyline.
    const regVerts = new Set<number>();
    for (const t of ts) {
      regVerts.add(triV[t * 3]); regVerts.add(triV[t * 3 + 1]); regVerts.add(triV[t * 3 + 2]);
    }
    const regVertArr = [...regVerts];
    const colTol = Math.max(diag * 1e-5, 1e-6);
    const colTolSq = colTol * colTol;
    const succ = new Map<number, number[]>();
    const addSucc = (u: number, v: number) => {
      const lst = succ.get(u);
      if (lst) lst.push(v); else succ.set(u, [v]);
    };
    for (const [u, v] of bsegs) {
      const ux = vx[u], uy = vy[u], uz = vz[u];
      const dx = vx[v] - ux, dy = vy[v] - uy, dz = vz[v] - uz;
      const segLenSq = dx * dx + dy * dy + dz * dz;
      // Gather interior-collinear vertices, ordered along u→v.
      const on: { id: number; t: number }[] = [];
      if (segLenSq > 1e-18) {
        for (const w of regVertArr) {
          if (w === u || w === v) continue;
          const wx = vx[w] - ux, wy = vy[w] - uy, wz = vz[w] - uz;
          const tPar = (wx * dx + wy * dy + wz * dz) / segLenSq;
          if (tPar <= 1e-6 || tPar >= 1 - 1e-6) continue;
          // perpendicular distance² from w to the segment line
          const cxv = wy * dz - wz * dy;
          const cyv = wz * dx - wx * dz;
          const czv = wx * dy - wy * dx;
          const perpSq = (cxv * cxv + cyv * cyv + czv * czv) / segLenSq;
          if (perpSq <= colTolSq) on.push({ id: w, t: tPar });
        }
      }
      on.sort((p, q) => p.t - q.t);
      let prev = u;
      for (const { id } of on) { addSucc(prev, id); prev = id; }
      addSucc(prev, v);
    }

    // Walk successors into closed loops, consuming each half-edge once.
    const loops: number[][] = [];
    let walkOk = true;
    for (const startV of [...succ.keys()]) {
      let outs = succ.get(startV);
      while (outs && outs.length) {
        const loop: number[] = [startV];
        let cur = outs.pop() as number;
        let guard = 0;
        while (cur !== startV && guard++ < 200000) {
          loop.push(cur);
          const nxt = succ.get(cur);
          if (!nxt || nxt.length === 0) { walkOk = false; break; }
          cur = nxt.pop() as number;
        }
        if (!walkOk) break;
        if (loop.length >= 3) loops.push(loop);
        outs = succ.get(startV);
      }
      if (!walkOk) break;
    }
    if (!walkOk || loops.length === 0) { for (const t of ts) emitOriginal(t); continue; }

    // 2D basis in the region's plane (use the first tri's normal).
    const t0 = ts[0];
    const n = new THREE.Vector3(nrm[t0 * 3], nrm[t0 * 3 + 1], nrm[t0 * 3 + 2]);
    const up = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const bx = new THREE.Vector3().crossVectors(up, n).normalize();
    const by = new THREE.Vector3().crossVectors(n, bx).normalize();
    const to2D = (id: number): [number, number] => {
      const px = vx[id], py = vy[id], pz = vz[id];
      return [px * bx.x + py * bx.y + pz * bx.z, px * by.x + py * by.y + pz * by.z];
    };
    const signedArea = (loop: number[]): number => {
      let s = 0;
      for (let i = 0; i < loop.length; i++) {
        const [x1, y1] = to2D(loop[i]);
        const [x2, y2] = to2D(loop[(i + 1) % loop.length]);
        s += x1 * y2 - x2 * y1;
      }
      return s / 2;
    };
    // Drop collinear/duplicate boundary vertices: the fan's spurious rim
    // points are exactly the collinear ones, so removing them turns the
    // perimeter back into the real polygon (a coarse face → a quad → 2 tris).
    const simplify = (loop: number[]): number[] => {
      const dedup: number[] = [];
      for (const id of loop) if (dedup.length === 0 || dedup[dedup.length - 1] !== id) dedup.push(id);
      if (dedup.length > 1 && dedup[0] === dedup[dedup.length - 1]) dedup.pop();
      if (dedup.length < 3) return dedup;
      const out: number[] = [];
      const m = dedup.length;
      for (let i = 0; i < m; i++) {
        const id = dedup[i];
        if (pinned.has(id)) { out.push(id); continue; } // shared seam vertex
        const [px, py] = to2D(dedup[(i + m - 1) % m]);
        const [cx, cy] = to2D(id);
        const [nx2, ny2] = to2D(dedup[(i + 1) % m]);
        const ax = cx - px, ay = cy - py, bx2 = nx2 - cx, by2 = ny2 - cy;
        const crossv = ax * by2 - ay * bx2;
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx2, by2);
        // keep the corner only when the turn is non-negligible
        if (la < 1e-9 || lb < 1e-9 || Math.abs(crossv) > 1e-7 * la * lb) out.push(id);
      }
      return out.length >= 3 ? out : dedup;
    };
    for (let i = 0; i < loops.length; i++) loops[i] = simplify(loops[i]);

    // Largest |area| loop is the outer boundary; the rest are holes (notches).
    let outerIdx = 0;
    let outerAbs = -1;
    const areas = loops.map((lp, i) => {
      const A = signedArea(lp);
      if (Math.abs(A) > outerAbs) { outerAbs = Math.abs(A); outerIdx = i; }
      return A;
    });
    const outer = loops[outerIdx].slice();
    if (areas[outerIdx] < 0) outer.reverse(); // CCW
    const holes: number[][] = [];
    for (let i = 0; i < loops.length; i++) {
      if (i === outerIdx) continue;
      const h = loops[i].slice();
      if (signedArea(h) > 0) h.reverse(); // holes CW
      holes.push(h);
    }

    // Bridge holes into the outer loop, then ear-clip the simple polygon.
    const poly = bridgeHoles(outer, holes, to2D);
    const tri2 = earClip(poly, to2D);
    if (!tri2 || tri2.length === 0) { for (const t of ts) emitOriginal(t); continue; }

    // Build the new triangles, then accept them ONLY if they cover the same
    // surface area as the originals. Collapsing a flat fan is exactly
    // area-preserving (same polygon, fewer tris). If anything went wrong —
    // a real notch corner pruned as "collinear", a mis-bridged hole, a
    // self-intersecting rim — the area shifts, and we keep the originals.
    // This makes the whole pass provably shape-safe for inputs we DON'T
    // fully model (e.g. a weld-degraded fillet face), so it can only ever
    // tidy the pathological CSG fan and never delete real geometry.
    const degSq = Math.max(diag * 1e-7, 1e-7) ** 2;
    let origArea = 0;
    for (const t of ts) {
      const o = t * 9;
      e1.set(posIn[o + 3] - posIn[o], posIn[o + 4] - posIn[o + 1], posIn[o + 5] - posIn[o + 2]);
      e2.set(posIn[o + 6] - posIn[o], posIn[o + 7] - posIn[o + 1], posIn[o + 8] - posIn[o + 2]);
      origArea += cr.crossVectors(e1, e2).length();
    }
    const pending: number[] = [];
    let newArea = 0;
    for (let i = 0; i < tri2.length; i += 3) {
      const A = poly[tri2[i]], B = poly[tri2[i + 1]], C = poly[tri2[i + 2]];
      const ax = vx[A], ay = vy[A], az = vz[A];
      e1.set(vx[B] - ax, vy[B] - ay, vz[B] - az);
      e2.set(vx[C] - ax, vy[C] - ay, vz[C] - az);
      cr.crossVectors(e1, e2);
      const ar = cr.length();
      if (ar * ar < degSq) continue; // collapsed bridge sliver
      newArea += ar;
      const flip = cr.dot(n) < 0;
      const P = flip ? C : B;
      const Qd = flip ? B : C;
      pending.push(ax, ay, az, vx[P], vy[P], vz[P], vx[Qd], vy[Qd], vz[Qd]);
    }
    // Reject (keep originals) if area drifted >0.1% — a clean fan collapse is
    // exact; only a wrong simplification/triangulation changes the footprint.
    if (
      pending.length < 9 ||
      Math.abs(newArea - origArea) > 1e-3 * Math.max(origArea, 1e-9)
    ) {
      for (const t of ts) emitOriginal(t);
      continue;
    }
    for (const f of pending) outFloats.push(f);
  }

  return new Float32Array(outFloats);
}

/**
 * Joins hole loops into an outer loop by adding zero-width bridge edges (the
 * classic "keyhole" ear-clipping preprocessing): for each hole pick its
 * rightmost vertex, find a mutually-visible outer vertex, and splice the hole
 * in. Good enough for the convex/near-convex faces CSG edge-cuts produce.
 */
export function bridgeHoles(
  outer: number[],
  holes: number[][],
  to2D: (id: number) => [number, number],
): number[] {
  let poly = outer.slice();
  // Process holes by descending rightmost-x so nested splices stay valid.
  const ordered = holes
    .map((h) => {
      let bi = 0, bx = -Infinity;
      for (let i = 0; i < h.length; i++) {
        const [x] = to2D(h[i]);
        if (x > bx) { bx = x; bi = i; }
      }
      return { h, bi, bx };
    })
    .sort((p, q) => q.bx - p.bx);

  for (const { h, bi } of ordered) {
    const hv = h[bi];
    const [hx, hy] = to2D(hv);
    // Nearest outer vertex to the hole's rightmost point (visibility proxy —
    // exact for the small convex faces here).
    let best = -1, bestD = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [ox, oy] = to2D(poly[i]);
      const d = (ox - hx) * (ox - hx) + (oy - hy) * (oy - hy);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return outer; // give up → caller falls back to originals
    // Splice: ...outer[best], hole(bi..end..bi), outer[best], ...
    const rot = h.slice(bi).concat(h.slice(0, bi));
    const merged = poly.slice(0, best + 1)
      .concat([rot[0]], rot.slice(1), [rot[0]], [poly[best]], poly.slice(best + 1));
    poly = merged;
  }
  return poly;
}

/**
 * Ear-clipping triangulation of a simple polygon (CCW) given as vertex ids
 * plus a 2D projection. Returns a flat list of index triples into `poly`, or
 * null if it can't make progress (caller keeps the originals).
 */
export function earClip(
  poly: number[],
  to2D: (id: number) => [number, number],
): number[] | null {
  const n = poly.length;
  if (n < 3) return null;
  const P = poly.map(to2D);
  const idx = poly.map((_, i) => i);
  const area2 = (a: number, b: number, c: number) =>
    (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[c][0] - P[a][0]) * (P[b][1] - P[a][1]);
  const inTri = (a: number, b: number, c: number, p: number) => {
    const d1 = area2(p, a, b), d2 = area2(p, b, c), d3 = area2(p, c, a);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };
  const out: number[] = [];
  let guard = idx.length * idx.length + 16;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (area2(a, b, c) <= 0) continue; // reflex or degenerate
      let ear = true;
      for (let j = 0; j < idx.length; j++) {
        const p = idx[j];
        if (p === a || p === b || p === c) continue;
        if (inTri(a, b, c, p)) { ear = false; break; }
      }
      if (!ear) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) return null; // not a simple polygon we can handle → bail
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/**
 * Welds the unwelded triangle-soup that three-bvh-csg emits back into a clean
 * manifold and drops the near-zero-area sliver triangles a boolean can leave
 * behind. Returns a fresh NON-INDEXED, position-only geometry (callers add
 * uv/normal as needed).
 *
 * `fast`: skip `retriangulateCoplanarRegions` and the final sliver cull. Used
 * by live-preview paths where cosmetic quality is less important than latency.
 *
 * Why: a CSG result is a triangle soup with coincident-but-not-shared vertices
 * along every cut seam. three-bvh-csg is fragile when a *subsequent* cutter
 * slices that soup near a shared corner — it emits inverted/degenerate slivers
 * (the gray "star/spike" where two chamfered/filleted edges meet a shared
 * vertex). Re-welding the running solid between sequential subtractions hands
 * the next boolean a proper manifold instead of soup, and the final weld
 * removes any sliver the last cut produced. mergeVertices welds by ALL
 * attributes, so the normal/uv attributes are dropped first to unify purely by
 * position (same pattern shellMesh/extrusionInternals use).
 */
export function weldAndCleanSolid(geo: THREE.BufferGeometry, fast?: boolean): THREE.BufferGeometry {
  let work: THREE.BufferGeometry | null = null;
  let welded: THREE.BufferGeometry | null = null;
  let ni: THREE.BufferGeometry | null = null;
  try {
    work = geo.clone();
    work.deleteAttribute('normal');
    work.deleteAttribute('uv');

    // Tolerances scale with the geometry's size — same rationale as makeNear()
    // in this file — so sub-millimetre features aren't collapsed and large
    // models still weld three-bvh-csg's seam duplicates. The weld tol is 10×
    // tighter than makeNear's edge-match tol: we only need to fuse coincident
    // seam verts, never distinct features.
    const bb = new THREE.Box3().setFromBufferAttribute(
      work.attributes.position as THREE.BufferAttribute,
    );
    const diag = bb.min.distanceTo(bb.max) || 1;
    const weldTol = Math.max(diag * 1e-5, 1e-6);
    // Reject a triangle when |e1×e2| (= 2·area) is below a size-relative floor.
    const degenLen = Math.max(diag * 1e-7, 1e-7);
    const degenLenSq = degenLen * degenLen;

    welded = mergeVertices(work, weldTol);
    work.dispose();
    work = null;

    ni = welded.index ? welded.toNonIndexed() : welded;
    if (ni !== welded) welded.dispose();
    welded = null;

    // Drop degenerate (near-zero-area) triangles: welding collapses CSG sliver
    // caps to a line, and a zero-area triangle wrecks the next boolean.
    const p = ni.attributes.position.array as ArrayLike<number>;
    const triCount = (p.length / 9) | 0;
    const kept = new Float32Array(triCount * 9); // preallocated (no per-vert push)
    let w = 0;
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const cr = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      const o = t * 9;
      e1.set(p[o + 3] - p[o],     p[o + 4] - p[o + 1], p[o + 5] - p[o + 2]);
      e2.set(p[o + 6] - p[o],     p[o + 7] - p[o + 1], p[o + 8] - p[o + 2]);
      if (cr.crossVectors(e1, e2).lengthSq() < degenLenSq) continue;
      for (let k = 0; k < 9; k++) kept[w++] = p[o + k];
    }
    ni.dispose();
    ni = null;

    const cleanPos = w === kept.length ? kept : kept.subarray(0, w);

    // fast mode: skip the expensive coplanar-retriangulation + sliver cull.
    // Preview paths use this — cosmetic quality matters less than latency.
    let finalPos: ArrayLike<number>;
    if (fast) {
      finalPos = cleanPos;
    } else {
      // Collapse three-bvh-csg's coplanar fan (the giant skewed "broken face")
      // back to a minimal triangulation. Region-by-region conservative: on any
      // doubt a region is emitted unchanged, so this never corrupts geometry.
      try {
        finalPos = retriangulateCoplanarRegions(
          cleanPos instanceof Float32Array ? cleanPos : new Float32Array(cleanPos),
          diag,
        );
      } catch {
        finalPos = cleanPos;
      }

      // FINAL sliver cull — runs after retriangulation whose ear-clip can
      // re-emit thin slivers at shared corners.
      {
        const fp = finalPos instanceof Float32Array ? finalPos : new Float32Array(finalPos);
        const triN = (fp.length / 9) | 0;
        const culled = new Float32Array(fp.length);
        let cw = 0;
        const minHeightSq = weldTol * weldTol;
        for (let t = 0; t < triN; t++) {
          const o = t * 9;
          e1.set(fp[o + 3] - fp[o], fp[o + 4] - fp[o + 1], fp[o + 5] - fp[o + 2]);
          e2.set(fp[o + 6] - fp[o], fp[o + 7] - fp[o + 1], fp[o + 8] - fp[o + 2]);
          cr.crossVectors(e1, e2);
          const areaSq4 = cr.lengthSq();
          const l1 = e1.lengthSq();
          const l3 = e2.lengthSq();
          e1.set(fp[o + 6] - fp[o + 3], fp[o + 7] - fp[o + 4], fp[o + 8] - fp[o + 5]);
          const l2 = e1.lengthSq();
          const longestSq = Math.max(l1, l2, l3);
          if (longestSq < 1e-18 || areaSq4 / longestSq < minHeightSq) continue;
          for (let k = 0; k < 9; k++) culled[cw++] = fp[o + k];
        }
        finalPos = cw === culled.length ? culled : culled.subarray(0, cw);
      }
    }
    const fw = (finalPos as ArrayLike<number>).length;

    const out = new THREE.BufferGeometry();
    out.setAttribute(
      'position',
      new THREE.BufferAttribute(
        finalPos instanceof Float32Array ? finalPos : new Float32Array(finalPos),
        3,
      ),
    );
    // Restore the (zero) uv the raw CSG path used to carry, so downstream
    // consumers/exporters see the same attribute set as before this change.
    out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((fw / 3) * 2), 2));
    // three-bvh-csg reads geometry.attributes.normal on every operand — the
    // next subtraction throws if it's missing.
    out.computeVertexNormals();
    return out;
  } finally {
    // Never strand an intermediate if mergeVertices/toNonIndexed throws
    // (the caller's catch keeps the raw CSG result).
    if (ni && ni !== welded) ni.dispose();
    if (welded) welded.dispose();
    if (work) work.dispose();
  }
}
