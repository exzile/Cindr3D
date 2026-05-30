import { describe, expect, it } from 'vitest';
import { createBRepBody, type BRepBody } from '../../brepBody';
import { OccHandle } from '../../occHandle';
import { getSelectableEdges } from '../selectableEdges';

// ── Fake OCC kernel ────────────────────────────────────────────────────────────
// Mirrors the subset of opencascade.js that selectableEdges + adjacency touch:
// MapShapes / IndexedMap (FindIndex/FindKey/Extent), TopExp_Explorer, BRepAdaptor
// curve classification (GetType/Circle/First-LastParameter/D0), gp_Pnt, TopoDS casts.
// occDeref returns handle._object directly because the fake oc has no wrapPointer.

type Vec3 = [number, number, number];

interface VertDef { ptr: number; pos: Vec3 }
interface EdgeDef {
  ptr: number;
  curve: 'line' | 'circle';
  verts: [number, number];
  radius?: number;
  first: number;
  last: number;
  point: (u: number) => Vec3;
}
interface FaceDef { ptr: number; edges: number[] }

const ENUM = {
  TopAbs_FACE: 1,
  TopAbs_EDGE: 2,
  TopAbs_VERTEX: 3,
  TopAbs_SHAPE: 4,
} as const;

const GEOM = {
  GeomAbs_Line: { value: 0 },
  GeomAbs_Circle: { value: 1 },
  GeomAbs_Ellipse: { value: 2 },
  GeomAbs_BSplineCurve: { value: 6 },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeOcc(): any {
  const oc = {
    TopAbs_ShapeEnum: ENUM,
    GeomAbs_CurveType: GEOM,
    TopoDS_Shape: undefined,
    TopoDS_Edge: undefined,
    TopoDS: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Edge_1: (s: any) => s,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Vertex_1: (s: any) => s,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Face_1: (s: any) => s,
    },
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
      Current() { const s = this.items[this.i]; return { ptr: s.ptr, delete() { /* view */ } }; }
      Next() { this.i += 1; }
      delete() { /* owned but no-op for the fake */ }
    },
    TopTools_IndexedMapOfShape_1: class {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _populate(items: any[]) {
        const seen = new Set<number>();
        for (const it of items) {
          if (!seen.has(it.ptr)) { seen.add(it.ptr); this.items.push(it); }
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      FindIndex(shape: any) { return this.items.findIndex((it) => it.ptr === shape.ptr) + 1; }
      FindKey(idx: number) { return this.items[idx - 1]; }
      Extent() { return this.items.length; }
      delete() { /* owned but no-op for the fake */ }
    },
    BRepAdaptor_Curve_2: class {
      private def: EdgeDef;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(edge: any) { this.def = edge.def; }
      GetType() {
        return this.def.curve === 'circle' ? GEOM.GeomAbs_Circle
          : this.def.curve === 'line' ? GEOM.GeomAbs_Line
            : GEOM.GeomAbs_BSplineCurve;
      }
      FirstParameter() { return this.def.first; }
      LastParameter() { return this.def.last; }
      Circle() { const r = this.def.radius ?? 0; return { Radius() { return r; }, delete() {} }; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      D0(u: number, p: any) { const [x, y, z] = this.def.point(u); p._set(x, y, z); }
      delete() { /* owned but no-op for the fake */ }
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

function makeBody(verts: VertDef[], edges: EdgeDef[], faces: FaceDef[]): BRepBody {
  const vertObjs = new Map<number, unknown>();
  for (const v of verts) vertObjs.set(v.ptr, { ptr: v.ptr, kind: 'vertex', delete() {} });

  const edgeObjs = new Map<number, unknown>();
  for (const e of edges) {
    edgeObjs.set(e.ptr, {
      ptr: e.ptr,
      kind: 'edge',
      def: e,
      verts: e.verts.map((vp) => vertObjs.get(vp)),
      delete() {},
    });
  }

  const faceObjs = new Map<number, unknown>();
  for (const f of faces) {
    faceObjs.set(f.ptr, {
      ptr: f.ptr,
      kind: 'face',
      edges: f.edges.map((ep) => edgeObjs.get(ep)),
      delete() {},
    });
  }

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

  return createBRepBody({ shape, edgeIds, faceIds, vertexIds });
}

function lineEdge(ptr: number, a: VertDef, b: VertDef): EdgeDef {
  const dx = b.pos[0] - a.pos[0], dy = b.pos[1] - a.pos[1], dz = b.pos[2] - a.pos[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const dir: Vec3 = [dx / len, dy / len, dz / len];
  return {
    ptr,
    curve: 'line',
    verts: [a.ptr, b.ptr],
    first: 0,
    last: len,
    point: (u) => [a.pos[0] + dir[0] * u, a.pos[1] + dir[1] * u, a.pos[2] + dir[2] * u],
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function buildBox(): BRepBody {
  // Unit cube: 8 vertices, 12 edges, 6 faces (each edge shared by exactly 2 faces).
  const v: VertDef[] = [
    { ptr: 1, pos: [0, 0, 0] }, { ptr: 2, pos: [1, 0, 0] },
    { ptr: 3, pos: [1, 1, 0] }, { ptr: 4, pos: [0, 1, 0] },
    { ptr: 5, pos: [0, 0, 1] }, { ptr: 6, pos: [1, 0, 1] },
    { ptr: 7, pos: [1, 1, 1] }, { ptr: 8, pos: [0, 1, 1] },
  ];
  const e: EdgeDef[] = [
    lineEdge(101, v[0], v[1]), // e0: v1-v2
    lineEdge(102, v[1], v[2]), // e1: v2-v3
    lineEdge(103, v[2], v[3]), // e2: v3-v4
    lineEdge(104, v[3], v[0]), // e3: v4-v1
    lineEdge(105, v[4], v[5]), // e4: v5-v6
    lineEdge(106, v[5], v[6]), // e5: v6-v7
    lineEdge(107, v[6], v[7]), // e6: v7-v8
    lineEdge(108, v[7], v[4]), // e7: v8-v5
    lineEdge(109, v[0], v[4]), // e8: v1-v5
    lineEdge(110, v[1], v[5]), // e9: v2-v6
    lineEdge(111, v[2], v[6]), // e10: v3-v7
    lineEdge(112, v[3], v[7]), // e11: v4-v8
  ];
  const f: FaceDef[] = [
    { ptr: 201, edges: [101, 102, 103, 104] }, // bottom
    { ptr: 202, edges: [105, 106, 107, 108] }, // top
    { ptr: 203, edges: [101, 110, 105, 109] }, // front (y=0)
    { ptr: 204, edges: [102, 111, 106, 110] }, // right (x=1)
    { ptr: 205, edges: [103, 112, 107, 111] }, // back (y=1)
    { ptr: 206, edges: [104, 109, 108, 112] }, // left (x=0)
  ];
  return makeBody(v, e, f);
}

function buildCylinder(radius: number): BRepBody {
  // Lateral + top + bottom face; top circle, bottom circle, vertical seam line.
  const vTop: VertDef = { ptr: 11, pos: [radius, 0, 1] };
  const vBot: VertDef = { ptr: 12, pos: [radius, 0, 0] };
  const verts = [vTop, vBot];

  const topCircle: EdgeDef = {
    ptr: 21, curve: 'circle', verts: [11, 11], radius, first: 0, last: Math.PI * 2,
    point: (u) => [radius * Math.cos(u), radius * Math.sin(u), 1],
  };
  const bottomCircle: EdgeDef = {
    ptr: 22, curve: 'circle', verts: [12, 12], radius, first: 0, last: Math.PI * 2,
    point: (u) => [radius * Math.cos(u), radius * Math.sin(u), 0],
  };
  const seam: EdgeDef = lineEdge(23, vBot, vTop);

  const edges = [topCircle, bottomCircle, seam];
  const faces: FaceDef[] = [
    { ptr: 31, edges: [21, 22, 23] }, // lateral
    { ptr: 32, edges: [21] },          // top cap
    { ptr: 33, edges: [22] },          // bottom cap
  ];
  return makeBody(verts, edges, faces);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('getSelectableEdges', () => {
  it('never invents or drops edge ids — keys exactly match body.edgeIds', () => {
    const oc = makeFakeOcc();
    const box = buildBox();
    const meta = getSelectableEdges(oc, box);

    expect(meta.size).toBe(box.edgeIds.size);
    expect([...meta.keys()].sort((a, b) => a - b)).toEqual([...box.edgeIds.keys()].sort((a, b) => a - b));
    for (const id of meta.keys()) expect(box.edgeIds.has(id)).toBe(true);
  });

  it('classifies a box as 12 filletable line edges with distinct tangent chains', () => {
    const oc = makeFakeOcc();
    const box = buildBox();
    const meta = getSelectableEdges(oc, box);

    expect(meta.size).toBe(12);
    for (const m of meta.values()) {
      expect(m.kind).toBe('line');
      expect(m.filletable).toBe(true);
      expect(m.adjacentFaceIds.length).toBe(2);
      expect(m.radius).toBeUndefined();
    }
    // Perpendicular edges at every vertex → no tangent links → 12 distinct chains.
    const chainIds = new Set([...meta.values()].map((m) => m.chainId));
    expect(chainIds.size).toBe(12);
  });

  it('marks cylinder caps as filletable circles and the seam as non-filletable', () => {
    const oc = makeFakeOcc();
    const radius = 5;
    const cyl = buildCylinder(radius);
    const meta = getSelectableEdges(oc, cyl);

    expect(meta.size).toBe(3);

    const top = meta.get(0)!;
    const bottom = meta.get(1)!;
    const seam = meta.get(2)!;

    expect(top.kind).toBe('circle');
    expect(top.filletable).toBe(true);
    expect(top.adjacentFaceIds.length).toBe(2);
    expect(top.radius).toBeCloseTo(radius);

    expect(bottom.kind).toBe('circle');
    expect(bottom.filletable).toBe(true);
    expect(bottom.radius).toBeCloseTo(radius);

    expect(seam.kind).toBe('seam');
    expect(seam.filletable).toBe(false);
    expect(seam.adjacentFaceIds.length).toBe(1);
  });

  it('memoizes per body revision and recomputes after invalidation', () => {
    const oc = makeFakeOcc();
    const box = buildBox();
    const first = getSelectableEdges(oc, box);
    const second = getSelectableEdges(oc, box);
    expect(second).toBe(first); // same revision → cached instance

    box.revision += 1;
    const third = getSelectableEdges(oc, box);
    expect(third).not.toBe(first); // revision bump → recompute
    expect(third.size).toBe(first.size);
  });
});
