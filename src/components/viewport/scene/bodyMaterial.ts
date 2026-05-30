import * as THREE from 'three';

/** Shared material for solid bodies. Module-level singleton; never dispose. */
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

/** Material for bounding-solid helper meshes — semi-transparent blue. Never dispose. */
export const BOUNDING_SOLID_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x4488ff,
  transparent: true,
  opacity: 0.3,
  side: THREE.DoubleSide,
});

/** Material for fastener meshes (bolts, nuts, washers) — metallic silver. Never dispose. */
export const FASTENER_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#B0B8C0',
  metalness: 0.8,
  roughness: 0.3,
});

const COMPONENT_COLOR_MATERIALS = new Map<string, THREE.MeshPhysicalMaterial>();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const material of COMPONENT_COLOR_MATERIALS.values()) material.dispose();
    COMPONENT_COLOR_MATERIALS.clear();
  });
}

export function componentColorMaterial(color: string): THREE.Material {
  const key = color.toLowerCase();
  const cached = COMPONENT_COLOR_MATERIALS.get(key);
  if (cached) return cached;
  // Evict oldest entry before growing past limit to prevent unbounded GPU leak
  // when components cycle through many colors over a session.
  if (COMPONENT_COLOR_MATERIALS.size >= 64) {
    const firstKey = COMPONENT_COLOR_MATERIALS.keys().next().value!;
    COMPONENT_COLOR_MATERIALS.get(firstKey)?.dispose();
    COMPONENT_COLOR_MATERIALS.delete(firstKey);
  }
  const material = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.58,
    side: THREE.DoubleSide,
  });
  COMPONENT_COLOR_MATERIALS.set(key, material);
  return material;
}
