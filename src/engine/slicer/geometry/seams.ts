import * as THREE from 'three';

import type { PrintProfile } from '../../../types/slicer';

export function closestPointIndex(contour: THREE.Vector2[], target: THREE.Vector2): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < contour.length; i++) {
    const d = contour[i].distanceTo(target);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function findSeamPosition(
  contour: THREE.Vector2[],
  pp: PrintProfile,
  _layerIndex: number,
  nozzleX?: number,
  nozzleY?: number,
): number {
  if (contour.length === 0) return 0;

  const mode: string = pp.zSeamPosition ?? pp.zSeamAlignment ?? 'shortest';

  switch (mode) {
    case 'random':
      return Math.floor(Math.random() * contour.length);

    case 'aligned':
    case 'back':
      return closestPointIndex(contour, new THREE.Vector2(0, 1e6));

    case 'user_specified': {
      const tx = pp.zSeamX ?? 0;
      const ty = pp.zSeamY ?? 0;
      let cx = 0;
      let cy = 0;
      if (pp.zSeamRelative) {
        for (const p of contour) { cx += p.x; cy += p.y; }
        cx /= contour.length;
        cy /= contour.length;
      }
      return closestPointIndex(contour, new THREE.Vector2(cx + tx, cy + ty));
    }

    case 'sharpest_corner': {
      const pref = pp.seamCornerPreference ?? 'none';
      let sharpestIdx = 0;
      let sharpestAngle = Math.PI * 2;
      let sharpestConcaveIdx = -1;
      let sharpestConcaveAngle = Math.PI * 2;
      let sharpestConvexIdx = -1;
      let sharpestConvexAngle = Math.PI * 2;
      const n = contour.length;
      for (let i = 0; i < n; i++) {
        const prev = contour[(i - 1 + n) % n];
        const curr = contour[i];
        const next = contour[(i + 1) % n];
        const v1 = new THREE.Vector2().subVectors(prev, curr).normalize();
        const v2 = new THREE.Vector2().subVectors(next, curr).normalize();
        const angle = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
        const cross = v1.x * v2.y - v1.y * v2.x;
        if (angle < sharpestAngle) {
          sharpestAngle = angle;
          sharpestIdx = i;
        }
        if (cross < 0 && angle < sharpestConcaveAngle) {
          sharpestConcaveAngle = angle;
          sharpestConcaveIdx = i;
        }
        if (cross > 0 && angle < sharpestConvexAngle) {
          sharpestConvexAngle = angle;
          sharpestConvexIdx = i;
        }
      }
      if (pref === 'hide_seam' && sharpestConcaveIdx >= 0) return sharpestConcaveIdx;
      if (pref === 'expose_seam' && sharpestConvexIdx >= 0) return sharpestConvexIdx;
      if (pref === 'smart_hide' && sharpestConcaveIdx >= 0) return sharpestConcaveIdx;
      return sharpestIdx;
    }

    case 'shortest':
    default:
      if (nozzleX !== undefined && nozzleY !== undefined) {
        return closestPointIndex(contour, new THREE.Vector2(nozzleX, nozzleY));
      }
      return 0;
  }
}
