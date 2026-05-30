import type { BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { performOccBooleanWithInstance, type OccBooleanOptions } from './booleanCore';

export async function occIntersect(
  a: BRepBody,
  b: BRepBody,
  options: OccBooleanOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occIntersectWithInstance(oc, a, b, options);
}

export function occIntersectWithInstance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  a: BRepBody,
  b: BRepBody,
  options: OccBooleanOptions = {},
): BRepBody | null {
  return performOccBooleanWithInstance(oc, 'intersect', a, b, options);
}
