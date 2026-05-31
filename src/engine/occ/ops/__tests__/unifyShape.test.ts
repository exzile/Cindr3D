/**
 * OCC-22.3 — occUnifyBodyWithInstance op-level tests (MergeFaces backend).
 *
 * Wraps ShapeUpgrade_UnifySameDomain. Mocks brepBody so we can assert:
 *   1. Default flags: unifyEdges=true, unifyFaces=true, concatBSplines=false.
 *   2. The unifier is kept alive in the new body's ownedResources (Shape() is a
 *      VIEW into the unifier in this build).
 *   3. Falls back to the _1 ctor + Initialize when _2 is absent.
 *   4. null when no UnifySameDomain binding exists.
 *   5. null + cleanup when Build() throws.
 */
import { describe, it, expect, vi } from 'vitest';

const UNIFIED_SHAPE = { __view: 'unified' };
let madeFromShape: unknown = null;

vi.mock('../../brepBody', () => ({
  occDeref: (_oc: unknown, s: unknown) => s,
  makeBRepBodyFromOccShape: (_oc: unknown, shape: unknown, options: unknown) => {
    madeFromShape = shape;
    return { id: 'unified-body', shape, options, faceIds: new Map(), edgeIds: new Map(), vertexIds: new Map(), ownedResources: [] as unknown[] };
  },
}));

import { occUnifyBodyWithInstance } from '../unifyShape';

function fakeBody() {
  return { id: 'b', shape: { ptr: 1 }, faceIds: new Map(), edgeIds: new Map(), vertexIds: new Map() };
}

describe('occUnifyBodyWithInstance', () => {
  it('uses default flags (edges+faces on, bsplines off) via the _2 ctor', () => {
    let ctorArgs: unknown[] = [];
    let deleted = false;
    const oc = {
      TopoDS_Shape: undefined,
      ShapeUpgrade_UnifySameDomain_2: class {
        constructor(...args: unknown[]) { ctorArgs = args; }
        Build() {}
        Shape() { return UNIFIED_SHAPE; }
        delete() { deleted = true; }
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = occUnifyBodyWithInstance(oc as any, fakeBody() as any);
    expect(body).not.toBeNull();
    // args after the shape: unifyEdges, unifyFaces, concatBSplines
    expect(ctorArgs.slice(1)).toEqual([true, true, false]);
    expect(madeFromShape).toBe(UNIFIED_SHAPE);
    // The unifier must be retained, NOT deleted, so the Shape() VIEW stays valid.
    expect(deleted).toBe(false);
    expect(body!.ownedResources).toHaveLength(1);
  });

  it('honors explicit flags', () => {
    let ctorArgs: unknown[] = [];
    const oc = {
      TopoDS_Shape: undefined,
      ShapeUpgrade_UnifySameDomain_2: class {
        constructor(...args: unknown[]) { ctorArgs = args; }
        Build() {}
        Shape() { return UNIFIED_SHAPE; }
        delete() {}
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    occUnifyBodyWithInstance(oc as any, fakeBody() as any, { unifyEdges: false, concatBSplines: true });
    expect(ctorArgs.slice(1)).toEqual([false, true, true]);
  });

  it('falls back to the _1 ctor + Initialize when _2 is absent', () => {
    let initArgs: unknown[] = [];
    const oc = {
      TopoDS_Shape: undefined,
      ShapeUpgrade_UnifySameDomain_1: class {
        Initialize(...args: unknown[]) { initArgs = args; }
        Build() {}
        Shape() { return UNIFIED_SHAPE; }
        delete() {}
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = occUnifyBodyWithInstance(oc as any, fakeBody() as any);
    expect(body).not.toBeNull();
    expect(initArgs.slice(1)).toEqual([true, true, false]);
  });

  it('returns null when no UnifySameDomain binding exists', () => {
    const oc = { TopoDS_Shape: undefined };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = occUnifyBodyWithInstance(oc as any, fakeBody() as any);
    expect(body).toBeNull();
  });

  it('returns null and cleans up when Build throws', () => {
    let deleted = false;
    const oc = {
      TopoDS_Shape: undefined,
      ShapeUpgrade_UnifySameDomain_2: class {
        constructor() {}
        Build() { throw new Error('unify failed'); }
        Shape() { return UNIFIED_SHAPE; }
        delete() { deleted = true; }
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = occUnifyBodyWithInstance(oc as any, fakeBody() as any);
    expect(body).toBeNull();
    expect(deleted).toBe(true);
  });
});
