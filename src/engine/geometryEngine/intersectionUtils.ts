import * as THREE from 'three';

export function extractWorldTriangles(
  mesh: THREE.Mesh,
): Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> {
  const geom = mesh.geometry;
  const posAttr = geom.attributes.position as THREE.BufferAttribute | undefined;
  if (!posAttr) return [];

  const m = mesh.matrixWorld;
  const idxAttr = geom.index;
  const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;

  const tris: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [];
  for (let t = 0; t < triCount; t++) {
    let i0: number; let i1: number; let i2: number;
    if (idxAttr) {
      i0 = idxAttr.getX(t * 3);
      i1 = idxAttr.getX(t * 3 + 1);
      i2 = idxAttr.getX(t * 3 + 2);
    } else {
      i0 = t * 3;
      i1 = t * 3 + 1;
      i2 = t * 3 + 2;
    }
    const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, i0).applyMatrix4(m);
    const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i1).applyMatrix4(m);
    const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i2).applyMatrix4(m);
    tris.push([v0, v1, v2]);
  }
  return tris;
}

export function triBoxesOverlap(
  tA: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  tB: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  tol: number,
): boolean {
  for (let axis = 0; axis < 3; axis++) {
    const k = axis as 0 | 1 | 2;
    const aMin = Math.min(tA[0].getComponent(k), tA[1].getComponent(k), tA[2].getComponent(k)) - tol;
    const aMax = Math.max(tA[0].getComponent(k), tA[1].getComponent(k), tA[2].getComponent(k)) + tol;
    const bMin = Math.min(tB[0].getComponent(k), tB[1].getComponent(k), tB[2].getComponent(k)) - tol;
    const bMax = Math.max(tB[0].getComponent(k), tB[1].getComponent(k), tB[2].getComponent(k)) + tol;
    if (aMax < bMin || bMax < aMin) return false;
  }
  return true;
}

export function triInterval(
  projVerts: number[],
  planeDist: number[],
  tol: number,
): [number, number] | null {
  let singleIdx = -1;
  let singleSign = 0;
  for (let i = 0; i < 3; i++) {
    const sign = planeDist[i] > tol ? 1 : planeDist[i] < -tol ? -1 : 0;
    if (sign === 0) continue;
    const otherSigns = [0, 1, 2].filter((j) => j !== i).map((j) =>
      planeDist[j] > tol ? 1 : planeDist[j] < -tol ? -1 : 0,
    );
    if (otherSigns[0] !== sign || otherSigns[1] !== sign) {
      singleIdx = i;
      singleSign = sign;
      break;
    }
  }

  if (singleIdx === -1) {
    const onPlane = [0, 1, 2].filter((i) => Math.abs(planeDist[i]) <= tol);
    if (onPlane.length < 2) return null;
    const t0 = Math.min(...onPlane.map((i) => projVerts[i]));
    const t1 = Math.max(...onPlane.map((i) => projVerts[i]));
    return t0 < t1 ? [t0, t1] : null;
  }

  const idx0 = (singleIdx + 1) % 3;
  const idx1 = (singleIdx + 2) % 3;

  const dSingle = planeDist[singleIdx];
  const d0 = planeDist[idx0];
  const d1 = planeDist[idx1];

  const denom0 = dSingle - d0;
  const denom1 = dSingle - d1;

  const t0 = Math.abs(denom0) > tol
    ? projVerts[idx0] + (projVerts[singleIdx] - projVerts[idx0]) * (d0 / (d0 - dSingle))
    : projVerts[idx0];
  const t1 = Math.abs(denom1) > tol
    ? projVerts[idx1] + (projVerts[singleIdx] - projVerts[idx1]) * (d1 / (d1 - dSingle))
    : projVerts[idx1];

  void singleSign;
  return [Math.min(t0, t1), Math.max(t0, t1)];
}

export function triTriIntersectSegment(
  tA: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  tB: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  tol: number,
): [THREE.Vector3, THREE.Vector3] | null {
  const [a0, a1, a2] = tA;
  const [b0, b1, b2] = tB;

  const ab = b1.clone().sub(b0);
  const ac = b2.clone().sub(b0);
  const nB = ab.cross(ac);
  if (nB.lengthSq() < tol * tol) return null;
  nB.normalize();
  const dB = nB.dot(b0);

  const dA = [nB.dot(a0) - dB, nB.dot(a1) - dB, nB.dot(a2) - dB];
  if (
    (dA[0] > tol && dA[1] > tol && dA[2] > tol) ||
    (dA[0] < -tol && dA[1] < -tol && dA[2] < -tol)
  ) return null;

  const aa = a1.clone().sub(a0);
  const ac2 = a2.clone().sub(a0);
  const nA = aa.cross(ac2);
  if (nA.lengthSq() < tol * tol) return null;
  nA.normalize();
  const dAPlane = nA.dot(a0);

  const dBdist = [nA.dot(b0) - dAPlane, nA.dot(b1) - dAPlane, nA.dot(b2) - dAPlane];
  if (
    (dBdist[0] > tol && dBdist[1] > tol && dBdist[2] > tol) ||
    (dBdist[0] < -tol && dBdist[1] < -tol && dBdist[2] < -tol)
  ) return null;

  const L = nA.clone().cross(nB);
  const Llen = L.length();
  if (Llen < tol) return null;
  const Lnorm = L.clone().divideScalar(Llen);

  const ax = Math.abs(Lnorm.x); const ay = Math.abs(Lnorm.y); const az = Math.abs(Lnorm.z);
  let P: THREE.Vector3;
  if (ax >= ay && ax >= az) {
    const det = nA.y * nB.z - nA.z * nB.y;
    if (Math.abs(det) < tol) return null;
    const y = (dAPlane * nB.z - dB * nA.z) / det;
    const z = (nA.y * dB - nB.y * dAPlane) / det;
    P = new THREE.Vector3(0, y, z);
  } else if (ay >= ax && ay >= az) {
    const det = nA.x * nB.z - nA.z * nB.x;
    if (Math.abs(det) < tol) return null;
    const x = (dAPlane * nB.z - dB * nA.z) / det;
    const z = (nA.x * dB - nB.x * dAPlane) / det;
    P = new THREE.Vector3(x, 0, z);
  } else {
    const det = nA.x * nB.y - nA.y * nB.x;
    if (Math.abs(det) < tol) return null;
    const x = (dAPlane * nB.y - dB * nA.y) / det;
    const y = (nA.x * dB - nB.x * dAPlane) / det;
    P = new THREE.Vector3(x, y, 0);
  }

  const projA = [
    Lnorm.dot(a0) - Lnorm.dot(P),
    Lnorm.dot(a1) - Lnorm.dot(P),
    Lnorm.dot(a2) - Lnorm.dot(P),
  ];
  const projB = [
    Lnorm.dot(b0) - Lnorm.dot(P),
    Lnorm.dot(b1) - Lnorm.dot(P),
    Lnorm.dot(b2) - Lnorm.dot(P),
  ];

  const intervalA = triInterval(projA, dA, tol);
  const intervalB = triInterval(projB, dBdist, tol);
  if (!intervalA || !intervalB) return null;

  const ta = Math.max(intervalA[0], intervalB[0]);
  const tb = Math.min(intervalA[1], intervalB[1]);
  if (tb - ta < tol) return null;

  const p0 = P.clone().addScaledVector(Lnorm, ta);
  const p1 = P.clone().addScaledVector(Lnorm, tb);
  return [p0, p1];
}

export function chainSegments(
  segments: Array<[THREE.Vector3, THREE.Vector3]>,
  tol: number,
): THREE.Vector3[][] {
  if (segments.length === 0) return [];

  const cell = Math.max(tol * 2, 1e-6);
  const keyFor = (p: THREE.Vector3): string => `${Math.round(p.x / cell)}|${Math.round(p.y / cell)}|${Math.round(p.z / cell)}`;

  const nodeOf: string[] = new Array(segments.length * 2);
  const bucketToSegEnds = new Map<string, Array<{ segIdx: number; endIdx: 0 | 1 }>>();

  const addEndpoint = (p: THREE.Vector3, segIdx: number, endIdx: 0 | 1) => {
    const cx = Math.round(p.x / cell); const cy = Math.round(p.y / cell); const cz = Math.round(p.z / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const k = `${cx + dx}|${cy + dy}|${cz + dz}`;
          const group = bucketToSegEnds.get(k);
          if (!group) continue;
          const probe = segments[group[0].segIdx][group[0].endIdx];
          if (probe.distanceToSquared(p) <= tol * tol) {
            group.push({ segIdx, endIdx });
            nodeOf[segIdx * 2 + endIdx] = k;
            return;
          }
        }
    const k = keyFor(p);
    bucketToSegEnds.set(k, [{ segIdx, endIdx }]);
    nodeOf[segIdx * 2 + endIdx] = k;
  };

  for (let i = 0; i < segments.length; i++) {
    addEndpoint(segments[i][0], i, 0);
    addEndpoint(segments[i][1], i, 1);
  }

  const usedSegs = new Set<number>();
  const polylines: THREE.Vector3[][] = [];

  const nextUnusedAt = (endpointKey: string, segIgnore: number): { segIdx: number; endIdx: 0 | 1 } | null => {
    const group = bucketToSegEnds.get(endpointKey);
    if (!group) return null;
    for (const g of group) {
      if (g.segIdx === segIgnore) continue;
      if (usedSegs.has(g.segIdx)) continue;
      return g;
    }
    return null;
  };

  for (let startSeg = 0; startSeg < segments.length; startSeg++) {
    if (usedSegs.has(startSeg)) continue;

    const chain: THREE.Vector3[] = [segments[startSeg][0].clone(), segments[startSeg][1].clone()];
    usedSegs.add(startSeg);

    let curSeg = startSeg;
    let curEnd: 0 | 1 = 1;
    for (;;) {
      const nodeKey = nodeOf[curSeg * 2 + curEnd];
      const nxt = nextUnusedAt(nodeKey, curSeg);
      if (!nxt) break;
      usedSegs.add(nxt.segIdx);
      const otherEnd: 0 | 1 = nxt.endIdx === 0 ? 1 : 0;
      chain.push(segments[nxt.segIdx][otherEnd].clone());
      curSeg = nxt.segIdx;
      curEnd = otherEnd;
    }

    curSeg = startSeg;
    curEnd = 0;
    const prepend: THREE.Vector3[] = [];
    for (;;) {
      const nodeKey = nodeOf[curSeg * 2 + curEnd];
      const nxt = nextUnusedAt(nodeKey, curSeg);
      if (!nxt) break;
      usedSegs.add(nxt.segIdx);
      const otherEnd: 0 | 1 = nxt.endIdx === 0 ? 1 : 0;
      prepend.unshift(segments[nxt.segIdx][otherEnd].clone());
      curSeg = nxt.segIdx;
      curEnd = otherEnd;
    }

    const full = [...prepend, ...chain];
    if (full.length >= 2) polylines.push(full);
  }

  return polylines;
}

export function computeMeshIntersectionCurve(
  meshA: THREE.Mesh,
  meshB: THREE.Mesh,
  tol = 1e-6,
): THREE.Vector3[][] {
  meshA.updateWorldMatrix(true, false);
  meshB.updateWorldMatrix(true, false);

  const trisA = extractWorldTriangles(meshA);
  const trisB = extractWorldTriangles(meshB);

  if (trisA.length * trisB.length > 50000) return [];

  const segments: Array<[THREE.Vector3, THREE.Vector3]> = [];
  for (const tA of trisA) {
    for (const tB of trisB) {
      if (!triBoxesOverlap(tA, tB, tol)) continue;
      const seg = triTriIntersectSegment(tA, tB, tol);
      if (seg) segments.push(seg);
    }
  }

  return chainSegments(segments, tol);
}

export function computePlaneIntersectionCurve(
  mesh: THREE.Mesh,
  plane: THREE.Plane,
  tol = 1e-6,
): THREE.Vector3[][] {
  mesh.updateWorldMatrix(true, false);
  const tris = extractWorldTriangles(mesh);
  const segments: Array<[THREE.Vector3, THREE.Vector3]> = [];

  for (const [v0, v1, v2] of tris) {
    const d0 = plane.distanceToPoint(v0);
    const d1 = plane.distanceToPoint(v1);
    const d2 = plane.distanceToPoint(v2);

    const s0 = d0 > tol ? 1 : d0 < -tol ? -1 : 0;
    const s1 = d1 > tol ? 1 : d1 < -tol ? -1 : 0;
    const s2 = d2 > tol ? 1 : d2 < -tol ? -1 : 0;
    if (s0 === s1 && s1 === s2) continue;

    const pts: THREE.Vector3[] = [];
    const edgeVerts: Array<[THREE.Vector3, number, THREE.Vector3, number]> = [
      [v0, d0, v1, d1],
      [v1, d1, v2, d2],
      [v2, d2, v0, d0],
    ];
    for (const [va, da, vb, db] of edgeVerts) {
      const sa = da > tol ? 1 : da < -tol ? -1 : 0;
      const sb = db > tol ? 1 : db < -tol ? -1 : 0;
      if (sa === 0) {
        if (pts.length === 0 || pts[pts.length - 1].distanceToSquared(va) > tol * tol) {
          pts.push(va.clone());
        }
      } else if (sb === 0) {
        // no-op
      } else if (sa !== sb) {
        const t = da / (da - db);
        pts.push(new THREE.Vector3().lerpVectors(va, vb, t));
      }
    }

    if (pts.length >= 2) {
      segments.push([pts[0], pts[1]]);
    }
  }

  return chainSegments(segments, tol);
}
