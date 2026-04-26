import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildEdgeVoronoi } from './voronoi';
import { buildEdgeVoronoiWasm } from './voronoiWasm';
import { allFixtures } from './__tests__/fixtures';

// 9.1E — parameterised parity check: every fixture from the canonical
// Arachne unit-test set must produce a non-empty graph through the WASM
// backend, and the Voronoi source-edge attribution must match the JS
// implementation exactly. The WASM solver (Boost) emits more vertices
// than the JS solver (sees ARACHNE-9.X.5) because it retains external
// medial-axis structure, so we don't compare vertex counts directly.
const sharedFixtures = allFixtures;

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

  it.each(sharedFixtures)('matches JS source-edge attribution for "$name"', async (fixture) => {
    const wasm = await buildEdgeVoronoiWasm(fixture.outer, fixture.holes);
    const js = buildEdgeVoronoi(fixture.outer, fixture.holes);
    expect(wasm.sourceEdges).toHaveLength(js.sourceEdges.length);
    // Source edges share the (contourIndex, edgeIndex) namespace by the
    // shared `buildSourceEdges` helper — both backends MUST agree.
    for (let i = 0; i < js.sourceEdges.length; i++) {
      expect(wasm.sourceEdges[i].contourIndex).toBe(js.sourceEdges[i].contourIndex);
      expect(wasm.sourceEdges[i].edgeIndex).toBe(js.sourceEdges[i].edgeIndex);
      expect(wasm.sourceEdges[i].isHole).toBe(js.sourceEdges[i].isHole);
    }
  });

  it.each(sharedFixtures)('emits a non-degenerate graph for "$name"', async (fixture) => {
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
