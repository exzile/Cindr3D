/**
 * OCC-22.1 / 22.2 — occTransformBodyWithInstance op-level tests.
 *
 * The op is the shared "transform-and-reregister" helper behind Move/Copy and
 * Align. These tests mock the brepBody helpers and feed a fake OCC instance so
 * we can assert:
 *   1. A column-major THREE.Matrix4 is fed to gp_Trsf.SetValues as a row-major
 *      3×4 (rotation + translation) — the cast that makes Move/Align land at the
 *      correct pose.
 *   2. BRepBuilderAPI_Transform is constructed with copy=true.
 *   3. The transformer's Shape() result is what gets wrapped into the new body.
 *   4. Disposal discipline: trsf + transformer are deleted; the occDeref VIEW is
 *      never deleted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

// ── Module mocks ─────────────────────────────────────────────────────────────
const RAW_SHAPE = { __view: 'rawShape' };
let makeBodyCalls: unknown[] = [];

vi.mock('../../brepBody', () => ({
  // occDeref returns a VIEW into the body's shape — the op must NOT delete it.
  occDeref: () => RAW_SHAPE,
  makeBRepBodyFromOccShape: (_oc: unknown, shape: unknown, options: unknown) => {
    makeBodyCalls.push({ shape, options });
    return { id: 'new-body', shape, faceIds: new Map(), edgeIds: new Map(), vertexIds: new Map() };
  },
}));

import { occTransformBodyWithInstance } from '../transformBody';

// ── Fake OCC instance ────────────────────────────────────────────────────────
let setValuesArgs: number[] | null;
let trsfDeleted: number;
let transformerDeleted: number;
let transformerCtor: { shape: unknown; trsf: unknown; copy: boolean } | null;
const TRANSFORMED_SHAPE = { __view: 'transformedShape' };

function makeFakeOcc() {
  setValuesArgs = null;
  trsfDeleted = 0;
  transformerDeleted = 0;
  transformerCtor = null;
  return {
    TopoDS_Shape: undefined,
    gp_Trsf_1: class {
      SetValues(...args: number[]) { setValuesArgs = args; }
      delete() { trsfDeleted++; }
    },
    BRepBuilderAPI_Transform_2: class {
      constructor(shape: unknown, trsf: unknown, copy: boolean) {
        transformerCtor = { shape, trsf, copy };
      }
      Shape() { return TRANSFORMED_SHAPE; }
      delete() { transformerDeleted++; }
    },
  };
}

function fakeBody() {
  return { id: 'src', shape: { ptr: 1 }, faceIds: new Map(), edgeIds: new Map(), vertexIds: new Map() };
}

describe('occTransformBodyWithInstance', () => {
  beforeEach(() => { makeBodyCalls = []; });

  it('feeds a column-major Matrix4 to gp_Trsf.SetValues as a row-major 3×4', () => {
    const oc = makeFakeOcc();
    // Pure translation (identity rotation) keeps the expected values obvious.
    const mat = new THREE.Matrix4().makeTranslation(10, 20, 30);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    occTransformBodyWithInstance(oc as any, fakeBody() as any, mat);

    expect(setValuesArgs).toEqual([
      1, 0, 0, 10,
      0, 1, 0, 20,
      0, 0, 1, 30,
    ]);
  });

  it('maps a rotation correctly (row-major rows are the basis vectors)', () => {
    const oc = makeFakeOcc();
    // 90° about Z: x→y, y→-x.  Column-major elements still map to row-major rows.
    const mat = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    const e = mat.elements;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    occTransformBodyWithInstance(oc as any, fakeBody() as any, mat);
    expect(setValuesArgs).toEqual([
      e[0], e[4], e[8], e[12],
      e[1], e[5], e[9], e[13],
      e[2], e[6], e[10], e[14],
    ]);
  });

  it('constructs the transformer with copy=true and wraps its Shape() result', () => {
    const oc = makeFakeOcc();
    const mat = new THREE.Matrix4().identity();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = occTransformBodyWithInstance(oc as any, fakeBody() as any, mat, { sourceFeatureId: 'feat-7' });

    expect(transformerCtor).not.toBeNull();
    expect(transformerCtor!.shape).toBe(RAW_SHAPE);
    expect(transformerCtor!.copy).toBe(true);
    expect(makeBodyCalls).toHaveLength(1);
    expect((makeBodyCalls[0] as { shape: unknown }).shape).toBe(TRANSFORMED_SHAPE);
    expect((makeBodyCalls[0] as { options: { sourceFeatureId?: string } }).options.sourceFeatureId).toBe('feat-7');
    expect(body).not.toBeNull();
  });

  it('disposes the trsf and transformer but never the occDeref VIEW', () => {
    const oc = makeFakeOcc();
    const mat = new THREE.Matrix4().identity();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    occTransformBodyWithInstance(oc as any, fakeBody() as any, mat);
    expect(trsfDeleted).toBe(1);
    expect(transformerDeleted).toBe(1);
    // RAW_SHAPE has no delete() — if the op tried to delete the VIEW it would throw.
  });

  it('returns null and still disposes the trsf when the transform throws', () => {
    const oc = makeFakeOcc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (oc as any).BRepBuilderAPI_Transform_2 = class {
      constructor() { throw new Error('boom'); }
      Shape() { return null as any; }
      delete() { transformerDeleted++; }
    };
    const mat = new THREE.Matrix4().identity();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = occTransformBodyWithInstance(oc as any, fakeBody() as any, mat);
    expect(body).toBeNull();
    expect(trsfDeleted).toBe(1);
  });
});
