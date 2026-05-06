import * as THREE from 'three';

export const mm = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const material = (color = 0x94a3b8): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.12 });

export const finishMesh = (mesh: THREE.Mesh): THREE.Mesh => {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.geometry.computeVertexNormals();
  return mesh;
};

export function groupToMesh(group: THREE.Group, name: string): THREE.Mesh {
  group.updateMatrixWorld(true);
  const clones: THREE.BufferGeometry[] = [];
  const subMaterials: THREE.Material[] = [];
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const clone = mesh.geometry.clone();
    clone.applyMatrix4(mesh.matrixWorld);
    clones.push(clone);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if (m) subMaterials.push(m);
  });
  const merged = mergeBufferGeometries(clones);
  for (const g of clones) g.dispose();
  for (const m of new Set(subMaterials)) m.dispose();
  const mesh = new THREE.Mesh(merged, material());
  mesh.name = name;
  return finishMesh(mesh);
}

function mergeBufferGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  for (const geometry of geometries) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    if (!position) continue;
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      if (normal) normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
    } else {
      for (let i = 0; i < position.count; i++) indices.push(i + offset);
    }
    offset += position.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}

