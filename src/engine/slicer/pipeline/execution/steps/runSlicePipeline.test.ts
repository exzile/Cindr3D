import { describe, expect, it } from 'vitest';

import { chooseLayerPrepWorkerCount } from './runSlicePipeline';
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
    expect(chooseLayerPrepWorkerCount(makeRun(120, 10_000), 16)).toBe(6);
  });

  it('reduces worker fanout for medium meshes', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 25_000), 8)).toBe(3);
    expect(chooseLayerPrepWorkerCount(makeRun(120, 50_000), 8)).toBe(2);
  });

  it('avoids cloning very large meshes into a worker pool', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 80_000), 8)).toBe(0);
    expect(chooseLayerPrepWorkerCount(makeRun(120, 120_000), 16)).toBe(0);
  });
});
