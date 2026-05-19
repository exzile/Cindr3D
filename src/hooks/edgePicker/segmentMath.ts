/**
 * segmentMath.ts — pure segment/point geometry helpers for the edge picker.
 *
 * Both the screen-space proximity gate (`edgeVisibility`) and the world-space
 * nearest-edge search (`nearestEdge`) need closest-point-on-segment; sharing
 * one implementation keeps the math (and its module-level scratch) in one
 * place. No per-call allocation — scratch is module-level (R3F hot-path rule).
 */
import * as THREE from 'three';

// Module-level scratch — no per-event allocation.
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();

/**
 * Returns the closest point on segment [a, b] to point p.
 * Result written into `out` (caller-owned; pass scratch and copy if needed).
 */
export function closestPointOnSegment(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  out: THREE.Vector3,
): THREE.Vector3 {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const lenSq = _ab.dot(_ab);
  if (lenSq === 0) {
    out.copy(a);
    return out;
  }
  const t = Math.max(0, Math.min(1, _ap.dot(_ab) / lenSq));
  out.copy(a).addScaledVector(_ab, t);
  return out;
}

/** Squared distance (px²) from point P to segment AB, all in screen pixels. */
export function segDistSqPx(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const abx = bx - ax; const aby = by - ay;
  const apx = px - ax; const apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq)) : 0;
  const cx = ax + abx * t; const cy = ay + aby * t;
  const dx = px - cx; const dy = py - cy;
  return dx * dx + dy * dy;
}
