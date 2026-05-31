/**
 * OCC-22.1c / 22.2 — store-level Move/Copy + Align transform tests.
 *
 * commitMoveBody (mesh fallback) and commitAlign (OCC delegation) are exercised
 * with the OCC infra mocked so jsdom never touches WASM. We assert:
 *   - Move by (10,0,0) shifts the body's mesh bbox by +10 in X.
 *   - copy=true adds a second feature (the original is untouched).
 *   - Align on an OCC-backed body transforms the BRep via the shared
 *     occTransformBodyWithInstance op and adopts the freshly-registered mesh.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// ── OCC infra mocks (configurable per test) ──────────────────────────────────
let occSync: { oc: unknown } | null = null;
let registryBody: unknown = null;
const transformCalls: Array<{ mat: THREE.Matrix4; options: unknown }> = [];
let transformResult: unknown = null;

vi.mock('../engine/occ/loader', () => ({
  getOccSync: () => occSync,
  getOcc: () => Promise.resolve({ oc: {} }),
}));
vi.mock('../engine/occ/picking', () => ({ disposeMeshDeferred: () => {} }));
vi.mock('../engine/occ/globalRegistry', () => ({
  globalBRepBodyRegistry: { get: () => registryBody },
}));
vi.mock('../engine/occ/ops/transformBody', () => ({
  occTransformBodyWithInstance: (_oc: unknown, _body: unknown, mat: THREE.Matrix4, options: unknown) => {
    transformCalls.push({ mat, options });
    return transformResult;
  },
}));
vi.mock('../engine/occ/registeredMesh', () => ({
  createRegisteredOccMesh: (_oc: unknown, _body: unknown, material: THREE.Material, featureId: string) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    m.userData = { featureId, brepBodyId: `brep-${featureId}-new`, isOccMesh: true };
    return m;
  },
}));

import { createMoveBodyActions } from '../store/cad/slices/featureManagement/meshTransform/moveBodyActions';
import { createAlignActions } from '../store/cad/slices/featureManagement/meshTransform/alignActions';
import type { Feature } from '../types/cad';

// ── Minimal store harness ────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(initial: Record<string, any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state: Record<string, any> = {
    statusMessage: '',
    setStatusMessage: (m: string) => { state.statusMessage = m; },
    pushUndo: () => {},
    updateFeatureParams: (id: string, params: Record<string, unknown>) => {
      state.features = state.features.map((f: Feature) => f.id === id ? { ...f, params } : f);
    },
    ...initial,
  };
  const get = () => state;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (patch: any) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  return { ctx: { set, get } as never, get };
}

function boxFeature(id: string, name: string, userData: Record<string, unknown> = {}): Feature {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  mesh.userData = { featureId: id, ...userData };
  return {
    id, name, type: 'extrude',
    params: {}, mesh, visible: true, suppressed: false, timestamp: Date.now(),
  } as Feature;
}

describe('commitMoveBody (mesh fallback)', () => {
  beforeEach(() => { occSync = null; registryBody = null; transformCalls.length = 0; transformResult = null; });

  it('moves a non-OCC body by (10,0,0) → mesh bbox shifts +10 in X', () => {
    const feat = boxFeature('f1', 'Box');
    const { ctx, get } = makeCtx({ features: [feat] });
    const actions = createMoveBodyActions(ctx);
    actions.commitMoveBody!('f1', { dx: 10, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0, copy: false });

    const moved = get().features.find((f: Feature) => f.id === 'f1') as Feature;
    const geom = (moved.mesh as THREE.Mesh).geometry;
    geom.computeBoundingBox();
    // original box spans [-1,1]; after +10 → [9,11]
    expect(geom.boundingBox!.min.x).toBeCloseTo(9, 5);
    expect(geom.boundingBox!.max.x).toBeCloseTo(11, 5);
  });

  it('copy=true adds a second feature and leaves the original in place', () => {
    const feat = boxFeature('f1', 'Box');
    const { ctx, get } = makeCtx({ features: [feat] });
    const actions = createMoveBodyActions(ctx);
    actions.commitMoveBody!('f1', { dx: 5, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0, copy: true });

    expect(get().features).toHaveLength(2);
    const original = get().features.find((f: Feature) => f.id === 'f1') as Feature;
    (original.mesh as THREE.Mesh).geometry.computeBoundingBox();
    expect((original.mesh as THREE.Mesh).geometry.boundingBox!.min.x).toBeCloseTo(-1, 5);
  });
});

describe('commitAlign (OCC delegation)', () => {
  beforeEach(() => { occSync = null; registryBody = null; transformCalls.length = 0; transformResult = null; });

  it('transforms the OCC BRep and adopts the freshly-registered mesh', () => {
    occSync = { oc: {} };
    registryBody = { id: 'srcBody' };
    transformResult = { id: 'movedBody' };

    const feat = boxFeature('f1', 'Box', { brepBodyId: 'brep-old' });
    const { ctx, get } = makeCtx({
      features: [feat],
      alignSource: { featureId: 'f1', point: [0, 0, 0], kind: 'face' },
      alignTarget: { point: [10, 0, 0], kind: 'face' },
    });
    const actions = createAlignActions(ctx);
    actions.commitAlign!({ moveType: 'translate', allowRotation: false, flip: false });

    // The shared OCC transform op was invoked with the new-pose matrix.
    expect(transformCalls).toHaveLength(1);
    expect(transformCalls[0].options).toEqual({ sourceFeatureId: 'f1' });
    // Translation column of the matrix = target - source = (10,0,0).
    expect(transformCalls[0].mat.elements[12]).toBeCloseTo(10, 5);

    // Feature now carries the OCC mesh with a NEW brepBodyId (not the stale one).
    const aligned = get().features.find((f: Feature) => f.id === 'f1') as Feature;
    expect((aligned.mesh as THREE.Mesh).userData.isOccMesh).toBe(true);
    expect((aligned.mesh as THREE.Mesh).userData.brepBodyId).toBe('brep-f1-new');
  });

  it('falls back to a mesh-only align when the body has no brepBodyId', () => {
    occSync = { oc: {} };
    const feat = boxFeature('f1', 'Box'); // no brepBodyId
    const { ctx, get } = makeCtx({
      features: [feat],
      alignSource: { featureId: 'f1', point: [0, 0, 0], kind: 'face' },
      alignTarget: { point: [10, 0, 0], kind: 'face' },
    });
    const actions = createAlignActions(ctx);
    actions.commitAlign!({ moveType: 'translate', allowRotation: false, flip: false });

    expect(transformCalls).toHaveLength(0); // OCC path not taken
    const aligned = get().features.find((f: Feature) => f.id === 'f1') as Feature;
    const geom = (aligned.mesh as THREE.Mesh).geometry;
    geom.computeBoundingBox();
    expect(geom.boundingBox!.min.x).toBeCloseTo(9, 5);
  });
});
