import * as THREE from 'three';

const SURFACE_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x8899aa,
  metalness: 0.3,
  roughness: 0.4,
  side: THREE.DoubleSide,
});
SURFACE_MATERIAL.userData['shared'] = true;

export function configureSurfaceMesh(geom: THREE.BufferGeometry) {
  const mesh = new THREE.Mesh(geom, SURFACE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
