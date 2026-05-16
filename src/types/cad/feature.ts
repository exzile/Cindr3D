import * as THREE from 'three';

export type FeatureType =
  | 'sketch'
  | 'extrude'
  | 'revolve'
  | 'fillet'
  | 'chamfer'
  | 'shell'
  | 'draft'
  | 'split-body'
  | 'offset-face'
  | 'hole'
  | 'thread'
  | 'linear-pattern'
  | 'circular-pattern'
  | 'rectangular-pattern'
  | 'mirror'
  | 'combine'
  | 'construction-plane'
  | 'construction-axis'
  | 'import'
  | 'primitive'
  | 'sweep'
  | 'loft'
  | 'thicken'
  | 'rib'
  | 'pattern-on-path'
  | 'scale'
  | 'form'
  | 'base-feature'
  | 'replace-face'
  | 'direct-edit'
  | 'texture-extrude'
  | 'decal'
  | 'split-face'
  | 'bounding-solid'
  | 'emboss'
  | 'pipe'
  | 'boundary-fill'
  | 'coil'
  | 'snapFit'
  | 'lipGroove'
  | 'fastener'
  | 'derive';

export type BooleanOperation = 'new-body' | 'join' | 'cut' | 'intersect';

export type BodyKind = 'solid' | 'surface' | 'mesh' | 'brep';

export interface Feature {
  id: string;
  name: string;
  type: FeatureType;
  sketchId?: string;
  bodyId?: string;
  componentId?: string;
  params: Record<string, unknown>;
  mesh?: THREE.Mesh;
  bodyKind?: BodyKind;
  visible: boolean;
  suppressed: boolean;
  timestamp: number;
  isBaseFeatureContainer?: boolean;
  baseFeatureOpen?: boolean;
  groupId?: string;
  suppressTimeline?: boolean;
  startFaceIds?: string[];
  endFaceIds?: string[];
  sideFaceIds?: string[];
  derivedFrom?: string;
}

export interface FeatureGroup {
  id: string;
  name: string;
  collapsed: boolean;
  parentGroupId?: string;
}

/** A picked geometry reference used by the Align tool. */
export interface AlignGeomPick {
  /** Feature whose body was picked (null = world/origin geometry). */
  featureId: string | null;
  kind: 'face' | 'edge' | 'vertex';
  /** Representative world point: face centroid / edge midpoint / vertex position. */
  point: [number, number, number];
  /** Face normal or edge direction (world, unit). Null for vertex. */
  dir: [number, number, number] | null;
}
