import type * as THREE from 'three';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { transformOccShape } from '../transform';

export interface OccBoxOptions {
  transform?: THREE.Matrix4;
  id?: string;
  sourceFeatureId?: string;
}

export async function occBox(
  width: number,
  height: number,
  depth: number,
  options: OccBoxOptions = {},
): Promise<BRepBody> {
  const { oc } = await getOcc();
  return occBoxWithInstance(oc, width, height, depth, options);
}

export function occBoxWithInstance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  width: number,
  height: number,
  depth: number,
  options: OccBoxOptions = {},
): BRepBody {
  validateBoxDimensions(width, height, depth);

  const boxMaker = new oc.BRepPrimAPI_MakeBox_2(width, height, depth);
  let shape = boxMaker.Shape();
  boxMaker.delete();

  if (options.transform) {
    shape = transformOccShape(oc, shape, options.transform);
  }

  return makeBRepBodyFromOccShape(oc, shape, {
    id: options.id,
    sourceFeatureId: options.sourceFeatureId,
  });
}

function validateBoxDimensions(width: number, height: number, depth: number): void {
  if (width <= 0 || height <= 0 || depth <= 0) {
    throw new RangeError('OCC box dimensions must be greater than zero');
  }
}
