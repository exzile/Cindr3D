/**
 * edgeTypes.ts — shared type definitions for model-edge topology.
 *
 * Previously co-located with the mesh-soup extraction logic in edgeTopology.ts.
 * Extracted here so persistence, rendering, and topology-producing code can
 * import the shape without pulling in the extraction implementation.
 */
import * as THREE from 'three';

export interface ModelEdge {
  /** Stable id (canonical endpoint hash) — same regardless of which segment was hit. */
  id: string;
  /** Ordered LOCAL-space polyline. Straight edge → 2 points; arc/loop → many; closed loop repeats the first point. */
  polyline: THREE.Vector3[];
  kind: 'crease' | 'boundary';
  /**
   * Convexity of the edge relative to the solid interior.
   * Convex = the edge protrudes outward (like a box corner to fillet).
   * Concave = the edge recedes inward (like a pocket or slot — needs fillet to fill).
   */
  convexity?: 'convex' | 'concave';
  /**
   * Unit in-face perpendicular pointing away from the edge into face 1 (LOCAL space).
   * Precomputed at topology-extraction time for the fast resolveEdge path.
   */
  u1?: THREE.Vector3;
  /** Unit in-face perpendicular pointing away from the edge into face 2 (LOCAL space). */
  u2?: THREE.Vector3;
}

export interface BodyTopology {
  edges: ModelEdge[];
}
