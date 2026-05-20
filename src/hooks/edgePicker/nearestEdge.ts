/**
 * nearestEdge.ts — pick the nearest MODEL edge from the explicit body
 * topology (no soup reconstruction).
 *
 * The topology was extracted once, correctly, at geometry-build time and
 * lives on `geometry.userData.topology`. We find the edge whose polyline is
 * closest to the ray-hit point and the nearest segment on it. The whole edge
 * is returned as `chain` so highlight + selection + cut act on the entire
 * edge; `edgeVertexA/B` carry the nearest segment for the screen-space
 * proximity gate (the user must point AT the line).
 */
import * as THREE from 'three';
import type { EdgePickResult } from '../../types/edge-picker.types';
import { closestPointOnSegment } from './segmentMath';
import {
  getCachedEdges,
  getCachedChain,
  pointAabbDistSq,
  type BodyTopologyLike,
  type CachedEdge,
} from './topologyCache';

// Module-level scratch — no per-event allocation.
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _segCp = new THREE.Vector3();

export function pickNearestEdge(
  mesh: THREE.Mesh,
  faceIndex: number,
  hitPoint: THREE.Vector3,
): EdgePickResult | null {
  const geom = mesh.geometry;
  const topo = geom.userData?.topology as BodyTopologyLike | undefined;
  if (!topo || !topo.edges || topo.edges.length === 0) return null;

  mesh.updateWorldMatrix(true, false);
  const cached = getCachedEdges(geom, topo, mesh.matrixWorld);

  const hx = hitPoint.x, hy = hitPoint.y, hz = hitPoint.z;
  let bestDistSq = Infinity;
  let bestEdge: CachedEdge | null = null;
  let bestI = 0;

  for (const ce of cached) {
    // Broad-phase: if even the edge's bounding box is farther than the best
    // segment found so far, no segment on it can win — skip its inner loop.
    // (Conservative: never skips a potential winner → identical result.)
    if (pointAabbDistSq(hx, hy, hz, ce.aabb) >= bestDistSq) continue;
    const pts = ce.pts;
    for (let i = 0; i + 1 < pts.length / 3; i++) {
      const o = i * 3;
      _vA.set(pts[o], pts[o + 1], pts[o + 2]);
      _vB.set(pts[o + 3], pts[o + 4], pts[o + 5]);
      closestPointOnSegment(hitPoint, _vA, _vB, _segCp);
      const dSq = hitPoint.distanceToSquared(_segCp);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestEdge = ce;
        bestI = i;
      }
    }
  }
  if (!bestEdge) return null;

  const bp = bestEdge.pts;
  const bo = bestI * 3;
  const ea = new THREE.Vector3(bp[bo], bp[bo + 1], bp[bo + 2]);
  const eb = new THREE.Vector3(bp[bo + 3], bp[bo + 4], bp[bo + 5]);
  // Full edge polyline (world) for highlight + stable id + cut. Cached on the
  // CachedEdge so continuous-hover pointermove doesn't allocate ~N Vector3
  // instances per event (N up to ~30 for circle rims). Treated as read-only
  // by consumers — handleClick clones it before storing in selection state.
  const chain = getCachedChain(bestEdge);
  const midpoint = new THREE.Vector3().addVectors(ea, eb).multiplyScalar(0.5);
  const direction = new THREE.Vector3().subVectors(eb, ea).normalize();

  return {
    mesh,
    faceIndex,
    edgeVertexA: ea,            // nearest segment — drives the proximity gate
    edgeVertexB: eb,
    edgeVertexIndexA: 0,
    edgeVertexIndexB: 0,
    midpoint,
    direction,
    chain,                      // the WHOLE model edge — drives highlight/id/cut
  };
}
