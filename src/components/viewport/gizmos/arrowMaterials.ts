import * as THREE from 'three';

// Shared viewport arrow/gizmo materials. Module-level singletons: do not dispose.
export const VIEWPORT_ARROW_COLORS = {
  primary: 0xc2410c,
  cut: 0xb91c1c,
  height: 0x0369a1,
  radius: 0xc2410c,
} as const;

export function createViewportArrowMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export function createViewportArrowLineMaterial(color: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.98,
    toneMapped: false,
  });
}

export const VIEWPORT_ARROW_MATERIAL = createViewportArrowMaterial(VIEWPORT_ARROW_COLORS.primary);
export const VIEWPORT_ARROW_MATERIAL_CUT = createViewportArrowMaterial(VIEWPORT_ARROW_COLORS.cut);
export const VIEWPORT_ARROW_LINE_MATERIAL = createViewportArrowLineMaterial(VIEWPORT_ARROW_COLORS.primary);
export const VIEWPORT_ARROW_LINE_MATERIAL_CUT = createViewportArrowLineMaterial(VIEWPORT_ARROW_COLORS.cut);

export const CYLINDER_HEIGHT_ARROW_MATERIAL = createViewportArrowMaterial(VIEWPORT_ARROW_COLORS.height);
export const CYLINDER_HEIGHT_ARROW_LINE_MATERIAL = createViewportArrowLineMaterial(VIEWPORT_ARROW_COLORS.height);
export const CYLINDER_RADIUS_ARROW_MATERIAL = createViewportArrowMaterial(VIEWPORT_ARROW_COLORS.radius);
export const CYLINDER_RADIUS_ARROW_LINE_MATERIAL = createViewportArrowLineMaterial(VIEWPORT_ARROW_COLORS.radius);
