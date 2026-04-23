import * as THREE from 'three';

export function linearPattern(
  mesh: THREE.Mesh,
  params: {
    dirX: number; dirY: number; dirZ: number;
    spacing: number; count: number;
    dir2X?: number; dir2Y?: number; dir2Z?: number;
    spacing2?: number; count2?: number;
  },
): THREE.Mesh[] {
  const dir1 = new THREE.Vector3(params.dirX, params.dirY, params.dirZ).normalize();
  const results: THREE.Mesh[] = [];
  const count2 = params.count2 ?? 1;
  const spacing2 = params.spacing2 ?? 0;
  const dir2 = params.dir2X !== undefined
    ? new THREE.Vector3(params.dir2X, params.dir2Y ?? 0, params.dir2Z ?? 0).normalize()
    : null;
  for (let j = 0; j < count2; j++) {
    for (let i = 0; i < params.count; i++) {
      if (i === 0 && j === 0) continue;
      const offset = dir1.clone().multiplyScalar(i * params.spacing);
      if (dir2) offset.addScaledVector(dir2, j * spacing2);
      const geom = mesh.geometry.clone();
      geom.translate(offset.x, offset.y, offset.z);
      const copy = new THREE.Mesh(geom, mesh.material);
      copy.userData = { ...mesh.userData };
      results.push(copy);
    }
  }
  return results;
}

export function circularPattern(
  mesh: THREE.Mesh,
  params: {
    axisX: number; axisY: number; axisZ: number;
    originX: number; originY: number; originZ: number;
    count: number; totalAngle: number;
  },
): THREE.Mesh[] {
  const axis = new THREE.Vector3(params.axisX, params.axisY, params.axisZ).normalize();
  const origin = new THREE.Vector3(params.originX, params.originY, params.originZ);
  const results: THREE.Mesh[] = [];
  const angleStep = (params.totalAngle / params.count) * (Math.PI / 180);
  for (let i = 1; i < params.count; i++) {
    const angle = angleStep * i;
    const quat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const geom = mesh.geometry.clone();
    const pos = geom.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      const point = new THREE.Vector3().fromBufferAttribute(pos, v).sub(origin).applyQuaternion(quat).add(origin);
      pos.setXYZ(v, point.x, point.y, point.z);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    const copy = new THREE.Mesh(geom, mesh.material);
    copy.userData = { ...mesh.userData };
    results.push(copy);
  }
  return results;
}

export function patternOnPath(mesh: THREE.Mesh, pathPoints: THREE.Vector3[], count: number): THREE.Mesh[] {
  if (pathPoints.length < 2 || count < 2) return [];
  const results: THREE.Mesh[] = [];
  const arcLens = [0];
  for (let i = 1; i < pathPoints.length; i++) {
    arcLens.push(arcLens[i - 1] + pathPoints[i].distanceTo(pathPoints[i - 1]));
  }
  const total = arcLens[arcLens.length - 1];

  for (let k = 0; k < count; k++) {
    const targetLen = count > 1 ? (k / (count - 1)) * total : 0;
    let seg = 0;
    for (let i = 1; i < arcLens.length; i++) {
      if (arcLens[i] >= targetLen) { seg = i - 1; break; }
    }
    const segT = arcLens[seg + 1] > arcLens[seg]
      ? (targetLen - arcLens[seg]) / (arcLens[seg + 1] - arcLens[seg])
      : 0;
    const pos = pathPoints[seg].clone().lerp(pathPoints[Math.min(seg + 1, pathPoints.length - 1)], segT);
    const tangent = pathPoints[Math.min(seg + 1, pathPoints.length - 1)].clone().sub(pathPoints[seg]).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    const geom = mesh.geometry.clone();
    const matrix = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
    geom.applyMatrix4(matrix);
    const copy = new THREE.Mesh(geom, mesh.material);
    copy.userData = { ...mesh.userData };
    results.push(copy);
  }
  return results;
}
