import * as THREE from "three";
import type { EdgePickResult } from "../../../../hooks/useEdgePicker";
import type { FacePickResult } from "../../../../types/face-picker.types";

/** Ordered points representing the picked edge: the full chained model edge when available, else the single hit segment. */
export function edgePoints(result: EdgePickResult): THREE.Vector3[] {
  return result.chain && result.chain.length >= 2
    ? result.chain
    : [result.edgeVertexA, result.edgeVertexB];
}

/** Normalize to 4 dp so pick-precision drift doesn't create stale IDs. */
const normCoord = (n: number) => +n.toFixed(4);

export function edgeId(result: EdgePickResult): string {
  const fid = (result.mesh.userData.featureId as string | undefined) ?? "";
  const prefix = fid ? `${fid}|` : "";
  const pts = edgePoints(result)
    .map((p) => p.toArray().map(normCoord).join(","))
    .join(":");
  return `${prefix}${result.mesh.uuid}:${pts}`;
}

/**
 * Build edge IDs from a face boundary polygon. Each consecutive pair of
 * boundary points becomes one edge ID, using the world-space coordinate format
 * that parseEdgeIds expects.
 */
export function faceEdgeIds(result: FacePickResult): string[] {
  const fid = (result.mesh.userData.featureId as string | undefined) ?? "";
  const prefix = fid ? `${fid}|` : "";
  const uuid = result.mesh.uuid;
  const b = result.boundary;
  const ids: string[] = [];
  for (let i = 0; i + 1 < b.length; i++) {
    const a = b[i]
      .toArray()
      .map((n) => +n.toFixed(4))
      .join(",");
    const bk = b[i + 1]
      .toArray()
      .map((n) => +n.toFixed(4))
      .join(",");
    ids.push(`${prefix}${uuid}:${a}:${bk}`);
  }
  return ids;
}

/**
 * Compute the inradius of a boundary polygon = min distance from centroid to
 * any boundary edge. Used for full-round fillet auto-radius.
 */
export function faceInradius(
  boundary: THREE.Vector3[],
  centroid: THREE.Vector3,
): number {
  let minDist = Infinity;
  const _seg = new THREE.Vector3();
  const _cp = new THREE.Vector3();
  for (let i = 0; i + 1 < boundary.length; i++) {
    const a = boundary[i];
    const b = boundary[i + 1];
    _seg.subVectors(b, a);
    const lenSq = _seg.lengthSq();
    if (lenSq < 1e-12) continue;
    const t = THREE.MathUtils.clamp(
      _cp.subVectors(centroid, a).dot(_seg) / lenSq,
      0,
      1,
    );
    const dist = centroid.distanceTo(a.clone().addScaledVector(_seg, t));
    if (dist < minDist) minDist = dist;
  }
  return minDist === Infinity ? 0 : minDist;
}

export function isCurvedEdge(
  edge: { polyline?: THREE.Vector3[] } | EdgePickResult,
): boolean {
  const pts = "mesh" in edge ? edgePoints(edge) : edge.polyline;
  return (pts?.length ?? 0) > 2;
}
