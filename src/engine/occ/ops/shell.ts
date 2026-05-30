/**
 * OCC-3.6 — Shell (hollow solid).
 * Removes specified faces and offsets the remaining walls inward by `thickness`
 * via BRepOffsetAPI_MakeThickSolid::MakeThickSolidByJoin.
 */
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';

type OccShellApi = OcctRaw & {
  BRepOffsetAPI_MakeThickSolid: new () => {
    MakeThickSolidByJoin(...args: unknown[]): void;
    Build(progress: unknown): void;
    IsDone(): boolean;
    HasErrors(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  Message_ProgressRange_1: new () => { delete?: () => void };
  TopTools_ListOfShape_1: new () => { Append_1(shape: unknown): void; delete(): void };
};

export interface OccShellOptions {
  id?: string;
  sourceFeatureId?: string;
  tolerance?: number;
  /** Add material outward by this amount in addition to the inward hollow. */
  outsideThickness?: number;
  /**
   * 'rolling-ball' (default) — GeomAbs_Arc join, smooth corner blending.
   * 'sharp'                  — GeomAbs_Intersection join, miter corners.
   */
  shellType?: 'rolling-ball' | 'sharp';
}

export async function occShell(
  body: BRepBody,
  facesToRemove: number[],
  thickness: number,
  options: OccShellOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occShellWithInstance(oc, body, facesToRemove, thickness, options);
}

export function occShellWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  facesToRemove: number[],
  thickness: number,
  options: OccShellOptions = {},
): BRepBody | null {
  const occ = oc as OccShellApi;
  if (facesToRemove.length === 0) return null;

  // Build the TopTools_ListOfShape of faces to remove
  const faceList = new occ.TopTools_ListOfShape_1();
  const rawFaces: Array<{ delete?: () => void }> = [];

  for (const faceId of facesToRemove) {
    const handle = body.faceIds.get(faceId);
    if (!handle) continue;
    const rawFace = occDeref(oc, handle, oc.TopoDS_Face);
    faceList.Append_1(rawFace);
    rawFaces.push(rawFace);
  }

  const rawBody = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const tol = options.tolerance ?? 1e-3;
  // GeomAbs_Arc = 0 (rolling-ball), GeomAbs_Intersection = 2 (sharp)
  const joinMode = options.shellType === 'sharp' ? 2 : 0;

  const thickSolid = new occ.BRepOffsetAPI_MakeThickSolid();
  const joinProgress = new occ.Message_ProgressRange_1();
  const buildProgress = new occ.Message_ProgressRange_1();
  try {
    thickSolid.MakeThickSolidByJoin(
      rawBody,
      faceList,
      -Math.abs(thickness), // negative = inward offset
      tol,
      false,    // intersection
      false,    // selfInter
      0,        // offsetMode = GeomAbs_Arc
      joinMode, // join type
      false,    // removeIntEdges
      joinProgress,
    );

    thickSolid.Build(buildProgress);

    if (!thickSolid.IsDone() || thickSolid.HasErrors()) {
      return null;
    }

    let resultShape = thickSolid.Shape();

    // Optional outward offset: run a second pass with positive thickness and empty face list
    if (options.outsideThickness && options.outsideThickness > 0) {
      const emptyList = new occ.TopTools_ListOfShape_1();
      const outerSolid = new occ.BRepOffsetAPI_MakeThickSolid();
      const outerJoinProg = new occ.Message_ProgressRange_1();
      const outerBuildProg = new occ.Message_ProgressRange_1();
      try {
        outerSolid.MakeThickSolidByJoin(
          rawBody,
          emptyList,
          Math.abs(options.outsideThickness), // positive = outward
          tol,
          false, false, 0, joinMode, false,
          outerJoinProg,
        );
        outerSolid.Build(outerBuildProg);
        if (outerSolid.IsDone() && !outerSolid.HasErrors()) {
          const outerShape = outerSolid.Shape();
          const fuse = new (oc as unknown as { BRepAlgoAPI_Fuse_3: new (a: unknown, b: unknown) => { Build(): void; IsDone?(): boolean; Shape(): unknown; delete(): void } }).BRepAlgoAPI_Fuse_3(resultShape, outerShape);
          fuse.Build();
          if (fuse.IsDone?.() !== false) resultShape = fuse.Shape();
          fuse.delete();
        }
      } finally {
        outerBuildProg.delete?.();
        outerJoinProg.delete?.();
        outerSolid.delete();
        emptyList.delete();
      }
    }

    return makeBRepBodyFromOccShape(oc, resultShape, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
    });
  } catch (e) {
    console.warn('[occShell] BRepOffsetAPI_MakeThickSolid threw:', e);
    return null;
  } finally {
    joinProgress.delete?.();
    buildProgress.delete?.();
    // NOTE: rawFaces and rawBody are occDeref wrapPointer VIEWs — do NOT delete.
    thickSolid.delete();
    faceList.delete();
  }
}
