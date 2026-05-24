/**
 * OCC-10.2 — Mirror body across a plane.
 * Uses gp_Trsf.SetMirror_3(gp_Ax2) + BRepBuilderAPI_Transform.
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';

type OccMirrorApi = OcctRaw & {
  BRepBuilderAPI_Transform_2: new (shape: unknown, trsf: unknown, copy: boolean) => { Shape(): unknown; delete(): void };
  gp_Trsf_1: new () => { SetMirror_3(ax2: unknown): void; delete(): void };
  gp_Pnt_3: new (x: number, y: number, z: number) => { delete(): void };
  gp_Dir_4: new (x: number, y: number, z: number) => { delete(): void };
  gp_Ax2_2: new (origin: unknown, mainDir: unknown) => { delete(): void };
};

export interface OccMirrorPlane {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface OccMirrorOptions {
  id?: string;
  sourceFeatureId?: string;
}

export async function occMirror(
  body: BRepBody,
  plane: OccMirrorPlane,
  options: OccMirrorOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occMirrorWithInstance(oc, body, plane, options);
}

export function occMirrorWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  plane: OccMirrorPlane,
  options: OccMirrorOptions = {},
): BRepBody | null {
  const occ = oc as OccMirrorApi;
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const n = plane.normal.clone().normalize();

  const occOrigin = new occ.gp_Pnt_3(plane.origin.x, plane.origin.y, plane.origin.z);
  const occNormal = new occ.gp_Dir_4(n.x, n.y, n.z);
  const ax2 = new occ.gp_Ax2_2(occOrigin, occNormal);
  const trsf = new occ.gp_Trsf_1();

  try {
    trsf.SetMirror_3(ax2);
    const transformer = new occ.BRepBuilderAPI_Transform_2(rawShape, trsf, true);
    const resultShape = transformer.Shape();
    transformer.delete();
    return makeBRepBodyFromOccShape(oc, resultShape, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
    });
  } catch (e) {
    console.warn('[occMirror] transform failed:', e);
    return null;
  } finally {
    trsf.delete();
    ax2.delete();
    occNormal.delete();
    occOrigin.delete();
  }
}
