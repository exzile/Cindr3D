import { describe, expect, it, vi } from 'vitest';
import { resolveOccFilletEdgeSets } from '../edgeModHelpers';
import type { BRepBody } from '../../../../../engine/occ/brepBody';

vi.mock('../../../../../engine/occ/loader', () => ({
  getOccSync: () => ({ oc: {} }),
}));

const collectTangentChainEdges = vi.fn();
vi.mock('../../../../../engine/occ/ops/adjacency', () => ({
  collectTangentChainEdges: (...args: unknown[]) => collectTangentChainEdges(...args),
}));

const computeEdgeAnchor = vi.fn();
vi.mock('../../../../../engine/occ/ops/edgeAnchor', () => ({
  computeEdgeAnchor: (...args: unknown[]) => computeEdgeAnchor(...args),
}));

const body = {
  edgeIds: new Map([
    [1, {}],
    [2, {}],
    [3, {}],
  ]),
} as unknown as BRepBody;

describe('resolveOccFilletEdgeSets', () => {
  it('keeps circular edge seeds local even when tangent propagation is enabled', () => {
    computeEdgeAnchor.mockReturnValue({ kind: 'circle' });
    collectTangentChainEdges.mockReturnValue([1, 2, 3]);

    const sets = resolveOccFilletEdgeSets([1], body, { propagate: true, radius: 1 });

    expect(sets).toEqual([{ edgeIds: [1], radius: 1 }]);
    expect(collectTangentChainEdges).not.toHaveBeenCalled();
  });

  it('still expands non-round edge seeds when tangent propagation is enabled', () => {
    computeEdgeAnchor.mockReturnValue({ kind: 'line' });
    collectTangentChainEdges.mockReturnValue([1, 2]);

    const sets = resolveOccFilletEdgeSets([1], body, { propagate: true, radius: 1 });

    expect(sets).toEqual([{ edgeIds: [1, 2], radius: 1 }]);
  });
});
