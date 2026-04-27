import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { sortIroningLinesMonotonic } from './finalizeLayer';

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
