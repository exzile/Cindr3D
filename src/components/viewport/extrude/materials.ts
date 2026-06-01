import * as THREE from 'three';
import {
  VIEWPORT_ARROW_LINE_MATERIAL,
  VIEWPORT_ARROW_LINE_MATERIAL_CUT,
  VIEWPORT_ARROW_MATERIAL,
  VIEWPORT_ARROW_MATERIAL_CUT,
} from '../gizmos/arrowMaterials';

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

export const PREVIEW_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x3b82f6,
  roughness: 0.6,
  side: THREE.FrontSide,
});
// Red preview used when press-pulling INTO a body (cut mode)
export const PREVIEW_MATERIAL_CUT = new THREE.MeshStandardMaterial({
  color: 0xef4444,
  roughness: 0.6,
  side: THREE.FrontSide,
});

export const PREVIEW_EDGE_MATERIAL = new THREE.LineBasicMaterial({ color: 0x1d4ed8 });
export const PREVIEW_EDGE_MATERIAL_CUT = new THREE.LineBasicMaterial({ color: 0x991b1b });

// X-ray pass — same geometry, no depth test, drawn over everything at low opacity
// so the cut/join outline is visible through body surfaces.
export const PREVIEW_EDGE_XRAY_MATERIAL = new THREE.LineBasicMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.28,
  depthTest: false,
});
export const PREVIEW_EDGE_XRAY_MATERIAL_CUT = new THREE.LineBasicMaterial({
  color: 0xef4444,
  transparent: true,
  opacity: 0.28,
  depthTest: false,
});

export const ARROW_MATERIAL = VIEWPORT_ARROW_MATERIAL;
export const ARROW_MATERIAL_CUT = VIEWPORT_ARROW_MATERIAL_CUT;
export const ARROW_LINE_MATERIAL = VIEWPORT_ARROW_LINE_MATERIAL;
export const ARROW_LINE_MATERIAL_CUT = VIEWPORT_ARROW_LINE_MATERIAL_CUT;

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
