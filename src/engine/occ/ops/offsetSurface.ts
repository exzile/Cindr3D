/**
 * OCC surface offset via BRepOffsetAPI_MakeOffsetShape.
 * Produces a properly offset open-shell BRepBody that handles concave/convex
 * regions and self-intersections, unlike the naive per-vertex normal approach.
 * Requires TKOffset (loaded by default in loader.ts).
 */
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';

type OccOffsetApi = OcctRaw & {
  BRepOffsetAPI_MakeOffsetShape_2: new (
    shape: unknown,
    offset: number,
    tol: number,
    mode: unknown,
    intersection: boolean,
    selfInter: boolean,
    join: unknown,
    removeIntEdges: boolean,
  ) => {
    Build(progress?: unknown): void;
    IsDone(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  BRepOffset_Mode: { BRepOffset_Skin: unknown };
  GeomAbs_JoinType: { GeomAbs_Arc: unknown };
  Message_ProgressRange_1: new () => { delete?: () => void };
};

export interface OccOffsetSurfaceOptions {
  id?: string;
  sourceFeatureId?: string;
  tolerance?: number;
}

export async function occOffsetSurface(
  sourceBody: { shape: unknown },
  distance: number,
  options: OccOffsetSurfaceOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occOffsetSurfaceWithInstance(oc, sourceBody, distance, options);
}

export function occOffsetSurfaceWithInstance(
  oc: OcctRaw,
  sourceBody: { shape: unknown },
  distance: number,
  options: OccOffsetSurfaceOptions = {},
): BRepBody | null {
  const occ = oc as OccOffsetApi;
  const tol = options.tolerance ?? 1e-4;

  try {
    const mode = occ.BRepOffset_Mode?.BRepOffset_Skin;
    const join = occ.GeomAbs_JoinType?.GeomAbs_Arc;
    if (mode === undefined || join === undefined) return null;

    const pr = new occ.Message_ProgressRange_1();
    const offsetMaker = new occ.BRepOffsetAPI_MakeOffsetShape_2(
      sourceBody.shape,
      distance,
      tol,
      mode,
      false,
      false,
      join,
      false,
    );
    try {
      offsetMaker.Build(pr);
      if (!offsetMaker.IsDone()) return null;
      const result = offsetMaker.Shape();
      return makeBRepBodyFromOccShape(oc, result, {
        id: options.id,
        sourceFeatureId: options.sourceFeatureId,
      });
    } finally {
      offsetMaker.delete();
      pr.delete?.();
    }
  } catch {
    return null;
  }
}
