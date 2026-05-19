import * as THREE from 'three';

export interface EdgePickResult {
  mesh: THREE.Mesh;
  faceIndex: number;
  edgeVertexA: THREE.Vector3;
  edgeVertexB: THREE.Vector3;
  edgeVertexIndexA: number;
  edgeVertexIndexB: number;
  midpoint: THREE.Vector3;
  direction: THREE.Vector3;
  /**
   * The FULL model edge this hit segment belongs to, as an ordered world-space
   * polyline (≥2 points). A straight box edge → 2 endpoints; a hole-rim circle
   * → the whole loop (first point repeated at the end). Built by chaining
   * tangent-continuous feature edges on the cleaned manifold. When present,
   * the highlight draws this polyline and the edge-ID encodes every point so
   * selecting any part selects/chamfers the entire edge. Absent → fall back to
   * the single edgeVertexA→edgeVertexB segment.
   */
  chain?: THREE.Vector3[];
}

export interface UseEdgePickerOptions {
  enabled: boolean;
  onHover?: (result: EdgePickResult | null) => void;
  onClick?: (result: EdgePickResult) => void;
  filter?: (mesh: THREE.Mesh) => boolean;
}
