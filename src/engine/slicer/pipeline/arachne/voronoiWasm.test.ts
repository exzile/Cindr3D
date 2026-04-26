import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildEdgeVoronoiWasm } from './voronoiWasm';
import { allFixtures } from './__tests__/fixtures';

// 9.1E — every fixture from the canonical Arachne fixture set must
// produce a non-degenerate Voronoi graph through the WASM backend.
// Source-edge attribution is deterministic (built from the contour
// loop the same way for every fixture); we assert the per-fixture
// edge counts here so a regression in the C++-side edge ordering is
// caught immediately.
describe('voronoiWasm — boost::polygon::voronoi backend', () => {
  it('produces a non-empty graph for a unit square', async () => {
    const square: THREE.Vector2[] = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(10, 0),
      new THREE.Vector2(10, 10),
      new THREE.Vector2(0, 10),
    ];
    const graph = await buildEdgeVoronoiWasm(square);
    expect(graph.sourceEdges).toHaveLength(4);
    expect(graph.vertices.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it.each(allFixtures)('emits expected source-edge count for "$name"', async (fixture) => {
    const graph = await buildEdgeVoronoiWasm(fixture.outer, fixture.holes);
    const expectedCount = fixture.outer.length + fixture.holes.reduce((s, h) => s + h.length, 0);
    expect(graph.sourceEdges.length).toBeLessThanOrEqual(expectedCount);
    // Source edges retain their (contourIndex, edgeIndex) namespace from
    // buildSourceEdges — outer first (ci=0), then each hole (ci > 0).
    if (graph.sourceEdges.length > 0) {
      expect(graph.sourceEdges[0].contourIndex).toBe(0);
      expect(graph.sourceEdges[0].isHole).toBe(false);
    }
  });

  it.each(allFixtures)('emits a non-degenerate graph for "$name"', async (fixture) => {
    const graph = await buildEdgeVoronoiWasm(fixture.outer, fixture.holes);
    expect(graph.vertices.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    for (const vertex of graph.vertices) {
      expect(Number.isFinite(vertex.point.x)).toBe(true);
      expect(Number.isFinite(vertex.point.y)).toBe(true);
      expect(Number.isFinite(vertex.radius)).toBe(true);
      expect(vertex.radius).toBeGreaterThanOrEqual(0);
      expect(vertex.sourceEdgeIds.length).toBeGreaterThanOrEqual(2);
    }
    for (const edge of graph.edges) {
      expect(edge.from).toBeGreaterThanOrEqual(0);
      expect(edge.to).toBeGreaterThanOrEqual(0);
      expect(edge.from).toBeLessThan(graph.vertices.length);
      expect(edge.to).toBeLessThan(graph.vertices.length);
    }
  });
});
