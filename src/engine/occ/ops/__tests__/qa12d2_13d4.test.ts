/**
 * OCC-12.D2 / OCC-13.4 — Programmatic QA verification.
 *
 * Covers the sub-items from the manual-QA checklists that can be expressed
 * as deterministic assertions against the mock kernel:
 *
 * OCC-12.D2:
 *  (3) Half-circle / D-notch arc is selectable as ONE edge (not segmented).
 *  (4) Arc chainId is isolated from adjacent line edges (no tangent cross-type bleed).
 *  (5) Fillet on an arc edge succeeds (Build() does not throw for circle curves).
 *  (7) getSelectableEdges works on an already-filleted body (circle + torus faces).
 *
 * OCC-13.4:
 *  (1) The 1mm corner case (arc → line at shared vertex) is resolved by the
 *      topological fallback (verified via OCC-16 D3 test + documented here).
 *  (2/3) isRollingBallCorner is accepted without error (ROUND-TRIP-ONLY).
 *        Setback documented as UNSUPPORTED in occ_fillet_chamfer_parity.md.
 *
 * Existing coverage (not duplicated here):
 *  OCC-12.D2 (1) box 12 edges → selectableEdges.test.ts:253
 *  OCC-12.D2 (2) cylinder seam not shown → selectableEdges.test.ts:270
 *  OCC-12.D2 (6) fillet on box edge → filletRequestedRadius.test.ts
 *  OCC-12.D2 (8) second fillet ordering → filletCornerOrder.test.ts (D3)
 *  OCC-13.4  (1) 1mm corner case → filletCornerOrder.test.ts (D3)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OccHandle } from '../../occHandle';
import { createBRepBody } from '../../brepBody';
import { getSelectableEdges } from '../selectableEdges';
import { occFilletEdgeSetsWithInstance } from '../fillet';
import { occFilletEdgeSetsTopologicalWithInstance } from '../fillet';

// ── Shared fake OCC ────────────────────────────────────────────────────────────

const ENUM = { TopAbs_FACE: 1, TopAbs_EDGE: 2, TopAbs_VERTEX: 3, TopAbs_SHAPE: 4 } as const;
const GEOM = { GeomAbs_Line: { value: 0 }, GeomAbs_Circle: { value: 1 } };
const TWO_PI = 2 * Math.PI;

type Vec3 = [number, number, number];
type CurveKind = 'line' | 'circle';

interface VertDef { ptr: number; pos: Vec3 }
interface EdgeDef { ptr: number; curve: CurveKind; verts: [number, number]; radius?: number }
interface FaceDef { ptr: number; edges: number[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildLog: number[][] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildShouldFail = false;

class FakeFilletBuilder {
  private ptrs: number[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private shape: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(shape: any) { this.shape = shape; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Add_2(_r: number, edge: any) { this.ptrs.push(edge.ptr); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Add_3(_r1: number, _r2: number, edge: any) { this.ptrs.push(edge.ptr); }
  Build() {
    buildLog.push([...this.ptrs]);
    if (buildShouldFail) throw new Error('mock: Build() cannot solve this edge');
  }
  IsDone() { return !buildShouldFail; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Shape() { return { ...this.shape, filletedWith: this.ptrs }; }
  delete() {}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeOcc(): any {
  return {
    TopAbs_ShapeEnum: ENUM,
    TopoDS_Shape: undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TopoDS: { Edge_1: (s: any) => s, Vertex_1: (s: any) => s, Face_1: (s: any) => s },
    BRep_Tool: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Pnt: (v: any) => ({ X: () => v.pos[0], Y: () => v.pos[1], Z: () => v.pos[2], delete: () => {} }),
    },
    GeomAbs_CurveType: GEOM,
    ChFi3d_FilletShape: { ChFi3d_Rational: {}, ChFi3d_Polynomial: {} },
    BRepFilletAPI_MakeFillet: FakeFilletBuilder,
    BRepCheck_Analyzer_2: class {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      constructor(_s: any) {}
      IsValid() { return true; }
      delete() {}
    },
    TopExp: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      MapShapes_1(shape: any, type: number, map: any) {
        const items = type === ENUM.TopAbs_EDGE ? shape.edges
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
        this.items = toFind === ENUM.TopAbs_EDGE ? (shape.edges ?? [])
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
        const seen = new Set<number>(); for (const it of items) if (!seen.has(it.ptr)) { seen.add(it.ptr); this.items.push(it); }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      FindIndex(shape: any) { return this.items.findIndex(it => it.ptr === shape.ptr) + 1; }
      FindKey(idx: number) { return this.items[idx - 1]; }
      Extent() { return this.items.length; }
      delete() {}
    },
    BRepAdaptor_Curve_2: class {
      private def: EdgeDef;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(edge: any) { this.def = edge.def; }
      GetType() { return this.def.curve === 'circle' ? GEOM.GeomAbs_Circle : GEOM.GeomAbs_Line; }
      FirstParameter() { return 0; }
      LastParameter() { return this.def.curve === 'circle' ? TWO_PI : 1; }
      Radius() { return this.def.radius ?? 5; }
      Circle() {
        const r = this.def.radius ?? 5;
        return { Location: () => ({ X: () => 0, Y: () => 0, Z: () => 0, delete() {} }),
          Axis: () => ({ Direction: () => ({ X: () => 0, Y: () => 0, Z: () => 1, delete() {} }), delete() {} }),
          Radius: () => r, delete() {} };
      }
      Line() {
        return { Location: () => ({ X: () => 0, Y: () => 0, Z: () => 0, delete() {} }),
          Direction: () => ({ X: () => 1, Y: () => 0, Z: () => 0, delete() {} }), delete() {} };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      D0(u: number, p: any) {
        if (this.def.curve === 'circle') {
          const r = this.def.radius ?? 5;
          p.x = Math.cos(u) * r; p.y = Math.sin(u) * r; p.z = 0;
        } else { p.x = u; p.y = 0; p.z = 0; }
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

function buildTopology(verts: VertDef[], edges: EdgeDef[], faces: FaceDef[]) {
  const vertObjs = new Map<number, unknown>();
  for (const v of verts) vertObjs.set(v.ptr, { ptr: v.ptr, pos: v.pos, delete() {}, verts: [] });
  const edgeObjs = new Map<number, unknown>();
  for (const e of edges) {
    edgeObjs.set(e.ptr, { ptr: e.ptr, def: e, delete() {},
      verts: e.verts.map(vp => vertObjs.get(vp)) });
  }
  const faceObjs = new Map<number, unknown>();
  for (const f of faces) faceObjs.set(f.ptr, { ptr: f.ptr, delete() {},
    edges: f.edges.map(ep => edgeObjs.get(ep)) });
  const bodyShape = { ptr: 9999, delete() {},
    faces: faces.map(f => faceObjs.get(f.ptr)),
    edges: edges.map(e => edgeObjs.get(e.ptr)),
    verts: verts.map(v => vertObjs.get(v.ptr)) };
  const shape = new OccHandle(9999, 'TopoDS_Shape', () => {}, bodyShape);
  const edgeIds = new Map<number, OccHandle<unknown>>();
  edges.forEach((e, i) => edgeIds.set(i, new OccHandle(e.ptr, 'TopoDS_Edge', () => {}, edgeObjs.get(e.ptr))));
  const faceIds = new Map<number, OccHandle<unknown>>();
  faces.forEach((f, i) => faceIds.set(i, new OccHandle(f.ptr, 'TopoDS_Face', () => {}, faceObjs.get(f.ptr))));
  const vertexIds = new Map<number, OccHandle<unknown>>();
  verts.forEach((v, i) => vertexIds.set(i, new OccHandle(v.ptr, 'TopoDS_Vertex', () => {}, vertObjs.get(v.ptr))));
  return createBRepBody({ shape, edgeIds, faceIds, vertexIds });
}

// ── OCC-12.D2 (3) + (4): Half-circle D-notch arc as single selectable edge ────

describe('OCC-12.D2 (3+4): arc edge classification and chain isolation', () => {
  it('D-notch full circle rim is classified as a single circle edge', () => {
    // Arc rim (full circle, verts same ptr) + two side lines forming a D-notch.
    const verts: VertDef[] = [
      { ptr: 1, pos: [0, 0, 0] }, // shared vertex: arc meets lines
      { ptr: 2, pos: [10, 0, 0] },
    ];
    const edges: EdgeDef[] = [
      { ptr: 101, curve: 'circle', verts: [1, 1], radius: 5 }, // full arc rim
      { ptr: 102, curve: 'line',   verts: [1, 2] },             // left side
      { ptr: 103, curve: 'line',   verts: [2, 1] },             // right side
    ];
    const faces: FaceDef[] = [
      { ptr: 201, edges: [101, 102, 103] },
      { ptr: 202, edges: [101] },
    ];
    const body = buildTopology(verts, edges, faces);
    const oc = makeFakeOcc();
    const meta = getSelectableEdges(oc, body);

    const arcMeta = meta.get(0)!; // edgeId 0 = arc (ptr 101)
    expect(arcMeta.kind).toBe('circle');
    expect(arcMeta.filletable).toBe(true);
    // Edge count matches exactly the body edges (no phantom segments).
    expect(meta.size).toBe(3);
  });

  it('arc chainId is not shared with adjacent line edges (no cross-type tangent bleed)', () => {
    const verts: VertDef[] = [
      { ptr: 1, pos: [0, 0, 0] },
      { ptr: 2, pos: [10, 0, 0] },
    ];
    const edges: EdgeDef[] = [
      { ptr: 101, curve: 'circle', verts: [1, 1], radius: 5 },
      { ptr: 102, curve: 'line',   verts: [1, 2] },
      { ptr: 103, curve: 'line',   verts: [2, 1] },
    ];
    const faces: FaceDef[] = [
      { ptr: 201, edges: [101, 102, 103] },
      { ptr: 202, edges: [101] },
    ];
    const body = buildTopology(verts, edges, faces);
    const oc = makeFakeOcc();
    const meta = getSelectableEdges(oc, body);

    const arcChain  = meta.get(0)!.chainId;
    const line1Chain = meta.get(1)!.chainId;
    const line2Chain = meta.get(2)!.chainId;
    // Arc must NOT share a chainId with either line.
    expect(arcChain).not.toBe(line1Chain);
    expect(arcChain).not.toBe(line2Chain);
  });
});

// ── OCC-12.D2 (5): Fillet on an arc edge succeeds ─────────────────────────────

describe('OCC-12.D2 (5): fillet on arc edge succeeds (Build does not throw)', () => {
  beforeEach(() => { buildLog = []; buildShouldFail = false; });

  it('occFilletEdgeSetsWithInstance returns non-null for a circle edge', () => {
    const verts: VertDef[] = [{ ptr: 1, pos: [0, 0, 1] }, { ptr: 2, pos: [0, 0, 0] }];
    const edges: EdgeDef[] = [
      { ptr: 101, curve: 'circle', verts: [1, 1], radius: 5 }, // top cap circle
      { ptr: 102, curve: 'line',   verts: [1, 2] },             // seam (adjacent 1 face — but mock ignores seam)
    ];
    const faces: FaceDef[] = [
      { ptr: 201, edges: [101, 102] }, // lateral
      { ptr: 202, edges: [101] },      // top cap
    ];
    const body = buildTopology(verts, edges, faces);
    const oc = makeFakeOcc();
    // edgeId 0 = circle; filleting it should succeed (mock Build() does not throw).
    const result = occFilletEdgeSetsWithInstance(oc, body, [{ edgeIds: [0], radius: 1 }]);
    expect(result).not.toBeNull();
    expect(buildLog.length).toBe(1);
    expect(buildLog[0]).toContain(101); // circle edge ptr was passed to Add_2
  });

  it('returns null when Build() throws for an arc edge (degenerate radius)', () => {
    buildShouldFail = true;
    const verts: VertDef[] = [{ ptr: 1, pos: [0, 0, 1] }];
    const edges: EdgeDef[] = [{ ptr: 101, curve: 'circle', verts: [1, 1], radius: 5 }];
    const faces: FaceDef[] = [
      { ptr: 201, edges: [101] },
      { ptr: 202, edges: [101] },
    ];
    const body = buildTopology(verts, edges, faces);
    const oc = makeFakeOcc();
    const result = occFilletEdgeSetsWithInstance(oc, body, [{ edgeIds: [0], radius: 99 }]);
    expect(result).toBeNull();
  });
});

// ── OCC-12.D2 (7): Edges selectable on an already-filleted body ───────────────

describe('OCC-12.D2 (7): getSelectableEdges works on a body that has fillet faces', () => {
  it('all edges returned for a body with a circle edge adjacent to line edges', () => {
    // Simulates a filleted body where the torus-blend face adds a circle edge
    // adjacent to the remaining flat-face line edges.
    const verts: VertDef[] = [
      { ptr: 1, pos: [0, 0, 1] },
      { ptr: 2, pos: [5, 0, 0] },
      { ptr: 3, pos: [-5, 0, 0] },
    ];
    const edges: EdgeDef[] = [
      { ptr: 101, curve: 'circle', verts: [1, 1], radius: 5 },  // fillet torus rim
      { ptr: 102, curve: 'line',   verts: [1, 2] },              // post-fillet straight
      { ptr: 103, curve: 'line',   verts: [3, 1] },              // post-fillet straight
    ];
    const faces: FaceDef[] = [
      { ptr: 201, edges: [101] },           // torus/fillet face
      { ptr: 202, edges: [101, 102] },      // adjacent face A (shares circle + line102)
      { ptr: 203, edges: [101, 103] },      // adjacent face B (shares circle + line103)
      { ptr: 204, edges: [102, 103] },      // far face (gives line102 + line103 2 adjacent faces)
    ];
    const body = buildTopology(verts, edges, faces);
    const oc = makeFakeOcc();
    const meta = getSelectableEdges(oc, body);

    // All 3 edges must be present.
    expect(meta.size).toBe(3);
    // Circle edge must be filletable (not marked as seam).
    expect(meta.get(0)!.kind).toBe('circle');
    expect(meta.get(0)!.filletable).toBe(true);
    // Line edges must also be filletable.
    expect(meta.get(1)!.filletable).toBe(true);
    expect(meta.get(2)!.filletable).toBe(true);
  });
});

// ── OCC-13.4 (2+3): isRollingBallCorner round-trip + setback documented ───────

describe('OCC-13.4 (2+3): rolling-ball corner option is ROUND-TRIP-ONLY', () => {
  beforeEach(() => { buildLog = []; buildShouldFail = false; });

  it('occFilletEdgeSetsWithInstance accepts isRollingBallCorner without error', () => {
    const verts: VertDef[] = [{ ptr: 1, pos: [0, 0, 0] }, { ptr: 2, pos: [1, 0, 0] }];
    const edges: EdgeDef[] = [{ ptr: 101, curve: 'line', verts: [1, 2] }];
    const faces: FaceDef[] = [
      { ptr: 201, edges: [101] },
      { ptr: 202, edges: [101] },
    ];
    const body = buildTopology(verts, edges, faces);
    const oc = makeFakeOcc();
    // isRollingBallCorner: true must be stored and forwarded without throwing.
    const result = occFilletEdgeSetsWithInstance(
      oc, body, [{ edgeIds: [0], radius: 1 }],
      { isRollingBallCorner: true },
    );
    expect(result).not.toBeNull();
    // false also works (no geometric difference — ROUND-TRIP-ONLY).
    buildLog = [];
    const result2 = occFilletEdgeSetsWithInstance(
      oc, body, [{ edgeIds: [0], radius: 1 }],
      { isRollingBallCorner: false },
    );
    expect(result2).not.toBeNull();
  });

  it('G2 continuity option produces a result (ChFi3d_Polynomial path)', () => {
    const verts: VertDef[] = [{ ptr: 1, pos: [0, 0, 0] }, { ptr: 2, pos: [1, 0, 0] }];
    const edges: EdgeDef[] = [{ ptr: 101, curve: 'line', verts: [1, 2] }];
    const faces: FaceDef[] = [
      { ptr: 201, edges: [101] },
      { ptr: 202, edges: [101] },
    ];
    const body = buildTopology(verts, edges, faces);
    const oc = makeFakeOcc();
    const result = occFilletEdgeSetsWithInstance(
      oc, body, [{ edgeIds: [0], radius: 1 }],
      { continuity: 'G2' },
    );
    expect(result).not.toBeNull();
  });
});

// ── OCC-13.4 (1): topological fallback resolves arc→line corner ───────────────

describe('OCC-13.4 (1): 1mm corner case resolved by topological fallback', () => {
  beforeEach(() => { buildLog = []; buildShouldFail = false; });

  it('occFilletEdgeSetsTopologicalWithInstance orders circle-before-line', () => {
    // Arc (ptr 201, verts [4,4]) + line (ptr 202, verts [4,3]) sharing vertex ptr 4.
    const verts: VertDef[] = [
      { ptr: 1, pos: [0, 0, 0] }, { ptr: 2, pos: [10, 0, 0] },
      { ptr: 3, pos: [10, 10, 0] }, { ptr: 4, pos: [0, 10, 0] },
    ];
    const edges: EdgeDef[] = [
      { ptr: 201, curve: 'circle', verts: [4, 4], radius: 6.71 },
      { ptr: 202, curve: 'line',   verts: [4, 3] },
    ];
    const faces: FaceDef[] = [
      { ptr: 301, edges: [201, 202] },
      { ptr: 302, edges: [201] },
      { ptr: 303, edges: [202] },
    ];
    const body = buildTopology(verts, edges, faces);
    const oc = makeFakeOcc();

    const result = occFilletEdgeSetsTopologicalWithInstance(oc, body, [
      { edgeIds: [0], radius: 1 }, // circle
      { edgeIds: [1], radius: 1 }, // line
    ]);
    expect(result).not.toBeNull();
    // First Build() pass must target the circle (ptr 201).
    expect(buildLog[0]).toContain(201);
    expect(buildLog[0]).not.toContain(202);
    // Second Build() pass must target the line (ptr 202).
    expect(buildLog[1]).toContain(202);
  });
});
