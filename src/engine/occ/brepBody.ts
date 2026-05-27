import type * as THREE from 'three';
import type { OcctRaw } from './types';
import { occWrap, OccHandle } from './occHandle';
import { assignTopologyIds, createBRepIdAllocator } from './topologyIds';

export type BRepTopologyHandle = OccHandle<unknown>;

export interface BRepTessellation {
  positions: Float32Array;
  normals: Float32Array;
  faceIds: Uint32Array;
  edgePolylines: Map<number, Float32Array>;
}

export interface BRepBody {
  id: string;
  revision: number;
  shape: BRepTopologyHandle;
  faceIds: Map<number, BRepTopologyHandle>;
  edgeIds: Map<number, BRepTopologyHandle>;
  vertexIds: Map<number, BRepTopologyHandle>;
  sourceFeatureId?: string;
  mesh?: THREE.BufferGeometry;
  _tessellation?: BRepTessellation;
  ownedResources?: Array<{ delete?: () => void }>;
  dispose(): void;
}

export interface CreateBRepBodyOptions {
  id?: string;
  revision?: number;
  shape: BRepTopologyHandle;
  faceIds?: Map<number, BRepTopologyHandle>;
  edgeIds?: Map<number, BRepTopologyHandle>;
  vertexIds?: Map<number, BRepTopologyHandle>;
  sourceFeatureId?: string;
  mesh?: THREE.BufferGeometry;
  tessellation?: BRepTessellation;
  ownedResources?: Array<{ delete?: () => void }>;
}

/**
 * Reconstruct a typed OCC object from an OccHandle.
 *
 * Prefers `oc.wrapPointer(handle.ptr, ctor)` when a valid WASM heap address
 * is available.  Falls back to the stored JS object reference when `.ptr` is
 * 0 / undefined / NaN — this covers opencascade.js builds that don't expose
 * `.ptr` on returned objects (the JS wrapper itself is still a valid embind
 * object that OCC methods accept).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function occDeref(oc: OcctRaw, handle: OccHandle, ctor: any): any {
  // Fast path: valid WASM heap pointer — use wrapPointer for type-correct reconstruction.
  if (typeof oc.wrapPointer === 'function' && handle.ptr) {
    return oc.wrapPointer(handle.ptr, ctor);
  }
  // Fallback: return the stored JS wrapper object directly (without cloning).
  // This handles opencascade.js builds where .ptr is not exposed on returned objects.
  // Access _object directly to avoid deref()'s clone() which creates an owned copy
  // that the caller (who treats the result as a VIEW) would never delete.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const object = (handle as any)._object;
  if (object) return object;
  // Last resort: try deref() which may clone.
  const derefed = handle.deref();
  if (!derefed) {
    throw new Error(`Cannot dereference OCC handle ${handle.type} (ptr=${handle.ptr}, disposed=${handle.isDisposed})`);
  }
  return derefed;
}

/**
 * Build a BRepBody from a raw OCC TopoDS_Shape.
 * Transfers ownership of `rawShape` -- it will be deleted via the body's shape handle.
 *
 * Walks all faces, edges, and vertices, wraps each in an OccHandle, and
 * assigns monotonic IDs via assignTopologyIds.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeBRepBodyFromOccShape(oc: OcctRaw, rawShape: any, options: Omit<CreateBRepBodyOptions, 'shape' | 'faceIds' | 'edgeIds' | 'vertexIds'> = {}): BRepBody {
  const shapeHandle = occWrap(rawShape, 'TopoDS_Shape');
  const faceHandles: OccHandle[] = [];
  const edgeHandles: OccHandle[] = [];
  const vertexHandles: OccHandle[] = [];

  // Retained maps: when collectTopologyHandles uses the MAP PATH, FindKey
  // returns wrappers that reference the map's internal storage.  The map must
  // stay alive for as long as those wrappers are used (body's entire lifetime).
  // Similarly, rawShape itself may reference the source builder/reader — the
  // caller must keep that alive via options.ownedResources.
  const retainedMaps: Array<{ delete(): void }> = [];

  try {
    // Walk faces — store shape directly as _object (not the Face_1/Edge_1 cast,
    // which may be a separate ephemeral wrapper in some builds).
    collectTopologyHandles(oc, rawShape, oc.TopAbs_ShapeEnum.TopAbs_FACE, (shape) => {
      faceHandles.push(new OccHandle<unknown>(
        typeof shape.ptr === 'number' ? shape.ptr : 0,
        'TopoDS_Face',
        () => { /* VIEW into retained map — no-op dispose */ },
        shape,
      ));
    }, retainedMaps);

    // Walk edges
    collectTopologyHandles(oc, rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, (shape) => {
      edgeHandles.push(new OccHandle<unknown>(
        typeof shape.ptr === 'number' ? shape.ptr : 0,
        'TopoDS_Edge',
        () => { /* VIEW into retained map — no-op dispose */ },
        shape,
      ));
    }, retainedMaps);

    // Walk vertices
    collectTopologyHandles(oc, rawShape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, (shape) => {
      vertexHandles.push(new OccHandle<unknown>(
        typeof shape.ptr === 'number' ? shape.ptr : 0,
        'TopoDS_Vertex',
        () => { /* VIEW into retained map — no-op dispose */ },
        shape,
      ));
    }, retainedMaps);

    const faceAlloc = createBRepIdAllocator(0);
    const edgeAlloc = createBRepIdAllocator(0);
    const vertexAlloc = createBRepIdAllocator(0);

    const { ids: faceIds } = assignTopologyIds(faceHandles, faceAlloc);
    const { ids: edgeIds } = assignTopologyIds(edgeHandles, edgeAlloc);
    const { ids: vertexIds } = assignTopologyIds(vertexHandles, vertexAlloc);

    const ownedResources = [...(options.ownedResources ?? []), ...retainedMaps];
    return createBRepBody({ ...options, shape: shapeHandle, faceIds, edgeIds, vertexIds, ownedResources });
  } catch (error) {
    console.error('[makeBRepBodyFromOccShape] failed building topology handles:', error);
    shapeHandle.dispose();
    disposeHandleList(faceHandles);
    disposeHandleList(edgeHandles);
    disposeHandleList(vertexHandles);
    for (const m of retainedMaps) { try { m.delete(); } catch { /* already freed */ } }
    throw error;
  }
}

let nextBodyId = 1;
let nextRevision = 1;

export function createBRepBody(options: CreateBRepBodyOptions): BRepBody {
  const body: BRepBody = {
    id: options.id ?? `brep-${nextBodyId++}`,
    revision: options.revision ?? nextRevision++,
    shape: options.shape,
    faceIds: options.faceIds ?? new Map(),
    edgeIds: options.edgeIds ?? new Map(),
    vertexIds: options.vertexIds ?? new Map(),
    sourceFeatureId: options.sourceFeatureId,
    mesh: options.mesh,
    _tessellation: options.tessellation,
    ownedResources: options.ownedResources,
    dispose() {
      disposeBRepBody(body);
    },
  };
  return body;
}

export function disposeBRepBody(body: BRepBody): void {
  body.shape.dispose();
  disposeTopologyMap(body.faceIds);
  disposeTopologyMap(body.edgeIds);
  disposeTopologyMap(body.vertexIds);
  for (const resource of body.ownedResources ?? []) {
    try { resource.delete?.(); } catch { /* already freed */ }
  }
  body.ownedResources = undefined;
  body.mesh?.dispose();
  body.mesh = undefined;
  body._tessellation = undefined;
}

/**
 * Check whether a BRepBody's main shape is still alive (not deleted by WASM GC).
 * Returns false if the underlying embind wrapper reports isDeleted(), or if the
 * handle has been disposed, or if the stored _object is null/missing.
 */
export function isBRepBodyAlive(body: BRepBody): boolean {
  if (body.shape.isDisposed) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = (body.shape as any)._object;
  if (!obj) return false;
  if (typeof obj.isDeleted === 'function' && obj.isDeleted()) return false;
  return true;
}

export function invalidateBRepTessellation(body: BRepBody): void {
  body.mesh?.dispose();
  body.mesh = undefined;
  body._tessellation = undefined;
  body.revision = nextRevision++;
}

/**
 * Resolve a topology sub-shape from the body's main shape on-the-fly.
 *
 * Builds a fresh TopTools_IndexedMapOfShape, looks up the shape at the given
 * 0-based index, and returns both the raw shape reference and a cleanup
 * function.  The returned shape is a VIEW into the temporary map — it is valid
 * only until `cleanup()` is called.
 *
 * This bypasses all stored OccHandle references, working around opencascade.js
 * builds where FindKey/Edge_1 wrappers become stale after map/builder deletion.
 *
 * Returns null if the index is out of range or topology traversal fails.
 */
export function resolveTopologyByIndex(
  oc: OcctRaw,
  bodyShape: unknown,
  shapeType: unknown,
  index: number,
): { shape: unknown; cleanup: () => void } | null {
  if (typeof oc.TopTools_IndexedMapOfShape_1 !== 'function' || !oc.TopExp?.MapShapes_1) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = new oc.TopTools_IndexedMapOfShape_1() as any;
  try {
    oc.TopExp.MapShapes_1(bodyShape, shapeType, map);
    const count: number = map.Extent();
    const mapIndex = index + 1; // 0-based → 1-based
    if (mapIndex < 1 || mapIndex > count) {
      map.delete();
      return null;
    }
    const findKeyFn: ((i: number) => unknown) | undefined =
      typeof map.FindKey === 'function' ? (i: number) => (map as { FindKey(i: number): unknown }).FindKey(i) :
      typeof map.FindKey_1 === 'function' ? (i: number) => (map as { FindKey_1(i: number): unknown }).FindKey_1(i) :
      undefined;
    if (!findKeyFn) {
      map.delete();
      return null;
    }
    const shape = findKeyFn(mapIndex);
    return { shape, cleanup: () => map.delete() };
  } catch {
    map.delete();
    return null;
  }
}

/**
 * Resolve multiple topology sub-shapes at once, sharing one map for efficiency.
 * Returns a map from 0-based index → raw shape, plus a single cleanup function.
 */
export function resolveMultipleTopologyByIndex(
  oc: OcctRaw,
  bodyShape: unknown,
  shapeType: unknown,
  indices: number[],
): { shapes: Map<number, unknown>; cleanup: () => void } | null {
  if (typeof oc.TopTools_IndexedMapOfShape_1 !== 'function' || !oc.TopExp?.MapShapes_1) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = new oc.TopTools_IndexedMapOfShape_1() as any;
  try {
    oc.TopExp.MapShapes_1(bodyShape, shapeType, map);
    const count: number = map.Extent();
    const findKeyFn: ((i: number) => unknown) | undefined =
      typeof map.FindKey === 'function' ? (i: number) => (map as { FindKey(i: number): unknown }).FindKey(i) :
      typeof map.FindKey_1 === 'function' ? (i: number) => (map as { FindKey_1(i: number): unknown }).FindKey_1(i) :
      undefined;
    if (!findKeyFn) {
      map.delete();
      return null;
    }
    const shapes = new Map<number, unknown>();
    for (const idx of indices) {
      const mapIdx = idx + 1;
      if (mapIdx >= 1 && mapIdx <= count) {
        shapes.set(idx, findKeyFn(mapIdx));
      }
    }
    return { shapes, cleanup: () => map.delete() };
  } catch {
    map.delete();
    return null;
  }
}

function disposeTopologyMap(handles: Map<number, BRepTopologyHandle>): void {
  for (const handle of handles.values()) {
    handle.dispose();
  }
  handles.clear();
}

/**
 * Collect unique topology sub-shapes using TopExp.MapShapes (deduplicated via
 * OCC's IsSame identity).  Falls back to TopExp_Explorer when MapShapes is
 * unavailable.
 *
 * Without dedup, TopExp_Explorer visits shared edges/vertices once per
 * adjacent face, inflating the edge count.
 *
 * **Lifecycle model**: FindKey returns a JS wrapper referencing the map's
 * internal C++ storage.  The wrapper stays valid as long as:
 *   (a) the map is not deleted, and
 *   (b) the source shape (and thus its topology) is alive.
 *
 * Callers keep the map alive via `retainedMaps` (pushed to body.ownedResources)
 * and the source shape alive via the builder/reader in ownedResources.
 */
function collectTopologyHandles(
  oc: OcctRaw,
  rawShape: unknown,
  shapeType: unknown,
  wrapShape: (shape: { ptr: number; delete(): void }) => void,
  retainedMaps?: Array<{ delete(): void }>,
): void {
  // Prefer MapShapes for dedup -- same approach as fillet.ts / chamfer.ts.
  if (typeof oc.TopTools_IndexedMapOfShape_1 === 'function' && oc.TopExp?.MapShapes_1) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = new oc.TopTools_IndexedMapOfShape_1() as any;
    // opencascade.js binding exposes FindKey (no suffix) in some builds, FindKey_1 in others.
    const findKeyFn: ((i: number) => unknown) | undefined =
      typeof map.FindKey === 'function' ? (i: number) => (map as { FindKey(i: number): unknown }).FindKey(i) :
      typeof map.FindKey_1 === 'function' ? (i: number) => (map as { FindKey_1(i: number): unknown }).FindKey_1(i) :
      undefined;
    if (findKeyFn) {
      try {
        oc.TopExp.MapShapes_1(rawShape, shapeType, map);
        const count: number = map.Extent();
        for (let i = 1; i <= count; i++) {
          const shape = findKeyFn(i) as { ptr: number; delete(): void };
          wrapShape(shape);
        }
        if (retainedMaps) {
          retainedMaps.push(map);
        } else {
          map.delete();
        }
      } catch (e) {
        map.delete();
        throw e;
      }
      return;
    }
    map.delete();
  }

  // Fallback: raw explorer with ptr-level dedup.
  const seenPtrs = new Set<number>();
  const explorer = new oc.TopExp_Explorer_2(rawShape, shapeType, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    while (explorer.More()) {
      const shape = explorer.Current() as { ptr: number; delete(): void };
      if (!seenPtrs.has(shape.ptr)) {
        seenPtrs.add(shape.ptr);
        wrapShape(shape);
      }
      explorer.Next();
    }
  } finally {
    explorer.delete();
  }
}

function disposeHandleList(handles: OccHandle[]): void {
  for (const handle of handles) {
    handle.dispose();
  }
  handles.length = 0;
}
