/**
 * OCC-5.2 — Exact chamfer via BRepFilletAPI_MakeChamfer.
 * Equal-distance chamfer uses Add_2(distance, edge);
 * two-distance uses Add_3(d1, d2, edge, refFace).
 */
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';

type OccShapeRef = { ptr: number; delete(): void };

type OccChamferApi = OcctRaw & {
  BRepFilletAPI_MakeChamfer: new (shape: unknown) => {
    Add_2(distance: number, edge: unknown): void;
    Add_3(distance1: number, distance2: number, edge: unknown, face: unknown): void;
    Build(progress: unknown): void;
    IsDone(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  Message_ProgressRange_1: new () => { delete?: () => void };
  TopExp_Explorer_2: new (shape: unknown, toFind: unknown, toAvoid: unknown) => {
    More(): boolean;
    Current(): OccShapeRef;
    Next(): void;
    delete(): void;
  };
  TopTools_IndexedMapOfShape_1: new () => {
    FindIndex_1(shape: unknown): number;
    Extent(): number;
    delete(): void;
  };
  TopExp: {
    MapShapes_1(shape: unknown, type: unknown, map: unknown): void;
  };
};

export interface OccChamferOptions {
  id?: string;
  sourceFeatureId?: string;
  /** Second distance for two-distance chamfer. Omit for equal-distance. */
  distance2?: number;
}

export async function occChamfer(
  body: BRepBody,
  edgeIds: number[],
  distance: number,
  options: OccChamferOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occChamferWithInstance(oc, body, edgeIds, distance, options);
}

export function occChamferWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  edgeIds: number[],
  distance: number,
  options: OccChamferOptions = {},
): BRepBody | null {
  const occ = oc as OccChamferApi;
  if (edgeIds.length === 0) return null;
  if (distance <= 0) return null;

  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const mk = new occ.BRepFilletAPI_MakeChamfer(rawShape);

  try {
    let addedAny = false;
    for (const edgeId of edgeIds) {
      const edgeHandle = body.edgeIds.get(edgeId);
      if (!edgeHandle) continue;
      const rawEdge = occDeref(oc, edgeHandle, oc.TopoDS_Edge);

      try {
        if (options.distance2 !== undefined) {
          // Two-distance: need a reference face adjacent to the edge
          const refFaceHandle = findAdjacentFace(oc, body, rawShape, rawEdge);
          if (refFaceHandle) {
            const rawFace = occDeref(oc, refFaceHandle, oc.TopoDS_Face);
            try {
              mk.Add_3(distance, options.distance2, rawEdge, rawFace);
            } finally {
              rawFace.delete?.();
            }
          } else {
            mk.Add_2(distance, rawEdge);
          }
        } else {
          mk.Add_2(distance, rawEdge);
        }
        addedAny = true;
      } catch (e) {
        console.warn(`[occChamfer] could not add edge ${edgeId}:`, e);
      } finally {
        rawEdge.delete?.();
      }
    }

    if (!addedAny) {
      return null;
    }

    const progress = new occ.Message_ProgressRange_1();
    try {
      mk.Build(progress);
    } finally {
      progress.delete?.();
    }
    if (!mk.IsDone()) {
      console.warn('[occChamfer] IsDone() = false');
      return null;
    }
    const resultShape = mk.Shape();
    return makeBRepBodyFromOccShape(oc, resultShape, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
    });
  } catch (e) {
    console.warn('[occChamfer] threw during Build/Shape:', e);
    return null;
  } finally {
    mk.delete();
    rawShape.delete?.();
  }
}

/**
 * Find the first face in body that is adjacent (shares the edge) and return its handle.
 * Used for two-distance chamfer reference face selection.
 *
 * Uses canonical TopTools_IndexedMapOfShape indices for identity comparison —
 * ptr comparison is unreliable because orientation wrappers produce different
 * ptr values for the same underlying shape (same bug fixed in computeChordLengthRadius
 * in fillet.ts).
 */
function findAdjacentFace(
  oc: OcctRaw,
  body: BRepBody,
  rawShape: unknown,
  rawEdge: OccShapeRef,
): (typeof body.faceIds extends Map<number, infer V> ? V : never) | undefined {
  const occ = oc as OccChamferApi;

  // Build canonical edge + face index maps so identity comparisons are reliable.
  const edgeMap = new occ.TopTools_IndexedMapOfShape_1();
  const faceMap = new occ.TopTools_IndexedMapOfShape_1();
  try {
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_FACE, faceMap);
  } catch {
    edgeMap.delete();
    faceMap.delete();
    return undefined;
  }

  const targetEdgeIdx = edgeMap.FindIndex_1(rawEdge);
  if (targetEdgeIdx <= 0) {
    edgeMap.delete();
    faceMap.delete();
    return undefined;
  }

  let faceExplorer: InstanceType<OccChamferApi['TopExp_Explorer_2']> | null = null;
  try {
    faceExplorer = new occ.TopExp_Explorer_2(
      rawShape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (faceExplorer.More()) {
      const faceShape = faceExplorer.Current();
      const edgeExp = new occ.TopExp_Explorer_2(
        faceShape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      let edgeFound = false;
      while (edgeExp.More()) {
        const e = edgeExp.Current();
        const idx = edgeMap.FindIndex_1(e);
        e.delete();
        if (idx === targetEdgeIdx) {
          edgeFound = true;
          edgeExp.delete();
          break;
        }
        edgeExp.Next();
      }
      if (!edgeFound) {
        edgeExp.delete();
        faceShape.delete();
        faceExplorer.Next();
        continue;
      }

      // Found an adjacent face — resolve its canonical index then look it up in
      // body.faceIds using the same map (avoids ptr comparison).
      const targetFaceIdx = faceMap.FindIndex_1(faceShape);
      faceShape.delete();

      if (targetFaceIdx > 0) {
        for (const [, handle] of body.faceIds) {
          const rawFaceHandle = occDeref(oc, handle, oc.TopoDS_Shape) as OccShapeRef;
          try {
            const handleIdx = faceMap.FindIndex_1(rawFaceHandle);
            if (handleIdx === targetFaceIdx) {
              return handle as ReturnType<typeof findAdjacentFace>;
            }
          } finally {
            rawFaceHandle.delete?.();
          }
        }
      }

      // Face not in body registry — try next face.
      faceExplorer.Next();
    }
  } catch { /* topology walk failed */ }
  finally {
    faceExplorer?.delete();
    edgeMap.delete();
    faceMap.delete();
  }
  return undefined;
}
