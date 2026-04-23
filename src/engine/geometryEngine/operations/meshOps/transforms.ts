import * as THREE from 'three';

export function reverseNormals(geom: THREE.BufferGeometry): void {
  if (geom.index) {
    const idx = geom.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i + 1];
      (idx as Uint16Array | Uint32Array)[i + 1] = idx[i + 2];
      (idx as Uint16Array | Uint32Array)[i + 2] = tmp;
    }
    geom.index.needsUpdate = true;
  } else {
    const pos = geom.getAttribute('position');
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const tmp = arr[i + 3 + k];
        arr[i + 3 + k] = arr[i + 6 + k];
        arr[i + 6 + k] = tmp;
      }
    }
    pos.needsUpdate = true;
  }
  geom.computeVertexNormals();
}

export function mirrorMesh(source: THREE.Mesh, plane: 'XY' | 'XZ' | 'YZ'): THREE.Mesh {
  const scale = new THREE.Vector3(
    plane === 'YZ' ? -1 : 1,
    plane === 'XZ' ? -1 : 1,
    plane === 'XY' ? -1 : 1,
  );
  const reflectMatrix = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);
  const geo = source.geometry.clone();
  geo.applyMatrix4(reflectMatrix);

  const idx = geo.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      const b = idx.getX(i + 2);
      idx.setX(i + 1, b);
      idx.setX(i + 2, a);
    }
    idx.needsUpdate = true;
  } else {
    const pos = geo.attributes.position;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      tmp.fromBufferAttribute(pos, i + 1);
      pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      pos.setXYZ(i + 2, tmp.x, tmp.y, tmp.z);
    }
    pos.needsUpdate = true;
  }
  geo.computeVertexNormals();

  const mat = Array.isArray(source.material) ? source.material[0].clone() : source.material.clone();
  return new THREE.Mesh(geo, mat);
}

export function reverseMeshNormals(mesh: THREE.Mesh): THREE.Mesh {
  const geom = mesh.geometry.clone();
  const pos = geom.attributes.position as THREE.BufferAttribute;
  if (geom.index) {
    const idx = geom.index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = tmp;
    }
    geom.index!.needsUpdate = true;
  } else {
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 9) {
      for (let j = 0; j < 3; j++) {
        const tmp = arr[i + 3 + j];
        arr[i + 3 + j] = arr[i + 6 + j];
        arr[i + 6 + j] = tmp;
      }
    }
    pos.needsUpdate = true;
  }
  if (geom.attributes.normal) geom.computeVertexNormals();
  const result = new THREE.Mesh(geom, mesh.material);
  result.userData = { ...mesh.userData };
  return result;
}

export function combineMeshes(meshes: THREE.Mesh[]): THREE.Mesh {
  const geoms = meshes.map((mesh) => {
    const geometry = mesh.geometry.toNonIndexed();
    geometry.applyMatrix4(mesh.matrixWorld);
    return geometry;
  });
  let totalVerts = 0;
  for (const geometry of geoms) totalVerts += (geometry.attributes.position as THREE.BufferAttribute).count;
  const positions = new Float32Array(totalVerts * 3);
  let offset = 0;
  for (const geometry of geoms) {
    const positionArray = geometry.attributes.position.array as Float32Array;
    positions.set(positionArray, offset);
    offset += positionArray.length;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.computeVertexNormals();
  const material = Array.isArray(meshes[0].material) ? meshes[0].material[0] : meshes[0].material;
  return new THREE.Mesh(merged, material);
}

export function transformMesh(
  mesh: THREE.Mesh,
  params: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number; scale: number },
): THREE.Mesh {
  const geom = mesh.geometry.clone();
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(params.tx, params.ty, params.tz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(params.rx, params.ry, params.rz)),
    new THREE.Vector3(params.scale, params.scale, params.scale),
  );
  geom.applyMatrix4(matrix);
  geom.computeVertexNormals();
  const result = new THREE.Mesh(geom, mesh.material);
  result.userData = { ...mesh.userData };
  return result;
}

export function scaleMesh(mesh: THREE.Mesh, sx: number, sy: number, sz: number): THREE.Mesh {
  const geom = mesh.geometry.clone();
  geom.applyMatrix4(new THREE.Matrix4().makeScale(sx, sy, sz));
  geom.computeVertexNormals();
  const result = new THREE.Mesh(geom, mesh.material);
  result.userData = { ...mesh.userData };
  return result;
}

export function alignMeshToCentroid(sourceMesh: THREE.Mesh, targetMesh: THREE.Mesh): THREE.Mesh {
  const srcBox = new THREE.Box3().setFromObject(sourceMesh);
  const tgtBox = new THREE.Box3().setFromObject(targetMesh);
  const srcCen = new THREE.Vector3();
  const tgtCen = new THREE.Vector3();
  srcBox.getCenter(srcCen);
  tgtBox.getCenter(tgtCen);
  const offset = tgtCen.sub(srcCen);
  const geom = sourceMesh.geometry.clone();
  geom.applyMatrix4(sourceMesh.matrixWorld);
  geom.translate(offset.x, offset.y, offset.z);
  geom.computeVertexNormals();
  const result = new THREE.Mesh(geom, sourceMesh.material);
  result.userData = { ...sourceMesh.userData };
  return result;
}
