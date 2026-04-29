import type * as THREE from 'three';

export type PreviewColorMode =
  | 'type'
  | 'speed'
  | 'flow'
  | 'width'
  | 'layer-time'
  | 'wall-quality'
  | 'seam';

export interface LayerGeometryData {
  extrusionPositions: Float32Array;
  extrusionColors: Float32Array;
  travelPositions: Float32Array;
  retractionPoints: Float32Array;
}

/** Per-segment metadata carried alongside a chain tube for hover inspect. */
export interface ShaftMoveData {
  type: string;
  speed: number;
  extrusion: number;
  lineWidth: number;
  length: number;
  /** 0-based index of the source SliceMove inside its layer. Useful for
   *  debugging and for the future g-code-text-panel sync feature. */
  moveIndex?: number;
}

/** Full hover info passed to the tooltip renderer. */
export interface MoveHoverInfo extends ShaftMoveData {
  worldPos: THREE.Vector3;
}

/** A connected run of same-type extrusion moves forming a polyline tube. */
export interface TubeChain {
  type: string;
  /** Polyline vertices. length === number_of_segments + 1 for open chains,
   *  number_of_segments for closed chains (the closure is implicit). */
  points: Array<{ x: number; y: number; lw: number }>;
  /** Colour per segment (parallel to moveRefs). length = points.length - 1
   *  for open chains, = points.length for closed chains. */
  segColors: Array<[number, number, number]>;
  /** Hover metadata per segment. */
  moveRefs: ShaftMoveData[];
  /** True if the polyline closes back on itself. */
  isClosed: boolean;
}
