/**
 * OCC-21.3 — occReplaceFaceWithInstance op-level tests.
 *
 * Replaces source face(s) with a target plane by subtracting the halfspace
 * between them. Mocks geomSurface (plane resolution), faceAdjacency (tangent
 * chain), booleanCore (the subtract), and brepBody (halfspace box build) so we
 * can assert:
 *   1. null for an empty source set.
 *   2. null when the target face is non-planar (sketchPlaneFromFace → null).
 *   3. Happy path performs a 'subtract' boolean and disposes the halfspace tool.
 *   4. isTangentChain expands the source set before resolving the cut side.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

// Plane records keyed by face id so each test can shape the geometry.
const planes: Record<number, { origin: THREE.Vector3; normal: THREE.Vector3; uDir: THREE.Vector3 } | null> = {};

vi.mock('../../geomSurface', () => ({
  sketchPlaneFromFace: (_oc: unknown, _body: unknown, faceId: number) => {
    const p = planes[faceId];
    return p ? { frame: p } : null;
  },
}));

let expandCalledWith: number[] | null = null;
vi.mock('../faceAdjacency', () => ({
  expandTangentFaceChain: (_oc: unknown, _body: unknown, ids: number[]) => {
    expandCalledWith = ids;
    return [...ids, 99]; // pretend the chain pulls in face 99
  },
}));

let booleanCall: { op: string; disposed: boolean } | null = null;
vi.mock('../booleanCore', () => ({
  performOccBooleanWithInstance: (_oc: unknown, op: string) => {
    booleanCall = { op, disposed: false };
    return { id: 'replaced', shape: {}, faceIds: new Map(), edgeIds: new Map(), vertexIds: new Map() };
  },
}));

vi.mock('../../brepBody', () => ({
  occDeref: (_oc: unknown, s: unknown) => s,
  makeBRepBodyFromOccShape: () => ({
    id: 'halfspace',
    shape: {},
    faceIds: new Map(),
    edgeIds: new Map(),
    vertexIds: new Map(),
    dispose() { if (booleanCall) booleanCall.disposed = true; },
  }),
}));

import { occReplaceFaceWithInstance } from '../replaceFace';

// Minimal OCC surface for buildHalfspaceBox (a box maker + transform + trsf).
function makeFakeOcc() {
  return {
    TopoDS_Shape: undefined,
    BRepPrimAPI_MakeBox_2: class { constructor() {} Shape() { return {}; } delete() {} },
    BRepBuilderAPI_Transform_2: class { constructor() {} Shape() { return {}; } delete() {} },
    gp_Trsf_1: class { SetValues() {} delete() {} },
  };
}

function fakeBody() {
  return { id: 'b', shape: {}, faceIds: new Map(), edgeIds: new Map(), vertexIds: new Map() };
}

function plane(origin: [number, number, number], normal: [number, number, number]) {
  return {
    origin: new THREE.Vector3(...origin),
    normal: new THREE.Vector3(...normal),
    uDir: new THREE.Vector3(1, 0, 0),
  };
}

describe('occReplaceFaceWithInstance', () => {
  beforeEach(() => {
    for (const k of Object.keys(planes)) delete planes[Number(k)];
    expandCalledWith = null;
    booleanCall = null;
  });

  it('returns null for an empty source-face set', () => {
    const oc = makeFakeOcc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = occReplaceFaceWithInstance(oc as any, fakeBody() as any, [], 2);
    expect(r).toBeNull();
  });

  it('returns null when the target face is non-planar', () => {
    planes[2] = null; // target non-planar
    planes[1] = plane([0, 0, 5], [0, 0, 1]);
    const oc = makeFakeOcc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = occReplaceFaceWithInstance(oc as any, fakeBody() as any, [1], 2);
    expect(r).toBeNull();
  });

  it('subtracts the halfspace and disposes the cutter on the happy path', () => {
    planes[2] = plane([0, 0, 0], [0, 0, 1]);   // target plane at z=0
    planes[1] = plane([0, 0, 5], [0, 0, 1]);   // source face above → cut +z side
    const oc = makeFakeOcc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = occReplaceFaceWithInstance(oc as any, fakeBody() as any, [1], 2);
    expect(r).not.toBeNull();
    expect(booleanCall?.op).toBe('subtract');
    expect(booleanCall?.disposed).toBe(true); // halfspace tool disposed after boolean
  });

  it('expands the source set when isTangentChain is set', () => {
    planes[2] = plane([0, 0, 0], [0, 0, 1]);
    planes[1] = plane([0, 0, 5], [0, 0, 1]);
    planes[99] = plane([0, 0, 5], [0, 0, 1]);
    const oc = makeFakeOcc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    occReplaceFaceWithInstance(oc as any, fakeBody() as any, [1], 2, { isTangentChain: true });
    expect(expandCalledWith).toEqual([1]);
  });

  it('does NOT expand the source set when isTangentChain is unset', () => {
    planes[2] = plane([0, 0, 0], [0, 0, 1]);
    planes[1] = plane([0, 0, 5], [0, 0, 1]);
    const oc = makeFakeOcc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    occReplaceFaceWithInstance(oc as any, fakeBody() as any, [1], 2);
    expect(expandCalledWith).toBeNull();
  });
});
