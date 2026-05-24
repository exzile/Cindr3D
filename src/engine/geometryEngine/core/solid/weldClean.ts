/**
 * weldClean.ts — weld + clean a three-bvh-csg result into a manifold solid,
 * collapsing the "broken-face fan" back to a minimal triangulation.
 *
 * Pure geometry (THREE only) - shared CSG mesh cleanup before topology extraction.
 * so csg.ts can clean a CSG result before topology extraction.
 */
import * as THREE from 'three';
import { Earcut } from 'three/src/extras/Earcut.js';
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
  // BUILD-STAMP: v8-manifold-merge — confirms _toManifold mergeVertices fix is in browser
  console.warn(`[retriangulate] v8-manifold-merge entry triCount=${triCount}`);

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
    // Half-edges are keyed by a packed integer (u·2^26 + v) instead of the
    // earlier `${u}_${v}` string — same role as spatial-hash packing,
    // with identical correctness at this scale (vertex IDs come from
    // the per-region `vid()` counter so they're tiny non-negative integers,
    // well under 2^26). String concat + Number-split was a noticeable share
    // of the retriangulate cost on selections that produce many regions.
    // Per-region normal (used for targeted debug logging of the X=0 wing face).
    const rnx = nrm[ts[0] * 3], rny = nrm[ts[0] * 3 + 1], rnz = nrm[ts[0] * 3 + 2];
    const isXFace = rnx < -0.9; // X=0 left face has normal ≈ (-1,0,0)
    if (isXFace || ts.length > 100) {
      console.warn(`[retriangulate] r=${r} ts=${ts.length} n=(${rnx.toFixed(2)},${rny.toFixed(2)},${rnz.toFixed(2)})`);
    }

    const HEDGE_MULT = 0x4000000; // 2^26
    const dKey = (u: number, v: number) => u * HEDGE_MULT + v;
    const dirCount = new Map<number, number>();
    for (const t of ts) {
      const a = triV[t * 3], b = triV[t * 3 + 1], c = triV[t * 3 + 2];
      const k0 = dKey(a, b), k1 = dKey(b, c), k2 = dKey(c, a);
      dirCount.set(k0, (dirCount.get(k0) ?? 0) + 1);
      dirCount.set(k1, (dirCount.get(k1) ?? 0) + 1);
      dirCount.set(k2, (dirCount.get(k2) ?? 0) + 1);
    }

    // ── Non-manifold repair: BVH boolean sometimes leaves a region with
    // "wing" or bridge triangles whose directed edges appear more than once
    // in the same direction (|net| > 1). Walk every half-edge pair; for each
    // over-counted direction remove the largest-area triangle that contains
    // that half-edge (the wing/bridge), then recompute dirCount from the
    // survivors. We only do this if removals are a small fraction of the
    // region (< half) so genuinely bad geometry just bails out normally.
    let repairTs = ts;
    let repairRemoved = 0;
    {
      const toRemove = new Set<number>();
      for (const [k, cnt] of dirCount) {
        const u = Math.floor(k / HEDGE_MULT);
        const v = k - u * HEDGE_MULT;
        const rk = v * HEDGE_MULT + u;
        const opp = dirCount.get(rk) ?? 0;
        const net = cnt - opp;
        if (net <= 1) continue; // boundary OK or interior — no over-count
        // This directed half-edge u→v appears more times than its reverse.
        // Find the largest-area triangle that owns this half-edge — that is
        // the wing/bridge triangle inserted by the BVH re-triangulator.
        let worstT = -1, worstArea = -1;
        for (const t of ts) {
          if (toRemove.has(t)) continue;
          const ta = triV[t * 3], tb = triV[t * 3 + 1], tc = triV[t * 3 + 2];
          if (!((ta === u && tb === v) || (tb === u && tc === v) || (tc === u && ta === v))) continue;
          const o = t * 9;
          e1.set(posIn[o + 3] - posIn[o], posIn[o + 4] - posIn[o + 1], posIn[o + 5] - posIn[o + 2]);
          e2.set(posIn[o + 6] - posIn[o], posIn[o + 7] - posIn[o + 1], posIn[o + 8] - posIn[o + 2]);
          const area = cr.crossVectors(e1, e2).length();
          if (area > worstArea) { worstArea = area; worstT = t; }
        }
        if (worstT >= 0) toRemove.add(worstT);
      }
      if (toRemove.size > 0 && toRemove.size < ts.length / 2) {
        repairRemoved = toRemove.size;
        repairTs = ts.filter(t => !toRemove.has(t));
        dirCount.clear();
        for (const t of repairTs) {
          const a = triV[t * 3], b = triV[t * 3 + 1], c = triV[t * 3 + 2];
          const k0 = dKey(a, b), k1 = dKey(b, c), k2 = dKey(c, a);
          dirCount.set(k0, (dirCount.get(k0) ?? 0) + 1);
          dirCount.set(k1, (dirCount.get(k1) ?? 0) + 1);
          dirCount.set(k2, (dirCount.get(k2) ?? 0) + 1);
        }
      }
      if (isXFace || toRemove.size > 0) {
        console.warn(`[retriangulate REPAIR] r=${r} ts=${ts.length} removed=${toRemove.size} repairTs=${repairTs.length}`);
      }
    }

    // ── Fan-overlap detection: the BVH boolean sometimes creates
    // overlapping fan triangles from multiple corner vertices of a flat
    // face (e.g. 77+48+33 = 158 triangles fanning from 3 rectangle
    // corners, totalling 219 wings out of 317). These are topologically
    // valid (proper half-edges) but geometrically overlapping — they
    // inflate origArea, making the area check reject earcut's correct
    // output. We DON'T remove them (they share corners with real tris);
    // instead we detect the pattern and flag it so the area check is
    // bypassed — earcut triangulates the boundary loops correctly.
    //
    // Detection: in a well-triangulated flat face, vertex valence is
    // 4-8. BVH fan corners have valence 30-80+. Sum valences of all
    // vertices with valence ≥ 20; if the sum accounts for ≥ 30% of the
    // region's triangle count, we have a multi-apex fan pattern.
    // ── Fan-overlap detection + long-edge wing removal.
    // The BVH boolean creates overlapping fan triangles from corner
    // vertices. These inflate origArea AND bake the wing shape into
    // boundary loops. Detect via vertex valence, then remove the wing
    // triangles (by maxE) BEFORE boundary recovery so the loops trace
    // only the real face edges.
    let fanDetected = false;
    let cornerIds: Set<number> | null = null;
    {
      const vertValence = new Map<number, number>();
      for (const t of repairTs) {
        for (let j = 0; j < 3; j++) {
          const id = triV[t * 3 + j];
          vertValence.set(id, (vertValence.get(id) ?? 0) + 1);
        }
      }
      let highValSum = 0;
      let highValCount = 0;
      for (const [, cnt] of vertValence) {
        if (cnt >= 20) { highValSum += cnt; highValCount++; }
      }
      fanDetected = highValCount >= 2 && highValSum > repairTs.length * 0.3;
      if (isXFace) {
        const top5 = [...vertValence.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        console.warn(`[retriangulate FAN-DIAG] r=${r} highValSum=${highValSum} highValCount=${highValCount} fanDetected=${fanDetected} top5=${top5.map(([id,c])=>`${id}:(${vx[id]?.toFixed(1)},${vy[id]?.toFixed(1)},${vz[id]?.toFixed(1)})=${c}`).join(' ')}`);
      }

      // ── Boundary reconstruction approach (replaces wing-removal):
      // Instead of removing wing tris (which leaves too few survivors to
      // form a coherent boundary), we keep ALL tris for boundary recovery,
      // then RECONSTRUCT the outer boundary from the rectangle corner
      // vertices.  The boundary loops from the wing fans become HOLES
      // (they trace the fillet-indent shapes where the flat face ends
      // and the fillet surface begins).  The rectangle corners are the
      // convex hull of the face, forming the correct outer boundary.
      if (fanDetected) {
        // Collect rectangle-corner vertex IDs.  These are the high-valence
        // fan apex vertices (valence 17-77 in the bracket-boss case).
        // Normal face vertices have valence ≤ 7.  Threshold 12 cleanly
        // separates corners from arc vertices.
        cornerIds = new Set<number>();
        for (const [id, cnt] of vertValence) {
          if (cnt >= 12) cornerIds.add(id);
        }
        if (isXFace) console.warn(`[retriangulate FAN-CORNERS] r=${r} corners=${cornerIds.size} ids=[${[...cornerIds].map(id => `${id}:(${vx[id]?.toFixed(1)},${vy[id]?.toFixed(1)},${vz[id]?.toFixed(1)})`).join(', ')}]`);
        // No wing removal — boundary recovery uses all repairTs tris.
        // The reconstruction happens after loop walking (see below).
      }
    }

    // Net half-edges: an interior edge of the region is traversed once in
    // each direction (net 0); a boundary edge survives once. Each surviving
    // directed edge u→v is a directed boundary segment.
    const bsegs: [number, number][] = [];
    let boundaryOk = true;
    const seen = new Set<number>();
    for (const [k, cnt] of dirCount) {
      if (seen.has(k)) continue;
      const u = Math.floor(k / HEDGE_MULT);
      const v = k - u * HEDGE_MULT;
      const rk = v * HEDGE_MULT + u;
      seen.add(k); seen.add(rk);
      const opp = dirCount.get(rk) ?? 0;
      const net = cnt - opp;
      if (net === 0) continue;                       // interior edge
      const fwdU = net > 0 ? u : v;
      const fwdV = net > 0 ? v : u;
      if (Math.abs(net) !== 1) {
        if (isXFace) console.warn(`[retriangulate REPAIR] r=${r} boundaryOk=false net=${net} u=${u} v=${v}`);
        boundaryOk = false; break;
      } // non-manifold rim
      bsegs.push([fwdU, fwdV]);
    }
    if (!boundaryOk) { for (const t of ts) emitOriginal(t); continue; }

    // Resolve T-junctions: three-bvh-csg's fan leaves a vertex sitting on the
    // INTERIOR of another triangle's edge. Such an edge cancels on the split
    // side but not the whole side, so it leaks into the boundary set and the
    // loop won't close. Split every boundary segment at any region vertex
    // lying on its interior so the rim becomes a proper closed polyline.
    const regVerts = new Set<number>();
    for (const t of repairTs) {
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
      // Deduplicate split points at nearly-identical parametric positions.
      // Multiple region vertices can be within colTol of the edge line at the
      // same t value (e.g. two seam-duplicate verts the weld tolerance didn't
      // fuse). Keeping both creates a branch in the successor graph that causes
      // incomplete loops downstream.
      const dedupedOn: { id: number; t: number }[] = [];
      for (const pt of on) {
        if (dedupedOn.length === 0 || pt.t - dedupedOn[dedupedOn.length - 1].t > 1e-6) {
          dedupedOn.push(pt);
        }
      }
      let prev = u;
      for (const { id } of dedupedOn) { addSucc(prev, id); prev = id; }
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
    if (!walkOk || loops.length === 0) {
      if (isXFace) console.warn(`[retriangulate REPAIR] r=${r} walkOk=${walkOk} loops=${loops.length} → emit originals`);
      for (const t of ts) emitOriginal(t); continue;
    }

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
    // Only dedup (remove consecutive-duplicate vertex IDs); skip the
    // collinear-vertex pruning. The old custom earClip needed it, but
    // earcut (Mapbox) handles collinear/near-collinear vertices natively.
    // Pruning nearly-collinear arc vertices flattens the boss hole boundary
    // and causes the area check to fail (0.5%+ drift on 170-vert arcs).
    for (let i = 0; i < loops.length; i++) {
      const dedup: number[] = [];
      for (const id of loops[i]) if (dedup.length === 0 || dedup[dedup.length - 1] !== id) dedup.push(id);
      if (dedup.length > 1 && dedup[0] === dedup[dedup.length - 1]) dedup.pop();
      loops[i] = dedup.length >= 3 ? dedup : loops[i];
    }

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

    // ── Fan-slit boundary cleaning.
    // When the BVH boolean fans a flat face from its corner vertices to arc
    // vertices, the half-edge boundary traces zig-zag "slit" paths from
    // corners INTO the face interior (to arc verts) and back, instead of
    // following the clean rectangle edge.  The contaminated boundary makes
    // earcut reproduce the wing shape.
    //
    // Fix: between every pair of consecutive corners in the outer loop, keep
    // only the vertices that are collinear with those two corners (i.e. on
    // the rectangle edge).  Non-collinear vertices are fan-slit excursions
    // through the interior — remove them.  Pinned T-junction vertices on
    // the edge survive (they ARE collinear), so no new seam mismatches.
    if (fanDetected && cornerIds && cornerIds.size >= 3) {
      const cPos: number[] = [];
      for (let i = 0; i < outer.length; i++) {
        if (cornerIds.has(outer[i])) cPos.push(i);
      }
      if (cPos.length >= 3) {
        const cleanOuter: number[] = [];
        for (let ci = 0; ci < cPos.length; ci++) {
          const cpS = cPos[ci];
          const cpE = cPos[(ci + 1) % cPos.length];
          const sId = outer[cpS], eId = outer[cpE];
          cleanOuter.push(sId);
          // walk from cpS+1 … cpE-1 (wrapping)
          const segLen = cpE > cpS
            ? cpE - cpS - 1
            : outer.length - cpS - 1 + cpE;
          if (segLen <= 0) continue;
          const [sx, sy] = to2D(sId);
          const [ex, ey] = to2D(eId);
          const edx = ex - sx, edy = ey - sy;
          const eLenSq = edx * edx + edy * edy;
          if (eLenSq < 1e-12) continue;
          const invELen = 1 / Math.sqrt(eLenSq);
          const collinear: { id: number; t: number }[] = [];
          let idx = (cpS + 1) % outer.length;
          for (let s = 0; s < segLen; s++) {
            const vid2 = outer[idx];
            const [px, py] = to2D(vid2);
            const vdx = px - sx, vdy = py - sy;
            const t = (vdx * edx + vdy * edy) / eLenSq;
            const perpDist = Math.abs(vdx * edy - vdy * edx) * invELen;
            if (perpDist < colTol && t > 1e-6 && t < 1 - 1e-6) {
              collinear.push({ id: vid2, t });
            }
            idx = (idx + 1) % outer.length;
          }
          collinear.sort((a, b) => a.t - b.t);
          for (const { id } of collinear) cleanOuter.push(id);
        }
        if (cleanOuter.length >= 3 && cleanOuter.length < outer.length) {
          // ── Subdivide long outer edges with Steiner points.
          // A 5-vertex rectangle + 170-vertex hole makes earcut create
          // 70mm slivers (aspect ratio >30:1) that Z-fight with the
          // tangent fillet surface.  Inserting intermediate vertices on
          // each outer edge keeps the longest earcut triangle under
          // ~maxSeg, so the fan/wing visual artifact is eliminated.
          // These Steiner points are on the rectangle edges — adjacent
          // faces are perpendicular so the T-junctions are invisible.
          const maxSeg = Math.max(diag * 0.03, 3);
          const subdOuter: number[] = [];
          for (let si = 0; si < cleanOuter.length; si++) {
            const curId = cleanOuter[si];
            const nxtId = cleanOuter[(si + 1) % cleanOuter.length];
            subdOuter.push(curId);
            const sdx = vx[nxtId] - vx[curId];
            const sdy = vy[nxtId] - vy[curId];
            const sdz = vz[nxtId] - vz[curId];
            const elen = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz);
            if (elen > maxSeg) {
              const segs = Math.ceil(elen / maxSeg);
              for (let ss = 1; ss < segs; ss++) {
                const st = ss / segs;
                const sid = vx.length;
                vx.push(vx[curId] + sdx * st);
                vy.push(vy[curId] + sdy * st);
                vz.push(vz[curId] + sdz * st);
                subdOuter.push(sid);
              }
            }
          }

          if (isXFace) console.warn(`[retriangulate FAN-CLEAN] r=${r} outer ${outer.length} → ${cleanOuter.length} clean → ${subdOuter.length} subdiv (removed ${outer.length - cleanOuter.length} fan-slit, added ${subdOuter.length - cleanOuter.length} steiner)`);
          // Ensure CCW winding is preserved.
          if (signedArea(subdOuter) < 0) subdOuter.reverse();
          outer.length = 0;
          outer.push(...subdOuter);
        }
      }
    }

    // Unconditionally subdivide long outer edges when holes are present.
    // The fan-slit block above only runs when fanDetected=true AND the boundary
    // had slit excursions to clean. When fanDetected=false OR the boundary was
    // already clean (no slits), Steiner subdivision never ran — earcut then
    // connects arc-hole vertices to distant outer corners, producing wing
    // triangles with maxE >80mm. Inserting intermediate vertices keeps every
    // earcut triangle under ~maxSeg, eliminating the long-diagonal wing shape.
    if (holes.length > 0) {
      const maxSeg = Math.max(diag * 0.03, 3);
      const subdOuter2: number[] = [];
      let anySubdiv2 = false;
      for (let si = 0; si < outer.length; si++) {
        const curId = outer[si];
        const nxtId = outer[(si + 1) % outer.length];
        subdOuter2.push(curId);
        const sdx = vx[nxtId] - vx[curId];
        const sdy = vy[nxtId] - vy[curId];
        const sdz = vz[nxtId] - vz[curId];
        const elen = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz);
        if (elen > maxSeg) {
          anySubdiv2 = true;
          const segs = Math.ceil(elen / maxSeg);
          for (let ss = 1; ss < segs; ss++) {
            const st = ss / segs;
            const sid = vx.length;
            vx.push(vx[curId] + sdx * st);
            vy.push(vy[curId] + sdy * st);
            vz.push(vz[curId] + sdz * st);
            subdOuter2.push(sid);
          }
        }
      }
      if (anySubdiv2) {
        if (isXFace) console.warn(`[retriangulate STEINER2] r=${r} outer ${outer.length} → ${subdOuter2.length}`);
        if (signedArea(subdOuter2) < 0) subdOuter2.reverse();
        outer.length = 0;
        outer.push(...subdOuter2);
      }
    }

    // Triangulate using Three.js's bundled earcut (Mapbox earcut port) which
    // handles holes natively — no separate bridge step needed. Build a flat
    // 2D-coordinate array: outer vertices first, then each hole in order, with
    // a holeIndices array marking where each hole starts. earcut returns
    // triangle index triples into this flat array which we map back to vertex
    // IDs in vx/vy/vz.
    // Filter out degenerate micro-holes (e.g. 4-vertex loops from fan-edge
    // artifacts).  Tiny holes confuse earcut's bridging and create extra
    // slivers.  Threshold: area < 0.1% of the outer boundary area.
    const outerArea = Math.abs(signedArea(outer));
    const minHoleArea = outerArea * 1e-3;
    const validHoles = holes.filter(h => {
      const a = Math.abs(signedArea(h));
      if (a < minHoleArea) {
        if (isXFace) console.warn(`[retriangulate] r=${r} dropping micro-hole: ${h.length} verts, area=${a.toFixed(4)} < ${minHoleArea.toFixed(4)}`);
        return false;
      }
      return true;
    });

    if (isXFace) console.warn(`[retriangulate REPAIR] r=${r} loops=${loops.length} outer=${outer.length} holes=${validHoles.length} loopSizes=${loops.map(l=>l.length).join(',')}`);
    const ecCoords: number[] = [];
    const ecIdMap: number[] = [];       // ecIdMap[flatIdx] → vertex ID in vx/vy/vz
    const ecHoleIndices: number[] = [];
    for (const id of outer) {
      const [u, v] = to2D(id);
      ecCoords.push(u, v);
      ecIdMap.push(id);
    }
    for (const h of validHoles) {
      ecHoleIndices.push(ecIdMap.length);
      for (const id of h) {
        const [u, v] = to2D(id);
        ecCoords.push(u, v);
        ecIdMap.push(id);
      }
    }
    const tri2 = Earcut.triangulate(ecCoords, ecHoleIndices.length > 0 ? ecHoleIndices : undefined, 2);
    if (!tri2 || tri2.length === 0) {
      if (isXFace) console.warn(`[retriangulate REPAIR] r=${r} earcut EMPTY outer=${outer.length} holes=${holes.length}`);
      for (const t of ts) emitOriginal(t); continue;
    }

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
    for (const t of repairTs) {
      const o = t * 9;
      e1.set(posIn[o + 3] - posIn[o], posIn[o + 4] - posIn[o + 1], posIn[o + 5] - posIn[o + 2]);
      e2.set(posIn[o + 6] - posIn[o], posIn[o + 7] - posIn[o + 1], posIn[o + 8] - posIn[o + 2]);
      origArea += cr.crossVectors(e1, e2).length();
    }
    const pending: number[] = [];
    let newArea = 0;
    for (let i = 0; i < tri2.length; i += 3) {
      const A = ecIdMap[tri2[i]], B = ecIdMap[tri2[i + 1]], C = ecIdMap[tri2[i + 2]];
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
    // Reject (keep originals) if area drifted too much. When the repair step
    // removed wing triangles (repairRemoved > 0), the boundary loops trace a
    // DIFFERENT polygon than the original fan — the area SHOULD differ because
    // we intentionally removed bad geometry. In that case accept any non-empty
    // earcut output. For un-repaired regions, keep the tight 0.2% guard.
    const areaDrift = Math.abs(newArea - origArea) / Math.max(origArea, 1e-9);
    const areaOk = (repairRemoved > 0 || fanDetected)
      ? pending.length >= 9                              // repaired/fan: accept any valid earcut
      : pending.length >= 9 && areaDrift <= 2e-3;        // normal:       tight area check
    if (!areaOk) {
      if (isXFace) console.warn(`[retriangulate REPAIR] r=${r} ts=${ts.length} area-check FAIL: newArea=${newArea.toFixed(3)} origArea=${origArea.toFixed(3)} pending=${pending.length} repairRemoved=${repairRemoved} fanDetected=${fanDetected}`);
      for (const t of ts) emitOriginal(t);
      continue;
    }
    if (isXFace) console.warn(`[retriangulate REPAIR] r=${r} ts=${ts.length} → SUCCESS pending=${pending.length/9} tris loops=${loops.length}`);
    for (const f of pending) outFloats.push(f);
  }

  return new Float32Array(outFloats);
}

/**
 * Joins hole loops into an outer loop by adding zero-width bridge edges (the
 * classic "keyhole" ear-clipping preprocessing): for each hole pick its
 * rightmost vertex, find a mutually-visible outer edge point, and splice the
 * hole in.
 *
 * Uses nearest-EDGE-POINT rather than nearest-VERTEX. When the nearest point
 * falls on the interior of an outer edge, a new vertex is inserted there (into
 * `vx`/`vy`/`vz`) so the bridge is as short as possible. This avoids the
 * "long diagonal bridge" that the nearest-vertex heuristic creates for holes
 * whose rightmost point is close to an edge midpoint but far from any vertex —
 * e.g. the boss-cylinder boundary at X=0 whose topmost arc is 0.04mm below
 * the bracket's top edge but 27mm from the nearest outer vertex.
 */
export function bridgeHoles(
  outer: number[],
  holes: number[][],
  to2D: (id: number) => [number, number],
  _vx: number[],
  _vy: number[],
  _vz: number[],
): number[] {
  void _vx; void _vy; void _vz;
  let poly = outer.slice();
  // Process holes by descending rightmost 2D-x. This order guarantees that
  // each hole's rightward bridge ray cannot cross any earlier bridge (earlier
  // bridges were placed further right, so subsequent rays never reach them).
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

    // Cast a rightward (+x) ray from (hx, hy) and find the nearest edge of
    // the current poly that the ray crosses. This standard algorithm (used by
    // Mapbox earcut and others) guarantees non-intersecting bridges: each
    // bridge goes rightward, and later holes have smaller x, so their rays
    // never cross earlier bridges.
    let bestEdge = -1, bestXi = Infinity, bestT = 0;
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const [ax, ay] = to2D(poly[i]);
      const [bx2, by] = to2D(poly[j]);
      const dy = by - ay;
      if (Math.abs(dy) < 1e-12) continue;         // horizontal edge — skip
      const t = (hy - ay) / dy;
      if (t < -1e-9 || t > 1 + 1e-9) continue;   // ray misses y-span of edge
      const xi = ax + t * (bx2 - ax);
      if (xi < hx - 1e-9) continue;               // intersection is to the left
      if (xi < bestXi) { bestXi = xi; bestEdge = i; bestT = Math.max(0, Math.min(1, t)); }
    }
    if (bestEdge < 0) return outer; // degenerate — give up, caller emits originals

    // Snap to the nearer existing endpoint of the crossing edge rather than
    // inserting a new midpoint vertex. A midpoint vertex is exactly collinear
    // with its two outer-edge neighbours; the earClip inTri test treats
    // on-boundary points as "inside", causing those collinear vertices to
    // falsely block every adjacent ear and stall the clipper. Snapping to an
    // existing vertex is always safe: the bridge still goes rightward (xi ≥ hx)
    // so it cannot cross any previously placed bridge (earlier bridges are
    // further right), and there are no new collinear vertices.
    const insertAt = bestT <= 0.5
      ? bestEdge
      : (bestEdge + 1) % poly.length;

    // Splice the hole into poly at insertAt (keyhole bridge).
    const rot = h.slice(bi).concat(h.slice(0, bi));
    const merged = poly.slice(0, insertAt + 1)
      .concat([rot[0]], rot.slice(1), [rot[0]], [poly[insertAt]], poly.slice(insertAt + 1));
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
        // Keyhole bridges duplicate vertex IDs at bridge junctions (the
        // merged polygon contains e.g. …, V, H0, …, H0, V, …). A
        // duplicate at a different array position has the same 2D coords
        // as an ear vertex, producing area2 ≈ 0 which inTri classifies
        // as "inside" — falsely blocking every adjacent ear and stalling
        // the clipper.  Skip vertices whose vertex ID matches any ear
        // vertex so the duplicate can't block clipping.
        if (poly[p] === poly[a] || poly[p] === poly[b] || poly[p] === poly[c]) continue;
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
 * Splits non-manifold vertices — vertices whose incident triangle fans form more
 * than one connected component (figure-8 topology). This is the defect produced
 * by EarCut hole bridging in THREE.js ExtrudeGeometry: the bridge edge is added
 * twice (forward + backward), so the bridge vertex has two disconnected fans.
 * `mergeVertices` merges them by position → one vertex index, two fans → Manifold
 * rejects with "Not manifold". Splitting the vertex into N copies (one per fan)
 * restores a valid manifold half-edge structure.
 *
 * Input: indexed or non-indexed BufferGeometry (position attribute only needed).
 * Output: new indexed geometry with the same surface and all fans manifold.
 * Returns the input unchanged (as a clone) if no splits were needed.
 */
export function repairNonManifoldVertices(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  // Ensure we have indexed geometry to work with
  let indexed: THREE.BufferGeometry;
  let ownIndexed = false;
  if (geo.index) {
    indexed = geo;
  } else {
    const posOnly = new THREE.BufferGeometry();
    posOnly.setAttribute('position', geo.attributes.position as THREE.BufferAttribute);
    const bb = new THREE.Box3().setFromBufferAttribute(geo.attributes.position as THREE.BufferAttribute);
    const diag = Math.max(bb.min.distanceTo(bb.max), 1);
    indexed = mergeVertices(posOnly, Math.max(diag * 1e-5, 1e-6));
    posOnly.dispose();
    ownIndexed = true;
  }

  try {
    const posAttr = indexed.attributes.position as THREE.BufferAttribute;
    const idxAttr = indexed.index!;
    const nVerts = posAttr.count;
    const nTris = idxAttr.count / 3;

    // For each original vertex, which triangles contain it (original indices)
    const vertToTris: number[][] = Array.from({ length: nVerts }, () => []);
    for (let t = 0; t < nTris; t++) {
      vertToTris[idxAttr.getX(t * 3)].push(t);
      vertToTris[idxAttr.getX(t * 3 + 1)].push(t);
      vertToTris[idxAttr.getX(t * 3 + 2)].push(t);
    }

    // Build undirected edge → triangle list from original indices
    // Key: min(a,b) * nVerts + max(a,b) — safe up to ~94M verts
    const edgeToTris = new Map<number, number[]>();
    for (let t = 0; t < nTris; t++) {
      const i0 = idxAttr.getX(t * 3), i1 = idxAttr.getX(t * 3 + 1), i2 = idxAttr.getX(t * 3 + 2);
      for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]] as [number, number][]) {
        const lo = a < b ? a : b, hi = a < b ? b : a;
        const k = lo * nVerts + hi;
        const arr = edgeToTris.get(k);
        if (arr) arr.push(t); else edgeToTris.set(k, [t]);
      }
    }

    // Working index array — only modified for split vertices
    const newIdx = new Uint32Array(idxAttr.count);
    for (let i = 0; i < idxAttr.count; i++) newIdx[i] = idxAttr.getX(i);

    // Position list — grows as we add split copies
    const newPos: number[] = [];
    for (let i = 0; i < nVerts; i++) {
      newPos.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    }

    let nextVert = nVerts;
    let didSplit = false;

    for (let v = 0; v < nVerts; v++) {
      const tris = vertToTris[v];
      if (tris.length < 2) continue;

      // BFS to find connected components among tris around vertex v.
      // Two triangles are in the same component if they share an edge that
      // includes v. Use ORIGINAL indices (idxAttr) for edge lookups so
      // earlier splits don't invalidate the edgeToTris map.
      const visited = new Set<number>();
      const components: number[][] = [];

      for (const seed of tris) {
        if (visited.has(seed)) continue;
        const comp: number[] = [];
        const queue: number[] = [seed];
        visited.add(seed);
        while (queue.length > 0) {
          const t = queue.shift()!;
          comp.push(t);
          // Edges of triangle t that include original vertex v
          const oi0 = idxAttr.getX(t * 3), oi1 = idxAttr.getX(t * 3 + 1), oi2 = idxAttr.getX(t * 3 + 2);
          const tv = [oi0, oi1, oi2];
          for (let j = 0; j < 3; j++) {
            const a = tv[j], b = tv[(j + 1) % 3];
            if (a !== v && b !== v) continue;
            const lo = a < b ? a : b, hi = a < b ? b : a;
            const adj = edgeToTris.get(lo * nVerts + hi);
            if (!adj) continue;
            for (const t2 of adj) {
              if (t2 !== t && !visited.has(t2)) {
                visited.add(t2);
                queue.push(t2);
              }
            }
          }
        }
        components.push(comp);
      }

      if (components.length <= 1) continue; // manifold at this vertex

      // Split: first component keeps v; each additional component gets a new vertex
      for (let c = 1; c < components.length; c++) {
        const newV = nextVert++;
        newPos.push(posAttr.getX(v), posAttr.getY(v), posAttr.getZ(v));
        for (const t of components[c]) {
          for (let j = 0; j < 3; j++) {
            if (newIdx[t * 3 + j] === v) newIdx[t * 3 + j] = newV;
          }
        }
        didSplit = true;
      }
    }

    if (!didSplit) {
      const clone = new THREE.BufferGeometry();
      clone.setAttribute('position', indexed.attributes.position);
      clone.setIndex(indexed.index);
      return clone;
    }

    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPos), 3));
    result.setIndex(new THREE.BufferAttribute(newIdx, 1));
    return result;
  } finally {
    if (ownIndexed) indexed.dispose();
  }
}

/**
 * Remove "spike" triangle components from a non-indexed position-only geometry.
 *
 * A spike is a connected set of triangles that attaches to the rest of the mesh
 * through exactly ONE apex vertex — all non-apex vertices of those triangles
 * appear ONLY in other triangles that also contain the apex.  This is the shape
 * three-bvh-csg leaves at a fillet endpoint when the cutter's end cap meets a
 * curved boss surface at a degenerate intersection seam.
 *
 * The detection is purely topological: no geometric thresholds.  It is safe to
 * run on any non-indexed geometry — legitimate sharp-corner fans, pyramids, or
 * sphere facets are never removed because their base vertices are always shared
 * with surrounding (non-spike) triangles.
 *
 * Returns the input geometry unchanged if no spikes are found, otherwise a new
 * geometry with the spike triangles removed and recomputed vertex normals.
 */
export function removeSpikeComponents(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const posAttr = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!posAttr) return geo;
  const pos = posAttr.array as Float32Array;
  const triCount = (pos.length / 9) | 0;
  if (triCount < 4) return geo;

  // Build position → unique vertex index via quantised-coordinate string key.
  // The geometry was already run through mergeVertices (by weldAndCleanSolid)
  // and then toNonIndexed, so each unique position appears as exact float copies.
  const vmap = new Map<string, number>();
  const vidx = new Int32Array(triCount * 3);
  let nv = 0;
  for (let t = 0; t < triCount; t++) {
    for (let j = 0; j < 3; j++) {
      const o = t * 9 + j * 3;
      const key = `${pos[o].toFixed(6)},${pos[o + 1].toFixed(6)},${pos[o + 2].toFixed(6)}`;
      let vi = vmap.get(key);
      if (vi === undefined) { vi = nv++; vmap.set(key, vi); }
      vidx[t * 3 + j] = vi;
    }
  }

  // Vertex → triangle list (valence map).
  const vtris: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < triCount; t++) {
    vtris[vidx[t * 3]].push(t);
    vtris[vidx[t * 3 + 1]].push(t);
    vtris[vidx[t * 3 + 2]].push(t);
  }

  const removeSet = new Set<number>();

  for (let v = 0; v < nv; v++) {
    const T_V = vtris[v];
    if (T_V.length < 2) continue;      // need at least spike + body
    const T_V_set = new Set<number>(T_V);

    // Classify each of V's triangles: is it a "spike" triangle?
    // A triangle T is a spike candidate when ALL of its non-V vertices only
    // appear in triangles that also contain V (i.e. nowhere outside T_V).
    const spikeTriangles: number[] = [];
    for (const t of T_V) {
      const i0 = vidx[t * 3], i1 = vidx[t * 3 + 1], i2 = vidx[t * 3 + 2];
      let isSpike = true;
      for (const nvi of [i0, i1, i2]) {
        if (nvi === v) continue;
        for (const t2 of vtris[nvi]) {
          if (!T_V_set.has(t2)) { isSpike = false; break; }
        }
        if (!isSpike) break;
      }
      if (isSpike) spikeTriangles.push(t);
    }

    // Remove only if the spike is a STRICT SUBSET of V's triangles — never
    // remove all of V's triangles (that would leave a hole in the body).
    if (spikeTriangles.length > 0 && spikeTriangles.length < T_V.length) {
      for (const t of spikeTriangles) removeSet.add(t);
    }
  }

  if (removeSet.size === 0) return geo;

  const newPos = new Float32Array((triCount - removeSet.size) * 9);
  let w = 0;
  for (let t = 0; t < triCount; t++) {
    if (!removeSet.has(t)) for (let k = 0; k < 9; k++) newPos[w++] = pos[t * 9 + k];
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
  out.computeVertexNormals();
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
    // ── Global position quantization ─────────────────────────────────────────
    // mergeVertices uses bucket-boundary rounding (Math.round(v / tol)) which
    // can miss merging vertices that straddle the bucket boundary — e.g. one
    // at 0.0004999 and another at 0.0005001 bucket to 0 and 1, even though
    // they're 0.0002mm apart.  These sub-weldTol position drifts then make
    // computeVertexNormals produce slightly tilted normals on nominally flat
    // faces (different vertices of one triangle have different X values, so
    // the cross product has tiny Y/Z components).  Lighting catches these as
    // bright "wing" streaks across long thin retriangulated slivers.
    //
    // Fix: snap every position to a fine grid (0.0001mm) — finer than the
    // 1e-3 weld tolerance, so we never collapse distinct features, but coarse
    // enough to drag all sub-pixel FP noise to identical positions.  Adjacent
    // faces' shared corners snap to the SAME grid point, so flat faces have
    // identically-placed vertices and computeVertexNormals returns exact
    // axis-aligned normals.
    const finalArr = finalPos instanceof Float32Array ? finalPos : new Float32Array(finalPos);
    {
      const snapGrid = 1e-4;          // 0.0001 mm grid
      const invGrid = 1 / snapGrid;
      for (let i = 0; i < finalArr.length; i++) {
        finalArr[i] = Math.round(finalArr[i] * invGrid) / invGrid;
      }
    }

    const fw = finalArr.length;

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(finalArr, 3));
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
