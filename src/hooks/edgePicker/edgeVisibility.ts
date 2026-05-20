/**
 * edgeVisibility.ts — visibility + proximity gate for a candidate edge.
 *
 * - Occlusion: casts camera → (point on the edge nearest the cursor hit) and
 *   rejects the edge if the solid is struck meaningfully nearer than that
 *   point — i.e. the edge is behind the body from the current view. You must
 *   rotate so the edge is actually visible before it can be picked.
 * - Proximity: rejects the edge if the cursor is further than EDGE_PICK_PX
 *   screen pixels from the FULL projected edge chain. The nearest 3D segment
 *   (edgeVertexA/B) is not always the closest segment in screen space — a
 *   perspective camera foreshortens the edge so the 3D-nearest segment can
 *   project far from the cursor. We therefore walk the entire chain and accept
 *   when ANY segment is within the threshold.
 *
 * All scratch is module-level (R3F hot-path rule — no per-event allocation).
 */
import * as THREE from 'three';
import type { EdgePickResult } from '../../types/edge-picker.types';
import { closestPointOnSegment, segDistSqPx } from './segmentMath';

/**
 * Max distance (CSS px) the cursor may be from an edge to pick/hover it.
 * 12 was too tight on perspective/isometric views — edges foreshorten so the
 * cursor lands a handful of pixels off even when it visually appears on the
 * line. 20 matches Fusion-style slop comfortably.
 */
export const EDGE_PICK_PX = 20;

// Module-level scratch — no per-event allocation.
const _occRay = new THREE.Raycaster();
const _occPt = new THREE.Vector3();   // world point on edge nearest the cursor
const _occNdc = new THREE.Vector3();  // that point projected to NDC
const _occNdc2 = new THREE.Vector2();
const _projA = new THREE.Vector3();
const _projB = new THREE.Vector3();

export function edgeIsPickable(
  result: EdgePickResult,
  hitPoint: THREE.Vector3,
  camera: THREE.Camera,
  pickables: THREE.Mesh[],
  cursorPx: number,
  cursorPy: number,
  rectW: number,
  rectH: number,
): boolean {
  const chain = result.chain;

  // ── Proximity (screen space) ──────────────────────────────────────────────
  // Walk every segment of the full edge chain and accept when ANY segment is
  // within EDGE_PICK_PX pixels. Using only edgeVertexA/B (the 3D-nearest
  // segment) is wrong: perspective foreshortening means the 3D-nearest segment
  // can project far from the cursor even while the user is pointing directly
  // at a different part of the same edge.
  const threshold = EDGE_PICK_PX * EDGE_PICK_PX;
  let minProxSq = Infinity;
  const nPts = chain.length;
  for (let i = 0; i + 1 < nPts; i++) {
    const wa = chain[i];
    const wb = chain[i + 1];
    _projA.copy(wa).project(camera);
    _projB.copy(wb).project(camera);
    // Skip segment if either endpoint is behind the near plane.
    if (_projA.z > 1 || _projB.z > 1) continue;
    const ax = (_projA.x * 0.5 + 0.5) * rectW;
    const ay = (1 - (_projA.y * 0.5 + 0.5)) * rectH;
    const bx = (_projB.x * 0.5 + 0.5) * rectW;
    const by = (1 - (_projB.y * 0.5 + 0.5)) * rectH;
    const dSq = segDistSqPx(cursorPx, cursorPy, ax, ay, bx, by);
    if (dSq < minProxSq) minProxSq = dSq;
    if (dSq <= threshold) break; // early-out: already within threshold
  }
  if (minProxSq > threshold) return false;

  // ── Occlusion (depth) ─────────────────────────────────────────────────────
  // Point on the nearest 3D segment nearest to the surface hit, in world space.
  const ea = result.edgeVertexA;
  const eb = result.edgeVertexB;
  closestPointOnSegment(hitPoint, ea, eb, _occPt);
  // Build the view ray through that point via its NDC — correct for BOTH
  // perspective and orthographic cameras (this app uses an ortho camera, where
  // rays are parallel, not emanating from camera.position).
  _occNdc.copy(_occPt).project(camera);
  _occNdc2.set(_occNdc.x, _occNdc.y);
  _occRay.setFromCamera(_occNdc2, camera);
  const distToEdge = _occRay.ray.origin.distanceTo(_occPt);
  if (distToEdge < 1e-6) return true;
  _occRay.far = distToEdge * 1.5;
  const occHits = _occRay.intersectObjects(pickables, false);
  if (occHits.length > 0) {
    // Tolerance: the edge sits on the body surface, so the view ray through it
    // legitimately strikes the body at ~distToEdge. Only treat it as occluded
    // when something is hit clearly in front of that.
    const eps = Math.max(distToEdge * 0.01, 1e-3);
    if (occHits[0].distance < distToEdge - eps) return false;
  }
  return true;
}
