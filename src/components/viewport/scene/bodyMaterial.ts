import * as THREE from 'three';

/** Shared material for all CSG-evaluated bodies. Module-level singleton — never dispose. */
export const BODY_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x8899aa,
  metalness: 0.3,
  roughness: 0.4,
  side: THREE.DoubleSide,
});

/** Material for surface bodies — translucent blue, double-sided. Never dispose. */
export const SURFACE_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x3b82f6,
  metalness: 0.0,
  roughness: 0.5,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
});
