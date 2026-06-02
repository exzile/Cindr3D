export interface CylinderPrimitiveDragDetail {
  radius?: number;
  height?: number;
}

export interface BoxPrimitiveDragDetail {
  width?: number;
  height?: number;
  depth?: number;
}

export const BOX_PRIMITIVE_DRAG_EVENT = 'cindr3d:primitive-box-drag';
export const CYLINDER_PRIMITIVE_DRAG_EVENT = 'cindr3d:primitive-cylinder-drag';

export function emitBoxPrimitiveDrag(detail: BoxPrimitiveDragDetail): void {
  window.dispatchEvent(new CustomEvent<BoxPrimitiveDragDetail>(BOX_PRIMITIVE_DRAG_EVENT, { detail }));
}

export function emitCylinderPrimitiveDrag(detail: CylinderPrimitiveDragDetail): void {
  window.dispatchEvent(new CustomEvent<CylinderPrimitiveDragDetail>(CYLINDER_PRIMITIVE_DRAG_EVENT, { detail }));
}
