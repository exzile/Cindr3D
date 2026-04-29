import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { variableWidthPathsToPerimeters } from '../index';

const v = (x: number, y: number) => new THREE.Vector2(x, y);

describe('Arachne pipeline integration', () => {
  it('keeps per-vertex line widths when converting paths to perimeters', () => {
    const perimeters = variableWidthPathsToPerimeters([
      {
        points: [v(0, 0), v(1, 0), v(1, 1)],
        widths: [0.3, 0.4, 0.5],
        depth: 0,
        isClosed: false,
        source: 'outer',
      },
      {
        points: [v(2, 0), v(2, 1)],
        widths: [0.6, 0.7],
        depth: 1,
        isClosed: false,
        source: 'gapfill',
      },
    ]);

    expect(perimeters.outerCount).toBe(1);
    expect(perimeters.lineWidths).toEqual([
      [0.3, 0.4, 0.5],
      [0.6, 0.7],
    ]);
    expect(perimeters.wallClosed).toEqual([false, false]);
    expect(perimeters.wallDepths).toEqual([0, 1]);
  });

  it('removes Arachne duplicate closing points before emitting closed perimeters', () => {
    const perimeters = variableWidthPathsToPerimeters([
      {
        points: [v(0, 0), v(10, 0), v(10, 10), v(0, 0)],
        widths: [0.42, 0.43, 0.44, 0.45],
        depth: 0,
        isClosed: true,
        source: 'outer',
      },
    ]);

    expect(perimeters.walls[0]).toHaveLength(3);
    expect(perimeters.walls[0][0]).toEqual(v(0, 0));
    expect(perimeters.walls[0][2]).toEqual(v(10, 10));
    expect(perimeters.lineWidths[0]).toEqual([0.42, 0.43, 0.44]);
    expect(perimeters.wallClosed).toEqual([true]);
  });
});
