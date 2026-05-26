import type * as THREE from 'three';
import type { OcctRaw } from './types';
import { occWrap, type OccHandle } from './occHandle';
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
 * Transfers ownership of `rawShape` — it will be deleted via the body's shape handle.
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
    collectTopologyHandles(oc, rawShape, oc.TopAbs_ShapeEnum.TopAbs_FACE, (shape) => {
      const face = oc.TopoDS.Face_1(shape);
      faceHandles.push(occWrap(face, 'TopoDS_Face'));
    });

    // Walk edges
    collectTopologyHandles(oc, rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, (shape) => {
      const edge = oc.TopoDS.Edge_1(shape);
      edgeHandles.push(occWrap(edge, 'TopoDS_Edge'));
    });

    // Walk vertices
    collectTopologyHandles(oc, rawShape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, (shape) => {
      const vertex = oc.TopoDS.Vertex_1(shape);
      vertexHandles.push(occWrap(vertex, 'TopoDS_Vertex'));
    });

    const faceAlloc = createBRepIdAllocator(0);
    const edgeAlloc = createBRepIdAllocator(0);
    const vertexAlloc = createBRepIdAllocator(0);

    const { ids: faceIds } = assignTopologyIds(faceHandles, faceAlloc);
    const { ids: edgeIds } = assignTopologyIds(edgeHandles, edgeAlloc);
    const { ids: vertexIds } = assignTopologyIds(vertexHandles, vertexAlloc);

    return createBRepBody({ ...options, shape: shapeHandle, faceIds, edgeIds, vertexIds });
  } catch (error) {
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
 */
function collectTopologyHandles(
  oc: OcctRaw,
  rawShape: unknown,
  shapeType: unknown,
  wrapShape: (shape: { delete(): void }) => void,
): void {
  // Prefer MapShapes for dedup — same approach as fillet.ts / chamfer.ts.
  if (typeof oc.TopTools_IndexedMapOfShape_1 === 'function' && oc.TopExp?.MapShapes_1) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = new oc.TopTools_IndexedMapOfShape_1() as any;
    try {
      oc.TopExp.MapShapes_1(rawShape, shapeType, map);
      const count: number = map.Extent();
      for (let i = 1; i <= count; i++) {
        const shape = map.FindKey_1(i);
        try {
          wrapShape(shape);
        } finally {
          shape.delete?.();
        }
      }
    } finally {
      map.delete();
    }
    return;
  }

  // Fallback: raw explorer (no dedup).
  const explorer = new oc.TopExp_Explorer_2(rawShape, shapeType, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    while (explorer.More()) {
      const shape = explorer.Current();
      try {
        wrapShape(shape);
      } finally {
        shape.delete();
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
