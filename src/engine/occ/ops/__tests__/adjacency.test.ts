/**
 * OCC-16.D1 — Unit tests for partitionEdgesByTopology and buildVertexEdgeMap helpers.
 * Uses mocked topology (no real OCC kernel) per the pattern in filletRequestedRadius.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { OccHandle } from '../../occHandle';
import { createBRepBody } from '../../brepBody';
import {
  buildVertexEdgeMap,
  edgesShareVertex,
  partitionEdgesByTopology,
} from '../adjacency';

// ── Minimal fake OCC for topology walks ──────────────────────────────────────

const ENUM = { TopAbs_FACE: 1, TopAbs_EDGE: 2, TopAbs_VERTEX: 3, TopAbs_SHAPE: 4 } as const;

type Vec3 = [number, number, number];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeOcc(vertPos: Map<number, Vec3>): any {
  return {
    TopAbs_ShapeEnum: ENUM,
    TopoDS_Shape: undefined,
    TopoDS_Edge: undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TopoDS: { Edge_1: (s: any) => s, Vertex_1: (s: any) => s, Face_1: (s: any) => s },
    BRep_Tool: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Pnt: (v: any) => {
        const pos = vertPos.get(v.ptr) ?? [0, 0, 0];
        return { X: () => pos[0], Y: () => pos[1], Z: () => pos[2], delete: () => {} };
      },
    },
    ChFi3d_FilletShape: { ChFi3d_Rational: {}, ChFi3d_Polynomial: {} },
    TopExp: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      MapShapes_1: (shape: any, type: number, map: any) => {
        const items =
          type === ENUM.TopAbs_EDGE ? shape.edges
          : type === ENUM.TopAbs_VERTEX ? shape.verts
          : shape.faces;
        map._populate(items ?? []);
      },
    },
    TopExp_Explorer_2: class {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      private items: any[];
      private i = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(shape: any, toFind: number) {
        this.items =
          toFind === ENUM.TopAbs_EDGE ? (shape.edges ?? [])
          : toFind === ENUM.TopAbs_VERTEX ? (shape.verts ?? [])
          : (shape.faces ?? []);
      }
      More() { return this.i < this.items.length; }
      Current() { return this.items[this.i]; }
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
    gp_Pnt_1: class {
      x = 0; y = 0; z = 0;
      X() { return this.x; } Y() { return this.y; } Z() { return this.z; }
      delete() {}
    },
  };
}

interface VertDef { ptr: number; pos: Vec3 }
interface EdgeDef { ptr: number; verts: [number, number] }
interface FaceDef { ptr: number; edges: number[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTopology(verts: VertDef[], edges: EdgeDef[], faces: FaceDef[]): { body: ReturnType<typeof createBRepBody>; oc: any } {
  const vertPos = new Map<number, Vec3>(verts.map((v) => [v.ptr, v.pos]));
  const vertObjs = new Map<number, unknown>();
  for (const v of verts) vertObjs.set(v.ptr, { ptr: v.ptr, delete() {}, verts: [] });
  const edgeObjs = new Map<number, unknown>();
  for (const e of edges) {
    edgeObjs.set(e.ptr, {
      ptr: e.ptr, delete() {},
      verts: e.verts.map((vp) => vertObjs.get(vp)),
    });
  }
  const faceObjs = new Map<number, unknown>();
  for (const f of faces) faceObjs.set(f.ptr, { ptr: f.ptr, delete() {}, edges: f.edges.map((ep) => edgeObjs.get(ep)) });
  const bodyShape = {
    ptr: 9999, delete() {},
    faces: faces.map((f) => faceObjs.get(f.ptr)),
    edges: edges.map((e) => edgeObjs.get(e.ptr)),
    verts: verts.map((v) => vertObjs.get(v.ptr)),
  };
  const shape = new OccHandle(9999, 'TopoDS_Shape', () => {}, bodyShape);
  const edgeIds = new Map<number, OccHandle<unknown>>();
  edges.forEach((e, i) => edgeIds.set(i, new OccHandle(e.ptr, 'TopoDS_Edge', () => {}, edgeObjs.get(e.ptr))));
  const faceIds = new Map<number, OccHandle<unknown>>();
  faces.forEach((f, i) => faceIds.set(i, new OccHandle(f.ptr, 'TopoDS_Face', () => {}, faceObjs.get(f.ptr))));
  const vertexIds = new Map<number, OccHandle<unknown>>();
  verts.forEach((v, i) => vertexIds.set(i, new OccHandle(v.ptr, 'TopoDS_Vertex', () => {}, vertObjs.get(v.ptr))));
  const body = createBRepBody({ shape, edgeIds, faceIds, vertexIds });
  const oc = makeFakeOcc(vertPos);
  return { body, oc };
}

// ── Test cases ────────────────────────────────────────────────────────────────

describe('buildVertexEdgeMap', () => {
  it('builds a vertex→edges map for two edges sharing a vertex', () => {
    // Edge 0: V0→V1, Edge 1: V1→V2  (V1 is shared)
    const { body, oc } = buildTopology(
      [{ ptr: 1, pos: [0, 0, 0] }, { ptr: 2, pos: [5, 0, 0] }, { ptr: 3, pos: [10, 0, 0] }],
      [{ ptr: 101, verts: [1, 2] }, { ptr: 102, verts: [2, 3] }],
      [{ ptr: 201, edges: [101, 102] }],
    );
    const map = buildVertexEdgeMap(oc, body);
    // V1 (ptr 2) is at [5,0,0] → key "5.000,0.000,0.000"
    const sharedKey = '5.000,0.000,0.000';
    expect(map.has(sharedKey)).toBe(true);
    expect(map.get(sharedKey)!.has(0)).toBe(true);  // edge 0
    expect(map.get(sharedKey)!.has(1)).toBe(true);  // edge 1
  });

  it('does not put non-adjacent edges in the same vertex bucket', () => {
    // Two disjoint edges sharing no vertex
    const { body, oc } = buildTopology(
      [{ ptr: 1, pos: [0,0,0] }, { ptr: 2, pos: [1,0,0] }, { ptr: 3, pos: [5,0,0] }, { ptr: 4, pos: [6,0,0] }],
      [{ ptr: 101, verts: [1, 2] }, { ptr: 102, verts: [3, 4] }],
      [{ ptr: 201, edges: [101] }, { ptr: 202, edges: [102] }],
    );
    const map = buildVertexEdgeMap(oc, body);
    for (const set of map.values()) {
      expect(set.has(0) && set.has(1)).toBe(false);
    }
  });
});

describe('edgesShareVertex', () => {
  it('returns true when two edges share a vertex', () => {
    const { body, oc } = buildTopology(
      [{ ptr: 1, pos: [0,0,0] }, { ptr: 2, pos: [5,0,0] }, { ptr: 3, pos: [10,0,0] }],
      [{ ptr: 101, verts: [1, 2] }, { ptr: 102, verts: [2, 3] }],
      [{ ptr: 201, edges: [101, 102] }],
    );
    const map = buildVertexEdgeMap(oc, body);
    expect(edgesShareVertex(map, 0, 1)).toBe(true);
  });

  it('returns false for non-adjacent edges', () => {
    const { body, oc } = buildTopology(
      [{ ptr: 1, pos: [0,0,0] }, { ptr: 2, pos: [1,0,0] }, { ptr: 3, pos: [5,0,0] }, { ptr: 4, pos: [6,0,0] }],
      [{ ptr: 101, verts: [1, 2] }, { ptr: 102, verts: [3, 4] }],
      [{ ptr: 201, edges: [101] }, { ptr: 202, edges: [102] }],
    );
    const map = buildVertexEdgeMap(oc, body);
    expect(edgesShareVertex(map, 0, 1)).toBe(false);
  });
});

describe('partitionEdgesByTopology', () => {
  it('identifies round and linear edges and their cross-type adjacency', () => {
    // edge 0 = circle (adjacent to edge 1 = line at shared vertex)
    const edgeKinds = new Map<number, string>([[0, 'circle'], [1, 'line']]);
    const vertexMap = new Map([['shared', new Set([0, 1])]]);
    const partition = partitionEdgesByTopology([0, 1], edgeKinds, vertexMap);
    expect(partition.round).toEqual([0]);
    expect(partition.linear).toEqual([1]);
    expect(partition.roundAdjacentToLinear).toEqual([0]);
    expect(partition.linearAdjacentToRound).toEqual([1]);
  });

  it('returns all linear with no adjacency when no round edges present', () => {
    const edgeKinds = new Map<number, string>([[0, 'line'], [1, 'line'], [2, 'line']]);
    const vertexMap = new Map([['v1', new Set([0, 1])]]);
    const partition = partitionEdgesByTopology([0, 1, 2], edgeKinds, vertexMap);
    expect(partition.round).toEqual([]);
    expect(partition.linear).toEqual([0, 1, 2]);
    expect(partition.roundAdjacentToLinear).toEqual([]);
    expect(partition.linearAdjacentToRound).toEqual([]);
  });

  it('includes arc in round partition', () => {
    const edgeKinds = new Map<number, string>([[0, 'arc'], [1, 'line']]);
    const vertexMap = new Map([['shared', new Set([0, 1])]]);
    const partition = partitionEdgesByTopology([0, 1], edgeKinds, vertexMap);
    expect(partition.round).toEqual([0]);
    expect(partition.roundAdjacentToLinear).toEqual([0]);
  });

  it('does not flag adjacency when edges do not share a vertex', () => {
    const edgeKinds = new Map<number, string>([[0, 'circle'], [1, 'line']]);
    // No shared vertex between 0 and 1
    const vertexMap = new Map([['v0a', new Set([0])], ['v0b', new Set([0])], ['v1a', new Set([1])]]);
    const partition = partitionEdgesByTopology([0, 1], edgeKinds, vertexMap);
    expect(partition.roundAdjacentToLinear).toEqual([]);
    expect(partition.linearAdjacentToRound).toEqual([]);
  });
});
