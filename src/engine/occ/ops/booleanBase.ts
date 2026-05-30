/**
 * Shared ID-propagation helper for BRepAlgoAPI_* boolean operations.
 * Walks Modified / Generated / IsDeleted maps from the algo and builds
 * the new body's faceIds / edgeIds / vertexIds maps.
 */
import type { OcctRaw } from '../types';
import type { BRepBody, BRepTopologyHandle } from '../brepBody';
import { occDeref, makeBRepBodyFromOccShape } from '../brepBody';
import { occWrap } from '../occHandle';
import { unifyRawShape } from './unifyShape';

/** Minimal structural interface for OCC BRepAlgoAPI_* algo objects used in
 *  propagateBooleanIds. The actual WASM objects satisfy this shape at runtime. */
export interface OccBooleanAlgo {
  Shape(): { delete?: () => void };
  Modified(shape: { delete?: () => void }): { delete?: () => void };
}

export function propagateBooleanIds(
  oc: OcctRaw,
  algo: OccBooleanAlgo,
  sources: BRepBody[],
): BRepBody {
  const rawResult = algo.Shape();
  // Unify same-domain faces/edges before assigning topology IDs so the resulting
  // body has CAD-style topology instead of tessellation-like fragments.
  const unified = unifyRawShape(oc, rawResult, { unifyEdges: true, unifyFaces: true });
  const shapeForBody = unified?.rawShape ?? rawResult;
  const ownedResources = unified ? [unified.unifier] : [];
  const newBody = makeBRepBodyFromOccShape(oc, shapeForBody, { ownedResources });

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
      let modList: { delete?: () => void } | null = null;
      let it: { More(): boolean; Value(): { delete?: () => void }; Next(): void; delete?: () => void } | null = null;
      try {
        modList = algo.Modified(rawFace);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        it = new (oc as any).TopTools_ListIteratorOfListOfShape_1(modList);
        if (!it) continue;
        while (it.More()) {
          const modShape = it.Value();
          try {
            // Re-tag: if this new face's ptr matches a face in newBody, override its ID.
            // newFace is a TopoDS.Face_1 VIEW of modShape (same ptr) — do NOT .delete()
            // it: modShape is deleted below, so deleting the VIEW too double-frees the
            // same pointer → WASM heap corruption.
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
          } finally {
            modShape.delete?.();
          }
          it.Next();
        }
      } catch { /* face may have been deleted; skip */ }
      finally {
        it?.delete?.();
        modList?.delete?.();
        // NOTE: rawFace is an occDeref wrapPointer VIEW — do NOT delete.
      }
    }
  }

  return newBody;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildOccShape(oc: OcctRaw, handle: BRepTopologyHandle, ctor: new (...args: any[]) => unknown): unknown {
  return occDeref(oc, handle, ctor);
}

/** Wrap a raw OCC shape returned by an algo as an OccHandle. */
export function wrapResultShape(oc: OcctRaw, rawShape: { delete?: () => void }): BRepTopologyHandle {
  void oc;
  return occWrap(rawShape, 'TopoDS_Shape');
}
