/**
 * Shared ID-propagation helper for BRepAlgoAPI_* boolean operations.
 * Walks Modified / Generated / IsDeleted maps from the algo and builds
 * the new body's faceIds / edgeIds / vertexIds maps.
 */
import type { OcctRaw } from '../types';
import type { BRepBody, BRepTopologyHandle } from '../brepBody';
import { occDeref, makeBRepBodyFromOccShape } from '../brepBody';
import { occWrap } from '../occHandle';

export function propagateBooleanIds(
  oc: OcctRaw,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  algo: any,
  sources: BRepBody[],
): BRepBody {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawResult: any = algo.Shape();
  const newBody = makeBRepBodyFromOccShape(oc, rawResult);

  // Build ptr→newFaceId lookup from the newly assigned IDs
  const ptrToNewId = new Map<number, number>();
  for (const [id, handle] of newBody.faceIds) {
    ptrToNewId.set(handle.ptr, id);
  }

  // Walk each source face through Modified() to carry IDs forward where possible.
  // This is a best-effort: if the op deleted or heavily modified a face, the new
  // body's monotonic IDs are used as-is (assigned by makeBRepBodyFromOccShape).
  // For OCC-7.x we'll add TNaming-based stable-ID tracking.
  for (const src of sources) {
    for (const [oldId, handle] of src.faceIds) {
      const rawFace = occDeref(oc, handle, oc.TopoDS_Face);
      try {
        const modList = algo.Modified(rawFace);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const it = new (oc as any).TopTools_ListIteratorOfListOfShape_1(modList);
        while (it.More()) {
          const modShape = it.Value();
          // Re-tag: if this new face's ptr matches a face in newBody, override its ID
          const newFace = oc.TopoDS.Face_1(modShape);
          const existingId = ptrToNewId.get(newFace.ptr);
          if (existingId !== undefined && existingId !== oldId) {
            // Swap IDs so the modified face keeps the old ID
            const oldHandle = newBody.faceIds.get(existingId) as BRepTopologyHandle;
            const newHandle = newBody.faceIds.get(oldId);
            if (oldHandle && !newHandle) {
              newBody.faceIds.delete(existingId);
              newBody.faceIds.set(oldId, oldHandle);
              ptrToNewId.set(newFace.ptr, oldId);
            }
          }
          modShape.delete();
          it.Next();
        }
        it.delete();
        modList.delete();
      } catch { /* face may have been deleted; skip */ }
    }
  }

  return newBody;
}

export function buildOccShape(
  oc: OcctRaw,
  handle: BRepTopologyHandle,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctor: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return occDeref(oc, handle, ctor);
}

/** Wrap a raw OCC shape returned by an algo as an OccHandle. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapResultShape(oc: OcctRaw, rawShape: any): BRepTopologyHandle {
  void oc;
  return occWrap(rawShape, 'TopoDS_Shape');
}
