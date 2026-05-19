/**
 * edgeVisibility.ts — visibility + proximity gate for a candidate edge.
 *
 * - Occlusion: casts camera → (point on the edge nearest the cursor hit) and
 *   rejects the edge if the solid is struck meaningfully nearer than that
 *   point — i.e. the edge is behind the body from the current view. You must
 *   rotate so the edge is actually visible before it can be picked.
 * - Proximity: rejects the edge if the cursor is further than EDGE_PICK_PX
 *   screen pixels from the projected edge segment — you must point AT the
 *   line, not anywhere on the face it bounds.
 *
 * All scratch is module-level (R3F hot-path rule — no per-event allocation).
 */
import * as THREE from 'three';
import type { EdgePickResult } from '../../types/edge-picker.types';
import { closestPointOnSegment, segDistSqPx } from './segmentMath';

/** Max distance (CSS px) the cursor may be from an edge to pick/hover it. */
export const EDGE_PICK_PX = 12;

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
  const ea = result.edgeVertexA;
  const eb = result.edgeVertexB;

  // ── Proximity (screen space) ──────────────────────────────────────────────
  _projA.copy(ea).project(camera);
  _projB.copy(eb).project(camera);
  // Behind the camera → not pickable here.
  if (_projA.z > 1 || _projB.z > 1) return false;
  const ax = (_projA.x * 0.5 + 0.5) * rectW;
  const ay = (1 - (_projA.y * 0.5 + 0.5)) * rectH;
  const bx = (_projB.x * 0.5 + 0.5) * rectW;
  const by = (1 - (_projB.y * 0.5 + 0.5)) * rectH;
  if (segDistSqPx(cursorPx, cursorPy, ax, ay, bx, by) > EDGE_PICK_PX * EDGE_PICK_PX) {
    return false;
  }

  // ── Occlusion (depth) ─────────────────────────────────────────────────────
  // Point on the edge nearest the cursor's surface hit, in world space.
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
