import * as THREE from 'three';
import type { SketchProfile } from '../../../../engine/occ/ops/sketchToWire';
import { OCC_PROFILE_POINT_COUNT } from '../../../../utils/occConstants';
import type { BodyBooleanOp } from '../featureManagement/bodyBoolean';

/**
 * Map a panel operation (which may include 'new-component') + body kind to a
 * BodyBooleanOp for placeToolFeature. Surface bodies and new-component never
 * solid-boolean here because they stay standalone.
 */
export function toolBooleanOp(
  operation: string | undefined,
  isSurface: boolean,
  hasMesh: boolean,
): BodyBooleanOp {
  if (isSurface || !hasMesh) return 'new-body';
  return operation === 'join' || operation === 'cut' || operation === 'intersect'
    ? operation
    : 'new-body';
}

export function shapeToOccSketchProfile(shape: THREE.Shape): SketchProfile | null {
  const outer = shape.getPoints(OCC_PROFILE_POINT_COUNT);
  if (outer.length < 3) return null;
  return {
    outer,
    holes: shape.holes
      .map((hole) => hole.getPoints(OCC_PROFILE_POINT_COUNT))
      .filter((points) => points.length >= 3),
  };
}
