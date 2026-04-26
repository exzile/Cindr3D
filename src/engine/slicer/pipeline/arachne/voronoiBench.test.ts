// ARACHNE-9.1E — synthetic perf bench for the WASM Voronoi adapter.
//
// The original 9.1E task wanted a comparison against the user's
// `adjustable_support_foot.stl` layer 21 (~1700 edges). That STL isn't
// in the repo, so this bench uses a deterministic synthetic fixture:
// a high-vertex-count outer with a few interior holes, sized to match
// the regime where the JS path was empirically observed to take
// minutes per layer.
//
// The bench is a `it.skipIf` guarded by an env var so it doesn't add
// 5-10s to every CI run, but is one-flag-away from running locally.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildEdgeVoronoi } from './voronoi';
import { buildEdgeVoronoiWasm } from './voronoiWasm';

const RUN_BENCH = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env?.ARACHNE_BENCH === '1';

// Deterministic 600-edge outer ring (a wavy circle) + 3 holes. Total
// ~640 edges — enough that the JS path's O(N·K²) starts hurting but
// small enough that the test stays under 30s even when JS is slow.
function buildLayer(): { outer: THREE.Vector2[]; holes: THREE.Vector2[][] } {
  const outerN = 600;
  const outer: THREE.Vector2[] = [];
  for (let i = 0; i < outerN; i++) {
    const t = (i / outerN) * Math.PI * 2;
    // Two superimposed sinusoidal wobbles so the polygon has rich
    // medial-axis structure rather than a pure circle.
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
    // Holes must wind clockwise relative to outer's CCW. The voronoi
    // adapter's `normalizeHole` flips automatically, but emitting CW
    // up-front avoids one allocation per hole.
    holes.push(ring.reverse());
  }

  return { outer, holes };
}

describe('Voronoi backend perf bench', () => {
  it.skipIf(!RUN_BENCH)('WASM is meaningfully faster than JS on a 640-edge layer', async () => {
    const { outer, holes } = buildLayer();

    // Warm WASM module — first call pays the instantiate cost.
    await buildEdgeVoronoiWasm(outer, holes);

    const t0 = performance.now();
    const wasmGraph = await buildEdgeVoronoiWasm(outer, holes);
    const wasmMs = performance.now() - t0;

    const t1 = performance.now();
    const jsGraph = buildEdgeVoronoi(outer, holes);
    const jsMs = performance.now() - t1;

    // Sanity — both produced *some* result.
    expect(wasmGraph.vertices.length).toBeGreaterThan(50);
    expect(jsGraph.vertices.length).toBeGreaterThan(50);

    // eslint-disable-next-line no-console
    console.log(
      `[voronoi bench] WASM=${wasmMs.toFixed(1)}ms JS=${jsMs.toFixed(1)}ms ` +
      `ratio=${(jsMs / wasmMs).toFixed(2)}× ` +
      `(WASM verts=${wasmGraph.vertices.length}, JS verts=${jsGraph.vertices.length})`,
    );

    // WASM should be at least 5× faster on this fixture. If it isn't,
    // something is wrong (regression or env-specific JIT win) — fail
    // loudly so we notice. Loose lower bound: regression catcher, not
    // a bench target.
    expect(jsMs / wasmMs).toBeGreaterThan(5);
  });

  it('produces compatible vertex+edge counts on small fixture (parity)', async () => {
    const square: THREE.Vector2[] = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(10, 0),
      new THREE.Vector2(10, 10),
      new THREE.Vector2(0, 10),
    ];
    const wasm = await buildEdgeVoronoiWasm(square);
    const js = buildEdgeVoronoi(square);
    expect(wasm.sourceEdges).toHaveLength(js.sourceEdges.length);
    // Different algorithms produce different counts on the medial axis
    // of a square (Boost's exact predicates emit one extra vertex at
    // the centroid that JS's geometric tolerance merges). Both must
    // still be non-empty.
    expect(wasm.vertices.length).toBeGreaterThan(0);
    expect(js.vertices.length).toBeGreaterThan(0);
  });
});
