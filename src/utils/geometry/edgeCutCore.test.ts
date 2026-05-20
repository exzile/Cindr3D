import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  dedupEdgesByEndpoints,
  clusterEdgesByEndpointConnectivity,
  type PickedEdge,
} from './edgeCutCore';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('dedupEdgesByEndpoints', () => {
  it('returns a single edge unchanged', () => {
    const eps = 1e-3;
    const e: PickedEdge[] = [{ a: v(0, 0, 0), b: v(1, 0, 0) }];
    expect(dedupEdgesByEndpoints(e, eps)).toHaveLength(1);
  });

  it('dedupes exact-duplicate edges', () => {
    const eps = 1e-3;
    const e: PickedEdge[] = [
      { a: v(0, 0, 0), b: v(1, 0, 0) },
      { a: v(0, 0, 0), b: v(1, 0, 0) },
    ];
    expect(dedupEdgesByEndpoints(e, eps)).toHaveLength(1);
  });

  it('dedupes reversed-direction duplicates', () => {
    const eps = 1e-3;
    const e: PickedEdge[] = [
      { a: v(0, 0, 0), b: v(1, 0, 0) },
      { a: v(1, 0, 0), b: v(0, 0, 0) },
    ];
    expect(dedupEdgesByEndpoints(e, eps)).toHaveLength(1);
  });

  it('dedupes within-eps jittered duplicates (straddle case)', () => {
    const eps = 1e-3;
    // Two endpoints 1e-5 apart should canonicalize to the same key.
    const e: PickedEdge[] = [
      { a: v(0, 0, 0),       b: v(1, 0, 0) },
      { a: v(1e-5, 1e-5, 0), b: v(1, 1e-5, 0) },
    ];
    expect(dedupEdgesByEndpoints(e, eps)).toHaveLength(1);
  });

  it('keeps distinct edges', () => {
    const eps = 1e-3;
    const e: PickedEdge[] = [
      { a: v(0, 0, 0), b: v(1, 0, 0) },
      { a: v(0, 0, 0), b: v(0, 1, 0) },
      { a: v(1, 0, 0), b: v(1, 1, 0) },
    ];
    expect(dedupEdgesByEndpoints(e, eps)).toHaveLength(3);
  });

  it('drops zero-length edges', () => {
    const eps = 1e-3;
    const e: PickedEdge[] = [
      { a: v(0, 0, 0), b: v(0, 0, 0) },
      { a: v(0, 0, 0), b: v(1, 0, 0) },
    ];
    expect(dedupEdgesByEndpoints(e, eps)).toHaveLength(1);
  });
});

describe('clusterEdgesByEndpointConnectivity', () => {
  it('returns empty for empty input', () => {
    expect(clusterEdgesByEndpointConnectivity([], 1e-3)).toEqual([]);
  });

  it('groups a connected chain into one cluster', () => {
    const eps = 1e-3;
    // a→b, b→c, c→d — all connected
    const e: PickedEdge[] = [
      { a: v(0, 0, 0), b: v(1, 0, 0) },
      { a: v(1, 0, 0), b: v(2, 0, 0) },
      { a: v(2, 0, 0), b: v(3, 0, 0) },
    ];
    const clusters = clusterEdgesByEndpointConnectivity(e, eps);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  it('splits disjoint groups into separate clusters', () => {
    const eps = 1e-3;
    const e: PickedEdge[] = [
      // Group 1
      { a: v(0, 0, 0), b: v(1, 0, 0) },
      { a: v(1, 0, 0), b: v(2, 0, 0) },
      // Group 2 — geometrically far from group 1
      { a: v(10, 0, 0), b: v(11, 0, 0) },
      { a: v(11, 0, 0), b: v(12, 0, 0) },
    ];
    const clusters = clusterEdgesByEndpointConnectivity(e, eps);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.length).sort()).toEqual([2, 2]);
  });

  it('handles a closed loop (all endpoints shared)', () => {
    const eps = 1e-3;
    // 4-edge square loop
    const e: PickedEdge[] = [
      { a: v(0, 0, 0), b: v(1, 0, 0) },
      { a: v(1, 0, 0), b: v(1, 1, 0) },
      { a: v(1, 1, 0), b: v(0, 1, 0) },
      { a: v(0, 1, 0), b: v(0, 0, 0) },
    ];
    const clusters = clusterEdgesByEndpointConnectivity(e, eps);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(4);
  });

  it('merges edges whose shared endpoint sits within eps but in different cells', () => {
    const eps = 1e-3;
    // Two edges meeting at a "shared" endpoint that is jittered by < eps —
    // canonical cell lookup must unify them.
    const e: PickedEdge[] = [
      { a: v(0, 0, 0), b: v(1, 0, 0) },
      { a: v(1 + 1e-5, 1e-5, 0), b: v(2, 0, 0) },
    ];
    const clusters = clusterEdgesByEndpointConnectivity(e, eps);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });

  it('scales linearly — 200 chained edges produce one cluster', () => {
    const eps = 1e-3;
    const e: PickedEdge[] = [];
    for (let i = 0; i < 200; i++) e.push({ a: v(i, 0, 0), b: v(i + 1, 0, 0) });
    const clusters = clusterEdgesByEndpointConnectivity(e, eps);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(200);
  });
});
