/**
 * OCC-16.B1 — Pure ordering function for topology-aware fillet sequencing.
 *
 * Given an EdgePartition (from partitionEdgesByTopology), returns an ordered
 * list of edge-id groups to apply as sequential combined passes.  Round edges
 * that share a vertex with linear edges go in group 1 so OCC has the blended
 * topology before the linear edges are attempted in group 2.
 *
 * Returns [] when there is no cross-type adjacency (caller should skip this path).
 * No OCC calls — entirely unit-testable with mocked partitions.
 */
import type { EdgePartition } from './adjacency';

/**
 * Returns an ordered array of edge-id groups.  Each group is applied as a
 * single combined BRepFilletAPI_MakeFillet pass on the running body:
 *   - group[0] : round edges adjacent to linear edges  (fillet the arcs first)
 *   - group[1] : linear edges adjacent to round edges  (line edges after arc blend)
 *   - remaining non-adjacent rounds and linears are appended as extra groups in
 *     that order (they have no cross-type adjacency so order doesn't matter for them).
 *
 * Returns [] when the partition has no cross-type adjacency — the topological
 * fallback only helps when at least one round edge is adjacent to a linear edge.
 */
export function topologicalFilletOrder(partition: EdgePartition): number[][] {
  const { round, linear, roundAdjacentToLinear, linearAdjacentToRound } = partition;

  if (roundAdjacentToLinear.length === 0 || linearAdjacentToRound.length === 0) {
    return [];
  }

  const groups: number[][] = [];

  // Group 1: round edges adjacent to linear.
  groups.push(roundAdjacentToLinear);

  // Group 2: linear edges adjacent to round.
  groups.push(linearAdjacentToRound);

  // Any remaining round edges not in group 1.
  const adjRoundSet = new Set(roundAdjacentToLinear);
  const remainingRound = round.filter((id) => !adjRoundSet.has(id));
  if (remainingRound.length > 0) groups.push(remainingRound);

  // Any remaining linear edges not in group 2.
  const adjLinearSet = new Set(linearAdjacentToRound);
  const remainingLinear = linear.filter((id) => !adjLinearSet.has(id));
  if (remainingLinear.length > 0) groups.push(remainingLinear);

  return groups;
}
