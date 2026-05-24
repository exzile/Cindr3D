import type { BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { performOccBooleanWithInstance, type OccBooleanOptions } from './booleanCore';

export async function occSubtract(
  target: BRepBody,
  tool: BRepBody,
  options: OccBooleanOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occSubtractWithInstance(oc, target, tool, options);
}

export function occSubtractWithInstance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  target: BRepBody,
  tool: BRepBody,
  options: OccBooleanOptions = {},
): BRepBody | null {
  return performOccBooleanWithInstance(oc, 'subtract', target, tool, options);
}
