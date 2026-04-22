import * as THREE from 'three';

export interface Triangle {
  v0: THREE.Vector3;
  v1: THREE.Vector3;
  v2: THREE.Vector3;
  normal: THREE.Vector3;
  edgeKey01: string;
  edgeKey12: string;
  edgeKey20: string;
}

export interface Segment {
  a: THREE.Vector2;
  b: THREE.Vector2;
  edgeKeyA: string;
  edgeKeyB: string;
}

export interface Contour {
  points: THREE.Vector2[];
  area: number;
  isOuter: boolean;
}

export interface BBox2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface InfillRegion {
  contour: THREE.Vector2[];
  holes: THREE.Vector2[][];
}

export interface GeneratedPerimeters {
  walls: THREE.Vector2[][];
  lineWidths: number[];
  outerCount: number;
  innermostHoles: THREE.Vector2[][];
  infillRegions: InfillRegion[];
}
