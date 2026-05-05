import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildNonPlanarIroningPoints, sortIroningLinesMonotonic } from './finalizeLayer';
import type { Triangle } from '../../../../../types/slicer-pipeline.types';

const line = (
  from: [number, number],
  to: [number, number],
) => ({
  from: new THREE.Vector2(...from),
  to: new THREE.Vector2(...to),
});

describe('sortIroningLinesMonotonic', () => {
  it('orders lines by their scan row and keeps extrusion direction monotonic', () => {
    const sorted = sortIroningLinesMonotonic([
      line([10, 2], [0, 2]),
      line([8, 0], [2, 0]),
      line([5, 1], [1, 1]),
    ]);

    expect(sorted.map((item) => item.from.y)).toEqual([0, 1, 2]);
    for (const item of sorted) {
      expect(item.from.x).toBeLessThanOrEqual(item.to.x);
    }
  });

  it('does not mutate the original line objects when reversing direction', () => {
    const original = line([10, 0], [0, 0]);
    const [sorted] = sortIroningLinesMonotonic([original]);

    expect(sorted.from.x).toBe(0);
    expect(sorted.to.x).toBe(10);
    expect(original.from.x).toBe(10);
    expect(original.to.x).toBe(0);
  });
});

describe('buildNonPlanarIroningPoints', () => {
  it('samples top surface Z and clamps lift above the planar layer', () => {
    const tri: Triangle = {
      v0: new THREE.Vector3(0, 0, 0),
      v1: new THREE.Vector3(10, 0, 1),
      v2: new THREE.Vector3(0, 10, 0),
      normal: new THREE.Vector3(0, -0.1, 1).normalize(),
      edgeKey01: '0:1',
      edgeKey12: '1:2',
      edgeKey20: '2:0',
    };

    const points = buildNonPlanarIroningPoints(
      line([0, 0], [10, 0]),
      [tri],
      { x: 0, y: 0, z: 0 },
      0,
      0.5,
      5,
    );

    expect(points).toHaveLength(3);
    expect(points[0].z).toBeCloseTo(0);
    expect(points[1].z).toBeCloseTo(0.5);
    expect(points[2].z).toBeCloseTo(0.5);
  });

  it('falls back to planar Z when no top surface covers the point', () => {
    const points = buildNonPlanarIroningPoints(
      line([20, 20], [25, 20]),
      [],
      { x: 0, y: 0, z: 0 },
      0.2,
      0.5,
      5,
    );

    expect(points.every((point) => point.z === 0.2)).toBe(true);
  });
});
