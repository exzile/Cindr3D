/**
 * OCC-3.3 — Sketch-based extrude.
 * Converts a SketchProfile (UV polygon) + plane frame into a solid via
 * BRepPrimAPI_MakePrism_1.
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import type { OccPlaneFrame } from '../plane';
import { type SketchProfile, sketchProfileToWires, wireToFace } from './sketchToWire';

type OccExtrudeApi = OcctRaw & {
  BRepBuilderAPI_Transform_2: new (shape: unknown, trsf: unknown, copy: boolean) => { Shape(): unknown; delete(): void };
  BRepPrimAPI_MakePrism_1: new (shape: unknown, vector: unknown, copy: boolean, canonize: boolean) => { Build(progress: unknown): void; Shape(): unknown; delete(): void };
  BRepAlgoAPI_Fuse_3: new (a: unknown, b: unknown) => { SetNonDestructive?(v: boolean): void; Build(p?: unknown): void; IsDone?(): boolean; HasErrors?(): boolean; Shape(): unknown; delete(): void };
  BRepOffsetAPI_DraftAngle_1: new (shape: unknown) => { Add(face: unknown, dir: unknown, angle: number, plane: unknown): void; Build(progress: unknown): void; IsDone?(): boolean; HasErrors?(): boolean; Shape(): unknown; delete(): void };
  BRepAdaptor_Surface_2: new (face: unknown, restricted: boolean) => { FirstUParameter(): number; LastUParameter(): number; FirstVParameter(): number; LastVParameter(): number; Value(u: number, v: number): { X(): number; Y(): number; Z(): number; delete(): void }; delete(): void };
  Message_ProgressRange_1: new () => { delete?: () => void };
  gp_Dir_4: new (x: number, y: number, z: number) => { delete(): void };
  gp_Pnt_3: new (x: number, y: number, z: number) => { delete(): void };
  gp_Pln_3: new (origin: unknown, normal: unknown) => { delete(): void };
  gp_Trsf_1: new () => { SetTranslation_1(vector: unknown): void; delete(): void };
  gp_Vec_4: new (x: number, y: number, z: number) => { delete(): void };
  TopExp_Explorer_2: new (shape: unknown, toFind: unknown, avoid: unknown) => { More(): boolean; Current(): { delete(): void }; Next(): void; delete(): void };
  TopoDS: { Face_1(shape: unknown): unknown };
  TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown };
};

export interface OccExtrudeOptions {
  id?: string;
  sourceFeatureId?: string;
  symmetric?: boolean;
  /** When set, also extrude in the opposite direction by this distance and union. */
  twoSideDist?: number;
  /** Draft/taper angle in degrees. Positive = outward, negative = inward. */
  taperAngle?: number;
}

export async function occExtrude(
  profile: SketchProfile,
  distance: number,
  frame: OccPlaneFrame,
  options: OccExtrudeOptions = {},
): Promise<BRepBody> {
  const { oc } = await getOcc();
  return occExtrudeWithInstance(oc, profile, distance, frame, options);
}

export function occExtrudeWithInstance(
  oc: OcctRaw,
  profile: SketchProfile,
  distance: number,
  frame: OccPlaneFrame,
  options: OccExtrudeOptions = {},
): BRepBody {
  const occ = oc as OccExtrudeApi;
  const wires = sketchProfileToWires(oc, profile, frame);
  if (!wires) throw new Error('[occExtrude] failed to build wires from profile');

  const face = wireToFace(oc, wires.outerWire, wires.holeWires);
  wires.outerWire.delete();
  for (const hw of wires.holeWires) hw.delete();

  if (!face) throw new Error('[occExtrude] failed to build face from wires');

  const dir = frame.normal.clone();
  let startFace = face;

  if (options.symmetric) {
    // Offset face by -distance/2 in normal direction first
    const halfBack = dir.clone().multiplyScalar(-distance / 2);
    const trsf = new occ.gp_Trsf_1();
    const offset = new occ.gp_Vec_4(halfBack.x, halfBack.y, halfBack.z);
    trsf.SetTranslation_1(offset);
    const mover = new occ.BRepBuilderAPI_Transform_2(face, trsf, true);
    startFace = mover.Shape();
    mover.delete();
    offset.delete();
    trsf.delete();
    face.delete();
  }

  const extDir = new oc.gp_Vec_4(
    dir.x * distance,
    dir.y * distance,
    dir.z * distance,
  );

  const prism = new occ.BRepPrimAPI_MakePrism_1(startFace, extDir, false, true);
  const progress = new occ.Message_ProgressRange_1();
  let resultShape: unknown;
  try {
    prism.Build(progress);
    resultShape = prism.Shape();
  } finally {
    progress.delete?.();
    prism.delete();
    extDir.delete();
  }

  // Two-sided: extrude in the negative direction by twoSideDist and fuse
  if (options.twoSideDist !== undefined && options.twoSideDist > 0 && !options.symmetric) {
    const negDir = new occ.gp_Vec_4(-dir.x * options.twoSideDist, -dir.y * options.twoSideDist, -dir.z * options.twoSideDist);
    const prism2 = new occ.BRepPrimAPI_MakePrism_1(startFace, negDir, false, true);
    const progress2 = new occ.Message_ProgressRange_1();
    let side2Shape: unknown;
    try {
      prism2.Build(progress2);
      side2Shape = prism2.Shape();
    } finally {
      progress2.delete?.();
      prism2.delete();
      negDir.delete();
    }
    const fuse = new occ.BRepAlgoAPI_Fuse_3(resultShape, side2Shape);
    fuse.SetNonDestructive?.(true);
    fuse.Build();
    if (fuse.IsDone?.() !== false && !fuse.HasErrors?.()) {
      resultShape = fuse.Shape();
    }
    fuse.delete();
  }

  if (options.taperAngle !== undefined && Math.abs(options.taperAngle) > 0.001) {
    const taperRad = THREE.MathUtils.degToRad(options.taperAngle);
    const drafter = new occ.BRepOffsetAPI_DraftAngle_1(resultShape);
    const pullDir = new occ.gp_Dir_4(dir.x, dir.y, dir.z);
    const planePnt = new occ.gp_Pnt_3(frame.origin.x, frame.origin.y, frame.origin.z);
    const planeNrm = new occ.gp_Dir_4(dir.x, dir.y, dir.z);
    const neutralPlane = new occ.gp_Pln_3(planePnt, planeNrm);

    const allFaces: unknown[] = [];
    const lateralIndices: number[] = [];
    const explorer = new occ.TopExp_Explorer_2(
      resultShape,
      occ.TopAbs_ShapeEnum.TopAbs_FACE,
      occ.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (explorer.More()) {
      const s = explorer.Current();
      const rawFace = occ.TopoDS.Face_1(s);
      s.delete();
      let dotAbs = 1;
      try {
        const surf = new occ.BRepAdaptor_Surface_2(rawFace, true);
        const u0 = surf.FirstUParameter(), u1 = surf.LastUParameter();
        const v0 = surf.FirstVParameter(), v1 = surf.LastVParameter();
        const uC = (u0 + u1) / 2, vC = (v0 + v1) / 2;
        const du = (u1 - u0) * 0.01 || 1e-4;
        const dv = (v1 - v0) * 0.01 || 1e-4;
        const p0 = surf.Value(uC, vC);
        const p1 = surf.Value(uC + du, vC);
        const p2 = surf.Value(uC, vC + dv);
        const ax = p1.X() - p0.X(), ay = p1.Y() - p0.Y(), az = p1.Z() - p0.Z();
        const bx = p2.X() - p0.X(), by = p2.Y() - p0.Y(), bz = p2.Z() - p0.Z();
        const fnx = ay * bz - az * by, fny = az * bx - ax * bz, fnz = ax * by - ay * bx;
        const len = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz);
        p0.delete(); p1.delete(); p2.delete(); surf.delete();
        if (len > 1e-10) dotAbs = Math.abs((fnx * dir.x + fny * dir.y + fnz * dir.z) / len);
      } catch { /* assume not lateral */ }
      if (dotAbs < 0.5) lateralIndices.push(allFaces.length);
      allFaces.push(rawFace);
      explorer.Next();
    }
    explorer.delete();

    let addedAny = false;
    for (const idx of lateralIndices) {
      try { drafter.Add(allFaces[idx], pullDir, taperRad, neutralPlane); addedAny = true; } catch { /* skip face */ }
    }

    if (addedAny) {
      const draftProg = new occ.Message_ProgressRange_1();
      try {
        drafter.Build(draftProg);
        if (drafter.IsDone?.() !== false && !drafter.HasErrors?.()) {
          resultShape = drafter.Shape();
        } else {
          console.warn('[occExtrude] DraftAngle Build failed — using untapered shape');
        }
      } catch (e) {
        console.warn('[occExtrude] DraftAngle threw:', e);
      } finally {
        draftProg.delete?.();
      }
    }

    drafter.delete();
    for (const f of allFaces) (f as { delete(): void }).delete();
    neutralPlane.delete();
    planeNrm.delete();
    planePnt.delete();
    pullDir.delete();
  }

  startFace.delete();

  return makeBRepBodyFromOccShape(oc, resultShape, {
    id: options.id,
    sourceFeatureId: options.sourceFeatureId,
  });
}

/** Convenience: extrude a simple rectangular profile (no holes). */
export function occExtrudeRect(
  oc: OcctRaw,
  width: number,
  height: number,
  distance: number,
  frame: OccPlaneFrame,
  options: OccExtrudeOptions = {},
): BRepBody {
  const hw = width / 2;
  const hh = height / 2;
  const profile: SketchProfile = {
    outer: [
      new THREE.Vector2(-hw, -hh),
      new THREE.Vector2( hw, -hh),
      new THREE.Vector2( hw,  hh),
      new THREE.Vector2(-hw,  hh),
    ],
    holes: [],
  };
  return occExtrudeWithInstance(oc, profile, distance, frame, options);
}
