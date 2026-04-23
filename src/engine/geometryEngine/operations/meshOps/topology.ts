import * as THREE from 'three';

export function planeCutMesh(
  mesh: THREE.Mesh,
  planeNormal: THREE.Vector3,
  planeOffset: number,
  keepSide: 'positive' | 'negative',
): THREE.Mesh {
  const geom = mesh.geometry.toNonIndexed();
  geom.applyMatrix4(mesh.matrixWorld);
  const normal = planeNormal.clone().normalize();
  const sign = keepSide === 'positive' ? 1 : -1;

  const pos = geom.attributes.position as THREE.BufferAttribute;
  const keptVerts: number[] = [];
  const cutLoop: THREE.Vector3[] = [];

  for (let i = 0; i < pos.count; i += 3) {
    const va = new THREE.Vector3().fromBufferAttribute(pos, i);
    const vb = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
    const vc = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
    const da = normal.dot(va) - planeOffset;
    const db = normal.dot(vb) - planeOffset;
    const dc = normal.dot(vc) - planeOffset;
    const sa = Math.sign(da) * sign >= 0;
    const sb = Math.sign(db) * sign >= 0;
    const sc = Math.sign(dc) * sign >= 0;

    if (sa && sb && sc) {
      keptVerts.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
    } else if (!sa && !sb && !sc) {
      continue;
    } else {
      const verts = [va, vb, vc];
      const distances = [da, db, dc];
      const kept: THREE.Vector3[] = [];
      const boundary: THREE.Vector3[] = [];
      for (let j = 0; j < 3; j++) {
        const curr = verts[j];
        const next = verts[(j + 1) % 3];
        const dc0 = distances[j];
        const dc1 = distances[(j + 1) % 3];
        const currKept = dc0 * sign >= 0;
        const nextKept = dc1 * sign >= 0;
        if (currKept) kept.push(curr);
        if (currKept !== nextKept) {
          const t = dc0 / (dc0 - dc1);
          const point = curr.clone().lerp(next, t);
          kept.push(point);
          boundary.push(point.clone());
        }
      }
      for (let j = 1; j + 1 < kept.length; j++) {
        keptVerts.push(
          kept[0].x, kept[0].y, kept[0].z,
          kept[j].x, kept[j].y, kept[j].z,
          kept[j + 1].x, kept[j + 1].y, kept[j + 1].z,
        );
      }
      cutLoop.push(...boundary);
    }
  }

  if (cutLoop.length >= 3) {
    const cen = cutLoop.reduce((acc, point) => acc.clone().add(point)).divideScalar(cutLoop.length);
    for (let i = 0; i < cutLoop.length - 1; i++) {
      keptVerts.push(
        cen.x, cen.y, cen.z,
        cutLoop[i].x, cutLoop[i].y, cutLoop[i].z,
        cutLoop[i + 1].x, cutLoop[i + 1].y, cutLoop[i + 1].z,
      );
    }
  }

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(keptVerts), 3));
  newGeom.computeVertexNormals();
  const result = new THREE.Mesh(newGeom, mesh.material);
  result.userData = { ...mesh.userData };
  return result;
}

export function makeClosedMesh(mesh: THREE.Mesh): THREE.Mesh {
  const geom = mesh.geometry.toNonIndexed();
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const quantum = 1e-4;
  const hashKey = (v: THREE.Vector3) =>
    `${Math.round(v.x / quantum)}|${Math.round(v.y / quantum)}|${Math.round(v.z / quantum)}`;

  const existingVerts: number[] = [];
  for (let i = 0; i < pos.count * 3; i++) existingVerts.push(pos.array[i]);

  const edgeCount = new Map<string, number>();
  const edgeVerts = new Map<string, [THREE.Vector3, THREE.Vector3]>();
  for (let i = 0; i < pos.count; i += 3) {
    const verts = [
      new THREE.Vector3().fromBufferAttribute(pos, i),
      new THREE.Vector3().fromBufferAttribute(pos, i + 1),
      new THREE.Vector3().fromBufferAttribute(pos, i + 2),
    ];
    for (let j = 0; j < 3; j++) {
      const a = verts[j];
      const b = verts[(j + 1) % 3];
      const ka = hashKey(a);
      const kb = hashKey(b);
      const key = ka < kb ? `${ka}#${kb}` : `${kb}#${ka}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      edgeVerts.set(key, [a, b]);
    }
  }

  const adjacency = new Map<string, string[]>();
  const keyVert = new Map<string, THREE.Vector3>();
  for (const [key, count] of edgeCount) {
    if (count !== 1) continue;
    const [a, b] = edgeVerts.get(key)!;
    const ka = hashKey(a);
    const kb = hashKey(b);
    keyVert.set(ka, a);
    keyVert.set(kb, b);
    if (!adjacency.has(ka)) adjacency.set(ka, []);
    if (!adjacency.has(kb)) adjacency.set(kb, []);
    adjacency.get(ka)!.push(kb);
    adjacency.get(kb)!.push(ka);
  }

  const visited = new Set<string>();
  const capVerts: number[] = [];
  for (const startKey of adjacency.keys()) {
    if (visited.has(startKey)) continue;
    const loop: THREE.Vector3[] = [];
    let cur = startKey;
    let prev = '';
    while (!visited.has(cur)) {
      visited.add(cur);
      loop.push(keyVert.get(cur)!);
      const neighbors = adjacency.get(cur) ?? [];
      const next = neighbors.find((candidate) => candidate !== prev && !visited.has(candidate));
      if (!next) break;
      prev = cur;
      cur = next;
    }
    if (loop.length < 3) continue;
    const cen = loop.reduce((acc, point) => acc.clone().add(point)).divideScalar(loop.length);
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      capVerts.push(cen.x, cen.y, cen.z, b.x, b.y, b.z, a.x, a.y, a.z);
    }
  }

  const combined = new Float32Array(existingVerts.length + capVerts.length);
  combined.set(existingVerts);
  combined.set(capVerts, existingVerts.length);
  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute('position', new THREE.BufferAttribute(combined, 3));
  newGeom.computeVertexNormals();
  const result = new THREE.Mesh(newGeom, mesh.material);
  result.userData = { ...mesh.userData };
  return result;
}

export function smoothMesh(mesh: THREE.Mesh, iterations: number, factor = 0.5): THREE.Mesh {
  const geom = mesh.geometry.clone().toNonIndexed();
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const neighbors = new Map<number, Set<number>>();
  for (let i = 0; i < count; i++) neighbors.set(i, new Set());
  for (let i = 0; i < count; i += 3) {
    const [a, b, c] = [i, i + 1, i + 2];
    neighbors.get(a)!.add(b); neighbors.get(a)!.add(c);
    neighbors.get(b)!.add(a); neighbors.get(b)!.add(c);
    neighbors.get(c)!.add(a); neighbors.get(c)!.add(b);
  }
  const arr = pos.array as Float32Array;
  for (let iter = 0; iter < iterations; iter++) {
    const newPos = arr.slice();
    for (let i = 0; i < count; i++) {
      const nbrs = [...neighbors.get(i)!];
      if (nbrs.length === 0) continue;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const nn of nbrs) {
        sx += arr[nn * 3];
        sy += arr[nn * 3 + 1];
        sz += arr[nn * 3 + 2];
      }
      sx /= nbrs.length;
      sy /= nbrs.length;
      sz /= nbrs.length;
      newPos[i * 3] = arr[i * 3] + factor * (sx - arr[i * 3]);
      newPos[i * 3 + 1] = arr[i * 3 + 1] + factor * (sy - arr[i * 3 + 1]);
      newPos[i * 3 + 2] = arr[i * 3 + 2] + factor * (sz - arr[i * 3 + 2]);
    }
    arr.set(newPos);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  const result = new THREE.Mesh(geom, mesh.material);
  result.userData = { ...mesh.userData };
  return result;
}

export function meshSectionSketch(mesh: THREE.Mesh, plane: THREE.Plane): THREE.Vector3[][] {
  const geom = mesh.geometry.toNonIndexed();
  geom.applyMatrix4(mesh.matrixWorld);
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const segments: [THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const verts = [
      new THREE.Vector3().fromBufferAttribute(pos, i),
      new THREE.Vector3().fromBufferAttribute(pos, i + 1),
      new THREE.Vector3().fromBufferAttribute(pos, i + 2),
    ];
    const dists = verts.map((v) => plane.distanceToPoint(v));
    const crossings: THREE.Vector3[] = [];
    for (let j = 0; j < 3; j++) {
      const a = verts[j];
      const b = verts[(j + 1) % 3];
      const da = dists[j];
      const db = dists[(j + 1) % 3];
      if (da * db < 0) {
        crossings.push(a.clone().lerp(b, da / (da - db)));
      } else if (Math.abs(da) < 1e-6) {
        crossings.push(a.clone());
      }
    }
    if (crossings.length >= 2) segments.push([crossings[0], crossings[1]]);
  }
  return segments.map(([a, b]) => [a, b]);
}

export function removeFaceAndHeal(
  mesh: THREE.Mesh,
  faceNormal: THREE.Vector3,
  faceCentroid: THREE.Vector3,
  normalTolRad = 2 * Math.PI / 180,
): THREE.Mesh {
  const geom = mesh.geometry.clone().toNonIndexed();
  geom.applyMatrix4(mesh.matrixWorld);
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const normal = faceNormal.clone().normalize();
  const cosMin = Math.cos(normalTolRad);
  if (!geom.boundingSphere) geom.computeBoundingSphere();
  const planeTol = Math.max(0.01, (geom.boundingSphere?.radius ?? 1) * 0.02);
  const planeOffset = normal.dot(faceCentroid);

  const keptVerts: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, i);
    const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
    const triN = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    const triCen = a.clone().add(b).add(c).divideScalar(3);
    const sameNormal = triN.dot(normal) > cosMin;
    const samePlane = Math.abs(normal.dot(triCen) - planeOffset) < planeTol;
    if (sameNormal && samePlane) continue;
    keptVerts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  const tempGeom = new THREE.BufferGeometry();
  tempGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(keptVerts), 3));
  const tempMesh = new THREE.Mesh(tempGeom, mesh.material);
  return makeClosedMesh(tempMesh);
}
