import * as THREE from 'three';

/** Shared material for all CSG-evaluated bodies. Module-level singleton — never dispose. */
export const BODY_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0xf2a23a,
  metalness: 0.0,
  roughness: 0.58,
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

/** Dim material for context meshes — used when another component is being edited in-place. Never dispose. */
export const DIM_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xf2a23a,
  transparent: true,
  opacity: 0.42,
  side: THREE.DoubleSide,
});

const COMPONENT_COLOR_MATERIALS = new Map<string, THREE.MeshPhysicalMaterial>();

export function componentColorMaterial(color: string): THREE.Material {
  const key = color.toLowerCase();
  const cached = COMPONENT_COLOR_MATERIALS.get(key);
  if (cached) return cached;
  const material = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.58,
    side: THREE.DoubleSide,
  });
  COMPONENT_COLOR_MATERIALS.set(key, material);
  return material;
}
