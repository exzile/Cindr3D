import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { computeAdaptiveLayerZs } from './adaptiveLayers';
import type { Triangle } from '../../../types/slicer-pipeline.types';

const tri = (
  v0: [number, number, number],
  v1: [number, number, number],
  v2: [number, number, number],
  normal: [number, number, number] = [0, 0, 1],
): Triangle => {
  const k = (a: [number, number, number], b: [number, number, number]) =>
    `${a.join(',')}_${b.join(',')}`;
  return {
    v0: new THREE.Vector3(...v0),
    v1: new THREE.Vector3(...v1),
    v2: new THREE.Vector3(...v2),
    normal: new THREE.Vector3(...normal),
    edgeKey01: k(v0, v1),
    edgeKey12: k(v1, v2),
    edgeKey20: k(v2, v0),
  };
};

/** Build a vertical-walled cube of given size at the origin. Triangle
 *  normals point straight along their face direction (no overhang). */
function buildCubeTriangles(size: number): Triangle[] {
  const h = size / 2;
  return [
    // Bottom (z=0)
    tri([-h, -h, 0], [h, -h, 0], [h, h, 0], [0, 0, -1]),
    tri([-h, -h, 0], [h, h, 0], [-h, h, 0], [0, 0, -1]),
    // Top (z=size)
    tri([-h, -h, size], [h, h, size], [h, -h, size], [0, 0, 1]),
    tri([-h, -h, size], [-h, h, size], [h, h, size], [0, 0, 1]),
    // Front
    tri([-h, -h, 0], [h, -h, 0], [h, -h, size], [0, -1, 0]),
    tri([-h, -h, 0], [h, -h, size], [-h, -h, size], [0, -1, 0]),
    // Back
    tri([-h, h, 0], [h, h, size], [h, h, 0], [0, 1, 0]),
    tri([-h, h, 0], [-h, h, size], [h, h, size], [0, 1, 0]),
    // Left
    tri([-h, -h, 0], [-h, h, size], [-h, h, 0], [-1, 0, 0]),
    tri([-h, -h, 0], [-h, -h, size], [-h, h, size], [-1, 0, 0]),
    // Right
    tri([h, -h, 0], [h, h, 0], [h, h, size], [1, 0, 0]),
    tri([h, -h, 0], [h, h, size], [h, -h, size], [1, 0, 0]),
  ];
}

describe('computeAdaptiveLayerZs — basics', () => {
  it('returns a monotonically increasing list of Z values', () => {
    const zs = computeAdaptiveLayerZs(buildCubeTriangles(10), 10, 0.2, 0.2, 0.1, 0.05, 1);
    for (let i = 1; i < zs.length; i++) {
      expect(zs[i]).toBeGreaterThan(zs[i - 1]);
    }
  });

  it('first layer Z equals firstLayerHeight × zScale', () => {
    const zs = computeAdaptiveLayerZs(buildCubeTriangles(5), 5, 0.3, 0.2, 0.1, 0.05, 1);
    expect(zs[0]).toBeCloseTo(0.3, 5);
  });

  it('zScale multiplies every emitted Z value', () => {
    const zs1 = computeAdaptiveLayerZs(buildCubeTriangles(5), 5, 0.2, 0.2, 0, 0.05, 1);
    const zs2 = computeAdaptiveLayerZs(buildCubeTriangles(5), 5, 0.2, 0.2, 0, 0.05, 2);
    expect(zs2[0]).toBeCloseTo(zs1[0] * 2, 5);
    expect(zs2[zs2.length - 1]).toBeCloseTo(zs1[zs1.length - 1] * 2, 5);
  });

  it('non-overhang vertical walls produce uniform layer height ≈ baseLayerHeight', () => {
    // Cube faces are vertical (no overhang penalty), so height stays
    // close to baseLayerHeight = 0.2 throughout the model.
    const zs = computeAdaptiveLayerZs(buildCubeTriangles(4), 4, 0.2, 0.2, 0.1, 0.05, 1);
    for (let i = 1; i < zs.length; i++) {
      const dz = zs[i] - zs[i - 1];
      expect(dz).toBeGreaterThanOrEqual(0.05);
      expect(dz).toBeLessThanOrEqual(0.31);
    }
  });

  it('always reaches the model height (last z >= modelHeight)', () => {
    const zs = computeAdaptiveLayerZs(buildCubeTriangles(8), 8, 0.2, 0.2, 0.1, 0.05, 1);
    expect(zs[zs.length - 1]).toBeGreaterThanOrEqual(8 - 1e-3);
  });

  it('empty triangles still produces layers spanning the model height', () => {
    const zs = computeAdaptiveLayerZs([], 5, 0.2, 0.2, 0.1, 0.05, 1);
    expect(zs.length).toBeGreaterThan(1);
    expect(zs[zs.length - 1]).toBeGreaterThanOrEqual(5 - 1e-3);
  });

  it('shallow-overhang triangles trigger smaller layer heights', () => {
    // Diagonal triangle with normal at 45° → high penalty (sin*cos > 0)
    const baseTris = buildCubeTriangles(10);
    const overhang = tri([0, 0, 5], [10, 0, 5], [5, 0, 7], [0.5, -0.5, 0.707]);
    const zs1 = computeAdaptiveLayerZs(baseTris, 10, 0.2, 0.3, 0.2, 0.1, 1);
    const zs2 = computeAdaptiveLayerZs([...baseTris, overhang], 10, 0.2, 0.3, 0.2, 0.1, 1);
    // The version with the overhang triangle should have at least as
    // many layers as the cube alone.
    expect(zs2.length).toBeGreaterThanOrEqual(zs1.length);
  });

  it('respects maxVariation as the upper bound on layer height span', () => {
    const zs = computeAdaptiveLayerZs(buildCubeTriangles(10), 10, 0.2, 0.2, 0.1, 0.05, 1);
    const heights = zs.map((z, i) => z - (i > 0 ? zs[i - 1] : 0));
    const heightRange = Math.max(...heights.slice(1)) - Math.min(...heights.slice(1));
    // baseHeight 0.2 ± maxVariation 0.1 → range max 0.2 → allow some slack
    expect(heightRange).toBeLessThanOrEqual(0.25);
  });

  it('emits at least 2 layer Z values for any positive-height model', () => {
    const zs = computeAdaptiveLayerZs(buildCubeTriangles(1), 1, 0.2, 0.2, 0.1, 0.05, 1);
    expect(zs.length).toBeGreaterThanOrEqual(2);
  });
});
