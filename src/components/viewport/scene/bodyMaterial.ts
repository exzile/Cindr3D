import * as THREE from 'three';

/** Shared material for all CSG-evaluated bodies. Module-level singleton — never dispose. */
export const BODY_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x8899aa,
  metalness: 0.3,
  roughness: 0.4,
  side: THREE.DoubleSide,
});
