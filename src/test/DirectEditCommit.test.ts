/**
 * OCC-21.1c — commitDirectEdit dispatch tests.
 *
 * Direct Edit reuses existing engine ops rather than new geometry code:
 *   - mode 'offset-face' and 'extrude' → occOffsetFacesWithInstance(±distance)
 *   - mode 'taper'                     → occDraftWithInstance(face, angle)
 * These tests mock the OCC infra and assert the correct op is dispatched with
 * the picked OCC face id, and that the feature is re-tagged 'direct-edit'.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const offsetCalls: Array<{ faceIds: number[]; distance: number }> = [];
const draftCalls: Array<{ faceIds: number[] }> = [];

vi.mock('../engine/occ/loader', () => ({ getOccSync: () => ({ oc: {} }), getOcc: () => Promise.resolve({ oc: {} }) }));
vi.mock('../engine/occ/globalRegistry', () => ({ globalBRepBodyRegistry: { get: () => ({ id: 'body' }) } }));
vi.mock('../store/meshRegistry', () => ({ liveBodyMeshes: new Map() }));
vi.mock('../engine/occ/picking', () => ({ disposeMeshDeferred: () => {} }));
vi.mock('../engine/occ/registeredMesh', () => ({
  createRegisteredOccMesh: (_oc: unknown, _b: unknown, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat),
}));
vi.mock('../engine/occ/ops/offsetFaces', () => ({
  occOffsetFacesWithInstance: (_oc: unknown, _b: unknown, faceIds: number[], distance: number) => {
    offsetCalls.push({ faceIds, distance });
    return { id: 'offsetResult' };
  },
}));
vi.mock('../engine/occ/ops/draft', () => ({
  occDraftWithInstance: (_oc: unknown, _b: unknown, faceIds: number[]) => {
    draftCalls.push({ faceIds });
    return { id: 'draftResult' };
  },
}));
vi.mock('../engine/occ/geomSurface', () => ({
  sketchPlaneFromFace: () => ({ frame: { origin: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(0, 0, 1) } }),
}));

import { createFaceFeatureDialogActions } from '../store/cad/slices/uiAndSketchTools/surfaceUi/faceFeatureDialogActions';
import type { Feature } from '../types/cad';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(initial: Record<string, any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state: Record<string, any> = {
    statusMessage: '', activeDialog: 'direct-edit',
    setStatusMessage: (m: string) => { state.statusMessage = m; },
    setActiveDialog: (d: string | null) => { state.activeDialog = d; },
    pushUndo: () => {},
    ...initial,
  };
  const get = () => state;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (patch: any) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  return { ctx: { set, get } as never, get };
}

function feature(): Feature {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  return { id: 'f1', name: 'Box', type: 'extrude', params: {}, mesh, visible: true, suppressed: false, timestamp: Date.now() } as Feature;
}

function baseState() {
  return {
    features: [feature()],
    directEditFaceId: 'face-mesh-id',
    directEditOccBodyId: 'body',
    directEditOccFaceId: 7,
    directEditFeatureId: 'f1',
  };
}

describe('commitDirectEdit dispatch', () => {
  beforeEach(() => { offsetCalls.length = 0; draftCalls.length = 0; });

  it("mode 'offset-face' routes to occOffsetFacesWithInstance with the picked face id", () => {
    const { ctx, get } = makeCtx(baseState());
    const actions = createFaceFeatureDialogActions(ctx);
    actions.commitDirectEdit!({ mode: 'offset-face', distance: 3 });
    expect(offsetCalls).toEqual([{ faceIds: [7], distance: 3 }]);
    expect(draftCalls).toHaveLength(0);
    const f = get().features.find((x: Feature) => x.id === 'f1') as Feature;
    expect(f.params.featureKind).toBe('direct-edit');
  });

  it("mode 'extrude' also routes to occOffsetFacesWithInstance", () => {
    const { ctx } = makeCtx(baseState());
    const actions = createFaceFeatureDialogActions(ctx);
    actions.commitDirectEdit!({ mode: 'extrude', distance: -2 });
    expect(offsetCalls).toEqual([{ faceIds: [7], distance: -2 }]);
    expect(draftCalls).toHaveLength(0);
  });

  it("mode 'taper' routes to occDraftWithInstance", () => {
    const { ctx } = makeCtx(baseState());
    const actions = createFaceFeatureDialogActions(ctx);
    actions.commitDirectEdit!({ mode: 'taper', distance: 0, tapAngle: 5 });
    expect(draftCalls).toEqual([{ faceIds: [7] }]);
    expect(offsetCalls).toHaveLength(0);
  });
});
