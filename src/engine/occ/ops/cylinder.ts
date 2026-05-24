import type * as THREE from 'three';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { transformOccShape } from '../transform';

export interface OccCylinderOptions {
  transform?: THREE.Matrix4;
  id?: string;
  sourceFeatureId?: string;
}

export async function occCylinder(
  radius: number,
  height: number,
  options: OccCylinderOptions = {},
): Promise<BRepBody> {
  const { oc } = await getOcc();
  return occCylinderWithInstance(oc, radius, height, options);
}

export function occCylinderWithInstance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  radius: number,
  height: number,
  options: OccCylinderOptions = {},
): BRepBody {
  validateCylinderDimensions(radius, height);

  const cylinderMaker = new oc.BRepPrimAPI_MakeCylinder_1(radius, height);
  let shape = cylinderMaker.Shape();
  cylinderMaker.delete();

  if (options.transform) {
    shape = transformOccShape(oc, shape, options.transform);
  }

  return makeBRepBodyFromOccShape(oc, shape, {
    id: options.id,
    sourceFeatureId: options.sourceFeatureId,
  });
}

function validateCylinderDimensions(radius: number, height: number): void {
  if (radius <= 0 || height <= 0) {
    throw new RangeError('OCC cylinder radius and height must be greater than zero');
  }
}
