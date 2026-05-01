import * as THREE from 'three';
import type { Sketch, SketchPlane } from '../../types/cad';

export function getPlaneAxes(plane: SketchPlane): { t1: THREE.Vector3; t2: THREE.Vector3 } {
  switch (plane) {
    case 'XY': return { t1: new THREE.Vector3(1, 0, 0), t2: new THREE.Vector3(0, 0, -1) };
    case 'YZ': return { t1: new THREE.Vector3(0, 1, 0), t2: new THREE.Vector3(0, 0, 1) };
    case 'XZ':
    default: return { t1: new THREE.Vector3(1, 0, 0), t2: new THREE.Vector3(0, 1, 0) };
  }
}

export function computePlaneAxesFromNormal(normal: THREE.Vector3): { t1: THREE.Vector3; t2: THREE.Vector3 } {
  const n = normal.clone().normalize();
  const ax = Math.abs(n.x); const ay = Math.abs(n.y); const az = Math.abs(n.z);
  const tempUp = ay <= ax && ay <= az
    ? new THREE.Vector3(0, 1, 0)
    : (ax <= az ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1));
  const t1 = new THREE.Vector3().crossVectors(tempUp, n).normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  return { t1, t2 };
}

export function getSketchAxes(sketch: Sketch): { t1: THREE.Vector3; t2: THREE.Vector3 } {
  if (sketch.plane === 'custom') {
    return computePlaneAxesFromNormal(sketch.planeNormal);
  }
  return getPlaneAxes(sketch.plane);
}

export function getPlaneRotation(plane: 'XY' | 'XZ' | 'YZ'): [number, number, number] {
  switch (plane) {
    case 'XY': return [-Math.PI / 2, 0, 0];
    case 'YZ': return [0, Math.PI / 2, 0];
    case 'XZ':
    default: return [0, 0, 0];
  }
}

export function getSketchExtrudeNormal(sketch: Sketch): THREE.Vector3 {
  return sketch.planeNormal.clone().normalize();
}
