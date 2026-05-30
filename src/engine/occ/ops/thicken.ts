/**
 * OCC-10.14 — Thicken a surface body (face/shell) into a solid.
 * Extrudes the body's faces along their normals by `thickness`.
 * For symmetric mode, extrudes thickness/2 in both directions.
 * Equivalent to BRepPrimAPI_MakePrism on the surface faces.
 */
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';

type OccThickenApi = OcctRaw & {
  BRepPrimAPI_MakePrism_1: new (shape: unknown, vec: unknown, copy: boolean, canonize: boolean) => {
    Build(): void;
    Shape(): unknown;
    delete(): void;
  };
  BRepAlgoAPI_Fuse_3: new (a: unknown, b: unknown) => {
    SetNonDestructive?(v: boolean): void;
    Build(progress?: unknown): void;
    IsDone?(): boolean;
    HasErrors?(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  BRepBuilderAPI_Transform_2: new (shape: unknown, trsf: unknown, copy: boolean) => {
    Shape(): unknown;
    delete(): void;
  };
  gp_Trsf_1: new () => { SetTranslation_1(vec: unknown): void; delete(): void };
  gp_Vec_4: new (x: number, y: number, z: number) => { delete(): void };
  Message_ProgressRange_1: new () => { delete?: () => void };
  BRepAdaptor_Surface_2: new (face: unknown, restricted: boolean) => {
    FirstUParameter(): number;
    LastUParameter(): number;
    FirstVParameter(): number;
    LastVParameter(): number;
    Value(u: number, v: number): { X(): number; Y(): number; Z(): number; delete(): void };
    delete(): void;
  };
  TopExp_Explorer_2: new (shape: unknown, toFind: unknown, toAvoid: unknown) => {
    More(): boolean;
    Current(): { delete(): void };
    Next(): void;
    delete(): void;
  };
};

export interface OccThickenOptions {
  id?: string;
  sourceFeatureId?: string;
  symmetric?: boolean;
}

export async function occThicken(
  body: BRepBody,
  thickness: number,
  options: OccThickenOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occThickenWithInstance(oc, body, thickness, options);
}

export function occThickenWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  thickness: number,
  options: OccThickenOptions = {},
): BRepBody | null {
  if (thickness <= 0) return null;
  const occ = oc as OccThickenApi;

  // Compute average normal across all faces
  const [nx, ny, nz] = computeBodyNormal(occ, body);

  const sourceShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  let startShape = sourceShape;

  if (options.symmetric) {
    // Shift surface back by thickness/2 before extruding
    const backVec = new occ.gp_Vec_4(-nx * thickness / 2, -ny * thickness / 2, -nz * thickness / 2);
    const trsf = new occ.gp_Trsf_1();
    let mover: InstanceType<OccThickenApi['BRepBuilderAPI_Transform_2']> | null = null;
    try {
      trsf.SetTranslation_1(backVec);
      mover = new occ.BRepBuilderAPI_Transform_2(startShape, trsf, true);
      startShape = mover.Shape();
    } finally {
      mover?.delete();
      backVec.delete();
      trsf.delete();
    }
  }

  const extVec = new occ.gp_Vec_4(nx * thickness, ny * thickness, nz * thickness);
  const prism = new occ.BRepPrimAPI_MakePrism_1(startShape, extVec, false, true);
  try {
    prism.Build();
    const resultShape = prism.Shape();
    return makeBRepBodyFromOccShape(oc, resultShape, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
    });
  } catch (e) {
    console.warn('[occThicken] BRepPrimAPI_MakePrism threw:', e);
    return null;
  } finally {
    prism.delete();
    extVec.delete();
    if (startShape !== sourceShape) (startShape as { delete?: () => void }).delete?.();
    sourceShape.delete?.();
  }
}

function computeBodyNormal(occ: OccThickenApi, body: BRepBody): [number, number, number] {
  // Average normals across all faces to get the dominant surface direction
  let sumX = 0, sumY = 0, sumZ = 0, count = 0;
  for (const handle of body.faceIds.values()) {
    let rawFace: { delete?: () => void } | null = null;
    let surf: InstanceType<OccThickenApi['BRepAdaptor_Surface_2']> | null = null;
    let p0: { X(): number; Y(): number; Z(): number; delete?: () => void } | null = null;
    let p1: { X(): number; Y(): number; Z(): number; delete?: () => void } | null = null;
    let p2: { X(): number; Y(): number; Z(): number; delete?: () => void } | null = null;
    try {
      rawFace = occDeref(occ as unknown as OcctRaw, handle, (occ as unknown as OcctRaw).TopoDS_Face);
      surf = new occ.BRepAdaptor_Surface_2(rawFace, true);
      const u0 = surf.FirstUParameter(), u1 = surf.LastUParameter();
      const v0 = surf.FirstVParameter(), v1 = surf.LastVParameter();
      const uC = (u0 + u1) / 2, vC = (v0 + v1) / 2;
      const du = (u1 - u0) * 0.01 || 1e-4;
      const dv = (v1 - v0) * 0.01 || 1e-4;
      p0 = surf.Value(uC, vC);
      p1 = surf.Value(uC + du, vC);
      p2 = surf.Value(uC, vC + dv);
      if (!p0 || !p1 || !p2) throw new Error('surf.Value returned null');
      const ax = p1.X() - p0.X(), ay = p1.Y() - p0.Y(), az = p1.Z() - p0.Z();
      const bx = p2.X() - p0.X(), by = p2.Y() - p0.Y(), bz = p2.Z() - p0.Z();
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 1e-10) { sumX += nx / len; sumY += ny / len; sumZ += nz / len; count++; }
    } catch { /* skip */ }
    finally {
      p0?.delete?.();
      p1?.delete?.();
      p2?.delete?.();
      surf?.delete();
      rawFace?.delete?.();
    }
  }
  if (count === 0) return [0, 0, 1];
  const len = Math.sqrt(sumX * sumX + sumY * sumY + sumZ * sumZ);
  return len > 1e-10 ? [sumX / len, sumY / len, sumZ / len] : [0, 0, 1];
}
