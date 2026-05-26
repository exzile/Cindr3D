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

/** Reconstruct a typed OCC object from an OccHandle's raw pointer. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function occDeref(oc: OcctRaw, handle: OccHandle, ctor: any): any {
  if (typeof oc.wrapPointer !== 'function') {
    const object = handle.deref();
    if (!object) {
      throw new Error(`Cannot dereference disposed OCC handle ${handle.type}:${handle.ptr}`);
    }
    return object;
  }
  return oc.wrapPointer(handle.ptr, ctor);
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

  try {
    // Walk faces
    collectTopologyHandles(oc, rawShape, oc.TopAbs_ShapeEnum.TopAbs_FACE, (shape, isOwnedCopy) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const face = oc.TopoDS.Face_1(shape) as any;
      if (isOwnedCopy) {
        // shape is an owned heap copy (explorer path). face is a VIEW of shape (same ptr).
        // OccHandle takes ownership — dispose calls face.delete() = shape.delete().
        // Do NOT call shape.delete() separately; the OccHandle is the sole owner.
        faceHandles.push(occWrap(face, 'TopoDS_Face'));
      } else {
        // shape is a VIEW of the map's internal slot (map path). face has the same ptr.
        // Use a no-op dispose to avoid double-free when disposeTopologyMap runs.
        // Pass face as _object so handle.deref() works when oc.wrapPointer is unavailable.
        faceHandles.push(new OccHandle<unknown>((face.ptr as number | undefined) ?? 0, 'TopoDS_Face', () => { /* VIEW — owned by body.shape */ }, face));
      }
    });

    // Walk edges
    collectTopologyHandles(oc, rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, (shape, isOwnedCopy) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const edge = oc.TopoDS.Edge_1(shape) as any;
      if (isOwnedCopy) {
        edgeHandles.push(occWrap(edge, 'TopoDS_Edge'));
      } else {
        edgeHandles.push(new OccHandle<unknown>((edge.ptr as number | undefined) ?? 0, 'TopoDS_Edge', () => { /* VIEW */ }, edge));
      }
    });

    // Walk vertices
    collectTopologyHandles(oc, rawShape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, (shape, isOwnedCopy) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vertex = oc.TopoDS.Vertex_1(shape) as any;
      if (isOwnedCopy) {
        vertexHandles.push(occWrap(vertex, 'TopoDS_Vertex'));
      } else {
        vertexHandles.push(new OccHandle<unknown>((vertex.ptr as number | undefined) ?? 0, 'TopoDS_Vertex', () => { /* VIEW */ }, vertex));
      }
    });

    const faceAlloc = createBRepIdAllocator(0);
    const edgeAlloc = createBRepIdAllocator(0);
    const vertexAlloc = createBRepIdAllocator(0);

    const { ids: faceIds } = assignTopologyIds(faceHandles, faceAlloc);
    const { ids: edgeIds } = assignTopologyIds(edgeHandles, edgeAlloc);
    const { ids: vertexIds } = assignTopologyIds(vertexHandles, vertexAlloc);

    return createBRepBody({ ...options, shape: shapeHandle, faceIds, edgeIds, vertexIds });
  } catch (error) {
    console.error('[makeBRepBodyFromOccShape] failed building topology handles:', error);
    shapeHandle.dispose();
    disposeHandleList(faceHandles);
    disposeHandleList(edgeHandles);
    disposeHandleList(vertexHandles);
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

export function invalidateBRepTessellation(body: BRepBody): void {
  body.mesh?.dispose();
  body.mesh = undefined;
  body._tessellation = undefined;
  body.revision = nextRevision++;
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
 * adjacent face, inflating the edge count.  The synthetic-edge filter in
 * EdgeOpEdgeHighlight then incorrectly hides real edges when the duplicate
 * count pushes a direction-group over its threshold.
 *
 * `isOwnedCopy` tells the callback whether `shape` is a heap-allocated copy
 * (explorer path — caller is responsible for deletion) or a wrapPointer VIEW
 * into the map's internal storage (map path — do NOT delete, map owns it).
 */
function collectTopologyHandles(
  oc: OcctRaw,
  rawShape: unknown,
  shapeType: unknown,
  wrapShape: (shape: { ptr: number; delete(): void }, isOwnedCopy: boolean) => void,
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
          // NOTE: FindKey returns a wrapPointer VIEW of the map's internal shape --
          // do NOT call shape.delete() here.  The map's own destructor (map.delete()
          // below) cleans up its internal storage.  isOwnedCopy=false signals this.
          const shape = findKeyFn(i) as { ptr: number; delete(): void };
          wrapShape(shape, false);
        }
      } finally {
        map.delete();
      }
      return;
    }
    map.delete();
    // FindKey method not found -- fall through to explorer fallback.
  }

  // Fallback: raw explorer with ptr-level dedup.
  // explorer.Current() returns a new heap-allocated TopoDS_Shape copy (isOwnedCopy=true).
  // We must delete duplicates ourselves (no IsSame dedup like MapShapes provides).
  const seenPtrs = new Set<number>();
  const explorer = new oc.TopExp_Explorer_2(rawShape, shapeType, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    while (explorer.More()) {
      const shape = explorer.Current() as { ptr: number; delete(): void };
      if (!seenPtrs.has(shape.ptr)) {
        seenPtrs.add(shape.ptr);
        // isOwnedCopy=true: wrapShape callback is responsible for calling shape.delete().
        wrapShape(shape, true);
      } else {
        shape.delete(); // discard duplicate owned copy
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
