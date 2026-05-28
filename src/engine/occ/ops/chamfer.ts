/**
 * OCC-5.2 — Exact chamfer via BRepFilletAPI_MakeChamfer.
 * Equal-distance chamfer uses Add_2(distance, edge);
 * two-distance (and the converted distance+angle) uses Add_3(d1, d2, edge, refFace).
 *
 * OCC-13.5/13.7 — brought up to occFilletEdgeSetsWithInstance's robustness baseline:
 *   - seam/boundary-edge guard (countAdjacentFacesForEdge < 2 → skip), so a chamfer
 *     on a cylinder/arc seam produces a clean null instead of a Build() throw;
 *   - Build(progress)/Build() binding-variance fallback;
 *   - rejects partial results (Build threw / IsDone()===false → null);
 *   - keeps the MakeChamfer builder alive via ownedResources because Shape()
 *     references it (matches fillet's lifetime model).
 *   - all selected edges go into ONE MakeChamfer pass so shared-vertex corners are
 *     blended by the kernel in a single solve (the corner-aware strategy).
 */
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import { countAdjacentFacesForEdge, findAdjacentFace, runEdgeOpBuild } from './adjacency';

type OccChamferApi = OcctRaw & {
  BRepFilletAPI_MakeChamfer: new (shape: unknown) => {
    Add_2(distance: number, edge: unknown): void;
    Add_3(distance1: number, distance2: number, edge: unknown, face: unknown): void;
    Build(progress?: unknown): void;
    IsDone(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  TopTools_IndexedMapOfShape_1: new () => {
    FindIndex_1?(shape: unknown): number;
    FindIndex?(shape: unknown): number;
    Extent(): number;
    delete(): void;
  };
  TopExp: { MapShapes_1(shape: unknown, type: unknown, map: unknown): void };
};

export interface OccChamferOptions {
  id?: string;
  sourceFeatureId?: string;
  /** Second distance for two-distance / distance-and-angle chamfer. Omit for equal-distance. */
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

  // Resolve the body shape and verify it is still alive.
  let rawShape: unknown;
  try {
    rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (rawShape as any)?.isDeleted === 'function' && (rawShape as any).isDeleted()) {
      throw new Error('shape is deleted');
    }
  } catch {
    console.warn('[occChamfer] body.shape handle is stale');
    return null;
  }

  const mk = new occ.BRepFilletAPI_MakeChamfer(rawShape);

  // Build a shape→index map once for seam/boundary detection (matches fillet).
  const seamDetectMap = new occ.TopTools_IndexedMapOfShape_1();
  let seamDetectReady = false;
  try {
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, seamDetectMap);
    seamDetectReady = seamDetectMap.Extent() > 0;
  } catch {
    // Non-fatal: seam detection degrades gracefully.
  }

  try {
    let addedAny = false;
    for (const edgeId of edgeIds) {
      const edgeHandle = body.edgeIds.get(edgeId);
      if (!edgeHandle) continue;
      // rawEdge is an occDeref wrapPointer VIEW — do NOT delete.
      const rawEdge = occDeref(oc, edgeHandle, oc.TopoDS_Edge);

      // Skip seam/boundary edges — they cause Build() to throw (matches fillet).
      if (seamDetectReady) {
        const adjFaces = countAdjacentFacesForEdge(
          oc,
          rawShape,
          seamDetectMap as Parameters<typeof countAdjacentFacesForEdge>[2],
          rawEdge,
        );
        if (adjFaces < 2) {
          console.warn(`[occChamfer] skipping edge ${edgeId}: seam or boundary edge (adjacent to ${adjFaces} face(s))`);
          continue;
        }
      }

      try {
        if (options.distance2 !== undefined) {
          // Two-distance / distance+angle: need a reference face adjacent to the edge.
          const refFaceHandle = findAdjacentFace(oc, body, rawShape, rawEdge as { ptr: number; delete(): void });
          if (refFaceHandle) {
            const rawFace = occDeref(oc, refFaceHandle, oc.TopoDS_Face);
            mk.Add_3(distance, options.distance2, rawEdge, rawFace);
            // NOTE: rawFace is an occDeref wrapPointer VIEW — do NOT delete.
          } else {
            mk.Add_2(distance, rawEdge);
          }
        } else {
          mk.Add_2(distance, rawEdge);
        }
        addedAny = true;
      } catch (e) {
        console.warn(`[occChamfer] could not add edge ${edgeId}:`, e);
      }
    }

    seamDetectMap.delete();

    if (!addedAny) {
      mk.delete();
      return null;
    }

    try {
      runEdgeOpBuild(oc, mk);
    } catch (buildErr) {
      // Never install a partial/open chamfer; let the caller keep the previous body.
      console.warn('[occChamfer] Build() threw; rejecting partial result. Error:', buildErr);
      mk.delete();
      return null;
    }

    if (!mk.IsDone()) {
      console.warn('[occChamfer] IsDone() = false; rejecting partial result');
      mk.delete();
      return null;
    }

    const resultShape = mk.Shape();
    // Keep the chamfer builder alive — resultShape is a reference into it
    // (matches fillet's ownedResources lifetime model).
    return makeBRepBodyFromOccShape(oc, resultShape, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
      ownedResources: [mk],
    });
  } catch (e) {
    console.warn('[occChamfer] threw during Add/Build/Shape:', e);
    try { seamDetectMap.delete(); } catch { /* already freed */ }
    mk.delete();
    return null;
    // NOTE: rawShape is an occDeref wrapPointer VIEW — do NOT delete.
  }
}
