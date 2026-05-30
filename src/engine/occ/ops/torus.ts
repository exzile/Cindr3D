/**
 * OCC-10.15 — Torus primitive.
 * Uses BRepPrimAPI_MakeTorus.
 * majorRadius: distance from torus centre to tube centre.
 * minorRadius: tube radius. Constraint: majorRadius > minorRadius > 0.
 */
import type * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { transformOccShape } from '../transform';

type OccTorusApi = OcctRaw & {
  BRepPrimAPI_MakeTorus_2: new (majorRadius: number, minorRadius: number) => { Shape(): unknown; delete(): void };
};

export interface OccTorusOptions {
  transform?: THREE.Matrix4;
  id?: string;
  sourceFeatureId?: string;
}

export async function occTorus(
  majorRadius: number,
  minorRadius: number,
  options: OccTorusOptions = {},
): Promise<BRepBody> {
  const { oc } = await getOcc();
  return occTorusWithInstance(oc, majorRadius, minorRadius, options);
}

export function occTorusWithInstance(
  oc: OcctRaw,
  majorRadius: number,
  minorRadius: number,
  options: OccTorusOptions = {},
): BRepBody {
  if (minorRadius <= 0) throw new RangeError('OCC torus minorRadius must be > 0');
  if (majorRadius <= minorRadius) throw new RangeError('OCC torus majorRadius must be > minorRadius');
  const occ = oc as OccTorusApi;

  const maker = new occ.BRepPrimAPI_MakeTorus_2(majorRadius, minorRadius);
  let shape = maker.Shape();
  maker.delete();

  if (options.transform) {
    shape = transformOccShape(oc, shape, options.transform);
  }

  return makeBRepBodyFromOccShape(oc, shape, {
    id: options.id,
    sourceFeatureId: options.sourceFeatureId,
  });
}
