import * as THREE from 'three';

export function disposeGeometries(
  ...geometries: Array<THREE.BufferGeometry | null | undefined>
): void {
  for (const geometry of geometries) {
    geometry?.dispose?.();
  }
}

export function disposeLineGeometries(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const line = obj as THREE.Line;
    if (line.isLine) {
      line.geometry?.dispose?.();
    }
  });
}

export function clearGroupChildren(
  group: THREE.Group,
  options?: { disposeMeshMaterial?: boolean },
): void {
  const disposeMeshMaterial = options?.disposeMeshMaterial ?? false;

  while (group.children.length > 0) {
    const child = group.children[0] as THREE.Object3D;

    const line = child as THREE.Line;
    if (line.isLine) {
      line.geometry?.dispose?.();
    }

    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose?.();
      if (disposeMeshMaterial) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => m?.dispose?.());
      }
    }

    group.remove(child);
  }
}
