/**
 * OCC-21.2 — occSplitFaceWithInstance op-level tests.
 *
 * Imprints a section (face ∩ plane) onto a target face via BRepFeat_SplitShape.
 * Mocks brepBody + runEdgeOpBuild; provides a fake OCC surface so we can assert:
 *   1. null when the requested faceId is not in body.faceIds (no OCC work).
 *   2. Happy path: section → wire(edges) → SplitShape.Add(wire, face) → new body.
 *   3. null when the section produced no edges (plane misses the face).
 *   4. Disposal: section/wire/builder/explorer/splitter owned resources deleted;
 *      occDeref VIEWs (rawShape, rawFace) never deleted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const RAW_SHAPE = { __view: 'rawShape' };
const RAW_FACE_DEREF = { __view: 'faceDeref' };
let makeBodyShape: unknown = null;

vi.mock('../../brepBody', () => ({
  occDeref: (_oc: unknown, handle: { __kind?: string }) =>
    handle.__kind === 'faceHandle' ? RAW_FACE_DEREF : RAW_SHAPE,
  makeBRepBodyFromOccShape: (_oc: unknown, shape: unknown) => {
    makeBodyShape = shape;
    return { id: 'split-result', shape, faceIds: new Map(), edgeIds: new Map(), vertexIds: new Map() };
  },
}));

vi.mock('../adjacency', () => ({
  runEdgeOpBuild: (_oc: unknown, maker: { Build: () => void }) => maker.Build(),
}));

import { occSplitFaceWithInstance } from '../splitFace';

const ENUM = { TopAbs_EDGE: 'EDGE', TopAbs_SHAPE: 'SHAPE' } as const;
const RAW_FACE_CAST = { __view: 'faceCast' };
const SECTION_SHAPE = { __view: 'section' };

let log: string[];
let splitterAddArgs: { wire: unknown; face: unknown } | null;

function makeFakeOcc(opts: { edges: number; sectionDone?: boolean; splitDone?: boolean }) {
  log = [];
  splitterAddArgs = null;
  return {
    TopoDS_Shape: undefined,
    TopAbs_ShapeEnum: ENUM,
    TopoDS: { Face_1: () => RAW_FACE_CAST },
    gp_Pnt_3: class { constructor() {} delete() { log.push('pnt'); } },
    gp_Dir_4: class { constructor() {} delete() { log.push('dir'); } },
    gp_Pln_3: class { constructor() {} delete() { log.push('pln'); } },
    BRepAlgoAPI_Section: class {
      constructor() {}
      Build() {}
      IsDone() { return opts.sectionDone ?? true; }
      Shape() { return SECTION_SHAPE; }
      delete() { log.push('section'); }
    },
    BRep_Builder: class {
      MakeWire() {}
      Add() {}
      delete() { log.push('builder'); }
    },
    TopoDS_Wire: class { delete() { log.push('wire'); } },
    TopExp_Explorer_2: class {
      private i = 0;
      constructor() {}
      More() { return this.i < opts.edges; }
      Current() { return { delete() { log.push('edgeCopy'); } }; }
      Next() { this.i++; }
      delete() { log.push('explorer'); }
    },
    BRepFeat_SplitShape: class {
      constructor() {}
      Add(wire: unknown, face: unknown) { splitterAddArgs = { wire, face }; }
      Build() {}
      IsDone() { return opts.splitDone ?? true; }
      Shape() { return { __view: 'splitResult' }; }
      delete() { log.push('splitter'); }
    },
  };
}

function bodyWithFace(hasFace: boolean) {
  const faceIds = new Map<number, unknown>();
  if (hasFace) faceIds.set(5, { __kind: 'faceHandle' });
  return { id: 'b', shape: { ptr: 1 }, faceIds, edgeIds: new Map(), vertexIds: new Map() };
}

const ORIGIN = { x: 0, y: 0, z: 0 };
const NORMAL = { x: 0, y: 0, z: 1 };

describe('occSplitFaceWithInstance', () => {
  beforeEach(() => { makeBodyShape = null; });

  it('returns null when the faceId is not present on the body', () => {
    const oc = makeFakeOcc({ edges: 2 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = occSplitFaceWithInstance(oc as any, bodyWithFace(false) as any, 5, ORIGIN, NORMAL);
    expect(r).toBeNull();
  });

  it('imprints the section wire onto the face and returns a new body', () => {
    const oc = makeFakeOcc({ edges: 3 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = occSplitFaceWithInstance(oc as any, bodyWithFace(true) as any, 5, ORIGIN, NORMAL);
    expect(r).not.toBeNull();
    // SplitShape.Add was called with the wire and the CAST face (TopoDS.Face_1).
    expect(splitterAddArgs).not.toBeNull();
    expect(splitterAddArgs!.face).toBe(RAW_FACE_CAST);
    expect((makeBodyShape as { __view: string }).__view).toBe('splitResult');
  });

  it('returns null when the section yields no edges', () => {
    const oc = makeFakeOcc({ edges: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = occSplitFaceWithInstance(oc as any, bodyWithFace(true) as any, 5, ORIGIN, NORMAL);
    expect(r).toBeNull();
  });

  it('disposes all owned resources on the happy path', () => {
    const oc = makeFakeOcc({ edges: 2 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    occSplitFaceWithInstance(oc as any, bodyWithFace(true) as any, 5, ORIGIN, NORMAL);
    expect(log).toContain('section');
    expect(log).toContain('wire');
    expect(log).toContain('builder');
    expect(log).toContain('explorer');
    expect(log).toContain('splitter');
    // Each explored edge copy is owned and freed.
    expect(log.filter((l) => l === 'edgeCopy')).toHaveLength(2);
  });
});
