/**
 * OCC-10.16 — Scale body (uniform or non-uniform).
 * Uniform: gp_Trsf.SetScale + BRepBuilderAPI_Transform (exact, preserves BRep).
 * Non-uniform: gp_GTrsf + BRepBuilderAPI_GTransform (approximates curved surfaces).
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';

type OccScaleApi = OcctRaw & {
  BRepBuilderAPI_Transform_2: new (shape: unknown, trsf: unknown, copy: boolean) => { Shape(): unknown; delete(): void };
  BRepBuilderAPI_GTransform_2: new (shape: unknown, gTrsf: unknown, copy: boolean) => { Shape(): unknown; IsDone(): boolean; delete(): void };
  gp_Trsf_1: new () => { SetScale(point: unknown, factor: number): void; delete(): void };
  gp_GTrsf_1: new () => { SetVectorialPart(mat: unknown): void; delete(): void };
  gp_Mat_1: new () => { SetDiag(x: number, y: number, z: number): void; delete(): void };
  gp_Pnt_3: new (x: number, y: number, z: number) => { delete(): void };
};

export type OccScaleFactor =
  | number
  | { x: number; y: number; z: number };

export interface OccScaleOptions {
  id?: string;
  sourceFeatureId?: string;
}

export async function occScale(
  body: BRepBody,
  origin: THREE.Vector3,
  scale: OccScaleFactor,
  options: OccScaleOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occScaleWithInstance(oc, body, origin, scale, options);
}

export function occScaleWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  origin: THREE.Vector3,
  scale: OccScaleFactor,
  options: OccScaleOptions = {},
): BRepBody | null {
  const occ = oc as OccScaleApi;
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);

  try {
    if (typeof scale === 'number') {
      return uniformScale(occ, rawShape, origin, scale, options);
    }
    return nonUniformScale(occ, rawShape, scale, options);
  } catch (e) {
    console.warn('[occScale] failed:', e);
    return null;
  }
  // NOTE: rawShape is an occDeref wrapPointer VIEW — do NOT delete.
}

function uniformScale(
  occ: OccScaleApi,
  rawShape: unknown,
  origin: THREE.Vector3,
  factor: number,
  options: OccScaleOptions,
): BRepBody | null {
  const occOrigin = new occ.gp_Pnt_3(origin.x, origin.y, origin.z);
  const trsf = new occ.gp_Trsf_1();
  let transformer: InstanceType<OccScaleApi['BRepBuilderAPI_Transform_2']> | null = null;
  try {
    trsf.SetScale(occOrigin, factor);
    transformer = new occ.BRepBuilderAPI_Transform_2(rawShape, trsf, true);
    const resultShape = transformer.Shape();
    return makeBRepBodyFromOccShape(occ as unknown as OcctRaw, resultShape, options);
  } finally {
    transformer?.delete();
    trsf.delete();
    occOrigin.delete();
  }
}

function nonUniformScale(
  occ: OccScaleApi,
  rawShape: unknown,
  scale: { x: number; y: number; z: number },
  options: OccScaleOptions,
): BRepBody | null {
  const mat = new occ.gp_Mat_1();
  const gTrsf = new occ.gp_GTrsf_1();
  let transformer: InstanceType<OccScaleApi['BRepBuilderAPI_GTransform_2']> | null = null;
  try {
    mat.SetDiag(scale.x, scale.y, scale.z);
    gTrsf.SetVectorialPart(mat);
    transformer = new occ.BRepBuilderAPI_GTransform_2(rawShape, gTrsf, true);
    if (!transformer.IsDone()) {
      return null;
    }
    const resultShape = transformer.Shape();
    return makeBRepBodyFromOccShape(occ as unknown as OcctRaw, resultShape, options);
  } finally {
    transformer?.delete();
    gTrsf.delete();
    mat.delete();
  }
}
