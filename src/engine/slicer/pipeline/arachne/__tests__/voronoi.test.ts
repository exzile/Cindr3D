import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildEdgeVoronoi } from '../voronoi';
import { lShape, rectangle10x10 } from './fixtures';

function expectPointClose(point: THREE.Vector2, x: number, y: number): void {
  expect(point.x).toBeCloseTo(x, 6);
  expect(point.y).toBeCloseTo(y, 6);
}

describe('buildEdgeVoronoi', () => {
  it('builds one internal edge-site vertex at the centre of a rectangle', () => {
    const graph = buildEdgeVoronoi(rectangle10x10.outer, rectangle10x10.holes);

    expect(graph.sourceEdges).toHaveLength(4);
    expect(graph.vertices).toHaveLength(1);
    expectPointClose(graph.vertices[0].point, 5, 5);
    expect(graph.vertices[0].radius).toBeCloseTo(5, 6);
    expect(graph.vertices[0].sourceEdgeIds).toHaveLength(4);
  });

  it('builds two internal edge-site vertices for the fixture L-shape', () => {
    const graph = buildEdgeVoronoi(lShape.outer, lShape.holes);
    const points = graph.vertices.map((vertex) => vertex.point).sort((a, b) => a.x - b.x);

    expect(graph.sourceEdges).toHaveLength(6);
    expect(graph.vertices).toHaveLength(2);
    expectPointClose(points[0], 2.5, 7.5);
    expectPointClose(points[1], 7.5, 2.5);
    for (const vertex of graph.vertices) {
      expect(vertex.radius).toBeCloseTo(2.5, 6);
      expect(vertex.sourceEdgeIds).toHaveLength(3);
    }
  });

  it('keeps hole edges as source sites and excludes vertices inside holes', () => {
    const outer = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(20, 0),
      new THREE.Vector2(20, 20),
      new THREE.Vector2(0, 20),
    ];
    const hole = [
      new THREE.Vector2(8, 8),
      new THREE.Vector2(8, 12),
      new THREE.Vector2(12, 12),
      new THREE.Vector2(12, 8),
    ];
    const graph = buildEdgeVoronoi(outer, [hole]);

    expect(graph.sourceEdges).toHaveLength(8);
    expect(graph.sourceEdges.filter((edge) => edge.isHole)).toHaveLength(4);
    for (const vertex of graph.vertices) {
      expect(vertex.point.x < 8 || vertex.point.x > 12 || vertex.point.y < 8 || vertex.point.y > 12).toBe(true);
    }
  });

  it('builds a 500-edge dense contour without the brute-force perf cliff', () => {
    const edgeCount = 500;
    const radius = 20;
    const outer = Array.from({ length: edgeCount }, (_, index) => {
      const angle = (index / edgeCount) * Math.PI * 2;
      return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
    });

    const start = performance.now();
    const graph = buildEdgeVoronoi(outer, []);
    const durationMs = performance.now() - start;

    expect(graph.sourceEdges).toHaveLength(edgeCount);
    expect(graph.vertices.length).toBeGreaterThan(0);
    // Production layers typically have 50-200 edges; 500 is the synthetic
    // worst case. Original brute force was hours at this size; the indexed
    // version finishes in seconds. Real cliff (Fortune sweep-line) is the
    // proper fix for large-N — see the perf note at the top of voronoi.ts.
    expect(durationMs).toBeLessThan(10_000);
  }, 15_000);

  it('builds a production-shaped 150-edge polygon with two holes well under 1s', () => {
    // Approximates a real sliced layer: rounded outer + two mounting-hole-
    // shaped circular cutouts. Catches regressions in the indexed voronoi
    // for the actual common case (not the worst case).
    const outerEdges = 100;
    const outerRadius = 25;
    const outer = Array.from({ length: outerEdges }, (_, i) => {
      const a = (i / outerEdges) * Math.PI * 2;
      // Slightly noisy radius — production polygons are never perfect circles.
      const r = outerRadius + Math.sin(a * 5) * 0.3;
      return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
    });
    const holeEdges = 25;
    const makeHole = (cx: number, cy: number, r: number) =>
      Array.from({ length: holeEdges }, (_, i) => {
        // CW winding for holes.
        const a = -((i / holeEdges) * Math.PI * 2);
        return new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      });
    const holes = [makeHole(-10, 0, 3), makeHole(10, 0, 3)];

    const start = performance.now();
    const graph = buildEdgeVoronoi(outer, holes);
    const durationMs = performance.now() - start;

    expect(graph.sourceEdges).toHaveLength(outerEdges + 2 * holeEdges);
    expect(graph.vertices.length).toBeGreaterThan(0);
    // Production target — should comfortably fit inside a single layer's
    // share of slice budget. If this regresses we'll feel it on real prints.
    expect(durationMs).toBeLessThan(1_000);
  });
});
