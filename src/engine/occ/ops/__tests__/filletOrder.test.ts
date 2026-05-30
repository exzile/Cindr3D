/**
 * OCC-16.D2 — Unit tests for topologicalFilletOrder.
 * Pure function, no OCC calls needed.
 */
import { describe, it, expect } from 'vitest';
import { topologicalFilletOrder } from '../filletOrder';
import type { EdgePartition } from '../adjacency';

describe('topologicalFilletOrder', () => {
  it('returns [[circleId], [lineId]] when circle and line share a vertex', () => {
    const partition: EdgePartition = {
      round: [10],
      linear: [20],
      roundAdjacentToLinear: [10],
      linearAdjacentToRound: [20],
    };
    const result = topologicalFilletOrder(partition);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([10]);
    expect(result[1]).toEqual([20]);
  });

  it('returns [] when only circles (no cross-type adjacency)', () => {
    const partition: EdgePartition = {
      round: [10, 11],
      linear: [],
      roundAdjacentToLinear: [],
      linearAdjacentToRound: [],
    };
    expect(topologicalFilletOrder(partition)).toEqual([]);
  });

  it('returns [] when only linear edges', () => {
    const partition: EdgePartition = {
      round: [],
      linear: [20, 21],
      roundAdjacentToLinear: [],
      linearAdjacentToRound: [],
    };
    expect(topologicalFilletOrder(partition)).toEqual([]);
  });

  it('returns [] when round and linear edges exist but none are adjacent', () => {
    const partition: EdgePartition = {
      round: [10],
      linear: [20],
      roundAdjacentToLinear: [],
      linearAdjacentToRound: [],
    };
    expect(topologicalFilletOrder(partition)).toEqual([]);
  });

  it('places non-adjacent round edges in a third group after the adjacency groups', () => {
    // round 10 adjacent to linear 20; round 11 isolated
    const partition: EdgePartition = {
      round: [10, 11],
      linear: [20],
      roundAdjacentToLinear: [10],
      linearAdjacentToRound: [20],
    };
    const result = topologicalFilletOrder(partition);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual([10]);  // adjacent round first
    expect(result[1]).toEqual([20]);  // adjacent linear second
    expect(result[2]).toEqual([11]);  // isolated round appended
  });

  it('places non-adjacent linear edges in a group after the adjacency groups', () => {
    const partition: EdgePartition = {
      round: [10],
      linear: [20, 21],
      roundAdjacentToLinear: [10],
      linearAdjacentToRound: [20],
    };
    const result = topologicalFilletOrder(partition);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual([10]);
    expect(result[1]).toEqual([20]);
    expect(result[2]).toEqual([21]);
  });

  it('real failing case: notch arc (r6.71 circle) adjacent to top line edge', () => {
    const notchRimId = 42;
    const topEdgeId = 7;
    const partition: EdgePartition = {
      round: [notchRimId],
      linear: [topEdgeId],
      roundAdjacentToLinear: [notchRimId],
      linearAdjacentToRound: [topEdgeId],
    };
    const result = topologicalFilletOrder(partition);
    expect(result[0]).toContain(notchRimId);
    expect(result[1]).toContain(topEdgeId);
  });
});
