import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Sketch, SketchEntity } from '../types/cad';

// ── OCC infrastructure mocks ─────────────────────────────────────────────────
// The test exercises commit logic (join/new-body promotion), not OCC geometry.
// Mock the OCC loader and geometry ops so the WASM URL isn't resolved in jsdom.

let bodyCounter = 0;
function makeFakeBody(id = `body-${++bodyCounter}`) {
  const faceIds = new Map([[1, {}], [2, {}]]);
  const edgeIds = new Map([[1, {}]]);
  return {
    id,
    sourceFeatureId: undefined as string | undefined,
    shape: { ptr: bodyCounter, isDisposed: false, dispose() {}, deref() { return {}; } },
    faceIds,
    edgeIds,
    vertexIds: new Map(),
    revision: 1,
    dispose() {},
    ownedResources: [],
  };
}

vi.mock('../engine/occ/loader', () => ({
  getOcc: () => Promise.resolve({ oc: {} }),
  getOccSync: () => ({ oc: {} }),
}));

vi.mock('../engine/occ/ops/extrude', () => ({
  occExtrudeWithInstance: () => ({
    shape: {},
    ownedResources: [],
    dispose() {},
  }),
}));

vi.mock('../engine/occ/ops/booleanCore', () => ({
  performOccBooleanWithInstance: () => makeFakeBody(),
}));

vi.mock('../engine/occ/tessellate', () => ({
  tessellateWithInstance: () => ({ geometry: new THREE.BufferGeometry(), triangleCount: 2 }),
  tessellationToGeometry: () => new THREE.BufferGeometry(),
  attachTessellationToMesh: () => {},
}));

// Track which join scenario the test is exercising via the sketch geometry.
// sketchB's x1 determines face-touching (x1=10 with overlap in Z) vs edge-only (x1=10 corner).
let _joinShouldSucceed = false;
export function _setJoinShouldSucceed(v: boolean) { _joinShouldSucceed = v; }

vi.mock('../store/cad/slices/extrudeRevolve/extrudeCommitOccBoolean', async (importOriginal) => {
  const real = await importOriginal<typeof import('../store/cad/slices/extrudeRevolve/extrudeCommitOccBoolean')>();
  return {
    ...real,
    // Stub OCC boolean: return a mesh for face-touching join, nothing for edge-only.
    buildSingleProfileOccBooleanExtrudeMesh: async (params: { selected: string[] }) => {
      // Face-touching join test uses sketch-b::0; we gate on the flag set before each it().
      void params;
      if (!_joinShouldSucceed) {
        return { needsStoredMesh: false, occBooleanResolved: false, occFailureMessage: null, stale: false };
      }
      const fakeBody = makeFakeBody();
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
      mesh.userData.brepBodyId = fakeBody.id;
      return {
        featureMesh: mesh,
        needsStoredMesh: true,
        suppressedTargetId: 'target-id',
        bodyId: undefined as string | undefined,
        componentId: undefined as string | undefined,
        committedDirection: undefined,
        occBooleanResolved: true,
        occFailureMessage: null,
        stale: false,
      };
    },
    buildMultiProfileOccBooleanExtrudeMesh: async () => ({
      needsStoredMesh: false,
      occBooleanResolved: false,
      occFailureMessage: null,
      stale: false,
    }),
  };
});

vi.mock('../engine/occ/brepBody', async (importOriginal) => {
  const real = await importOriginal<typeof import('../engine/occ/brepBody')>();
  return {
    ...real,
    makeBRepBodyFromOccShape: (_oc: unknown, _shape: unknown, opts?: { id?: string }) =>
      makeFakeBody(opts?.id),
  };
});

vi.mock('../engine/occ/tessellate', () => ({
  tessellateOccBody: () => ({
    geometry: new THREE.BufferGeometry(),
    tessellation: null,
  }),
}));

vi.mock('../engine/occ/registeredMesh', () => ({
  createRegisteredOccMesh: () => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    mesh.userData.brepBodyId = 'fake';
    return mesh;
  },
}));

const mkPoint = (id: string, x: number, z: number) => ({ id, x, y: 0, z });

function mkRectangleSketch(id: string, x1: number, z1: number, x2: number, z2: number): Sketch {
  const entity: SketchEntity = {
    id: `${id}-rect`,
    type: 'rectangle',
    points: [
      mkPoint(`${id}-p1`, x1, z1),
      mkPoint(`${id}-p2`, x2, z2),
    ],
    closed: true,
  };

  return {
    id,
    name: id,
    plane: 'XY',
    planeNormal: new THREE.Vector3(0, 1, 0),
    planeOrigin: new THREE.Vector3(0, 0, 0),
    entities: [entity],
    constraints: [],
    dimensions: [],
    fullyConstrained: false,
  };
}

describe('commitExtrude join operation', () => {
  beforeEach(async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
      clear: () => { storage.clear(); },
    });

    const [{ useCADStore }, { useComponentStore }] = await Promise.all([
      import('../store/cadStore'),
      import('../store/componentStore'),
    ]);
    const rootComponentId = useComponentStore.getState().rootComponentId;
    useComponentStore.setState({
      activeComponentId: rootComponentId,
      bodies: {},
      selectedBodyId: null,
    });
    useCADStore.setState({
      sketches: [],
      features: [],
      activeTool: 'select',
      editingFeatureId: null,
      extrudeSelectedSketchId: null,
      extrudeSelectedSketchIds: [],
      extrudeDistance: 10,
      extrudeDistance2: 10,
      extrudeDirection: 'positive',
      extrudeOperation: 'new-body',
      extrudeThinEnabled: false,
      extrudeBodyKind: 'solid',
      extrudeStartType: 'profile',
      extrudeStartOffset: 0,
      extrudeExtentType: 'distance',
      extrudeExtentType2: 'distance',
      extrudeTaperAngle: 0,
      extrudeTaperAngle2: 0,
      extrudeParticipantBodyIds: [],
      extrudeConfinedFaceIds: [],
    });
  });

  it('keeps face-touching join extrudes on the existing body', async () => {
    _setJoinShouldSucceed(true); // face-touching → OCC boolean succeeds → join stays on same body
    const [{ useCADStore }, { useComponentStore }] = await Promise.all([
      import('../store/cadStore'),
      import('../store/componentStore'),
    ]);
    const sketchA = mkRectangleSketch('sketch-a', 0, 0, 10, 10);
    const sketchB = mkRectangleSketch('sketch-b', 10, 2, 20, 8);

    useCADStore.setState({
      sketches: [sketchA],
      extrudeSelectedSketchIds: [`${sketchA.id}::0`],
      extrudeSelectedSketchId: `${sketchA.id}::0`,
      extrudeOperation: 'new-body',
    });
    await useCADStore.getState().commitExtrude();

    useCADStore.setState({
      sketches: [sketchA, sketchB],
      extrudeSelectedSketchIds: [`${sketchB.id}::0`],
      extrudeSelectedSketchId: `${sketchB.id}::0`,
      extrudeOperation: 'join',
    });
    await useCADStore.getState().commitExtrude();

    const state = useCADStore.getState();
    expect(state.features.filter((f) => f.type === 'extrude')).toHaveLength(2);
    expect(state.features.at(-1)?.params.operation).toBe('join');
    expect(Object.keys(useComponentStore.getState().bodies)).toHaveLength(1);
  });

  it('still promotes edge-only contact to a new body', async () => {
    _setJoinShouldSucceed(false); // edge-only → OCC boolean fails → promoted to new-body
    const [{ useCADStore }, { useComponentStore }] = await Promise.all([
      import('../store/cadStore'),
      import('../store/componentStore'),
    ]);
    const sketchA = mkRectangleSketch('sketch-a', 0, 0, 10, 10);
    const sketchB = mkRectangleSketch('sketch-b', 10, 10, 20, 20);

    useCADStore.setState({
      sketches: [sketchA],
      extrudeSelectedSketchIds: [`${sketchA.id}::0`],
      extrudeSelectedSketchId: `${sketchA.id}::0`,
      extrudeOperation: 'new-body',
    });
    await useCADStore.getState().commitExtrude();

    useCADStore.setState({
      sketches: [sketchA, sketchB],
      extrudeSelectedSketchIds: [`${sketchB.id}::0`],
      extrudeSelectedSketchId: `${sketchB.id}::0`,
      extrudeOperation: 'join',
    });
    await useCADStore.getState().commitExtrude();

    const state = useCADStore.getState();
    expect(state.features.filter((f) => f.type === 'extrude')).toHaveLength(2);
    expect(state.features.at(-1)?.params.operation).toBe('new-body');
    expect(Object.keys(useComponentStore.getState().bodies)).toHaveLength(2);
  });
});
