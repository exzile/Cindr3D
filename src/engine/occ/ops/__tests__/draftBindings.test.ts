/**
 * Regression: occDraftWithInstance must use the correct OCC bindings (2026-05-30).
 *
 * Bugs fixed (all silently degraded Draft to null via swallowed BindingErrors):
 *   - ctor: BRepOffsetAPI_DraftAngle_**1** is the 0-arg ctor; the shape ctor is _2.
 *   - Add: needs 5 args (F, dir, angle, plane, Flag) — the trailing Flag was missing.
 *   - the face must be cast via TopoDS.Face_1 (occDeref returns a TopoDS_Shape).
 *   - Build() takes 0 args here (was called as Build(progress)); now via runEdgeOpBuild.
 *
 * The mock records what occDraftWithInstance does and asserts each of the above.
 */
import { describe, it, expect } from 'vitest';
import { OccHandle } from '../../occHandle';
import { createBRepBody } from '../../brepBody';
import { occDraftWithInstance } from '../draft';
import * as THREE from 'three';

const ENUM = { TopAbs_FACE: 1, TopAbs_EDGE: 2, TopAbs_VERTEX: 3, TopAbs_SHAPE: 4 } as const;

interface DraftCall { addArgCount: number; faceWasCast: boolean; buildArgCount: number; usedCtor2: boolean }
let lastDraft: DraftCall;

class FakeDraftAngle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rawShape: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(shape: any) { this.rawShape = shape; lastDraft.usedCtor2 = true; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Add(face: any, ...rest: unknown[]) {
    lastDraft.addArgCount = 1 + rest.length; // F + (dir, angle, plane, Flag)
    lastDraft.faceWasCast = face?.__face1 === true;
  }
  Build(...args: unknown[]) { lastDraft.buildArgCount = args.length; }
  IsDone() { return true; }
  HasErrors() { return false; }
  Shape() { return { ...this.rawShape, drafted: true }; }
  delete() {}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeOcc(): any {
  return {
    TopAbs_ShapeEnum: ENUM,
    TopoDS_Shape: undefined,
    // No wrapPointer + no Message_ProgressRange_1 -> occDeref uses handle._object,
    // and runEdgeOpBuild goes straight to the 0-arg Build().
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TopoDS: { Edge_1: (s: any) => s, Vertex_1: (s: any) => s, Face_1: (s: any) => ({ ...s, __face1: true }) },
    BRepOffsetAPI_DraftAngle_2: FakeDraftAngle,
    gp_Dir_4: class { delete() {} },
    gp_Pnt_3: class { delete() {} },
    gp_Pln_3: class { delete() {} },
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
function buildBoxFaceBody(): { body: ReturnType<typeof createBRepBody>; oc: any } {
  const v1 = { ptr: 1, delete() {}, verts: [] };
  const v2 = { ptr: 2, delete() {}, verts: [] };
  const edge = { ptr: 500, delete() {}, verts: [v1, v2] };
  const face = { ptr: 600, delete() {}, edges: [edge] };
  const bodyShape = { ptr: 9999, delete() {}, faces: [face], edges: [edge], verts: [v1, v2] };
  const shape = new OccHandle(9999, 'TopoDS_Shape', () => {}, bodyShape);
  const faceIds = new Map<number, OccHandle<unknown>>([[0, new OccHandle(600, 'TopoDS_Face', () => {}, face)]]);
  const edgeIds = new Map<number, OccHandle<unknown>>([[0, new OccHandle(500, 'TopoDS_Edge', () => {}, edge)]]);
  const vertexIds = new Map<number, OccHandle<unknown>>([
    [0, new OccHandle(1, 'TopoDS_Vertex', () => {}, v1)],
    [1, new OccHandle(2, 'TopoDS_Vertex', () => {}, v2)],
  ]);
  const body = createBRepBody({ shape, edgeIds, faceIds, vertexIds });
  return { body, oc: makeFakeOcc() };
}

describe('occDraftWithInstance — OCC binding correctness', () => {
  it('uses DraftAngle_2 ctor, a Face_1-cast face, a 5-arg Add, and a 0-arg Build', () => {
    lastDraft = { addArgCount: 0, faceWasCast: false, buildArgCount: -1, usedCtor2: false };
    const { body, oc } = buildBoxFaceBody();
    const result = occDraftWithInstance(
      oc, body, [0],
      new THREE.Vector3(0, 0, 1), 5 * Math.PI / 180,
      { origin: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(0, 0, 1) },
    );

    // Draft must succeed (the bugs made this null).
    expect(result).not.toBeNull();
    expect(lastDraft.usedCtor2).toBe(true);      // _2(shape), not _1
    expect(lastDraft.faceWasCast).toBe(true);    // TopoDS.Face_1 applied
    expect(lastDraft.addArgCount).toBe(5);       // F, dir, angle, plane, Flag
    expect(lastDraft.buildArgCount).toBe(0);     // Build() not Build(progress)
  });
});
