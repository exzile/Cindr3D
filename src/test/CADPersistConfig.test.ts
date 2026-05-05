import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mergeActiveSketchForPersistence } from '../store/cad/persistConfig';
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
});
