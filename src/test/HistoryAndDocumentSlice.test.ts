import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { ConstructionGeometry, Feature, Sketch, SketchDimension, SketchEntity } from '../types/cad';

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
      constructions: {},
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

  it('reloads component construction vectors as Vector3 instances', async () => {
    const [{ useCADStore }, { useComponentStore }] = await Promise.all([
      import('../store/cadStore'),
      import('../store/componentStore'),
    ]);
    const rootComponentId = useComponentStore.getState().rootComponentId;
    const construction: ConstructionGeometry = {
      id: 'construction-plane-1',
      name: 'Offset Plane',
      type: 'plane',
      componentId: rootComponentId,
      visible: true,
      planeNormal: new THREE.Vector3(0, 0, 1),
      planeOrigin: new THREE.Vector3(10, 20, 30),
      planeSize: 75,
      definition: { method: 'offset-plane', referencePlane: 'XY', distance: 30 },
    };
    useComponentStore.setState({
      constructions: { [construction.id]: construction },
    });

    const json = useCADStore.getState().getDesignJSON();
    useComponentStore.setState({ constructions: {} });
    useCADStore.getState().loadFromFile(json);

    const restored = useComponentStore.getState().constructions[construction.id];
    expect(restored?.planeNormal).toBeInstanceOf(THREE.Vector3);
    expect(restored?.planeOrigin).toBeInstanceOf(THREE.Vector3);
    expect(restored?.planeNormal?.toArray()).toEqual([0, 0, 1]);
    expect(restored?.planeOrigin?.toArray()).toEqual([10, 20, 30]);
    expect(restored?.definition).toEqual(construction.definition);
  });

  it('clears component animation tracks on cad New Document', async () => {
    const [{ useCADStore }, { useComponentStore }] = await Promise.all([
      import('../store/cadStore'),
      import('../store/componentStore'),
    ]);
    useComponentStore.setState({
      animationTracks: [{ jointId: 'j-anim', startValue: 0, endValue: 90, easing: 'linear' }],
    });

    useCADStore.getState().newDocument();

    expect(useComponentStore.getState().animationTracks).toEqual([]);
  });

  it('component New Document resets the full document field set', async () => {
    const { useComponentStore } = await import('../store/componentStore');
    useComponentStore.setState({
      animationTracks: [{ jointId: 'j-anim', startValue: 0, endValue: 90, easing: 'linear' }],
      rigidGroups: [{ id: 'rg1' } as never],
      motionLinks: [{ id: 'ml1' } as never],
      occurrences: { o1: {} as never },
      definitions: { d1: {} as never },
      explodedOffsets: { e1: {} as never },
    });

    useComponentStore.getState().newDocument();

    const state = useComponentStore.getState();
    expect(state.animationTracks).toEqual([]);
    expect(state.rigidGroups).toEqual([]);
    expect(state.motionLinks).toEqual([]);
    expect(state.occurrences).toEqual({});
    expect(state.definitions).toEqual({});
    expect(state.explodedOffsets).toEqual({});
  });

  it('restores design and component metadata through undo', async () => {
    const [{ useCADStore }, { useComponentStore }] = await Promise.all([
      import('../store/cadStore'),
      import('../store/componentStore'),
    ]);
    const rootComponentId = useComponentStore.getState().rootComponentId;
    const construction: ConstructionGeometry = {
      id: 'undo-construction-plane',
      name: 'Undo Plane',
      type: 'plane',
      componentId: rootComponentId,
      visible: true,
      planeNormal: new THREE.Vector3(0, 1, 0),
      planeOrigin: new THREE.Vector3(4, 5, 6),
      definition: { method: 'offset-plane', referencePlane: 'XZ', distance: 5 },
    };

    useCADStore.setState({
      constructionPlanes: [{ id: 'plane-a', name: 'Plane A', origin: [0, 0, 0], normal: [0, 0, 1], size: 25 }],
      constructionAxes: [{ id: 'axis-a', name: 'Axis A', origin: [0, 0, 0], direction: [1, 0, 0], length: 25 }],
      constructionPoints: [{ id: 'point-a', name: 'Point A', position: [1, 2, 3] }],
      contactSets: [{ id: 'contact-a', name: 'Contact A', component1Id: 'c1', component2Id: 'c2', enabled: true }],
      selectionSets: [{ id: 'selection-a', name: 'Selection A', bodyIds: ['body-a'] }],
    });
    useComponentStore.setState({ constructions: { [construction.id]: construction } });
    useCADStore.getState().pushUndo();

    useCADStore.setState({
      constructionPlanes: [],
      constructionAxes: [],
      constructionPoints: [],
      contactSets: [],
      selectionSets: [],
    });
    useComponentStore.setState({ constructions: {} });

    useCADStore.getState().undo();

    expect(useCADStore.getState().constructionPlanes).toHaveLength(1);
    expect(useCADStore.getState().constructionAxes).toHaveLength(1);
    expect(useCADStore.getState().constructionPoints).toHaveLength(1);
    expect(useCADStore.getState().contactSets).toHaveLength(1);
    expect(useCADStore.getState().selectionSets).toHaveLength(1);
    const restoredConstruction = useComponentStore.getState().constructions[construction.id];
    expect(restoredConstruction?.planeNormal).toBeInstanceOf(THREE.Vector3);
    expect(restoredConstruction?.planeOrigin?.toArray()).toEqual([4, 5, 6]);
  });
});
