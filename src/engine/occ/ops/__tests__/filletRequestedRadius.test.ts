import { describe, expect, it, beforeEach } from 'vitest';
import { occFilletEdgeSetsWithInstance } from '../fillet';
import { createBRepBody, type BRepBody } from '../../brepBody';
import { OccHandle } from '../../occHandle';

// Integration-style fake for occFilletEdgeSetsWithInstance: topology walk
// (MapShapes / IndexedMap / explorer / BRepAdaptor) + a BRepFilletAPI_MakeFillet
// mock that records the radii passed to Add_2/Add_3 and can be told to fail Build()
// on the first attempt. Proves the two-attempt strategy:
//   1. requested radii are used verbatim when OCC builds (no silent cap);
//   2. clamped radii are used only as a retry after a hard Build() failure.

const ENUM = { TopAbs_FACE: 1, TopAbs_EDGE: 2, TopAbs_VERTEX: 3, TopAbs_SHAPE: 4 } as const;

type Vec3 = [number, number, number];

// Built per test.
let builders: FakeMakeFillet[] = [];
let buildFailQueue: boolean[] = [];

class FakeMakeFillet {
  radii: number[] = [];
  failBuild: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shape: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(shape: any) {
    this.shape = shape;
    this.failBuild = buildFailQueue.shift() ?? false;
    builders.push(this);
  }
  Add_2(r: number) { this.radii.push(r); }
  Add_3(r1: number, r2: number) { this.radii.push(r1, r2); }
  Build() { if (this.failBuild) throw new Error('mock Build failure'); }
  IsDone() { return !this.failBuild; }
  Shape() { return this.shape; }
  delete() {}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeOcc(vertPos: Map<number, Vec3>, resultShape: any): any {
  const oc = {
    TopAbs_ShapeEnum: ENUM,
    TopoDS_Shape: undefined,
    TopoDS_Edge: undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TopoDS: { Edge_1: (s: any) => s, Vertex_1: (s: any) => s, Face_1: (s: any) => s },
    ChFi3d_FilletShape: { ChFi3d_Rational: { v: 0 }, ChFi3d_QuasiAngular: { v: 1 }, ChFi3d_Polynomial: { v: 2 } },
    BRepFilletAPI_MakeFillet: FakeMakeFillet,
    TopExp: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      MapShapes_1: (shape: any, type: number, map: any) => {
        const items = type === ENUM.TopAbs_FACE ? shape.faces
          : type === ENUM.TopAbs_EDGE ? shape.edges
            : shape.verts;
        map._populate(items ?? []);
      },
    },
    TopExp_Explorer_2: class {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      private items: any[];
      private i = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(shape: any, toFind: number) {
        this.items = toFind === ENUM.TopAbs_EDGE ? (shape.edges ?? [])
          : toFind === ENUM.TopAbs_VERTEX ? (shape.verts ?? [])
            : (shape.faces ?? []);
      }
      More() { return this.i < this.items.length; }
      Current() { return this.items[this.i]; } // real object (has .edges/.verts, noop delete)
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
      FindKey(idx: number) { return this.items[idx - 1]; }
      Extent() { return this.items.length; }
      delete() {}
    },
    BRepAdaptor_Curve_2: class {
      private a: Vec3; private b: Vec3;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(edge: any) { this.a = vertPos.get(edge.verts[0].ptr)!; this.b = vertPos.get(edge.verts[1].ptr)!; }
      FirstParameter() { return 0; }
      LastParameter() { return 1; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      D0(u: number, p: any) {
        p._set(
          this.a[0] + (this.b[0] - this.a[0]) * u,
          this.a[1] + (this.b[1] - this.a[1]) * u,
          this.a[2] + (this.b[2] - this.a[2]) * u,
        );
      }
      delete() {}
    },
    gp_Pnt_1: class {
      x = 0; y = 0; z = 0;
      _set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; }
      X() { return this.x; } Y() { return this.y; } Z() { return this.z; }
      delete() {}
    },
  };
  void resultShape;
  return oc;
}

interface VertDef { ptr: number; pos: Vec3 }
interface EdgeDef { ptr: number; verts: [number, number] }
interface FaceDef { ptr: number; edges: number[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTopology(verts: VertDef[], edges: EdgeDef[], faces: FaceDef[]): { body: BRepBody; oc: any; bodyShape: any } {
  const vertPos = new Map<number, Vec3>(verts.map((v) => [v.ptr, v.pos]));
  const vertObjs = new Map<number, unknown>();
  for (const v of verts) vertObjs.set(v.ptr, { ptr: v.ptr, kind: 'vertex', delete() {} });
  const edgeObjs = new Map<number, unknown>();
  for (const e of edges) edgeObjs.set(e.ptr, { ptr: e.ptr, kind: 'edge', verts: e.verts.map((vp) => vertObjs.get(vp)), delete() {} });
  const faceObjs = new Map<number, unknown>();
  for (const f of faces) faceObjs.set(f.ptr, { ptr: f.ptr, kind: 'face', edges: f.edges.map((ep) => edgeObjs.get(ep)), delete() {} });
  const bodyShape = {
    ptr: 9999,
    kind: 'body',
    faces: faces.map((f) => faceObjs.get(f.ptr)),
    edges: edges.map((e) => edgeObjs.get(e.ptr)),
    verts: verts.map((v) => vertObjs.get(v.ptr)),
    delete() {},
  };
  const shape = new OccHandle(9999, 'TopoDS_Shape', () => {}, bodyShape);
  const edgeIds = new Map<number, OccHandle<unknown>>();
  edges.forEach((e, i) => edgeIds.set(i, new OccHandle(e.ptr, 'TopoDS_Edge', () => {}, edgeObjs.get(e.ptr))));
  const faceIds = new Map<number, OccHandle<unknown>>();
  faces.forEach((f, i) => faceIds.set(i, new OccHandle(f.ptr, 'TopoDS_Face', () => {}, faceObjs.get(f.ptr))));
  const vertexIds = new Map<number, OccHandle<unknown>>();
  verts.forEach((v, i) => vertexIds.set(i, new OccHandle(v.ptr, 'TopoDS_Vertex', () => {}, vertObjs.get(v.ptr))));
  const body = createBRepBody({ shape, edgeIds, faceIds, vertexIds });
  const oc = makeFakeOcc(vertPos, bodyShape);
  return { body, oc, bodyShape };
}

// Two co-filleted edges sharing vertex v2; each edge belongs to 2 faces so the
// seam guard keeps them. computeSafeFilletRadii caps both at 0.37*min(len)≈1.85.
function twoEdgeCorner() {
  return buildTopology(
    [{ ptr: 1, pos: [0, 0, 0] }, { ptr: 2, pos: [10, 0, 0] }, { ptr: 3, pos: [15, 0, 0] }],
    [{ ptr: 101, verts: [1, 2] }, { ptr: 102, verts: [2, 3] }], // e0 len 10, e1 len 5
    [{ ptr: 201, edges: [101, 102] }, { ptr: 202, edges: [101] }, { ptr: 203, edges: [102] }],
  );
}

describe('occFilletEdgeSetsWithInstance — requested-radius-first (OCC-13.2 revised)', () => {
  beforeEach(() => {
    builders = [];
    buildFailQueue = [];
  });

  it('uses the exact requested radius when OCC builds (no silent cap)', () => {
    const { body, oc } = twoEdgeCorner();
    // radius 4 exceeds the would-be clamp (~1.85). Build succeeds on attempt 1.
    const result = occFilletEdgeSetsWithInstance(oc, body, [{ edgeIds: [0, 1], radius: 4 }]);
    expect(result).not.toBeNull();
    expect(builders).toHaveLength(1); // only attempt 1 ran
    // Both edges added at the requested 4 — NOT the ~1.85 clamp.
    expect(builders[0].radii).toEqual([4, 4]);
  });

  it('falls back to clamped radii only after a hard Build() failure', () => {
    const { body, oc } = twoEdgeCorner();
    buildFailQueue = [true]; // first attempt fails, second succeeds
    const result = occFilletEdgeSetsWithInstance(oc, body, [{ edgeIds: [0, 1], radius: 4 }]);
    expect(result).not.toBeNull();
    expect(builders).toHaveLength(2);
    // Attempt 1 tried the requested radius...
    expect(builders[0].radii).toEqual([4, 4]);
    // ...attempt 2 clamped to the corner limit (~1.85, well under 4).
    for (const r of builders[1].radii) {
      expect(r).toBeLessThan(4);
      expect(r).toBeCloseTo(1.85, 2);
    }
  });

  it('returns null when both attempts fail', () => {
    const { body, oc } = twoEdgeCorner();
    buildFailQueue = [true, true];
    const result = occFilletEdgeSetsWithInstance(oc, body, [{ edgeIds: [0, 1], radius: 4 }]);
    expect(result).toBeNull();
    expect(builders).toHaveLength(2);
  });
});
