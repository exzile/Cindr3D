import * as THREE from 'three';
import { computePlaneAxesFromNormal } from './planeUtils';

export function computeCoplanarFaceBoundary(
  mesh: THREE.Mesh,
  faceIndex: number,
  tol = 1e-3,
): { boundary: THREE.Vector3[]; normal: THREE.Vector3; centroid: THREE.Vector3 } | null {
  const geom = mesh.geometry;
  const posAttr = geom.attributes.position as THREE.BufferAttribute | undefined;
  if (!posAttr) return null;

  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(m);

  const idxAttr = geom.index;
  const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
  const getTriIndices = (i: number): [number, number, number] => {
    if (idxAttr) {
      return [idxAttr.getX(i * 3), idxAttr.getX(i * 3 + 1), idxAttr.getX(i * 3 + 2)];
    }
    return [i * 3, i * 3 + 1, i * 3 + 2];
  };

  if (faceIndex < 0 || faceIndex >= triCount) return null;

  const worldVerts = new Map<number, THREE.Vector3>();
  const getWorldVert = (vi: number): THREE.Vector3 => {
    let v = worldVerts.get(vi);
    if (!v) {
      v = new THREE.Vector3().fromBufferAttribute(posAttr, vi).applyMatrix4(m);
      worldVerts.set(vi, v);
    }
    return v;
  };

  const triNormal = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 => {
    const ab = b.clone().sub(a);
    const ac = c.clone().sub(a);
    return ab.cross(ac).normalize();
  };

  const [hi0, hi1, hi2] = getTriIndices(faceIndex);
  const hv0 = getWorldVert(hi0); const hv1 = getWorldVert(hi1); const hv2 = getWorldVert(hi2);
  const hitNormal = triNormal(hv0, hv1, hv2);
  if (hitNormal.lengthSq() < 0.5) return null;
  const hitOffset = hitNormal.dot(hv0);

  if (!geom.boundingSphere) geom.computeBoundingSphere();
  const radius = geom.boundingSphere?.radius ?? 1;
  const planeTol = Math.max(0.01, tol * radius);

  const coplanarTris: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [];
  for (let t = 0; t < triCount; t++) {
    const [a, b, c] = getTriIndices(t);
    const va = getWorldVert(a); const vb = getWorldVert(b); const vc = getWorldVert(c);
    const n = triNormal(va, vb, vc);
    if (n.lengthSq() < 0.5) continue;
    if (n.dot(hitNormal) < 0.985) continue;
    const off = n.dot(va);
    if (Math.abs(off - hitOffset) > planeTol) continue;
    coplanarTris.push([va, vb, vc]);
  }
  if (coplanarTris.length === 0) return null;
  if (coplanarTris.length < 2) return null;

  const SOFT_COS = 0.707;
  let softCount = 0;
  for (let t = 0; t < triCount; t++) {
    const [a, b, c] = getTriIndices(t);
    const va = getWorldVert(a); const vb = getWorldVert(b); const vc = getWorldVert(c);
    const n = triNormal(va, vb, vc);
    if (n.lengthSq() < 0.5) continue;
    if (n.dot(hitNormal) < SOFT_COS) continue;
    const off = n.dot(va);
    if (Math.abs(off - hitOffset) > planeTol * 4) continue;
    softCount++;
  }
  if (softCount > coplanarTris.length) return null;

  const MERGE_RADIUS = 0.05;
  const CELL = MERGE_RADIUS * 2;
  const canonicalPos = new Map<string, THREE.Vector3>();

  const keyFor = (v: THREE.Vector3): string => {
    const cx = Math.round(v.x / CELL); const cy = Math.round(v.y / CELL); const cz = Math.round(v.z / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const nk = `${cx + dx}|${cy + dy}|${cz + dz}`;
          const existing = canonicalPos.get(nk);
          if (existing && existing.distanceTo(v) <= MERGE_RADIUS) {
            return nk;
          }
        }
      }
    }
    const k = `${cx}|${cy}|${cz}`;
    canonicalPos.set(k, v.clone());
    return k;
  };

  const keyToPos = new Map<string, THREE.Vector3>();
  for (const [va, vb, vc] of coplanarTris) {
    for (const v of [va, vb, vc]) {
      const k = keyFor(v);
      if (!keyToPos.has(k)) keyToPos.set(k, canonicalPos.get(k) ?? v.clone());
    }
  }

  const splitTris: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [];
  const EDGE_TOL = 0.06;

  const pointOnSegment = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): boolean => {
    const ab = b.clone().sub(a);
    const ap = p.clone().sub(a);
    const lenSq = ab.lengthSq();
    if (lenSq < 1e-8) return false;
    const t = ap.dot(ab) / lenSq;
    if (t <= EDGE_TOL / Math.sqrt(lenSq) || t >= 1 - EDGE_TOL / Math.sqrt(lenSq)) return false;
    const proj = a.clone().add(ab.multiplyScalar(t));
    return proj.distanceTo(p) < EDGE_TOL;
  };

  for (const tri of coplanarTris) {
    const triKeys = [keyFor(tri[0]), keyFor(tri[1]), keyFor(tri[2])];
    let needsSplit = false;
    const edgeMidpoints: Map<string, THREE.Vector3[]> = new Map();

    for (let ei = 0; ei < 3; ei++) {
      const a = tri[ei]; const b = tri[(ei + 1) % 3];
      const eKey = `${ei}`;
      const mids: THREE.Vector3[] = [];
      for (const [k, pos] of keyToPos) {
        if (triKeys.includes(k)) continue;
        if (pointOnSegment(pos, a, b)) mids.push(pos);
      }
      if (mids.length > 0) {
        needsSplit = true;
        const ab = b.clone().sub(a);
        mids.sort((m1, m2) => m1.clone().sub(a).dot(ab) - m2.clone().sub(a).dot(ab));
        edgeMidpoints.set(eKey, mids);
      }
    }

    if (!needsSplit) {
      splitTris.push(tri);
      continue;
    }

    const perimeterPts: THREE.Vector3[] = [];
    for (let ei = 0; ei < 3; ei++) {
      perimeterPts.push(tri[ei]);
      const mids = edgeMidpoints.get(`${ei}`);
      if (mids) perimeterPts.push(...mids);
    }
    for (let pi = 1; pi < perimeterPts.length - 1; pi++) {
      splitTris.push([perimeterPts[0], perimeterPts[pi], perimeterPts[pi + 1]]);
    }
  }

  const undirectedKey = (a: string, b: string) => (a < b ? `${a}#${b}` : `${b}#${a}`);
  const edgeCount = new Map<string, number>();
  for (const [va, vb, vc] of splitTris) {
    const ka = keyFor(va); const kb = keyFor(vb); const kc = keyFor(vc);
    for (const [e0, e1] of [[ka, kb], [kb, kc], [kc, ka]] as const) {
      const k = undirectedKey(e0, e1);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const [va, vb, vc] of splitTris) {
    const ka = keyFor(va); const kb = keyFor(vb); const kc = keyFor(vc);
    for (const [e0, e1] of [[ka, kb], [kb, kc], [kc, ka]] as const) {
      if (edgeCount.get(undirectedKey(e0, e1)) === 1) {
        if (!adjacency.has(e0)) adjacency.set(e0, []);
        adjacency.get(e0)!.push(e1);
      }
    }
  }
  if (adjacency.size < 3) return null;

  const visitedEdges = new Set<string>();
  const loops: string[][] = [];
  for (const [startKey, _] of adjacency.entries()) {
    void _;
    const outEdges = adjacency.get(startKey) ?? [];
    for (const firstNext of outEdges) {
      const firstEdgeKey = `${startKey}->${firstNext}`;
      if (visitedEdges.has(firstEdgeKey)) continue;
      const loop: string[] = [startKey];
      visitedEdges.add(firstEdgeKey);
      let cur: string = firstNext;
      const safety = adjacency.size + 2;
      let closed = false;
      for (let i = 0; i < safety; i++) {
        loop.push(cur);
        if (cur === startKey) { closed = true; break; }
        const next = (adjacency.get(cur) ?? []).find((n) => !visitedEdges.has(`${cur}->${n}`));
        if (next === undefined) break;
        visitedEdges.add(`${cur}->${next}`);
        cur = next;
      }
      if (closed && loop.length >= 4) {
        loop.pop();
        loops.push(loop);
      }
    }
  }
  if (loops.length === 0) return null;

  const _planeAxes = computePlaneAxesFromNormal(hitNormal);
  const _pa = _planeAxes.t1;
  const _pb = _planeAxes.t2;
  const loopArea2D = (loopKeys: string[]): number => {
    let a = 0;
    const n = loopKeys.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const pi = canonicalPos.get(loopKeys[i])!;
      const pj = canonicalPos.get(loopKeys[j])!;
      const xi = pi.dot(_pa); const yi = pi.dot(_pb);
      const xj = pj.dot(_pa); const yj = pj.dot(_pb);
      a += xi * yj - xj * yi;
    }
    return Math.abs(a) * 0.5;
  };
  loops.sort((a, b) => loopArea2D(b) - loopArea2D(a));
  const outer = loops[0];
  if (outer.length < 3) return null;

  const boundary: THREE.Vector3[] = outer.map((k) => canonicalPos.get(k)!.clone());

  const centroid = new THREE.Vector3();
  for (const p of boundary) centroid.add(p);
  centroid.multiplyScalar(1 / boundary.length);

  const finalNormal = hitNormal.clone();
  void normalMatrix;

  return { boundary, normal: finalNormal, centroid };
}
