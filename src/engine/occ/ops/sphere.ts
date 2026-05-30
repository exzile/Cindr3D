/**
 * OCC-10.15 — Sphere primitive.
 * Uses BRepPrimAPI_MakeSphere.
 */
import type * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { transformOccShape } from '../transform';

type OccSphereApi = OcctRaw & {
  BRepPrimAPI_MakeSphere_2: new (radius: number) => { Shape(): unknown; delete(): void };
};

export interface OccSphereOptions {
  transform?: THREE.Matrix4;
  id?: string;
  sourceFeatureId?: string;
}

export async function occSphere(
  radius: number,
  options: OccSphereOptions = {},
): Promise<BRepBody> {
  const { oc } = await getOcc();
  return occSphereWithInstance(oc, radius, options);
}

export function occSphereWithInstance(
  oc: OcctRaw,
  radius: number,
  options: OccSphereOptions = {},
): BRepBody {
  if (radius <= 0) throw new RangeError('OCC sphere radius must be greater than zero');
  const occ = oc as OccSphereApi;

  const maker = new occ.BRepPrimAPI_MakeSphere_2(radius);
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
