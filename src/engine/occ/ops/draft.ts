/**
 * OCC-10.8 — Draft angle on solid faces.
 * Applies a taper angle to selected faces relative to a neutral plane and
 * pull direction via BRepOffsetAPI_DraftAngle.
 *
 * OCC-20 additions (2026-05-31, Fusion parity):
 *   - mode: 'one-side' (default) | 'two-side' | 'symmetric'
 *     Two-side/symmetric classify each face by which side of the neutral
 *     plane its centroid is on, then apply angleRad to the "above" side
 *     and angleRad2 (or -angleRad for symmetric) to the "below" side.
 *   - isDirectionFlipped: negates the pull direction (Fusion isDirectionFlipped).
 *   - isTangentChain: expand faceIds to include tangent-connected neighbours.
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { runEdgeOpBuild } from './adjacency';
import { expandTangentFaceChain } from './faceAdjacency';

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
  BRepAdaptor_Surface_2: new (face: unknown, restricted: boolean) => {
    FirstUParameter(): number; LastUParameter(): number;
    FirstVParameter(): number; LastVParameter(): number;
    Value(u: number, v: number): { X(): number; Y(): number; Z(): number; delete(): void };
    delete(): void;
  };
};

export interface OccDraftNeutralPlane {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface OccDraftOptions {
  id?: string;
  sourceFeatureId?: string;
  /**
   * 'one-side' (default) — all selected faces get the same angle.
   * 'symmetric' — faces above the neutral plane get +angle, faces below get -angle.
   * 'two-side'  — faces above get angleRad, faces below get angleRad2 (defaults to angleRad).
   * Mirrors Fusion DraftFeatureInput: setSingleAngle(isSymmetric) / setTwoAngles(a1,a2).
   */
  mode?: 'one-side' | 'two-side' | 'symmetric';
  /** Second angle for 'two-side' mode (below the neutral plane). Defaults to angleRad. */
  angleRad2?: number;
  /** Negate the pull direction (Fusion isDirectionFlipped). */
  isDirectionFlipped?: boolean;
  /** Expand faceIds to include tangent-connected neighbours (Fusion isTangentChain). */
  isTangentChain?: boolean;
}

/** Return the centroid of a face (UV midpoint world position). VIEW face — do NOT delete. */
function faceCentroid(
  occ: OccDraftApi,
  rawFace: unknown,
): THREE.Vector3 | null {
  let surf: { delete(): void } & ReturnType<OccDraftApi['BRepAdaptor_Surface_2']> | null = null;
  try {
    surf = new occ.BRepAdaptor_Surface_2(rawFace, true);
    const u = (surf.FirstUParameter() + surf.LastUParameter()) / 2;
    const v = (surf.FirstVParameter() + surf.LastVParameter()) / 2;
    const p = surf.Value(u, v);
    const result = new THREE.Vector3(p.X(), p.Y(), p.Z());
    p.delete();
    return result;
  } catch {
    return null;
  } finally {
    surf?.delete();
  }
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

  // Expand face selection to tangent neighbours if requested.
  const resolvedFaceIds = options.isTangentChain
    ? expandTangentFaceChain(oc, body, faceIds)
    : faceIds;

  const occ = oc as OccDraftApi;
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const drafter = new occ.BRepOffsetAPI_DraftAngle_2(rawShape);

  // Flip pull direction if requested (Fusion isDirectionFlipped).
  const pd = pullDirection.clone().normalize();
  if (options.isDirectionFlipped) pd.negate();
  const pn = neutralPlane.normal.clone().normalize();

  const occPullDir = new occ.gp_Dir_4(pd.x, pd.y, pd.z);
  const occPlaneOrigin = new occ.gp_Pnt_3(
    neutralPlane.origin.x, neutralPlane.origin.y, neutralPlane.origin.z,
  );
  const occPlaneNormal = new occ.gp_Dir_4(pn.x, pn.y, pn.z);
  const occPlane = new occ.gp_Pln_3(occPlaneOrigin, occPlaneNormal);

  const mode = options.mode ?? 'one-side';
  // For two-side, allow a distinct second angle; symmetric uses the same magnitude.
  const angleRad2 = options.angleRad2 ?? angleRad;

  let addedAny = false;
  for (const faceId of resolvedFaceIds) {
    const handle = body.faceIds.get(faceId);
    if (!handle) continue;
    // occDeref returns a TopoDS_Shape; DraftAngle.Add needs a real TopoDS_Face.
    // Face_1 is a VIEW — do NOT delete. Add's 5th arg (Flag) is required here.
    const rawFace = occ.TopoDS.Face_1(occDeref(oc, handle, oc.TopoDS_Shape));

    // Determine the effective angle for this face.
    // For two-side/symmetric: classify by which side of the neutral plane the
    // face centroid is on. Positive side → angleRad; negative → -angleRad2
    // (for symmetric) or -angleRad2 (for two-side with explicit second angle).
    let effectiveAngle = angleRad;
    if (mode === 'two-side' || mode === 'symmetric') {
      const centroid = faceCentroid(occ, rawFace);
      if (centroid) {
        const signed = centroid
          .clone()
          .sub(neutralPlane.origin)
          .dot(pn);
        if (signed < 0) {
          // Face is on the "below" side of the neutral plane.
          effectiveAngle = mode === 'symmetric' ? -angleRad : -angleRad2;
        }
      }
    }

    try {
      drafter.Add(rawFace, occPullDir, effectiveAngle, occPlane, true);
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
