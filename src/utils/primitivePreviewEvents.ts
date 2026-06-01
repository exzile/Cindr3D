export interface CylinderPrimitiveDragDetail {
  radius?: number;
  height?: number;
}

export const CYLINDER_PRIMITIVE_DRAG_EVENT = 'cindr3d:primitive-cylinder-drag';

export function emitCylinderPrimitiveDrag(detail: CylinderPrimitiveDragDetail): void {
  window.dispatchEvent(new CustomEvent<CylinderPrimitiveDragDetail>(CYLINDER_PRIMITIVE_DRAG_EVENT, { detail }));
}
