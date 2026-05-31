/**
 * OCC-22 — Transform a BRepBody by a THREE.Matrix4.
 * Used by Move/Copy (22.1) and Align (22.2).
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';

type OccTransformApi = OcctRaw & {
  BRepBuilderAPI_Transform_2: new (shape: unknown, trsf: unknown, copy: boolean) => { Shape(): unknown; delete(): void };
  gp_Trsf_1: new () => {
    SetValues(a11: number, a12: number, a13: number, a14: number,
              a21: number, a22: number, a23: number, a24: number,
              a31: number, a32: number, a33: number, a34: number): void;
    delete(): void;
  };
};

export interface OccTransformOptions { id?: string; sourceFeatureId?: string; }

export function occTransformBodyWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  mat: THREE.Matrix4,
  options: OccTransformOptions = {},
): BRepBody | null {
  const occ = oc as OccTransformApi;
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const e = mat.elements; // column-major
  const trsf = new occ.gp_Trsf_1();
  try {
    // THREE Matrix4 is column-major; gp_Trsf.SetValues takes row-major 3×4.
    trsf.SetValues(
      e[0], e[4], e[8],  e[12],
      e[1], e[5], e[9],  e[13],
      e[2], e[6], e[10], e[14],
    );
    const transformer = new occ.BRepBuilderAPI_Transform_2(rawShape, trsf, true);
    const resultShape = transformer.Shape();
    transformer.delete();
    return makeBRepBodyFromOccShape(oc, resultShape, options);
  } catch (err) {
    console.warn('[occTransformBody] failed:', err);
    return null;
  } finally {
    trsf.delete();
    // rawShape is a VIEW — do NOT delete.
  }
}
