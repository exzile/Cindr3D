import * as THREE from 'three';

// Shared materials for the extrude tool. Module-level singletons — never dispose.

export const PROFILE_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.18,
  side: THREE.DoubleSide,
  depthWrite: false,
});
export const PROFILE_HOVER_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x60a5fa,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false,
});
export const PROFILE_SELECTED_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
  depthWrite: false,
});

export const PREVIEW_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x3b82f6,
  metalness: 0.15,
  roughness: 0.35,
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
});
// Red preview used when press-pulling INTO a body (cut mode)
export const PREVIEW_MATERIAL_CUT = new THREE.MeshPhysicalMaterial({
  color: 0xef4444,
  metalness: 0.15,
  roughness: 0.35,
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
});

export const ARROW_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
export const ARROW_MATERIAL_CUT = new THREE.MeshBasicMaterial({ color: 0xef4444 });
export const ARROW_LINE_MATERIAL = new THREE.LineBasicMaterial({ color: 0xffaa00 });
export const ARROW_LINE_MATERIAL_CUT = new THREE.LineBasicMaterial({ color: 0xef4444 });

// Face-highlight materials for press-pull face picking
export const FACE_HIGHLIGHT_FILL = new THREE.MeshBasicMaterial({
  color: 0x60a5fa,
  transparent: true,
  opacity: 0.4,
  side: THREE.DoubleSide,
  depthWrite: false,
  depthTest: false,
});
export const FACE_HIGHLIGHT_OUTLINE = new THREE.LineBasicMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.95,
  depthTest: false,
});
