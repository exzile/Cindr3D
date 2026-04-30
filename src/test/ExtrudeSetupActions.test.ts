import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GeometryEngine } from '../engine/GeometryEngine';
import type { Sketch, SketchEntity } from '../types/cad';

const mkPoint = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

function mkActiveRectangleSketch(planeNormal: THREE.Vector3): Sketch {
  const entity: SketchEntity = {
    id: 'rect-1',
    type: 'rectangle',
    points: [
      mkPoint('p1', 0, 0, 0),
      mkPoint('p2', 20, 0, 10),
    ],
    closed: true,
  };

  return {
    id: 'active-sketch-1',
    name: 'Sketch 1',
    plane: 'XY',
    planeNormal,
    planeOrigin: new THREE.Vector3(0, 0, 0),
    entities: [entity],
    constraints: [],
    dimensions: [],
    fullyConstrained: false,
  };
}

describe('startExtrudeTool', () => {
  it('finishes an active rectangle sketch before profile selection', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
      clear: () => { storage.clear(); },
    });

    const [{ useCADStore }, { getPlaneNormal }] = await Promise.all([
      import('../store/cadStore'),
      import('../store/cad/defaults'),
    ]);
    const activeSketch = mkActiveRectangleSketch(getPlaneNormal('XY'));

    useCADStore.setState({
      activeSketch,
      sketches: [],
      features: [],
      activeTool: 'rectangle',
      viewMode: 'sketch',
      sketchPlaneSelecting: false,
    });

    useCADStore.getState().startExtrudeTool();

    const state = useCADStore.getState();
    expect(state.activeSketch).toBeNull();
    expect(state.activeTool).toBe('extrude');
    expect(state.sketches).toHaveLength(1);
    expect(state.sketches[0].id).toBe(activeSketch.id);
    expect(state.features.some((feature) => feature.type === 'sketch' && feature.sketchId === activeSketch.id)).toBe(true);
    expect(GeometryEngine.createProfileSketch(state.sketches[0], 0)).not.toBeNull();
  });

  it('selects a concrete profile when starting press-pull from a face', async () => {
    const [{ useCADStore }] = await Promise.all([
      import('../store/cadStore'),
    ]);
    const boundary = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(10, 0, 0),
      new THREE.Vector3(10, 0, 10),
      new THREE.Vector3(0, 0, 10),
    ];

    useCADStore.setState({
      sketches: [],
      features: [],
      extrudeSelectedSketchId: null,
      extrudeSelectedSketchIds: [],
    });

    useCADStore.getState().startExtrudeFromFace(
      boundary,
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(5, 0, 5),
    );

    const state = useCADStore.getState();
    expect(state.sketches).toHaveLength(1);
    expect(state.extrudeSelectedSketchIds).toEqual([`${state.sketches[0].id}::0`]);
    expect(state.extrudeSelectedSketchId).toBe(`${state.sketches[0].id}::0`);
    expect(GeometryEngine.createProfileSketch(state.sketches[0], 0)).not.toBeNull();
  });
});
