import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCADPersistConfig } from '../store/cad/persistConfig';
import { mergeActiveSketchForPersistence } from '../store/cad/persistence';
import type { Sketch } from '../types/cad';

const sketch = (id: string, entityCount = 0): Sketch => ({
  id,
  name: id,
  plane: 'XY',
  planeNormal: new THREE.Vector3(0, 0, 1),
  planeOrigin: new THREE.Vector3(),
  entities: Array.from({ length: entityCount }, (_, index) => ({
    id: `${id}-entity-${index}`,
    type: 'line',
    points: [
      { id: `${id}-entity-${index}-0`, x: 0, y: 0, z: 0 },
      { id: `${id}-entity-${index}-1`, x: 1, y: 0, z: 0 },
    ],
  })),
  constraints: [],
  dimensions: [],
  fullyConstrained: false,
});

describe('CAD persistence config', () => {
  it('replaces a stale saved sketch with the active sketch snapshot', () => {
    const stale = sketch('sketch-a', 1);
    const active = sketch('sketch-a', 2);

    const result = mergeActiveSketchForPersistence([stale], active);

    expect(result).toEqual([active]);
    expect(result[0].entities).toHaveLength(2);
  });

  it('appends the active sketch when it has not been committed into sketches yet', () => {
    const saved = sketch('sketch-a', 1);
    const active = sketch('sketch-b', 1);

    expect(mergeActiveSketchForPersistence([saved], active)).toEqual([saved, active]);
  });

  it('leaves sketches untouched when there is no active sketch snapshot', () => {
    const saved = [sketch('sketch-a', 1)];

    expect(mergeActiveSketchForPersistence(saved, null)).toBe(saved);
  });

  it('persists design metadata arrays used by construction and assembly tools', () => {
    const partialize = createCADPersistConfig().partialize!;
    const state = {
      gridSize: 1,
      snapEnabled: true,
      gridVisible: true,
      sketchPolygonSides: 6,
      sketchFilletRadius: 2,
      units: 'mm',
      visualStyle: 'shaded',
      showEnvironment: true,
      showShadows: true,
      showGroundPlane: true,
      showComponentColors: false,
      viewportLayout: 'single',
      ambientOcclusionEnabled: false,
      dimensionToleranceMode: 'none',
      dimensionToleranceUpper: 0,
      dimensionToleranceLower: 0,
      activeSketch: null,
      sketches: [],
      features: [],
      designConfigurations: [],
      activeDesignConfigurationId: 'default',
      parameters: [],
      constructionPlanes: [{ id: 'plane-1', name: 'Plane 1', origin: [0, 0, 0], normal: [0, 0, 1], size: 100 }],
      constructionAxes: [{ id: 'axis-1', name: 'Axis 1', origin: [0, 0, 0], direction: [1, 0, 0], length: 100 }],
      constructionPoints: [{ id: 'point-1', name: 'Point 1', position: [1, 2, 3] }],
      contactSets: [{ id: 'contact-1', name: 'Contact 1', component1Id: 'a', component2Id: 'b', enabled: true }],
      selectionSets: [{ id: 'selection-1', name: 'Selection 1', bodyIds: ['body-1'] }],
      frozenFormVertices: [],
      featureGroups: [],
      canvasReferences: [],
      jointOrigins: [],
      formBodies: [],
    } as unknown as Parameters<typeof partialize>[0];
    const persisted = partialize(state) as Record<string, unknown>;

    expect(persisted.constructionPlanes).toHaveLength(1);
    expect(persisted.constructionAxes).toHaveLength(1);
    expect(persisted.constructionPoints).toHaveLength(1);
    expect(persisted.contactSets).toHaveLength(1);
    expect(persisted.selectionSets).toHaveLength(1);
  });
});
