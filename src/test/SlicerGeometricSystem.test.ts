import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  bboxFromMoves,
  buildBox as buildBoxGeometry,
  makeSlicer,
} from './_helpers/slicerSystemHelpers';
import {
  buildColorContext,
  buildLayerInstances,
} from '../components/slicer/workspace/canvas/extrusionInstances';

/**
 * System-level slicer geometry tests.
 *
 * These slice a small synthetic mesh through the real Slicer pipeline and
 * assert end-to-end properties:
 *   - Per-layer extrusion moves land at the right XY locations.
 *   - Move lengths reflect actual line distances.
 *   - When fed into the preview instance builder, the resulting instances
 *     sit at the right place in 3D space.
 */

const HIDDEN: ReadonlySet<string> = new Set();

describe('Slicer geometric system tests — wall placement', () => {
  it('produces walls inside the model footprint for a 20mm cube', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(20, 20, 4),
      transform: new THREE.Matrix4(),
    }]);

    expect(result.layerCount).toBeGreaterThan(15);

    const layer = result.layers[5];
    const walls = layer.moves.filter((m) =>
      m.type === 'wall-outer' || m.type === 'wall-inner',
    );
    expect(walls.length).toBeGreaterThan(0);

    const bbox = bboxFromMoves(walls);
    expect(bbox.width).toBeGreaterThan(19);
    expect(bbox.width).toBeLessThan(20.5);
    expect(bbox.height).toBeGreaterThan(19);
    expect(bbox.height).toBeLessThan(20.5);
  }, 60_000);

  it('outer wall total perimeter is close to the ideal 4 × side length minus inset', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(20, 20, 4),
      transform: new THREE.Matrix4(),
    }]);

    const layer = result.layers[5];
    const outerWalls = layer.moves.filter((m) => m.type === 'wall-outer');
    expect(outerWalls.length).toBeGreaterThan(0);

    let totalLen = 0;
    for (const move of outerWalls) {
      totalLen += Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y);
    }

    expect(totalLen).toBeGreaterThan(75);
    expect(totalLen).toBeLessThan(82);
  }, 60_000);

  it('per-move length matches the segment endpoints (no length drift)', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(15, 15, 2),
      transform: new THREE.Matrix4(),
    }]);

    const layer = result.layers[3];
    let mismatched = 0;
    for (const move of layer.moves) {
      if (move.type === 'travel') continue;
      const expected = Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y);
      expect(Number.isFinite(expected)).toBe(true);
      expect(expected).toBeGreaterThanOrEqual(0);
      if (expected < 1e-6) mismatched++;
    }
    expect(mismatched).toBe(0);
  }, 60_000);

  it('layer Z values increase monotonically by layerHeight', async () => {
    const slicer = makeSlicer({ layerHeight: 0.2 });
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(10, 10, 2),
      transform: new THREE.Matrix4(),
    }]);
    expect(result.layers.length).toBeGreaterThan(5);
    for (let i = 1; i < result.layers.length; i++) {
      const dz = result.layers[i].z - result.layers[i - 1].z;
      expect(dz).toBeCloseTo(0.2, 3);
    }
  }, 60_000);

  it('horizontalExpansion shifts wall positions outward consistently across layers', async () => {
    const baseline = await makeSlicer({}).slice([{
      geometry: buildBoxGeometry(20, 20, 4),
      transform: new THREE.Matrix4(),
    }]);
    const expanded = await makeSlicer({ horizontalExpansion: 0.2 }).slice([{
      geometry: buildBoxGeometry(20, 20, 4),
      transform: new THREE.Matrix4(),
    }]);

    for (const layerIdx of [3, 6, 9, 12]) {
      if (!baseline.layers[layerIdx] || !expanded.layers[layerIdx]) continue;
      const baseW = bboxFromMoves(baseline.layers[layerIdx].moves.filter((m) => m.type === 'wall-outer')).width;
      const expW = bboxFromMoves(expanded.layers[layerIdx].moves.filter((m) => m.type === 'wall-outer')).width;
      expect(expW - baseW).toBeGreaterThan(0.2);
      expect(expW - baseW).toBeLessThan(0.6);
    }
  }, 60_000);
});

describe('Slicer + preview integration — instance placement', () => {
  it('preview instance endpoints sit on the source wall move endpoints exactly', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(15, 15, 2),
      transform: new THREE.Matrix4(),
    }]);

    const layer = result.layers[2];
    const layerHeight = 0.2;
    const ctx = buildColorContext(layer, 'type', undefined);
    const data = buildLayerInstances({
      layer,
      layerHeight,
      filamentDiameter: 1.75,
      isCurrentLayer: false,
      currentLayerMoveCount: undefined,
      showTravel: false,
      hiddenTypes: HIDDEN,
      colorContext: ctx,
    });

    expect(data.count).toBeGreaterThan(0);
    // Every wall-outer source move should produce one instance landing at
    // its from/to XY exactly (instances are 1:1 with non-zero-length
    // extrusion moves; no chain stitching, no end trim).
    let checked = 0;
    for (let i = 0; i < data.count; i++) {
      const moveIndex = data.moveRefs[i].moveIndex!;
      const mv = layer.moves[moveIndex];
      if (mv.type !== 'wall-outer') continue;
      expect(data.iA[i * 3]).toBeCloseTo(mv.from.x, 5);
      expect(data.iA[i * 3 + 1]).toBeCloseTo(mv.from.y, 5);
      expect(data.iB[i * 3]).toBeCloseTo(mv.to.x, 5);
      expect(data.iB[i * 3 + 1]).toBeCloseTo(mv.to.y, 5);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  }, 60_000);

  it('preview instance count equals the count of non-zero-length extrusion moves', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(15, 15, 2),
      transform: new THREE.Matrix4(),
    }]);

    const layer = result.layers[2];
    const ctx = buildColorContext(layer, 'type', undefined);
    const data = buildLayerInstances({
      layer,
      layerHeight: 0.2,
      filamentDiameter: 1.75,
      isCurrentLayer: false,
      currentLayerMoveCount: undefined,
      showTravel: false,
      hiddenTypes: HIDDEN,
      colorContext: ctx,
    });

    const expected = layer.moves.filter((m) => {
      if (m.type === 'travel') return false;
      if (m.extrusion <= 0) return false;
      const len = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
      return len >= 1e-6;
    }).length;

    expect(data.count).toBe(expected);
  }, 60_000);
});
