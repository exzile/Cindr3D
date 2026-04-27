import { describe, expect, it } from 'vitest';

import { chooseLayerPrepWorkerCount, triangleIntersectsLayerBatch } from './runSlicePipeline';
import type { SliceRun } from './types';

function makeRun(
  totalLayers: number,
  triangleCount: number,
  pp: Record<string, unknown> = {},
): Pick<SliceRun, 'totalLayers' | 'triangles' | 'pp'> {
  return {
    totalLayers,
    triangles: new Array(triangleCount),
    pp,
  } as unknown as Pick<SliceRun, 'totalLayers' | 'triangles' | 'pp'>;
}

describe('chooseLayerPrepWorkerCount', () => {
  it('keeps short prints on the sequential path', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(47, 1_000), 8)).toBe(0);
  });

  it('respects the print-profile opt out', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 1_000, { parallelLayerPreparation: false }), 8)).toBe(0);
  });

  it('caps small meshes at the layer-prep worker maximum', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 10_000), 16)).toBe(8);
  });

  it('reserves one core for the parent worker and UI responsiveness', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 10_000), 4)).toBe(3);
  });

  it('reduces worker fanout for medium meshes', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 25_000), 8)).toBe(6);
    expect(chooseLayerPrepWorkerCount(makeRun(120, 50_000), 8)).toBe(5);
  });

  it('uses a conservative pool for large meshes', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 80_000), 8)).toBe(4);
    expect(chooseLayerPrepWorkerCount(makeRun(120, 120_000), 16)).toBe(4);
  });

  it('avoids cloning huge meshes into a worker pool', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 200_000), 8)).toBe(0);
    expect(chooseLayerPrepWorkerCount(makeRun(120, 300_000), 16)).toBe(0);
  });
});

describe('triangleIntersectsLayerBatch', () => {
  const run = {
    layerZs: [0.2, 0.4, 0.6, 0.8],
    modelBBox: { min: { z: 10 } },
  } as unknown as Pick<SliceRun, 'layerZs' | 'modelBBox'>;

  function triangle(minZ: number, maxZ: number): SliceRun['triangles'][number] {
    return {
      v0: { z: 10 + minZ },
      v1: { z: 10 + maxZ },
      v2: { z: 10 + minZ },
    } as SliceRun['triangles'][number];
  }

  it('keeps triangles that can intersect any assigned worker layer', () => {
    expect(triangleIntersectsLayerBatch(run, triangle(0.35, 0.45), [0, 1])).toBe(true);
  });

  it('filters triangles outside the assigned worker layer batch', () => {
    expect(triangleIntersectsLayerBatch(run, triangle(0.7, 0.9), [0, 1])).toBe(false);
  });
});
