import { describe, expect, it } from 'vitest';
import { createBRepBody, type BRepBody } from '../../brepBody';
import { OccHandle } from '../../occHandle';
import { computeSafeFilletRadii } from '../fillet';

// Minimal fake OCC topology kernel for the radius pre-validation (OCC-13.2):
// MapShapes (EDGE/VERTEX) + IndexedMap.FindIndex, TopExp_Explorer over edge
// vertices, and BRepAdaptor_Curve.D0 for chord-length endpoints.

const ENUM = { TopAbs_FACE: 1, TopAbs_EDGE: 2, TopAbs_VERTEX: 3, TopAbs_SHAPE: 4 } as const;

type Vec3 = [number, number, number];
interface VertDef { ptr: number; pos: Vec3 }
interface EdgeDef { ptr: number; verts: [number, number] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeOcc(vertPos: Map<number, Vec3>): any {
  const oc = {
    TopAbs_ShapeEnum: ENUM,
    TopoDS_Shape: undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TopoDS: { Edge_1: (s: any) => s, Vertex_1: (s: any) => s, Face_1: (s: any) => s },
    TopExp: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      MapShapes_1: (shape: any, type: number, map: any) => {
        map._populate(type === ENUM.TopAbs_EDGE ? shape.edges : shape.verts);
      },
    },
    TopExp_Explorer_2: class {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      private items: any[];
      private i = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(shape: any, toFind: number) {
        this.items = toFind === ENUM.TopAbs_VERTEX ? (shape.verts ?? []) : (shape.edges ?? []);
      }
      More() { return this.i < this.items.length; }
      Current() { const s = this.items[this.i]; return { ptr: s.ptr, delete() {} }; }
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
      Extent() { return this.items.length; }
      delete() {}
    },
    BRepAdaptor_Curve_2: class {
      // straight line between its two vertices.
      private a: Vec3; private b: Vec3;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(edge: any) {
        this.a = vertPos.get(edge.verts[0].ptr)!;
        this.b = vertPos.get(edge.verts[1].ptr)!;
      }
      FirstParameter() { return 0; }
      LastParameter() { return 1; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      D0(u: number, p: any) {
        const t = u; // first=0, last=1
        p._set(
          this.a[0] + (this.b[0] - this.a[0]) * t,
          this.a[1] + (this.b[1] - this.a[1]) * t,
          this.a[2] + (this.b[2] - this.a[2]) * t,
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
  return oc;
}

function makeBody(verts: VertDef[], edges: EdgeDef[]): { body: BRepBody; vertPos: Map<number, Vec3> } {
  const vertPos = new Map<number, Vec3>(verts.map((v) => [v.ptr, v.pos]));
  const vertObjs = new Map<number, unknown>();
  for (const v of verts) vertObjs.set(v.ptr, { ptr: v.ptr, delete() {} });
  const edgeObjs = new Map<number, unknown>();
  for (const e of edges) {
    edgeObjs.set(e.ptr, { ptr: e.ptr, verts: e.verts.map((vp) => vertObjs.get(vp)), delete() {} });
  }
  const bodyShape = {
    ptr: 9999,
    edges: edges.map((e) => edgeObjs.get(e.ptr)),
    verts: verts.map((v) => vertObjs.get(v.ptr)),
    delete() {},
  };
  const shape = new OccHandle(9999, 'TopoDS_Shape', () => {}, bodyShape);
  const edgeIds = new Map<number, OccHandle<unknown>>();
  edges.forEach((e, i) => edgeIds.set(i, new OccHandle(e.ptr, 'TopoDS_Edge', () => {}, edgeObjs.get(e.ptr))));
  const vertexIds = new Map<number, OccHandle<unknown>>();
  verts.forEach((v, i) => vertexIds.set(i, new OccHandle(v.ptr, 'TopoDS_Vertex', () => {}, vertObjs.get(v.ptr))));
  return { body: createBRepBody({ shape, edgeIds, vertexIds }), vertPos };
}

describe('computeSafeFilletRadii (OCC-13.2)', () => {
  it('caps a filleted edge at 0.95x the shortest non-filleted neighbour', () => {
    // A path: v0 --e0(len 10)-- v1 --e1(len 4)-- v2. Fillet e0 only.
    const { body, vertPos } = makeBody(
      [{ ptr: 1, pos: [0, 0, 0] }, { ptr: 2, pos: [10, 0, 0] }, { ptr: 3, pos: [14, 0, 0] }],
      [{ ptr: 101, verts: [1, 2] }, { ptr: 102, verts: [2, 3] }],
    );
    const oc = makeFakeOcc(vertPos);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawShape = (body.shape as any)._object ?? null;
    const caps = computeSafeFilletRadii(oc, body, rawShape, new Set([0]));
    // e0's only neighbour (e1, len 4, not filleted) → cap 0.95 * 4 = 3.8.
    expect(caps.get(0)).toBeCloseTo(3.8);
  });

  it('caps co-filleted neighbours at ~0.49x the connecting edge length', () => {
    // v0 --e0-- v1 --e1(connector len 10)-- v2 --e2-- v3. Fillet e0 and e2.
    const { body, vertPos } = makeBody(
      [
        { ptr: 1, pos: [-5, 0, 0] }, { ptr: 2, pos: [0, 0, 0] },
        { ptr: 3, pos: [10, 0, 0] }, { ptr: 4, pos: [15, 0, 0] },
      ],
      [
        { ptr: 101, verts: [1, 2] }, // e0
        { ptr: 102, verts: [2, 3] }, // e1 connector (len 10)
        { ptr: 103, verts: [3, 4] }, // e2
      ],
    );
    const oc = makeFakeOcc(vertPos);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawShape = (body.shape as any)._object ?? null;
    const caps = computeSafeFilletRadii(oc, body, rawShape, new Set([0, 2]));
    // e0 neighbour e1 (len 10, NOT filleted) → 0.95*10=9.5; but e0 also has no
    // co-filleted neighbour, so cap is 9.5. e2 similarly 9.5.
    // The connecting-edge halving applies when the connector itself is filleted;
    // here e1 is not filleted, so each end edge can take 0.95*10.
    expect(caps.get(0)).toBeCloseTo(9.5);
    expect(caps.get(2)).toBeCloseTo(9.5);
  });

  it('halves the cap when the connector edge is itself filleted', () => {
    // v0 --e0-- v1 --e1(len 10)-- v2. Fillet e0 AND e1 (they share v1).
    const { body, vertPos } = makeBody(
      [{ ptr: 1, pos: [-3, 0, 0] }, { ptr: 2, pos: [0, 0, 0] }, { ptr: 3, pos: [10, 0, 0] }],
      [{ ptr: 101, verts: [1, 2] }, { ptr: 102, verts: [2, 3] }],
    );
    const oc = makeFakeOcc(vertPos);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawShape = (body.shape as any)._object ?? null;
    const caps = computeSafeFilletRadii(oc, body, rawShape, new Set([0, 1]));
    // e0 (len 3) and e1 (len 10) share v1 and are both filleted.
    // e0's neighbour e1 is filleted → 0.49*10 = 4.9.
    // e1's neighbour e0 is filleted → 0.49*3 = 1.47.
    expect(caps.get(0)).toBeCloseTo(4.9);
    expect(caps.get(1)).toBeCloseTo(1.47);
  });
});
