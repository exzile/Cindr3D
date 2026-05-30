import * as THREE from 'three';
import type { SketchProfile } from '../../../../engine/occ/ops/sketchToWire';
import type { createOccPlaneFrame } from '../../../../engine/occ/plane';
import { worldPointToPlane } from '../../../../engine/occ/plane';
import { OCC_PROFILE_POINT_COUNT } from '../../../../utils/occConstants';

export function resolveRevolveAxisVec(
  axisKey: string,
  axisDirection: [number, number, number] | undefined,
): THREE.Vector3 {
  if (axisDirection) {
    return new THREE.Vector3(axisDirection[0], axisDirection[1], axisDirection[2]);
  }
  if (axisKey === 'X') return new THREE.Vector3(1, 0, 0);
  if (axisKey === 'Z') return new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3(0, 1, 0);
}

export function resolveRevolveAngles(
  direction: string,
  angle: number,
  angle2: number,
): {
  primaryAngleDeg: number;
  primaryAngleRad: number;
  side2AngleRad: number | undefined;
} {
  const primaryAngleDeg = direction === 'symmetric' ? angle / 2 : angle;
  if (direction === 'symmetric') {
    const primaryAngleRad = THREE.MathUtils.degToRad(primaryAngleDeg);
    return { primaryAngleDeg, primaryAngleRad, side2AngleRad: primaryAngleRad };
  }
  if (direction === 'two-sides') {
    return {
      primaryAngleDeg,
      primaryAngleRad: THREE.MathUtils.degToRad(angle),
      side2AngleRad: THREE.MathUtils.degToRad(angle2),
    };
  }
  return {
    primaryAngleDeg,
    primaryAngleRad: THREE.MathUtils.degToRad(angle),
    side2AngleRad: undefined,
  };
}

export function makeRevolveSketchProfileFromShape(shape: THREE.Shape): SketchProfile {
  return {
    outer: shape.getPoints(OCC_PROFILE_POINT_COUNT),
    holes: shape.holes
      .map((hole) => hole.getPoints(OCC_PROFILE_POINT_COUNT))
      .filter((points) => points.length >= 3),
  };
}

export function makeFaceBoundarySketchProfile(
  points: readonly THREE.Vector3[],
  frame: ReturnType<typeof createOccPlaneFrame>,
): SketchProfile {
  return {
    outer: points.map((point) => worldPointToPlane(frame, point)),
    holes: [],
  };
}

export function revolveAxisOriginVector(
  axisOrigin: [number, number, number] | undefined,
): THREE.Vector3 {
  const origin = axisOrigin ?? ([0, 0, 0] as [number, number, number]);
  return new THREE.Vector3(origin[0], origin[1], origin[2]);
}
