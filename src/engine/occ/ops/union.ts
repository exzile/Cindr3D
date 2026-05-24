import type { BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { performOccBooleanWithInstance, type OccBooleanOptions } from './booleanCore';

export async function occUnion(
  a: BRepBody,
  b: BRepBody,
  options: OccBooleanOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occUnionWithInstance(oc, a, b, options);
}

export function occUnionWithInstance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  a: BRepBody,
  b: BRepBody,
  options: OccBooleanOptions = {},
): BRepBody | null {
  return performOccBooleanWithInstance(oc, 'union', a, b, options);
}
