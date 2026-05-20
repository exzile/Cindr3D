import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  dedupEdgesByEndpoints,
  clusterEdgesByEndpointConnectivity,
  buildTriangleList,
  computeEdgeGizmoDir,
  parseEdgeIds,
  parseEdgeLabel,
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

describe('buildTriangleList — indexed vs non-indexed parity', () => {
  it('emits identical triangles for an indexed and a non-indexed box', () => {
    // A 2-triangle "square" facing +Z.
    const verts = [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ];
    const indices = [0, 1, 2, 0, 2, 3];

    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    indexed.setIndex(indices);
    const nonIndexed = indexed.toNonIndexed();

    const trisI = buildTriangleList(indexed);
    const trisN = buildTriangleList(nonIndexed);

    expect(trisI).toHaveLength(2);
    expect(trisN).toHaveLength(2);
    for (let t = 0; t < trisI.length; t++) {
      for (let k = 0; k < 3; k++) {
        expect(trisI[t][k].x).toBe(trisN[t][k].x);
        expect(trisI[t][k].y).toBe(trisN[t][k].y);
        expect(trisI[t][k].z).toBe(trisN[t][k].z);
      }
    }

    indexed.dispose();
    nonIndexed.dispose();
  });
});

describe('parseEdgeIds', () => {
  it('parses a simple two-point legacy edge ID', () => {
    const out = parseEdgeIds(['mesh-uuid:0,0,0:1,0,0']);
    expect(out).not.toBeNull();
    expect(out!.featureId).toBeNull();
    expect(out!.meshUuid).toBe('mesh-uuid');
    expect(out!.edges).toHaveLength(1);
    expect(out!.edges[0].a.x).toBe(0);
    expect(out!.edges[0].b.x).toBe(1);
  });

  it('parses a featureId-prefixed edge ID', () => {
    const out = parseEdgeIds(['feat-1|mesh-uuid:0,0,0:1,0,0']);
    expect(out).not.toBeNull();
    expect(out!.featureId).toBe('feat-1');
    expect(out!.meshUuid).toBe('mesh-uuid');
  });

  it('parses a chained edge ID into multiple segments', () => {
    // 4 points → 3 segments
    const out = parseEdgeIds(['mesh-uuid:0,0,0:1,0,0:1,1,0:0,1,0']);
    expect(out).not.toBeNull();
    expect(out!.edges).toHaveLength(3);
    expect(out!.edges[0].a.toArray()).toEqual([0, 0, 0]);
    expect(out!.edges[1].a.toArray()).toEqual([1, 0, 0]);
    expect(out!.edges[2].b.toArray()).toEqual([0, 1, 0]);
  });

  it('handles negative and decimal coordinates', () => {
    const out = parseEdgeIds(['m:-1.5,2.25,-0.5:3.75,-4,0']);
    expect(out).not.toBeNull();
    expect(out!.edges[0].a.toArray()).toEqual([-1.5, 2.25, -0.5]);
    expect(out!.edges[0].b.toArray()).toEqual([3.75, -4, 0]);
  });

  it('returns null when all IDs are malformed', () => {
    expect(parseEdgeIds([])).toBeNull();
    expect(parseEdgeIds(['totally-broken'])).toBeNull();
    expect(parseEdgeIds(['mesh:onlyOnePoint'])).toBeNull();
    expect(parseEdgeIds(['mesh:bad,coords:1,2,3'])).toBeNull();
  });

  it('drops only the malformed ID and keeps the rest', () => {
    const out = parseEdgeIds([
      'mesh:0,0,0:1,0,0',
      'mesh:nope:1,1,1',          // malformed middle coord
      'mesh:2,0,0:3,0,0',
    ]);
    expect(out).not.toBeNull();
    // Two good IDs → 2 segments on the same mesh.
    expect(out!.edges).toHaveLength(2);
  });

  it('rejects NaN/Infinity coords', () => {
    expect(parseEdgeIds(['m:NaN,0,0:1,0,0'])).toBeNull();
    expect(parseEdgeIds(['m:Infinity,0,0:1,0,0'])).toBeNull();
  });

  it('merges edges on the same mesh under one ParsedEdges', () => {
    const out = parseEdgeIds([
      'mesh:0,0,0:1,0,0',
      'mesh:1,0,0:1,1,0',
      'mesh:1,1,0:0,1,0',
    ]);
    expect(out).not.toBeNull();
    expect(out!.edges).toHaveLength(3);
  });

  it('upgrades a null featureId to a concrete one seen on the same mesh', () => {
    // First ID has no featureId; second has one — the merged result should
    // carry the concrete featureId (applyEdgeCut needs it for feature-id
    // lookup on extrude bodies).
    const out = parseEdgeIds([
      'mesh:0,0,0:1,0,0',
      'feat-1|mesh:1,0,0:1,1,0',
    ]);
    expect(out).not.toBeNull();
    expect(out!.featureId).toBe('feat-1');
  });
});

describe('parseEdgeLabel', () => {
  it('formats endpoints with 1-decimal precision', () => {
    const label = parseEdgeLabel('m:0,0,0:1.2345,2,3', 0);
    expect(label).toContain('Edge 1');
    expect(label).toContain('(0.0, 0.0, 0.0)');
    expect(label).toContain('(1.2, 2.0, 3.0)');
  });

  it('falls back to `Edge N` for malformed IDs', () => {
    expect(parseEdgeLabel('garbage', 0)).toBe('Edge 1');
    expect(parseEdgeLabel('mesh:notenough', 4)).toBe('Edge 5');
  });

  it('never prints NaN for non-finite coords (Number.isFinite guard)', () => {
    const label = parseEdgeLabel('m:NaN,0,0:1,0,0', 0);
    expect(label).toBe('Edge 1');
    expect(label).not.toContain('NaN');
  });
});

describe('computeEdgeGizmoDir — accepts indexed source', () => {
  it('matches the non-indexed result for a box edge', () => {
    // Two-triangle quad in XY (z=0). Edge from (0,0,0)→(1,0,0) is shared by
    // both tris (it's actually a single-face edge, so resolveEdge will return
    // null — but the goal here is parity between indexed/non-indexed, not the
    // value itself).
    const verts = [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 0, 0,
      1, 1, 0,
      0, 1, 0,
      // Add a perpendicular tri sharing the (0,0,0)-(1,0,0) edge to give it
      // two adjacent faces.
      0, 0, 0,
      1, 0, 0,
      0, 0, 1,
    ];
    const nonIndexed = new THREE.BufferGeometry();
    nonIndexed.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));

    // Indexed version that maps to the same triangle list.
    const idxVerts = [
      0, 0, 0,  // 0
      1, 0, 0,  // 1
      1, 1, 0,  // 2
      0, 1, 0,  // 3
      0, 0, 1,  // 4
    ];
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(idxVerts, 3));
    indexed.setIndex([0, 1, 2, 0, 2, 3, 0, 1, 4]);

    const e: PickedEdge[] = [{ a: v(0, 0, 0), b: v(1, 0, 0) }];
    const dirN = computeEdgeGizmoDir(nonIndexed, e);
    const dirI = computeEdgeGizmoDir(indexed, e);

    // Either both should resolve to the same direction, or both should be null.
    if (dirN === null) {
      expect(dirI).toBeNull();
    } else {
      expect(dirI).not.toBeNull();
      expect(dirI!.x).toBeCloseTo(dirN.x, 6);
      expect(dirI!.y).toBeCloseTo(dirN.y, 6);
      expect(dirI!.z).toBeCloseTo(dirN.z, 6);
    }

    nonIndexed.dispose();
    indexed.dispose();
  });
});
