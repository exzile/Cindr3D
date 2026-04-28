import { describe, expect, it } from 'vitest';
import type { MultiPolygon as PCMultiPolygon } from 'polygon-clipping';

import {
  filterMovesByBlockedMP,
  forcedSupportIslandsFromMP,
} from './support';
import type { SliceMove } from '../../../types/slicer';

// 10x10 square at origin, CCW outer ring, closed.
function squareMP(minX: number, minY: number, size: number): PCMultiPolygon {
  return [
    [
      [
        [minX, minY],
        [minX + size, minY],
        [minX + size, minY + size],
        [minX, minY + size],
        [minX, minY],
      ],
    ],
  ];
}

function supportMove(fromX: number, fromY: number, toX: number, toY: number): SliceMove {
  return {
    type: 'support',
    from: { x: fromX, y: fromY },
    to: { x: toX, y: toY },
    speed: 60,
    extrusion: 0,
    lineWidth: 0.4,
  };
}

describe('forcedSupportIslandsFromMP (Cura "Support Mesh")', () => {
  it('returns one island per outer polygon', () => {
    const mp: PCMultiPolygon = [
      ...squareMP(0, 0, 10),
      ...squareMP(50, 50, 5),
    ];
    const islands = forcedSupportIslandsFromMP(mp, 0.2, 0.2);
    expect(islands).toHaveLength(2);
  });

  it('skips degenerate (<3 vertex) outer rings', () => {
    const mp: PCMultiPolygon = [
      [
        [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
      ],
    ];
    expect(forcedSupportIslandsFromMP(mp, 0.2, 0.2)).toHaveLength(0);
  });

  it('island carries the outer ring as points and a non-zero area', () => {
    const islands = forcedSupportIslandsFromMP(squareMP(0, 0, 10), 0.2, 0.2);
    expect(islands[0].points.length).toBeGreaterThanOrEqual(3);
    expect(islands[0].area).toBeGreaterThan(0);
  });
});

describe('filterMovesByBlockedMP (Cura "Anti-Overhang Mesh")', () => {
  it('returns the moves untouched when the blocked region is empty', () => {
    const moves = [supportMove(0, 0, 10, 0)];
    expect(filterMovesByBlockedMP(moves, [])).toEqual(moves);
  });

  it('drops support moves whose midpoint is inside the blocked region', () => {
    const blocked = squareMP(0, 0, 10);
    const inside = supportMove(2, 5, 8, 5);   // midpoint (5, 5) inside
    const outside = supportMove(20, 5, 30, 5); // midpoint (25, 5) outside
    expect(filterMovesByBlockedMP([inside, outside], blocked)).toEqual([outside]);
  });

  it('preserves non-support moves regardless of region', () => {
    const blocked = squareMP(0, 0, 10);
    const move: SliceMove = {
      type: 'wall-outer',
      from: { x: 5, y: 5 },
      to: { x: 6, y: 5 },
      speed: 30,
      extrusion: 0.1,
      lineWidth: 0.4,
    };
    expect(filterMovesByBlockedMP([move], blocked)).toEqual([move]);
  });
});
