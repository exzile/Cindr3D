import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Feature, Sketch, SketchDimension, SketchEntity } from '../types/cad';

const mkSketch = (entities: SketchEntity[] = [], dimensions: SketchDimension[] = []): Sketch => ({
  id: 'active-case-sketch',
  name: 'Active case sketch',
  plane: 'XY',
  planeNormal: new THREE.Vector3(0, 1, 0),
  planeOrigin: new THREE.Vector3(0, 0, 0),
  entities,
  constraints: [],
  dimensions,
  fullyConstrained: false,
});

describe('history and document undo/redo', () => {
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
    const rootComponent = useComponentStore.getState().components[rootComponentId];
    useComponentStore.setState({
      activeComponentId: rootComponentId,
      selectedBodyId: null,
      components: { [rootComponentId]: { ...rootComponent, bodyIds: [], childIds: [], sketchIds: [] } },
      bodies: {},
    });
    useCADStore.setState({
      features: [],
      sketches: [],
      activeSketch: null,
      featureGroups: [],
      undoStack: [],
      redoStack: [],
      statusMessage: '',
    });
  });

  it('restores active sketch entities and dimensions on undo and redo', async () => {
    const { useCADStore } = await import('../store/cadStore');
    const emptySketch = mkSketch();

    useCADStore.setState({
      sketches: [emptySketch],
      activeSketch: emptySketch,
    });
    useCADStore.getState().pushUndo();

    const line: SketchEntity = {
      id: 'case-edge',
      type: 'line',
      points: [
        { id: 'p1', x: 0, y: 0, z: 0 },
        { id: 'p2', x: 62, y: 0, z: 0 },
      ],
    };
    const dimension: SketchDimension = {
      id: 'case-width',
      type: 'linear',
      entityIds: [line.id],
      value: 62,
      position: { x: 31, y: -6 },
      driven: false,
      orientation: 'horizontal',
    };
    const dimensionedSketch = mkSketch([line], [dimension]);
    useCADStore.setState({
      sketches: [dimensionedSketch],
      activeSketch: dimensionedSketch,
    });

    useCADStore.getState().undo();
    let state = useCADStore.getState();
    expect(state.activeSketch?.entities).toHaveLength(0);
    expect(state.activeSketch?.dimensions).toHaveLength(0);
    expect(state.sketches[0]?.entities).toHaveLength(0);

    useCADStore.getState().redo();
    state = useCADStore.getState();
    expect(state.activeSketch?.entities).toHaveLength(1);
    expect(state.activeSketch?.dimensions).toHaveLength(1);
    expect(state.activeSketch?.planeNormal).toBeInstanceOf(THREE.Vector3);
    expect(state.sketches[0]?.dimensions[0]?.value).toBe(62);
  });

  it('restores component bodies with the feature timeline on undo and redo', async () => {
    const [{ useCADStore }, { useComponentStore }] = await Promise.all([
      import('../store/cadStore'),
      import('../store/componentStore'),
    ]);
    const rootComponentId = useComponentStore.getState().rootComponentId;

    useCADStore.getState().pushUndo();

    const bodyId = useComponentStore.getState().addBody(rootComponentId, 'Body 1');
    const feature: Feature = {
      id: 'extrude-body-feature',
      name: 'Extrude 1',
      type: 'extrude',
      sketchId: 'active-case-sketch',
      bodyId,
      componentId: rootComponentId,
      params: { operation: 'new-body', distance: 10, direction: 'positive' },
      visible: true,
      suppressed: false,
      timestamp: 1,
      bodyKind: 'solid',
    };
    useComponentStore.getState().addFeatureToBody(bodyId, feature.id);
    useCADStore.setState({ features: [feature] });

    useCADStore.getState().undo();
    expect(useCADStore.getState().features).toHaveLength(0);
    expect(Object.keys(useComponentStore.getState().bodies)).toHaveLength(0);

    useCADStore.getState().redo();
    expect(useCADStore.getState().features).toHaveLength(1);
    expect(Object.keys(useComponentStore.getState().bodies)).toEqual([bodyId]);
    expect(useComponentStore.getState().bodies[bodyId]?.featureIds).toEqual([feature.id]);
  });
});
