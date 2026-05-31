/**
 * OCC-21.4b — occSplitBodyBySurface op-level tests.
 *
 * Splits a solid by a tool body via BRepAlgoAPI_Splitter and extracts every
 * resulting TopAbs_SOLID. Mocks brepBody + runEdgeOpBuild so we can assert:
 *   1. Returns [] (with a warning) when the Splitter binding is absent.
 *   2. SetArguments(body) + SetTools(tool) are wired and N solids are extracted.
 *   3. HasErrors() / IsDone()===false short-circuits to [].
 *   4. Disposal: splitter + both lists are deleted; every exp.Current() solid
 *      copy is deleted; occDeref VIEWs are never deleted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const RAW_BODY = { __view: 'body' };
const RAW_TOOL = { __view: 'tool' };
let makeBodyShapes: unknown[] = [];

vi.mock('../../brepBody', () => ({
  occDeref: (_oc: unknown, shape: { __which?: string }) =>
    shape.__which === 'tool' ? RAW_TOOL : RAW_BODY,
  makeBRepBodyFromOccShape: (_oc: unknown, shape: unknown) => {
    makeBodyShapes.push(shape);
    return { id: `piece-${makeBodyShapes.length}`, shape, faceIds: new Map(), edgeIds: new Map(), vertexIds: new Map() };
  },
}));

// runEdgeOpBuild just invokes Build() on the maker, like the real helper.
vi.mock('../adjacency', () => ({
  runEdgeOpBuild: (_oc: unknown, maker: { Build: () => void }) => maker.Build(),
}));

import { occSplitBodyBySurface } from '../splitBody';

const ENUM = { TopAbs_SOLID: 'SOLID', TopAbs_SHAPE: 'SHAPE' } as const;

let deleted: string[];

function makeFakeOcc(opts: { solids: number; isDone?: boolean; hasErrors?: boolean }) {
  deleted = [];
  const solidCopiesDeleted: number[] = [];
  return {
    TopoDS_Shape: undefined,
    TopAbs_ShapeEnum: ENUM,
    BRepAlgoAPI_Splitter_1: class {
      args: unknown = null;
      tools: unknown = null;
      SetArguments(a: unknown) { this.args = a; }
      SetTools(t: unknown) { this.tools = t; }
      Build() { /* invoked via runEdgeOpBuild */ }
      IsDone() { return opts.isDone ?? true; }
      HasErrors() { return opts.hasErrors ?? false; }
      Shape() { return { __view: 'result' }; }
      delete() { deleted.push('splitter'); }
    },
    TopTools_ListOfShape_1: class {
      appended: unknown[] = [];
      Append_1(s: unknown) { this.appended.push(s); }
      delete() { deleted.push('list'); }
    },
    TopExp_Explorer_2: class {
      private i = 0;
      constructor() { /* args ignored */ }
      More() { return this.i < opts.solids; }
      Current() {
        const idx = this.i;
        return { __view: `solid-${idx}`, delete() { solidCopiesDeleted.push(idx); } };
      }
      Next() { this.i++; }
      delete() { deleted.push('explorer'); }
    },
    _solidCopiesDeleted: solidCopiesDeleted,
  };
}

function body(which: 'body' | 'tool') {
  return { id: which, shape: { __which: which }, faceIds: new Map(), edgeIds: new Map(), vertexIds: new Map() };
}

describe('occSplitBodyBySurface', () => {
  beforeEach(() => { makeBodyShapes = []; });

  it('returns [] when the Splitter binding is unavailable', () => {
    const oc = { TopoDS_Shape: undefined }; // no BRepAlgoAPI_Splitter_1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pieces = occSplitBodyBySurface(oc as any, body('body') as any, body('tool') as any);
    expect(pieces).toEqual([]);
  });

  it('wires arguments/tools and extracts N solid pieces', () => {
    const oc = makeFakeOcc({ solids: 2 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pieces = occSplitBodyBySurface(oc as any, body('body') as any, body('tool') as any);
    expect(pieces).toHaveLength(2);
    // Every extracted solid copy was wrapped into a body.
    expect(makeBodyShapes.map((s) => (s as { __view: string }).__view)).toEqual(['solid-0', 'solid-1']);
  });

  it('returns [] when the Splitter reports errors', () => {
    const oc = makeFakeOcc({ solids: 3, hasErrors: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pieces = occSplitBodyBySurface(oc as any, body('body') as any, body('tool') as any);
    expect(pieces).toEqual([]);
  });

  it('disposes splitter, both lists, and every solid copy', () => {
    const oc = makeFakeOcc({ solids: 2 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    occSplitBodyBySurface(oc as any, body('body') as any, body('tool') as any);
    expect(deleted).toContain('splitter');
    expect(deleted.filter((d) => d === 'list')).toHaveLength(2);
    expect(deleted).toContain('explorer');
    expect(oc._solidCopiesDeleted).toEqual([0, 1]);
  });
});
