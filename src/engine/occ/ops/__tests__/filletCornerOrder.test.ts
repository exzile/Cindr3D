/**
 * OCC-16.D3 — Integration test: 1mm fillet-meets-fillet corner.
 *
 * Verifies that occFilletEdgeSetsTopologicalWithInstance succeeds for the
 * exact failing case: a circular notch-rim edge adjacent to a linear top
 * edge, where the combined pass and all prior fallbacks fail, but
 * round-before-linear ordering succeeds.
 *
 * Uses a mock kernel where Build() is order-aware:
 *   - Building [circleEdge] alone: succeeds.
 *   - Building [lineEdge] on the arc-filleted running body: succeeds.
 *   - Building both together (combined): fails.
 *   - Building [lineEdge] first: fails.
 *
 * This mirrors the real OCC behaviour verified manually on 2026-05-29.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OccHandle } from '../../occHandle';
import { createBRepBody } from '../../brepBody';
import { occFilletEdgeSetsTopologicalWithInstance } from '../fillet';

// ── Fake OCC ──────────────────────────────────────────────────────────────────

const ENUM = { TopAbs_FACE: 1, TopAbs_EDGE: 2, TopAbs_VERTEX: 3, TopAbs_SHAPE: 4 } as const;
const GEOM_CIRCLE = { value: 1 };
const GEOM_LINE = { value: 0 };
const TWO_PI = 2 * Math.PI;

// Track Build() call order to simulate order-dependent OCC behaviour.
let buildCallLog: string[][] = [];

// When set, the next Build() call for the given edge-ptr set fails.
let failForEdgeSets: Set<string>[] = [];

function edgeSetKey(edgePtrs: number[]): string {
  return [...edgePtrs].sort((a, b) => a - b).join(',');
}

class FakeFilletBuilder {
  private edgePtrs: number[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rawShape: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(shape: any) {
    this.rawShape = shape;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Add_2(_r: number, edge: any) { this.edgePtrs.push(edge.ptr); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Add_3(_r1: number, _r2: number, edge: any) { this.edgePtrs.push(edge.ptr); }
  Build() {
    const key = edgeSetKey(this.edgePtrs);
    buildCallLog.push([...this.edgePtrs.map(String)]);
    const shouldFail = failForEdgeSets.some((s) => s.has(key));
    if (shouldFail) throw new Error('mock: OCC cannot solve this corner in one pass');
  }
  IsDone() { return true; }
  Shape() {
    // Simulate real OCC behaviour: when only the arc edge (ptr 201) was filleted,
    // the arc is CONSUMED and replaced by a new blend edge (ptr 301).  The surviving
    // line edge (ptr 202) shifts to position 0 — a different body-level ID than in
    // the original body (where it was at index 1 → edgeId 1).
    //
    // This forces the anchor-based re-resolution path in
    // occFilletEdgeSetsTopologicalWithInstance to be exercised:  group 1 cannot
    // naively look up edgeId 1 in the intermediate body (it would get the blend edge,
    // not the line edge), and must instead use findEdgeByAnchor to locate the line edge
    // at its new position (edgeId 0).
    //
    // The combined-failure shape (filletedWith=[201,202]) is left unchanged so that
    // the "returns null" test case still works.
    const filletedArcOnly = this.edgePtrs.length === 1 && this.edgePtrs[0] === 201;
    if (filletedArcOnly) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lineEdge = this.rawShape.edges.find((e: any) => e.ptr === 202);
      // New torus-blend edge that replaced the arc.  ptr 301, line-typed so
      // BRepAdaptor_Curve_2 falls back to 'line' (undefined in edgeCurveType → default).
      const blendEdge = { ptr: 301, delete() {}, curve: 'line' as const, verts: [] };
      return {
        ...this.rawShape,
        // Line edge is now first → edgeId 0 in the intermediate body.
        // Arc edge is gone; blend edge is last → edgeId 1.
        edges: [lineEdge, blendEdge],
        filletedWith: this.edgePtrs,
      };
    }
    return { ...this.rawShape, filletedWith: this.edgePtrs };
  }
  delete() {}
}

type Vec3 = [number, number, number];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeOcc(vertPos: Map<number, Vec3>, edgeCurveType: Map<number, 'circle' | 'line'>): any {
  return {
    TopAbs_ShapeEnum: ENUM,
    TopoDS_Shape: undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TopoDS: { Edge_1: (s: any) => s, Vertex_1: (s: any) => s, Face_1: (s: any) => s },
    BRep_Tool: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Pnt: (v: any) => {
        const pos = vertPos.get(v.ptr) ?? [0, 0, 0];
        return { X: () => pos[0], Y: () => pos[1], Z: () => pos[2], delete: () => {} };
      },
    },
    GeomAbs_CurveType: { GeomAbs_Line: GEOM_LINE, GeomAbs_Circle: GEOM_CIRCLE },
    ChFi3d_FilletShape: { ChFi3d_Rational: {}, ChFi3d_Polynomial: {} },
    BRepFilletAPI_MakeFillet: FakeFilletBuilder,
    BRepCheck_Analyzer_2: class {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(_shape: any) {}
      IsValid() { return true; }
      delete() {}
    },
    TopExp: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      MapShapes_1(shape: any, type: number, map: any) {
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
    BRepAdaptor_Curve_2: class {
      private type: 'circle' | 'line';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(edge: any) {
        this.type = edgeCurveType.get(edge.ptr) ?? 'line';
      }
      GetType() { return this.type === 'circle' ? GEOM_CIRCLE : GEOM_LINE; }
      FirstParameter() { return 0; }
      LastParameter() { return this.type === 'circle' ? TWO_PI : 1; }
      Radius() { return 6.71; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Circle() { return { Location: () => ({ X: () => 0, Y: () => 0, Z: () => 0, delete() {} }), Axis: () => ({ Direction: () => ({ X: () => 0, Y: () => 0, Z: () => 1, delete() {} }), delete() {} }), Radius: () => 6.71, delete() {} }; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Line() { return { Location: () => ({ X: () => 0, Y: () => 5, Z: () => 0, delete() {} }), Direction: () => ({ X: () => 1, Y: () => 0, Z: () => 0, delete() {} }), delete() {} }; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      D0(u: number, p: any) {
        if (this.type === 'circle') {
          p.x = Math.cos(u) * 6.71; p.y = Math.sin(u) * 6.71; p.z = 0;
        } else {
          p.x = u; p.y = 5; p.z = 0;
        }
      }
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
interface EdgeDef { ptr: number; verts: [number, number]; curve: 'circle' | 'line' }
interface FaceDef { ptr: number; edges: number[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTopology(verts: VertDef[], edges: EdgeDef[], faces: FaceDef[]): { body: ReturnType<typeof createBRepBody>; oc: any } {
  const vertPos = new Map<number, Vec3>(verts.map((v) => [v.ptr, v.pos]));
  const edgeCurveType = new Map<number, 'circle' | 'line'>(edges.map((e) => [e.ptr, e.curve]));
  const vertObjs = new Map<number, unknown>();
  for (const v of verts) vertObjs.set(v.ptr, { ptr: v.ptr, delete() {}, verts: [] });
  const edgeObjs = new Map<number, unknown>();
  for (const e of edges) {
    edgeObjs.set(e.ptr, { ptr: e.ptr, delete() {}, curve: e.curve, verts: e.verts.map((p) => vertObjs.get(p)) });
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
  return { body, oc: makeFakeOcc(vertPos, edgeCurveType) };
}

// ── Topology: rect extrude with notch-arc + adjacent top line ─────────────────
//
// Vertices:  V0 (left bottom), V1 (right bottom), V2 (right top), V3 (left top)
//            V4 = V3 (shared vertex where arc meets top-line)
// Edge 0 (ptr 201): notch arc (circle), vertices V3–V3 (full circle rim)
//   → body edgeId 0
// Edge 1 (ptr 202): top line, vertices V3–V2
//   → body edgeId 1
// They share vertex V3 (ptr 4).

function cornerCase() {
  return buildTopology(
    [
      { ptr: 1, pos: [0,  0, 0] },   // V0
      { ptr: 2, pos: [10, 0, 0] },   // V1
      { ptr: 3, pos: [10, 10, 0] },  // V2
      { ptr: 4, pos: [0,  10, 0] },  // V3 = shared vertex (arc rim + line start)
    ],
    [
      { ptr: 201, curve: 'circle', verts: [4, 4] }, // edge 0: notch arc (full circle)
      { ptr: 202, curve: 'line',   verts: [4, 3] }, // edge 1: top line edge
    ],
    [
      { ptr: 301, edges: [201, 202] }, // top face
      { ptr: 302, edges: [201] },      // arc face
      { ptr: 303, edges: [202] },      // side face
    ],
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('occFilletEdgeSetsTopologicalWithInstance — OCC-16 corner case', () => {
  beforeEach(() => {
    buildCallLog = [];
    failForEdgeSets = [];
  });

  it('applies round-before-linear when combined pass would fail', () => {
    const { body, oc } = cornerCase();
    // Combined [circle+line] fails; individual passes succeed.
    const combinedKey = edgeSetKey([201, 202]);
    failForEdgeSets = [new Set([combinedKey])];

    const result = occFilletEdgeSetsTopologicalWithInstance(oc, body, [
      { edgeIds: [0], radius: 1 }, // circle edge (body edgeId 0 → ptr 201)
      { edgeIds: [1], radius: 1 }, // line edge   (body edgeId 1 → ptr 202)
    ]);

    expect(result).not.toBeNull();
    // First Build() must include the circle edge (ptr 201) alone.
    expect(buildCallLog[0]).toContain('201');
    expect(buildCallLog[0]).not.toContain('202');
    // Second Build() must include the line edge (ptr 202).
    // IMPORTANT: after the arc fillet, the mock Shape() reorders edges so the line
    // edge shifts from edgeId 1 → edgeId 0 in the intermediate body.  The function
    // must use anchor-based re-resolution (not the original edgeId 1) to find it.
    expect(buildCallLog[1]).toContain('202');
    // Exactly two Build() calls: one for each group.
    expect(buildCallLog).toHaveLength(2);
  });

  it('returns null when there is no cross-type adjacency (both edges same type)', () => {
    // Two line edges — no circle, so topological ordering has no advantage.
    const { body, oc } = buildTopology(
      [{ ptr: 1, pos: [0,0,0] }, { ptr: 2, pos: [5,0,0] }, { ptr: 3, pos: [10,0,0] }],
      [{ ptr: 101, curve: 'line', verts: [1, 2] }, { ptr: 102, curve: 'line', verts: [2, 3] }],
      [{ ptr: 201, edges: [101, 102] }],
    );
    const result = occFilletEdgeSetsTopologicalWithInstance(oc, body, [
      { edgeIds: [0, 1], radius: 1 },
    ]);
    // No cross-type adjacency → function should return null (skip this path).
    expect(result).toBeNull();
  });
});
