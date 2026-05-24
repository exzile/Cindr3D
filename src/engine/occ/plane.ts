import * as THREE from 'three';
import type { Sketch } from '../../types/cad';

export interface OccPlaneFrame {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  uDir: THREE.Vector3;
  vDir: THREE.Vector3;
}

const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Y = new THREE.Vector3(0, 1, 0);
const WORLD_Z = new THREE.Vector3(0, 0, 1);

export function createOccPlaneFrame(origin: THREE.Vector3, normal: THREE.Vector3, uHint?: THREE.Vector3): OccPlaneFrame {
  const safeNormal = normal.lengthSq() > 0 ? normal.clone().normalize() : WORLD_Y.clone();
  const rawU = uHint && uHint.lengthSq() > 0
    ? uHint.clone()
    : Math.abs(safeNormal.dot(WORLD_X)) < 0.9
      ? WORLD_X.clone()
      : WORLD_Z.clone();
  const uDir = rawU.addScaledVector(safeNormal, -rawU.dot(safeNormal)).normalize();
  const vDir = new THREE.Vector3().crossVectors(safeNormal, uDir).normalize();

  return {
    origin: origin.clone(),
    normal: safeNormal,
    uDir,
    vDir,
  };
}

export function createOccPlaneFrameFromSketch(sketch: Sketch): OccPlaneFrame {
  if (sketch.plane === 'XY') return createOccPlaneFrame(sketch.planeOrigin, sketch.planeNormal, WORLD_X);
  if (sketch.plane === 'XZ') return createOccPlaneFrame(sketch.planeOrigin, sketch.planeNormal, WORLD_X);
  if (sketch.plane === 'YZ') return createOccPlaneFrame(sketch.planeOrigin, sketch.planeNormal, WORLD_Y);
  return createOccPlaneFrame(sketch.planeOrigin, sketch.planeNormal);
}

export function planePointToWorld(frame: OccPlaneFrame, point: THREE.Vector2): THREE.Vector3 {
  return frame.origin
    .clone()
    .addScaledVector(frame.uDir, point.x)
    .addScaledVector(frame.vDir, point.y);
}

export function worldPointToPlane(frame: OccPlaneFrame, point: THREE.Vector3): THREE.Vector2 {
  const delta = point.clone().sub(frame.origin);
  return new THREE.Vector2(delta.dot(frame.uDir), delta.dot(frame.vDir));
}
