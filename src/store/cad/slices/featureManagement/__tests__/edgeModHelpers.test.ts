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

// OCC-17 changed the round-seed guard from computeEdgeAnchor to getSelectableEdges
// so it can distinguish full circles (kind='circle', span>=2π) from arcs. The
// computeEdgeAnchor mock is no longer in the code path — mock getSelectableEdges instead.
const mockEdgeMeta = new Map<number, { kind: string }>();
vi.mock('../../../../../engine/occ/ops/selectableEdges', () => ({
  getSelectableEdges: () => mockEdgeMeta,
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
    // Edge 1 is a full circle — the guard should hold it back from propagation.
    mockEdgeMeta.set(1, { kind: 'circle' });
    collectTangentChainEdges.mockReturnValue([1, 2, 3]);

    const sets = resolveOccFilletEdgeSets([1], body, { propagate: true, radius: 1 });

    expect(sets).toEqual([{ edgeIds: [1], radius: 1 }]);
    expect(collectTangentChainEdges).not.toHaveBeenCalled();
  });

  it('still expands non-round edge seeds when tangent propagation is enabled', () => {
    // Edge 1 is a line — arcs and lines both propagate.
    mockEdgeMeta.set(1, { kind: 'line' });
    collectTangentChainEdges.mockReturnValue([1, 2]);

    const sets = resolveOccFilletEdgeSets([1], body, { propagate: true, radius: 1 });

    expect(sets).toEqual([{ edgeIds: [1, 2], radius: 1 }]);
  });
});
