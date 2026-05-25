import type * as THREE from 'three';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { transformOccShape } from '../transform';

export interface OccCylinderOptions {
  transform?: THREE.Matrix4;
  id?: string;
  sourceFeatureId?: string;
}

export interface OccCylinderShape {
  shape: unknown;
  ownedResources: Array<{ delete?: () => void }>;
  dispose(): void;
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
  const cylinder = occCylinderShapeWithInstance(oc, radius, height, options);
  let consumed = false;
  try {
    const body = makeBRepBodyFromOccShape(oc, cylinder.shape, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
      ownedResources: cylinder.ownedResources,
    });
    consumed = true;
    return body;
  } finally {
    if (!consumed) cylinder.dispose();
  }
}

export function occCylinderShapeWithInstance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  radius: number,
  height: number,
  options: OccCylinderOptions = {},
): OccCylinderShape {
  validateCylinderDimensions(radius, height);

  const cylinderMaker = new oc.BRepPrimAPI_MakeCylinder_1(radius, height);
  let shape = cylinderMaker.Shape();
  const ownedResources: Array<{ delete?: () => void }> = [cylinderMaker];

  if (options.transform) {
    shape = transformOccShape(oc, shape, options.transform);
  }

  return {
    shape,
    ownedResources,
    dispose() {
      (shape as { delete?: () => void }).delete?.();
      for (const resource of ownedResources) {
        try { resource.delete?.(); } catch { /* already freed */ }
      }
    },
  };
}

function validateCylinderDimensions(radius: number, height: number): void {
  if (radius <= 0 || height <= 0) {
    throw new RangeError('OCC cylinder radius and height must be greater than zero');
  }
}
