import * as THREE from 'three';

export interface FacePickResult {
  mesh: THREE.Mesh;
  faceIndex: number;
  boundary: THREE.Vector3[];
  normal: THREE.Vector3;
  centroid: THREE.Vector3;
  occBodyId?: string;
  occFaceId?: number;
}

export interface UseFacePickerOptions {
  enabled: boolean;
  onHover?: (result: FacePickResult | null) => void;
  onClick?: (result: FacePickResult) => void;
  filter?: (mesh: THREE.Mesh) => boolean;
  /**
   * Coplanar-grouping tolerance forwarded to computeCoplanarFaceBoundary.
   * A looser value folds tangentially-connected near-coplanar triangles into
   * one face (Shell's "tangent chain"). Defaults to the boundary util default.
   */
  coplanarTol?: number;
}
