import { describe, expect, it } from 'vitest';

import { sampleBedMesh, scoreBedMeshPlacement, type ArrangeBedMesh } from './bedMeshArrange';

const mesh: ArrangeBedMesh = {
  minX: 0,
  maxX: 100,
  minY: 0,
  maxY: 100,
  points: [
    [0, 0, 0.5],
    [0, 0.02, 0.5],
    [0, 0.02, 0.5],
  ],
};

describe('bed mesh arrange scoring', () => {
  it('samples the mesh with bilinear interpolation', () => {
    expect(sampleBedMesh(mesh, 50, 50)).toBeCloseTo(0.02);
  });

  it('treats points outside the probed mesh as unknown', () => {
    expect(sampleBedMesh(mesh, -1, 50)).toBeNull();
    expect(sampleBedMesh(mesh, 50, 101)).toBeNull();
  });

  it('prefers flat regions and penalizes dead spots', () => {
    const flatScore = scoreBedMeshPlacement(mesh, { x: 0, y: 0, w: 20, h: 20 });
    const warpedScore = scoreBedMeshPlacement(mesh, { x: 70, y: 0, w: 25, h: 25 });

    expect(warpedScore).toBeGreaterThan(flatScore + 1000);
  });

  it('penalizes placements that extend outside a partial mesh', () => {
    expect(scoreBedMeshPlacement(mesh, { x: -5, y: 10, w: 20, h: 20 })).toBeGreaterThanOrEqual(10000);
  });
});
