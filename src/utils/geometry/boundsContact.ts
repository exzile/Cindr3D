import * as THREE from 'three';

type Axis = 'x' | 'y' | 'z';

const AXES: Axis[] = ['x', 'y', 'z'];

function intervalOverlap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

function intervalTouches(aMin: number, aMax: number, bMin: number, bMax: number, epsilon: number): boolean {
  return Math.abs(aMax - bMin) <= epsilon || Math.abs(bMax - aMin) <= epsilon;
}

export function boxesHaveJoinableContact(a: THREE.Box3, b: THREE.Box3, epsilon = 1e-5): boolean {
  let touchingAxes = 0;

  for (const axis of AXES) {
    const overlap = intervalOverlap(a.min[axis], a.max[axis], b.min[axis], b.max[axis]);
    if (overlap > epsilon) continue;
    if (intervalTouches(a.min[axis], a.max[axis], b.min[axis], b.max[axis], epsilon)) {
      touchingAxes += 1;
      continue;
    }
    return false;
  }

  return touchingAxes <= 1;
}

export function boxesShareFaceContact(a: THREE.Box3, b: THREE.Box3, epsilon = 1e-5): boolean {
  let touchingAxes = 0;

  for (const axis of AXES) {
    const overlap = intervalOverlap(a.min[axis], a.max[axis], b.min[axis], b.max[axis]);
    if (overlap > epsilon) continue;
    if (intervalTouches(a.min[axis], a.max[axis], b.min[axis], b.max[axis], epsilon)) {
      touchingAxes += 1;
      continue;
    }
    return false;
  }

  return touchingAxes === 1;
}
