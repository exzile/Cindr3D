import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Sketch, SketchEntity } from '../types/cad';

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
    useCADStore.getState().commitExtrude();

    useCADStore.setState({
      sketches: [sketchA, sketchB],
      extrudeSelectedSketchIds: [`${sketchB.id}::0`],
      extrudeSelectedSketchId: `${sketchB.id}::0`,
      extrudeOperation: 'join',
    });
    useCADStore.getState().commitExtrude();

    const state = useCADStore.getState();
    expect(state.features.filter((f) => f.type === 'extrude')).toHaveLength(2);
    expect(state.features.at(-1)?.params.operation).toBe('join');
    expect(Object.keys(useComponentStore.getState().bodies)).toHaveLength(1);
  });

  it('still promotes edge-only contact to a new body', async () => {
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
    useCADStore.getState().commitExtrude();

    useCADStore.setState({
      sketches: [sketchA, sketchB],
      extrudeSelectedSketchIds: [`${sketchB.id}::0`],
      extrudeSelectedSketchId: `${sketchB.id}::0`,
      extrudeOperation: 'join',
    });
    useCADStore.getState().commitExtrude();

    const state = useCADStore.getState();
    expect(state.features.filter((f) => f.type === 'extrude')).toHaveLength(2);
    expect(state.features.at(-1)?.params.operation).toBe('new-body');
    expect(Object.keys(useComponentStore.getState().bodies)).toHaveLength(2);
  });
});
