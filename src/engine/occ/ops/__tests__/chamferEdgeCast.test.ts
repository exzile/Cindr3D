/**
 * Regression: occChamferWithInstance must cast each edge to a TopoDS_Edge via
 * TopoDS.Edge_1 before handing it to BRepFilletAPI_MakeChamfer.Add_2.
 *
 * The bug (fixed 2026-05-30): the chamfer derefed the stored handle as
 * `oc.TopoDS_Edge`, which in the WASM build yields a TopoDS_Shape. Add_2 then
 * threw a BindingError ("Expected ... TopoDS_Edge, got an instance of
 * TopoDS_Shape") for EVERY edge, so all chamfers silently returned null — the
 * user saw "OCC operation failed" on every chamfer, even a plain box edge.
 *
 * This mock tags the object returned by TopoDS.Edge_1 and makes Add_2 reject any
 * edge that was NOT produced by that cast — exactly what real embind does. If the
 * cast is ever dropped again, Add_2 throws → chamfer returns null → test fails.
 */
import { describe, it, expect } from 'vitest';
import { OccHandle } from '../../occHandle';
import { createBRepBody } from '../../brepBody';
import { occChamferWithInstance } from '../chamfer';

const ENUM = { TopAbs_FACE: 1, TopAbs_EDGE: 2, TopAbs_VERTEX: 3, TopAbs_SHAPE: 4 } as const;

/** Records the edges Add_* received and whether each was Edge_1-cast. */
let addedEdgeWasCast: boolean[] = [];
/** Records whether the reference face passed to Add_3 / AddDA was Face_1-cast. */
let addedFaceWasCast: boolean[] = [];

// embind's strict type check: the chamfer API only accepts a real TopoDS_Edge /
// TopoDS_Face, which in this mock are the objects produced by TopoDS.Edge_1 /
// TopoDS.Face_1 (tagged __edge1 / __face1). A raw TopoDS_Shape (occDeref without
// the cast) is rejected — exactly as the WASM build does.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assertEdge(edge: any) {
  if (!edge || edge.__edge1 !== true) {
    throw new Error('BindingError: Expected null or instance of TopoDS_Edge, got an instance of TopoDS_Shape');
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assertFace(face: any) {
  if (!face || face.__face1 !== true) {
    throw new Error('BindingError: Expected null or instance of TopoDS_Face, got an instance of TopoDS_Shape');
  }
}

class FakeChamferBuilder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rawShape: any;
  private edgePtrs: number[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(shape: any) { this.rawShape = shape; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Add_2(_d: number, edge: any) {
    assertEdge(edge);
    addedEdgeWasCast.push(true);
    this.edgePtrs.push(edge.ptr);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Add_3(_d1: number, _d2: number, edge: any, face: any) {
    assertEdge(edge);
    assertFace(face);
    addedEdgeWasCast.push(true);
    addedFaceWasCast.push(true);
    this.edgePtrs.push(edge.ptr);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AddDA(_d: number, _ang: number, edge: any, face: any) {
    assertEdge(edge);
    assertFace(face);
    addedEdgeWasCast.push(true);
    addedFaceWasCast.push(true);
    this.edgePtrs.push(edge.ptr);
  }
  Build() { /* succeeds */ }
  IsDone() { return true; }
  Shape() { return { ...this.rawShape, chamferedWith: this.edgePtrs }; }
  delete() {}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeOcc(): any {
  return {
    TopAbs_ShapeEnum: ENUM,
    TopoDS_Shape: undefined,
    TopoDS_Edge: undefined,
    TopoDS_Face: undefined,
    // Edge_1 is the cast that produces a real TopoDS_Edge — tag it so Add_2 can
    // verify the chamfer went through the cast (and not the raw deref).
    // Edge_1 / Face_1 are the casts that produce a real TopoDS_Edge / TopoDS_Face —
    // tag them so Add_2/Add_3/AddDA can verify the chamfer went through the cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TopoDS: { Edge_1: (s: any) => ({ ...s, __edge1: true }), Face_1: (s: any) => ({ ...s, __face1: true }), Vertex_1: (s: any) => s },
    BRepFilletAPI_MakeChamfer: FakeChamferBuilder,
    TopExp: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      MapShapes_1(shape: any, type: number, map: any) {
        const items = type === ENUM.TopAbs_EDGE ? shape.edges : type === ENUM.TopAbs_VERTEX ? shape.verts : shape.faces;
        map._populate(items ?? []);
      },
    },
    TopExp_Explorer_2: class {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      private items: any[]; private i = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(shape: any, toFind: number) {
        this.items = toFind === ENUM.TopAbs_EDGE ? (shape.edges ?? [])
          : toFind === ENUM.TopAbs_VERTEX ? (shape.verts ?? []) : (shape.faces ?? []);
      }
      More() { return this.i < this.items.length; }
      Current() { const it = this.items[this.i]; return { ...it, delete() {} }; }
      Next() { this.i += 1; }
      delete() {}
    },
    TopTools_IndexedMapOfShape_1: class {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _populate(items: any[]) {
        const seen = new Set<number>();
        for (const it of items) if (!seen.has(it.ptr)) { seen.add(it.ptr); this.items.push(it); }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      FindIndex(shape: any) { return this.items.findIndex((it) => it.ptr === shape.ptr) + 1; }
      FindIndex_1(shape: { ptr: number }) { return this.items.findIndex((it) => it.ptr === shape.ptr) + 1; }
      FindKey(idx: number) { return this.items[idx - 1]; }
      Extent() { return this.items.length; }
      delete() {}
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildBoxEdgeBody(): { body: ReturnType<typeof createBRepBody>; oc: any } {
  // One line edge (ptr 500) shared by two faces (ptr 600, 601) → 2 adjacent faces,
  // so the seam/boundary guard does NOT skip it.
  const v1 = { ptr: 1, delete() {}, verts: [] };
  const v2 = { ptr: 2, delete() {}, verts: [] };
  const edge = { ptr: 500, delete() {}, curve: 'line' as const, verts: [v1, v2] };
  const face0 = { ptr: 600, delete() {}, edges: [edge] };
  const face1 = { ptr: 601, delete() {}, edges: [edge] };
  const bodyShape = { ptr: 9999, delete() {}, faces: [face0, face1], edges: [edge], verts: [v1, v2] };
  const shape = new OccHandle(9999, 'TopoDS_Shape', () => {}, bodyShape);
  const edgeIds = new Map<number, OccHandle<unknown>>([[0, new OccHandle(500, 'TopoDS_Edge', () => {}, edge)]]);
  const faceIds = new Map<number, OccHandle<unknown>>([
    [0, new OccHandle(600, 'TopoDS_Face', () => {}, face0)],
    [1, new OccHandle(601, 'TopoDS_Face', () => {}, face1)],
  ]);
  const vertexIds = new Map<number, OccHandle<unknown>>([
    [0, new OccHandle(1, 'TopoDS_Vertex', () => {}, v1)],
    [1, new OccHandle(2, 'TopoDS_Vertex', () => {}, v2)],
  ]);
  const body = createBRepBody({ shape, edgeIds, faceIds, vertexIds });
  return { body, oc: makeFakeOcc() };
}

describe('occChamferWithInstance — edge/face cast to TopoDS_Edge/TopoDS_Face', () => {
  it('equal-distance: feeds Add_2 an Edge_1-cast edge (not a raw shape)', () => {
    addedEdgeWasCast = [];
    addedFaceWasCast = [];
    const { body, oc } = buildBoxEdgeBody();
    const result = occChamferWithInstance(oc, body, [0], 0.5, { sourceFeatureId: 'test' });
    // The chamfer must succeed — the bug made this null for every edge.
    expect(result).not.toBeNull();
    // Add_2 must have received exactly one edge, and it must have been Edge_1-cast.
    expect(addedEdgeWasCast).toEqual([true]);
  });

  it('two-distance: feeds Add_3 an Edge_1-cast edge AND a Face_1-cast reference face', () => {
    addedEdgeWasCast = [];
    addedFaceWasCast = [];
    const { body, oc } = buildBoxEdgeBody();
    const result = occChamferWithInstance(oc, body, [0], 0.5, { distance2: 0.3, sourceFeatureId: 'test' });
    // Without the TopoDS.Face_1 cast, Add_3 throws a BindingError → null result.
    expect(result).not.toBeNull();
    expect(addedEdgeWasCast).toEqual([true]);
    expect(addedFaceWasCast).toEqual([true]);
  });

  it('distance-and-angle: feeds AddDA an Edge_1-cast edge AND a Face_1-cast reference face', () => {
    addedEdgeWasCast = [];
    addedFaceWasCast = [];
    const { body, oc } = buildBoxEdgeBody();
    const result = occChamferWithInstance(oc, body, [0], 0.5, { angle: 30, sourceFeatureId: 'test' });
    expect(result).not.toBeNull();
    expect(addedEdgeWasCast).toEqual([true]);
    expect(addedFaceWasCast).toEqual([true]);
  });
});
