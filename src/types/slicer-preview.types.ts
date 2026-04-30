import type * as THREE from 'three';

export type PreviewColorMode =
  | 'type'
  | 'speed'
  | 'flow'
  | 'width'
  | 'layer-time'
  | 'wall-quality'
  | 'seam';

/** Per-instance metadata carried alongside an extrusion capsule for hover inspect. */
export interface ShaftMoveData {
  type: string;
  speed: number;
  extrusion: number;
  lineWidth: number;
  length: number;
  /** 0-based index of the source SliceMove inside its layer. Used by the
   *  hover tooltip and the g-code-text-panel sync feature. */
  moveIndex?: number;
}

/** Full hover info passed to the tooltip renderer. */
export interface MoveHoverInfo extends ShaftMoveData {
  worldPos: THREE.Vector3;
}
