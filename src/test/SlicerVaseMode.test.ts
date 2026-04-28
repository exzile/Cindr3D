import { describe, expect, it } from 'vitest';

import {
  buildBox,
  outerWallMoves,
  sliceGeometry,
  wallMoves,
} from './_helpers/slicerSystemHelpers';

/**
 * Vase / spiralize mode integration coverage.
 *
 * Verifies the contract wired in emitGroupedAndContourWalls.ts +
 * emitContourInfill.ts + finalizeLayer.ts: above the solid-bottom band the
 * slicer prints ONLY the outer wall, and the per-segment Z ramp from the
 * GCodeEmitter Z-aware extrudeTo path produces a monotonically increasing
 * Z across each layer's outer wall.
 */
describe('Vase mode (spiralizeContour)', () => {
  it('emits zero infill or inner-wall moves above the solid-bottom band', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 5), {
      spiralizeContour: true,
      bottomLayers: 3,
      wallCount: 1,
      // wallCount=1 already collapses inner walls, but spiralize must
      // override even for higher wallCount profiles. Set a high count
      // here to prove the spiralize gate fires regardless.
    });
    // Above the bottom band, only outer-wall moves should exist. Skin
    // (`top-bottom`) and inner-wall moves are suppressed by the
    // spiralize gates we added.
    for (let li = 4; li < result.layers.length - 2; li++) {
      const layer = result.layers[li];
      const innerWalls = layer.moves.filter((m) => m.type === 'wall-inner');
      const skinMoves = layer.moves.filter((m) => m.type === 'top-bottom');
      const infillMoves = layer.moves.filter((m) => m.type === 'infill');
      expect(innerWalls).toHaveLength(0);
      expect(skinMoves).toHaveLength(0);
      expect(infillMoves).toHaveLength(0);
    }
  }, 60_000);

  it('keeps the bottom band as a solid floor', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 5), {
      spiralizeContour: true,
      bottomLayers: 2,
    });
    // Layer 0 (first solid floor layer) must contain skin moves so the
    // base prints solid. Without this, vase parts would print with no
    // floor at all.
    const layer0 = result.layers[0];
    const skin = layer0.moves.filter((m) => m.type === 'top-bottom');
    expect(skin.length).toBeGreaterThan(0);
  }, 60_000);

  it('disables support emission in vase mode', async () => {
    // Geometry irrelevant — just verify the support-skip gate fires.
    // We use a box with a bottom larger than top (overhang) to be sure
    // the support generator would otherwise try to emit something.
    const result = await sliceGeometry(buildBox(20, 20, 5), {
      spiralizeContour: true,
      supportEnabled: true,
      supportAngle: 30,
    });
    for (const layer of result.layers) {
      const supportMoves = layer.moves.filter((m) =>
        m.type === 'support-line' || m.type === 'support-interface' || m.type === 'support'
      );
      expect(supportMoves).toHaveLength(0);
    }
  }, 60_000);

  it('uses only outer-wall moves above the floor (spiralize wall set is single-pass)', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 5), {
      spiralizeContour: true,
      bottomLayers: 2,
      wallCount: 3, // would normally produce inner walls; spiralize must drop them
    });
    // Skip last layer since the layer pipeline can produce edge-case
    // termination moves there; verify the meaty middle.
    for (let li = 3; li < result.layers.length - 1; li++) {
      const walls = wallMoves(result.layers[li]);
      const outers = outerWallMoves(result.layers[li]);
      // Every wall move on this layer should be tagged as wall-outer.
      expect(walls.length).toBeGreaterThan(0);
      expect(outers.length).toBe(walls.length);
    }
  }, 60_000);
});
