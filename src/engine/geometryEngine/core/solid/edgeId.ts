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

/** Stable id from the first/last point of a canonically-ordered polyline. */
export function modelEdgeId(pts: THREE.Vector3[]): string {
  const A = pts[0];
  const B = pts[pts.length - 1];
  return `${A.x.toFixed(4)},${A.y.toFixed(4)},${A.z.toFixed(4)}~`
    + `${B.x.toFixed(4)},${B.y.toFixed(4)},${B.z.toFixed(4)}~${pts.length}`;
}
