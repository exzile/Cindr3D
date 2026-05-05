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

export interface SeamPlacementOptions {
  previousSeam?: THREE.Vector2 | null;
  continuityTolerance?: number;
  userSpecifiedRadius?: number;
  layerZ?: number;
  isSupported?: (point: THREE.Vector2) => boolean;
}

function contourCentroid(contour: THREE.Vector2[]): THREE.Vector2 {
  const center = new THREE.Vector2();
  for (const point of contour) center.add(point);
  return center.multiplyScalar(1 / Math.max(1, contour.length));
}

function cornerSharpness(contour: THREE.Vector2[], index: number): number {
  const n = contour.length;
  const prev = contour[(index - 1 + n) % n];
  const curr = contour[index];
  const next = contour[(index + 1) % n];
  const v1 = new THREE.Vector2().subVectors(prev, curr).normalize();
  const v2 = new THREE.Vector2().subVectors(next, curr).normalize();
  return Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
}

function closestSupportedIndex(
  contour: THREE.Vector2[],
  startIdx: number,
  isSupported?: (point: THREE.Vector2) => boolean,
): number {
  if (!isSupported || isSupported(contour[startIdx])) return startIdx;
  let bestIdx = startIdx;
  let bestDistance = Infinity;
  const start = contour[startIdx];
  for (let i = 0; i < contour.length; i++) {
    if (!isSupported(contour[i])) continue;
    const distance = contour[i].distanceTo(start);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function continuityIndex(
  contour: THREE.Vector2[],
  currentIdx: number,
  previousSeam: THREE.Vector2 | null | undefined,
  tolerance: number,
): number {
  if (!previousSeam || tolerance <= 0) return currentIdx;
  let bestIdx = currentIdx;
  let bestDistance = Infinity;
  for (let i = 0; i < contour.length; i++) {
    const distance = contour[i].distanceTo(previousSeam);
    if (distance > tolerance) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function userSpecifiedIndex(contour: THREE.Vector2[], pp: PrintProfile): number {
  const tx = pp.zSeamX ?? 0;
  const ty = pp.zSeamY ?? 0;
  let origin = new THREE.Vector2(0, 0);
  if (pp.zSeamRelative) origin = contourCentroid(contour);
  const target = new THREE.Vector2(origin.x + tx, origin.y + ty);
  const radius = pp.zSeamUserSpecifiedRadius ?? 0;
  if (radius <= 0) return closestPointIndex(contour, target);

  let bestIdx = -1;
  let bestScore = Infinity;
  for (let i = 0; i < contour.length; i++) {
    const distance = contour[i].distanceTo(target);
    if (distance > radius) continue;
    const sharpness = cornerSharpness(contour, i);
    const score = sharpness + distance / Math.max(radius, 1e-6) * 0.25;
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx >= 0 ? bestIdx : closestPointIndex(contour, target);
}

function paintedSeamIndex(contour: THREE.Vector2[], pp: PrintProfile, layerZ?: number): number | null {
  const hints = pp.zSeamPaintHints?.filter((hint) => Number.isFinite(hint.x) && Number.isFinite(hint.y)) ?? [];
  if (hints.length === 0) return null;

  let bestHint: THREE.Vector2 | null = null;
  let bestScore = Infinity;
  for (const hint of hints) {
    const target = new THREE.Vector2(hint.x, hint.y);
    const nearestIdx = closestPointIndex(contour, target);
    const xyDistance = contour[nearestIdx].distanceTo(target);
    const radius = hint.radius ?? pp.zSeamUserSpecifiedRadius ?? 0;
    if (radius > 0 && xyDistance > radius) continue;
    const zPenalty = layerZ !== undefined && hint.z !== undefined
      ? Math.abs(hint.z - layerZ) * (hint.weight ?? 0.15)
      : 0;
    const score = xyDistance + zPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestHint = target;
    }
  }
  return bestHint ? closestPointIndex(contour, bestHint) : null;
}

export function findSeamPosition(
  contour: THREE.Vector2[],
  pp: PrintProfile,
  _layerIndex: number,
  nozzleX?: number,
  nozzleY?: number,
  options: SeamPlacementOptions = {},
): number {
  if (contour.length === 0) return 0;

  const mode: string = pp.zSeamPosition ?? pp.zSeamAlignment ?? 'shortest';
  let seamIdx = 0;

  switch (mode) {
    case 'random':
      seamIdx = Math.floor(Math.random() * contour.length);
      break;

    case 'aligned':
    case 'back':
      seamIdx = closestPointIndex(contour, new THREE.Vector2(0, 1e6));
      break;

    case 'user_specified': {
      seamIdx = userSpecifiedIndex(contour, pp);
      break;
    }

    case 'painted': {
      seamIdx = paintedSeamIndex(contour, pp, options.layerZ) ?? userSpecifiedIndex(contour, pp);
      break;
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
      if (pref === 'hide_seam' && sharpestConcaveIdx >= 0) seamIdx = sharpestConcaveIdx;
      else if (pref === 'expose_seam' && sharpestConvexIdx >= 0) seamIdx = sharpestConvexIdx;
      else if (pref === 'smart_hide' && sharpestConcaveIdx >= 0) seamIdx = sharpestConcaveIdx;
      else seamIdx = sharpestIdx;
      break;
    }

    case 'shortest':
    default:
      if (nozzleX !== undefined && nozzleY !== undefined) {
        seamIdx = closestPointIndex(contour, new THREE.Vector2(nozzleX, nozzleY));
      } else {
        seamIdx = 0;
      }
      break;
  }

  if (mode !== 'random') {
    seamIdx = continuityIndex(
      contour,
      seamIdx,
      options.previousSeam,
      options.continuityTolerance ?? pp.zSeamContinuityDistance ?? 2,
    );
  }
  return closestSupportedIndex(contour, seamIdx, options.isSupported);
}
