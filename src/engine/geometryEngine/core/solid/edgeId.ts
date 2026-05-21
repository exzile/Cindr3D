/**
 * edgeId.ts — canonical, stable id for a model-edge polyline.
 *
 * Both the CSG-soup extractor (`edgeTopology.ts`) and the profile-loop
 * extractor (`profileTopology.ts`) must produce the SAME id for the same
 * physical edge so selection/highlight/cut agree regardless of which path
 * built the topology. The id is derived purely from the (already
 * canonically-ordered) endpoint coordinates + point count, so it is
 * deterministic and order-independent across the two producers.
 *
 * Keep this the single source of truth — never inline the `toFixed(4)`
 * format again (it was duplicated in two files before this was extracted).
 */
import type * as THREE from 'three';

/**
 * Stable id from the first/last point of a canonically-ordered polyline.
 *
 * @param bboxDiag - Optional bounding-box diagonal of the owning geometry.
 *   When provided, coordinates are divided by this value before formatting so
 *   the ID is invariant under uniform scaling (e.g. `geo.scale(s,s,s)`).
 *   Both producers that share the same body geometry must pass the same value;
 *   omitting it (the historical default) keeps the old absolute-coordinate IDs.
 */
export function modelEdgeId(pts: THREE.Vector3[], bboxDiag?: number): string {
  const s = bboxDiag && bboxDiag > 0 ? bboxDiag : 1;
  const A = pts[0];
  const B = pts[pts.length - 1];
  return `${(A.x / s).toFixed(4)},${(A.y / s).toFixed(4)},${(A.z / s).toFixed(4)}~`
    + `${(B.x / s).toFixed(4)},${(B.y / s).toFixed(4)},${(B.z / s).toFixed(4)}~${pts.length}`;
}
