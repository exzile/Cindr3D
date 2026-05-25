/**
 * OCC-10.8 — Draft angle on solid faces.
 * Applies a taper angle to selected faces relative to a neutral plane and
 * pull direction via BRepOffsetAPI_DraftAngle.
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';

type OccDraftApi = OcctRaw & {
  BRepOffsetAPI_DraftAngle_1: new (shape: unknown) => {
    Add(face: unknown, dir: unknown, angle: number, plane: unknown): void;
    Build(progress: unknown): void;
    IsDone(): boolean;
    HasErrors?(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  Message_ProgressRange_1: new () => { delete?: () => void };
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
  const drafter = new occ.BRepOffsetAPI_DraftAngle_1(rawShape);

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
    const rawFace = occDeref(oc, handle, oc.TopoDS_Face);
    try {
      drafter.Add(rawFace, occPullDir, angleRad, occPlane);
      addedAny = true;
    } catch (e) {
      console.warn(`[occDraft] could not add face ${faceId}:`, e);
    } finally {
      rawFace.delete?.();
    }
  }

  if (!addedAny) {
    drafter.delete();
    occPlane.delete();
    occPlaneNormal.delete();
    occPlaneOrigin.delete();
    occPullDir.delete();
    rawShape.delete?.();
    return null;
  }

  const progress = new occ.Message_ProgressRange_1();
  try {
    drafter.Build(progress);
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
    progress.delete?.();
    drafter.delete();
    occPlane.delete();
    occPlaneNormal.delete();
    occPlaneOrigin.delete();
    occPullDir.delete();
    rawShape.delete?.();
  }
}
