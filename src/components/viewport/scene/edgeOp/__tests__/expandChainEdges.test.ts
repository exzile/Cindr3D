import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { expandChainEdges } from '../edgeOpEdgeGeometry';

// edgePolylines values are irrelevant to expandChainEdges — it only checks `.has`.
function polylines(...ids: number[]): Map<number, THREE.Vector3[]> {
  const m = new Map<number, THREE.Vector3[]>();
  for (const id of ids) m.set(id, [new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
  return m;
}

describe('expandChainEdges (OCC-12 B2/B3)', () => {
  it('returns just the seed when there is no chain map', () => {
    const result = expandChainEdges(undefined, polylines(5), 5);
    expect([...result]).toEqual([5]);
  });

  it('returns just the seed when the seed has no chain id', () => {
    const chain = new Map<number, number>([[7, 0]]);
    const result = expandChainEdges(chain, polylines(5), 5);
    expect([...result]).toEqual([5]);
  });

  it('expands to every rendered edge sharing the seed chain id', () => {
    // edges 1,2,3 are chain 0; edge 4 is chain 1.
    const chain = new Map<number, number>([[1, 0], [2, 0], [3, 0], [4, 1]]);
    const result = expandChainEdges(chain, polylines(1, 2, 3, 4), 2);
    expect([...result].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('omits chain members that are not currently rendered', () => {
    // edge 3 is in the chain but absent from the rendered polylines.
    const chain = new Map<number, number>([[1, 0], [2, 0], [3, 0]]);
    const result = expandChainEdges(chain, polylines(1, 2), 1);
    expect([...result].sort((a, b) => a - b)).toEqual([1, 2]);
  });
});
