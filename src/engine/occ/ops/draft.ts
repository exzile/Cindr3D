/**
 * OCC-10.8 — Draft angle on solid faces.
 * Applies a taper angle to selected faces relative to a neutral plane and
 * pull direction via BRepOffsetAPI_DraftAngle.
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { runEdgeOpBuild } from './adjacency';

type OccDraftApi = OcctRaw & {
  // NOTE: the ctor is BRepOffsetAPI_DraftAngle_**2**(shape); _1() is the 0-arg
  // ctor. Add() takes 5 args (the trailing Flag is required in this build) and
  // the face MUST be a real TopoDS_Face (TopoDS.Face_1 cast — occDeref returns a
  // Shape). Build() takes 0 args here → go through runEdgeOpBuild for variance.
  BRepOffsetAPI_DraftAngle_2: new (shape: unknown) => {
    Add(face: unknown, dir: unknown, angle: number, plane: unknown, flag: boolean): void;
    Build(progress?: unknown): void;
    IsDone(): boolean;
    HasErrors?(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  TopoDS: { Face_1(s: unknown): unknown };
  gp_Dir_4: new (x: number, y: number, z: number) => { delete(): void };
  gp_Pnt_3: new (x: number, y: number, z: number) => { delete(): void };
  gp_Pln_3: new (origin: unknown, normal: unknown) => { delete(): void };
};

export interface OccDraftNeutralPlane {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface OccDraftOptions {
  id?: string;
  sourceFeatureId?: string;
}

export async function occDraft(
  body: BRepBody,
  faceIds: number[],
  pullDirection: THREE.Vector3,
  angleRad: number,
  neutralPlane: OccDraftNeutralPlane,
  options: OccDraftOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occDraftWithInstance(oc, body, faceIds, pullDirection, angleRad, neutralPlane, options);
}

export function occDraftWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  faceIds: number[],
  pullDirection: THREE.Vector3,
  angleRad: number,
  neutralPlane: OccDraftNeutralPlane,
  options: OccDraftOptions = {},
): BRepBody | null {
  if (faceIds.length === 0 || Math.abs(angleRad) < 1e-6) return null;

  const occ = oc as OccDraftApi;
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const drafter = new occ.BRepOffsetAPI_DraftAngle_2(rawShape);

  const pd = pullDirection.clone().normalize();
  const pn = neutralPlane.normal.clone().normalize();

  const occPullDir = new occ.gp_Dir_4(pd.x, pd.y, pd.z);
  const occPlaneOrigin = new occ.gp_Pnt_3(
    neutralPlane.origin.x, neutralPlane.origin.y, neutralPlane.origin.z,
  );
  const occPlaneNormal = new occ.gp_Dir_4(pn.x, pn.y, pn.z);
  const occPlane = new occ.gp_Pln_3(occPlaneOrigin, occPlaneNormal);

  let addedAny = false;
  for (const faceId of faceIds) {
    const handle = body.faceIds.get(faceId);
    if (!handle) continue;
    // occDeref returns a TopoDS_Shape; DraftAngle.Add needs a real TopoDS_Face.
    // Face_1 is a VIEW — do NOT delete. Add's 5th arg (Flag) is required here.
    const rawFace = occ.TopoDS.Face_1(occDeref(oc, handle, oc.TopoDS_Shape));
    try {
      drafter.Add(rawFace, occPullDir, angleRad, occPlane, true);
      addedAny = true;
    } catch (e) {
      console.warn(`[occDraft] could not add face ${faceId}:`, e);
    }
    // NOTE: rawFace is a TopoDS.Face_1 VIEW — do NOT delete.
  }

  if (!addedAny) {
    drafter.delete();
    occPlane.delete();
    occPlaneNormal.delete();
    occPlaneOrigin.delete();
    occPullDir.delete();
    // NOTE: rawShape is an occDeref wrapPointer VIEW — do NOT delete.
    return null;
  }

  try {
    // Build() takes 0 args in this WASM build — runEdgeOpBuild handles the
    // Build(progress)/Build() binding variance (same as fillet/chamfer/boolean).
    runEdgeOpBuild(oc, drafter);
    if (!drafter.IsDone() || drafter.HasErrors?.()) {
      console.warn('[occDraft] BRepOffsetAPI_DraftAngle failed');
      return null;
    }
    const resultShape = drafter.Shape();
    return makeBRepBodyFromOccShape(oc, resultShape, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
    });
  } catch (e) {
    console.warn('[occDraft] threw during Build/Shape:', e);
    return null;
  } finally {
    drafter.delete();
    occPlane.delete();
    occPlaneNormal.delete();
    occPlaneOrigin.delete();
    occPullDir.delete();
    // NOTE: rawShape is an occDeref wrapPointer VIEW — do NOT delete.
  }
}
