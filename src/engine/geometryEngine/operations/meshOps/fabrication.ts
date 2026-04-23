import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';

export function createRib(
  profilePoints: THREE.Vector3[],
  thickness: number,
  height: number,
  normal: THREE.Vector3,
): THREE.Mesh {
  const n = normal.clone().normalize();
  const verts: number[] = [];

  for (let i = 0; i + 1 < profilePoints.length; i++) {
    const p0 = profilePoints[i];
    const p1 = profilePoints[i + 1];
    const dir = p1.clone().sub(p0).normalize();
    const side = new THREE.Vector3().crossVectors(dir, n).normalize().multiplyScalar(thickness / 2);
    const up = n.clone().multiplyScalar(height);

    const corners = [
      p0.clone().sub(side), p0.clone().add(side), p1.clone().add(side), p1.clone().sub(side),
      p0.clone().sub(side).add(up), p0.clone().add(side).add(up), p1.clone().add(side).add(up), p1.clone().sub(side).add(up),
    ];

    const faces = [
      [0, 1, 2, 0, 2, 3],
      [4, 6, 5, 4, 7, 6],
      [0, 4, 5, 0, 5, 1],
      [2, 6, 7, 2, 7, 3],
      [0, 3, 7, 0, 7, 4],
      [1, 5, 6, 1, 6, 2],
    ];
    for (const face of faces) {
      for (const idx of face) verts.push(corners[idx].x, corners[idx].y, corners[idx].z);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geom.computeVertexNormals();
  return new THREE.Mesh(geom, new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4 }));
}

export function createWeb(
  entityPoints: THREE.Vector3[][],
  thickness: number,
  height: number,
  normal: THREE.Vector3,
): THREE.Mesh {
  const allVerts: number[] = [];
  for (const pts of entityPoints) {
    if (pts.length < 2) continue;
    const ribMesh = createRib(pts, thickness, height, normal);
    const pos = ribMesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i++) allVerts.push(arr[i]);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allVerts), 3));
  geom.computeVertexNormals();
  return new THREE.Mesh(geom, new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4 }));
}

export function createRest(
  centerX: number,
  centerY: number,
  centerZ: number,
  normalX: number,
  normalY: number,
  normalZ: number,
  width: number,
  depth: number,
  thickness: number,
): THREE.Mesh {
  const baseGeom = new THREE.BoxGeometry(width, thickness, depth);
  const normal = new THREE.Vector3(normalX, normalY, normalZ).normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  const mesh = new THREE.Mesh(baseGeom, new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4 }));
  mesh.position.set(centerX, centerY, centerZ);
  mesh.quaternion.copy(quat);
  mesh.updateMatrixWorld(true);
  const geom = baseGeom.clone();
  geom.applyMatrix4(mesh.matrixWorld);
  geom.computeVertexNormals();
  return new THREE.Mesh(geom, new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4 }));
}

export function createCosmeticThread(radius: number, pitch: number, length: number, turns?: number): THREE.BufferGeometry {
  const n = turns ?? Math.ceil(length / pitch);
  const stepsPerTurn = 64;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= n * stepsPerTurn; i++) {
    const t = i / stepsPerTurn;
    const angle = t * Math.PI * 2;
    const y = (i / (n * stepsPerTurn)) * length;
    points.push(new THREE.Vector3(radius * Math.cos(angle), y, radius * Math.sin(angle)));
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

export function remesh(mesh: THREE.Mesh, mode: 'refine' | 'coarsen', iterations: number): THREE.Mesh {
  if (mode === 'refine') {
    let geom = mesh.geometry.clone().toNonIndexed();
    for (let iter = 0; iter < iterations; iter++) {
      const pos = geom.attributes.position as THREE.BufferAttribute;
      const newVerts: number[] = [];
      for (let i = 0; i < pos.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, i);
        const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
        const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
        const ab = a.clone().add(b).multiplyScalar(0.5);
        const bc = b.clone().add(c).multiplyScalar(0.5);
        const ca = c.clone().add(a).multiplyScalar(0.5);
        for (const [x, y, z] of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]] as [THREE.Vector3, THREE.Vector3, THREE.Vector3][]) {
          newVerts.push(x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z);
        }
      }
      geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newVerts), 3));
    }
    geom.computeVertexNormals();
    const result = new THREE.Mesh(geom, mesh.material);
    result.userData = { ...mesh.userData };
    return result;
  }

  const srcNI = mesh.geometry.clone();
  const merged = srcNI.index ? srcNI : mergeVertices(srcNI, 1e-4);
  if (!srcNI.index) srcNI.dispose();
  const modifier = new SimplifyModifier();
  let cur = merged;
  for (let iter = 0; iter < iterations; iter++) {
    const pos = cur.attributes.position as THREE.BufferAttribute;
    const vertCount = pos.count;
    const remove = Math.max(0, Math.min(vertCount - 60, Math.floor(vertCount * 0.2)));
    if (remove < 3) break;
    const next = modifier.modify(cur, remove);
    if (cur !== merged) cur.dispose();
    cur = next;
  }
  cur.computeVertexNormals();
  if (cur === merged) {
    const result = new THREE.Mesh(cur, mesh.material);
    result.userData = { ...mesh.userData };
    return result;
  }
  merged.dispose();
  const result = new THREE.Mesh(cur, mesh.material);
  result.userData = { ...mesh.userData };
  return result;
}

export function shellMesh(
  mesh: THREE.Mesh,
  thickness: number,
  direction: 'inward' | 'outward' | 'symmetric',
): THREE.Mesh {
  const inwardDist = direction === 'outward' ? 0 : -thickness;
  let outerGeom = mesh.geometry.clone();
  outerGeom.applyMatrix4(mesh.matrixWorld);
  outerGeom.deleteAttribute('normal');
  outerGeom = mergeVertices(outerGeom, 1e-4);
  outerGeom.computeVertexNormals();

  const innerGeom = outerGeom.clone();
  const innerPos = innerGeom.attributes.position as THREE.BufferAttribute;
  const innerNorm = innerGeom.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < innerPos.count; i++) {
    const nx = innerNorm.getX(i);
    const ny = innerNorm.getY(i);
    const nz = innerNorm.getZ(i);
    innerPos.setXYZ(
      i,
      innerPos.getX(i) + nx * inwardDist,
      innerPos.getY(i) + ny * inwardDist,
      innerPos.getZ(i) + nz * inwardDist,
    );
  }
  innerPos.needsUpdate = true;

  if (innerGeom.index) {
    const idx = innerGeom.index;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
    idx.needsUpdate = true;
  }
  innerGeom.computeVertexNormals();

  const outerNI = outerGeom.toNonIndexed();
  const innerNI = innerGeom.toNonIndexed();
  outerGeom.dispose();
  innerGeom.dispose();
  const outerArr = outerNI.attributes.position.array as Float32Array;
  const innerArr = innerNI.attributes.position.array as Float32Array;
  const combined = new Float32Array(outerArr.length + innerArr.length);
  combined.set(outerArr, 0);
  combined.set(innerArr, outerArr.length);
  outerNI.dispose();
  innerNI.dispose();
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(combined, 3));
  geom.computeVertexNormals();
  const result = new THREE.Mesh(geom, mesh.material);
  result.userData = { ...mesh.userData };
  return result;
}

export function draftMesh(
  mesh: THREE.Mesh,
  pullAxisDir: THREE.Vector3,
  draftAngle: number,
  fixedPlaneY = 0,
): THREE.Mesh {
  const geom = mesh.geometry.clone().toNonIndexed();
  geom.applyMatrix4(mesh.matrixWorld);
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const axis = pullAxisDir.clone().normalize();
  const tanAngle = Math.tan(draftAngle * Math.PI / 180);

  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const height = v.dot(axis) - fixedPlaneY;
    if (Math.abs(height) < 1e-6) continue;
    const axisComponent = axis.clone().multiplyScalar(v.dot(axis));
    const radial = v.clone().sub(axisComponent);
    const radialLen = radial.length();
    if (radialLen < 1e-8) continue;
    const radialDir = radial.divideScalar(radialLen);
    const offset = height * tanAngle;
    pos.setXYZ(i, v.x + radialDir.x * offset, v.y + radialDir.y * offset, v.z + radialDir.z * offset);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  const result = new THREE.Mesh(geom, mesh.material);
  result.userData = { ...mesh.userData };
  return result;
}
