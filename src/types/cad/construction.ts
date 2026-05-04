import * as THREE from 'three';

export type ConstructionType = 'plane' | 'axis' | 'point';

export interface ConstructionGeometry {
  id: string;
  name: string;
  type: ConstructionType;
  componentId: string;
  visible: boolean;
  planeNormal?: THREE.Vector3;
  planeOrigin?: THREE.Vector3;
  planeSize?: number;
  axisDirection?: THREE.Vector3;
  axisOrigin?: THREE.Vector3;
  axisLength?: number;
  point?: THREE.Vector3;
  definition: ConstructionDefinition;
}

export type ConstructionDefinition =
  | { method: 'offset-plane'; referencePlane: string; distance: number }
  | { method: 'midplane'; plane1: string; plane2: string }
  | { method: 'angle-plane'; referencePlane: string; angle: number; axis: string }
  | { method: 'through-point'; point: [number, number, number]; referencePlane: string }
  | { method: 'three-points'; pt1: [number, number, number]; pt2: [number, number, number]; pt3: [number, number, number] }
  | { method: 'normal-to-curve'; origin: [number, number, number]; direction: [number, number, number] }
  | { method: 'tangent-plane'; faceId: string; point: { x: number; y: number; z: number } }
  | { method: 'three-points'; points: [string, string, string] }
  | { method: 'axis-through-points'; point1: string; point2: string }
  | { method: 'axis-perpendicular'; plane: string; point: string }
  | { method: 'point-at-vertex'; vertexId: string }
  | { method: 'origin'; axis: 'x' | 'y' | 'z' };

export interface ConstructionPlane {
  id: string;
  name: string;
  origin: [number, number, number];
  normal: [number, number, number];
  size: number;
}

export interface ConstructionAxis {
  id: string;
  name: string;
  origin: [number, number, number];
  direction: [number, number, number];
  length: number;
}

export interface ConstructionPoint {
  id: string;
  name: string;
  position: [number, number, number];
}
