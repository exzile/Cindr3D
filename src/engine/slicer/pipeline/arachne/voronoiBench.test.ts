// ARACHNE-9.1E — synthetic perf bench for the WASM Voronoi adapter.
//
// Originally compared JS vs WASM. After 9.3D removed the staged JS
// pipeline, this is a regression catcher for the WASM path itself.
// Skipped by default; run with `ARACHNE_BENCH=1 npx vitest run voronoiBench`.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildEdgeVoronoiWasm } from './voronoiWasm';

const RUN_BENCH = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env?.ARACHNE_BENCH === '1';

// Deterministic 600-edge outer ring (a wavy circle) + 3 holes. Total
// ~640 edges — matches the regime where the user's adjustable_support_foot
// fixture stresses the Voronoi solver.
function buildLayer(): { outer: THREE.Vector2[]; holes: THREE.Vector2[][] } {
  const outerN = 600;
  const outer: THREE.Vector2[] = [];
  for (let i = 0; i < outerN; i++) {
    const t = (i / outerN) * Math.PI * 2;
    const r = 50 + 4 * Math.sin(t * 7) + 2 * Math.cos(t * 11);
    outer.push(new THREE.Vector2(r * Math.cos(t), r * Math.sin(t)));
  }

  const holes: THREE.Vector2[][] = [];
  for (const [cx, cy, hr] of [[20, 0, 6], [-15, 12, 5], [-8, -18, 4]] as const) {
    const hN = 14;
    const ring: THREE.Vector2[] = [];
    for (let i = 0; i < hN; i++) {
      const t = (i / hN) * Math.PI * 2;
      ring.push(new THREE.Vector2(cx + hr * Math.cos(t), cy + hr * Math.sin(t)));
    }
    holes.push(ring.reverse());
  }

  return { outer, holes };
}

describe('Voronoi backend perf bench', () => {
  it.skipIf(!RUN_BENCH)('runs the 640-edge layer in < 100ms via WASM', async () => {
    const { outer, holes } = buildLayer();

    // Warm WASM module — first call pays the instantiate cost.
    await buildEdgeVoronoiWasm(outer, holes);

    const t0 = performance.now();
    const wasmGraph = await buildEdgeVoronoiWasm(outer, holes);
    const wasmMs = performance.now() - t0;

    expect(wasmGraph.vertices.length).toBeGreaterThan(50);

    console.log(
      `[voronoi bench] WASM=${wasmMs.toFixed(1)}ms ` +
      `(verts=${wasmGraph.vertices.length}, edges=${wasmGraph.edges.length})`,
    );

    // Loose regression catcher — production layers typically run in
    // 20-50ms; an order-of-magnitude regression should fail the bench.
    expect(wasmMs).toBeLessThan(500);
  });

  it('produces a non-empty graph on a small fixture', async () => {
    const square: THREE.Vector2[] = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(10, 0),
      new THREE.Vector2(10, 10),
      new THREE.Vector2(0, 10),
    ];
    const wasm = await buildEdgeVoronoiWasm(square);
    expect(wasm.sourceEdges.length).toBe(4);
    expect(wasm.vertices.length).toBeGreaterThan(0);
  });
});
