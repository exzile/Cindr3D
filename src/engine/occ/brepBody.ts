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
}

/** Reconstruct a typed OCC object from an OccHandle's raw pointer. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function occDeref(oc: OcctRaw, handle: OccHandle, ctor: any): any {
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

  // Walk faces
  const faceHandles: OccHandle[] = [];
  {
    const explorer = new oc.TopExp_Explorer_2(rawShape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (explorer.More()) {
      const s = explorer.Current();
      const face = oc.TopoDS.Face_1(s);
      s.delete();
      faceHandles.push(occWrap(face, 'TopoDS_Face'));
      explorer.Next();
    }
    explorer.delete();
  }

  // Walk edges
  const edgeHandles: OccHandle[] = [];
  {
    const explorer = new oc.TopExp_Explorer_2(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (explorer.More()) {
      const s = explorer.Current();
      const edge = oc.TopoDS.Edge_1(s);
      s.delete();
      edgeHandles.push(occWrap(edge, 'TopoDS_Edge'));
      explorer.Next();
    }
    explorer.delete();
  }

  // Walk vertices
  const vertexHandles: OccHandle[] = [];
  {
    const explorer = new oc.TopExp_Explorer_2(rawShape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (explorer.More()) {
      const s = explorer.Current();
      const vertex = oc.TopoDS.Vertex_1(s);
      s.delete();
      vertexHandles.push(occWrap(vertex, 'TopoDS_Vertex'));
      explorer.Next();
    }
    explorer.delete();
  }

  const faceAlloc = createBRepIdAllocator(0);
  const edgeAlloc = createBRepIdAllocator(0);
  const vertexAlloc = createBRepIdAllocator(0);

  const { ids: faceIds } = assignTopologyIds(faceHandles, faceAlloc);
  const { ids: edgeIds } = assignTopologyIds(edgeHandles, edgeAlloc);
  const { ids: vertexIds } = assignTopologyIds(vertexHandles, vertexAlloc);

  return createBRepBody({ ...options, shape: shapeHandle, faceIds, edgeIds, vertexIds });
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
