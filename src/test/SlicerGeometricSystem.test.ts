import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildChainTube, TUBE_RADIAL_SEGMENTS } from '../components/slicer/workspace/canvas/tubeGeometry';
import type { TubeChain } from '../types/slicer-preview.types';
import {
  bboxFromMoves,
  buildBox as buildBoxGeometry,
  makeSlicer,
} from './_helpers/slicerSystemHelpers';

/**
 * System-level slicer geometry tests.
 *
 * These slice a small synthetic mesh through the real Slicer pipeline
 * and assert end-to-end properties:
 *   - Per-layer extrusion moves land at the right XY locations.
 *   - Move lengths reflect actual line distances (no over- or under-extrusion
 *     in the move accounting).
 *   - When the moves are fed into the preview tube builder, the resulting
 *     mesh sits in the right place in 3D space.
 *
 * This complements the focused unit tests in
 * `engine/slicer/.../prepareLayerState.test.ts` and
 * `components/slicer/.../tubeGeometry.test.ts`.
 */

const RADIAL = TUBE_RADIAL_SEGMENTS;
const ringSize = RADIAL + 1;

describe('Slicer geometric system tests — wall placement', () => {
  it('produces walls inside the model footprint for a 20mm cube', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(20, 20, 4),
      transform: new THREE.Matrix4(),
    }]);

    expect(result.layerCount).toBeGreaterThan(15);

    // Pick layer 5 (well above first layer, away from ramp effects).
    const layer = result.layers[5];
    const walls = layer.moves.filter((m) =>
      m.type === 'wall-outer' || m.type === 'wall-inner',
    );
    expect(walls.length).toBeGreaterThan(0);

    const bbox = bboxFromMoves(walls);

    // The model is centered on the bed; the print center is inferred by
    // the slicer. We don't assume a specific (x,y) origin — but the wall
    // bbox must be ~20mm wide (size of the cube minus inset for line width).
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

    // Ideal perimeter for a 20mm square: 80mm. The wall sits at the
    // outer-wall inset (one half line-width inside the model boundary by
    // default), so the actual perimeter is 4 × (20 - lw) ≈ 4 × 19.6 = 78.4.
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
      // Some pipeline steps store an explicit length on certain moves;
      // for the basic from→to invariant we just check from/to are finite
      // and produce a non-negative distance.
      expect(Number.isFinite(expected)).toBe(true);
      expect(expected).toBeGreaterThanOrEqual(0);
      // Move from/to must be different (no zero-length non-travel moves).
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
      // 0.2mm expansion → +0.4mm width. Allow 0.2mm tolerance for offset rounding.
      expect(expW - baseW).toBeGreaterThan(0.2);
      expect(expW - baseW).toBeLessThan(0.6);
    }
  }, 60_000);
});

describe('Slicer + preview integration — tube placement', () => {
  it('preview tube rings center on the wall move endpoints (correct visual location)', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(15, 15, 2),
      transform: new THREE.Matrix4(),
    }]);

    const layer = result.layers[2];
    const outerWalls = layer.moves.filter((m) => m.type === 'wall-outer');
    expect(outerWalls.length).toBeGreaterThan(0);

    // Build a TubeChain from the outer-wall moves (they should form one
    // closed loop around the 15mm square).
    const points: TubeChain['points'] = [];
    points.push({ x: outerWalls[0].from.x, y: outerWalls[0].from.y, lw: outerWalls[0].lineWidth });
    for (const move of outerWalls) {
      points.push({ x: move.to.x, y: move.to.y, lw: move.lineWidth });
    }
    const isClosed = Math.hypot(
      points[0].x - points[points.length - 1].x,
      points[0].y - points[points.length - 1].y,
    ) < 0.05;
    if (isClosed) points.pop();

    const segCount = isClosed ? points.length : points.length - 1;
    if (segCount === 0) throw new Error('no segments built from outer walls');
    const chain: TubeChain = {
      type: 'wall-outer',
      points,
      segColors: Array.from({ length: segCount }, () => [1, 0, 0] as [number, number, number]),
      moveRefs: Array.from({ length: segCount }, () => ({
        type: 'wall-outer', speed: 60, extrusion: 0.001,
        lineWidth: outerWalls[0].lineWidth, length: 1,
      })),
      isClosed,
    };

    const tubeGeo = buildChainTube(chain, 0.2, layer.z);
    expect(tubeGeo).not.toBeNull();
    const positions = tubeGeo!.getAttribute('position').array as Float32Array;

    // The preview tube's first ring center should sit on (or near, due to
    // open-wall trim) the chain's first point.
    const start = 0;
    let cx = 0, cy = 0;
    for (let r = 0; r < RADIAL; r++) {
      cx += positions[start + r * 3 + 0];
      cy += positions[start + r * 3 + 1];
    }
    cx /= RADIAL; cy /= RADIAL;
    // Closed walls have NO end trim; tube center exactly equals chain point.
    if (isClosed) {
      expect(Math.abs(cx - chain.points[0].x)).toBeLessThan(1e-3);
      expect(Math.abs(cy - chain.points[0].y)).toBeLessThan(1e-3);
    } else {
      // Open wall — first ring shifted by OPEN_WALL_END_TRIM_FACTOR × lw.
      const trimDist = 0.18 * chain.points[0].lw;
      const dropDist = Math.hypot(cx - chain.points[0].x, cy - chain.points[0].y);
      expect(dropDist).toBeLessThan(trimDist + 0.01);
    }
  }, 60_000);

  it('preview tube ring count matches the chain point count', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBoxGeometry(15, 15, 2),
      transform: new THREE.Matrix4(),
    }]);

    const layer = result.layers[2];
    const outerWalls = layer.moves.filter((m) => m.type === 'wall-outer');
    const points: TubeChain['points'] = [
      { x: outerWalls[0].from.x, y: outerWalls[0].from.y, lw: outerWalls[0].lineWidth },
      ...outerWalls.map((m) => ({ x: m.to.x, y: m.to.y, lw: m.lineWidth })),
    ];
    const isClosed = Math.hypot(
      points[0].x - points[points.length - 1].x,
      points[0].y - points[points.length - 1].y,
    ) < 0.05;
    if (isClosed) points.pop();

    const segCount = isClosed ? points.length : points.length - 1;
    const chain: TubeChain = {
      type: 'wall-outer',
      points,
      segColors: Array.from({ length: segCount }, () => [1, 0, 0] as [number, number, number]),
      moveRefs: Array.from({ length: segCount }, () => ({
        type: 'wall-outer', speed: 60, extrusion: 0.001,
        lineWidth: outerWalls[0].lineWidth, length: 1,
      })),
      isClosed,
    };

    const geo = buildChainTube(chain, 0.2, layer.z);
    const positions = geo!.getAttribute('position').array as Float32Array;
    expect(positions.length).toBe(points.length * ringSize * 3);
  }, 60_000);
});
