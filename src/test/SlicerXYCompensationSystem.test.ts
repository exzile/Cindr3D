import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { bboxFromMoves, buildBox, makeSlicer } from './_helpers/slicerSystemHelpers';

/**
 * System-level test: slice a small box end-to-end and verify that the
 * XY compensation settings actually move the printed walls.
 *
 * This complements the unit tests in
 * `engine/slicer/pipeline/execution/steps/prepareLayerState.test.ts`
 * by exercising the full slicer pipeline (mesh → contours → walls →
 * G-code) with the new settings.
 */

async function sliceBox(size: number, printOverrides: Record<string, unknown>) {
  const slicer = makeSlicer(printOverrides);
  return slicer.slice([{
    geometry: buildBox(size, size, size),
    transform: new THREE.Matrix4(),
  }]);
}

describe('Slicer end-to-end — XY compensation', () => {
  it('slices a 10mm box without compensation as a baseline', async () => {
    const result = await sliceBox(10, {});
    expect(result.layerCount).toBeGreaterThan(40);
    expect(result.layers.length).toBeGreaterThan(0);
    const layer5Walls = result.layers[5].moves.filter((m) =>
      m.type === 'wall-outer' || m.type === 'wall-inner',
    );
    expect(layer5Walls.length).toBeGreaterThan(0);
  }, 60_000);

  it('applies horizontalExpansion to outer walls (positive grows the printed footprint)', async () => {
    const baseline = await sliceBox(10, {});
    const expanded = await sliceBox(10, { horizontalExpansion: 0.3 });

    // Compare layer 5 (well above first-layer) outer wall extents.
    const layerIndex = 5;
    const baseWalls = baseline.layers[layerIndex].moves.filter((m) => m.type === 'wall-outer');
    const expWalls = expanded.layers[layerIndex].moves.filter((m) => m.type === 'wall-outer');
    expect(baseWalls.length).toBeGreaterThan(0);
    expect(expWalls.length).toBeGreaterThan(0);

    const baseBox = bboxFromMoves(baseWalls);
    const expBox = bboxFromMoves(expWalls);
    // 0.3mm expansion → outer box grows by 0.6mm in width/height.
    // Allow generous tolerance (offset rounding, simplification, etc.)
    expect(expBox.width - baseBox.width).toBeGreaterThan(0.4);
    expect(expBox.width - baseBox.width).toBeLessThan(0.8);
  }, 60_000);

  it('shrinks first-layer outer when elephantFootCompensation > 0', async () => {
    const expanded = await sliceBox(10, { horizontalExpansion: 0.3 });
    const elephant = await sliceBox(10, {
      horizontalExpansion: 0.3,
      elephantFootCompensation: 0.2,
    });

    // Layer 0 (zero-based first layer) should be SMALLER with elephant
    // foot compensation than the equivalent expansion-only slice.
    const refWalls = expanded.layers[0].moves.filter((m) => m.type === 'wall-outer');
    const efWalls = elephant.layers[0].moves.filter((m) => m.type === 'wall-outer');
    expect(refWalls.length).toBeGreaterThan(0);
    expect(efWalls.length).toBeGreaterThan(0);

    const refBox = bboxFromMoves(refWalls);
    const efBox = bboxFromMoves(efWalls);
    // 0.2mm elephant foot → first layer outer shrinks by 0.4mm
    expect(refBox.width - efBox.width).toBeGreaterThan(0.25);

    // Layer 5 (above first layer) should be IDENTICAL — elephant foot
    // is layer-0-only.
    const refMid = bboxFromMoves(expanded.layers[5].moves.filter((m) => m.type === 'wall-outer'));
    const efMid = bboxFromMoves(elephant.layers[5].moves.filter((m) => m.type === 'wall-outer'));
    expect(Math.abs(refMid.width - efMid.width)).toBeLessThan(0.05);
  }, 60_000);

  it('initialLayerHorizontalExpansion overrides horizontalExpansion on layer 0 only', async () => {
    const baseline = await sliceBox(10, { horizontalExpansion: 0.1 });
    const overridden = await sliceBox(10, {
      horizontalExpansion: 0.1,
      initialLayerHorizontalExpansion: 0.5,
    });

    const baseLayer0 = bboxFromMoves(baseline.layers[0].moves.filter((m) => m.type === 'wall-outer'));
    const ovrLayer0 = bboxFromMoves(overridden.layers[0].moves.filter((m) => m.type === 'wall-outer'));
    // Layer 0: baseline +0.2mm, overridden +1.0mm → diff ~0.8mm
    expect(ovrLayer0.width - baseLayer0.width).toBeGreaterThan(0.5);

    // Layer 5: both should match (override is layer-0 only)
    const baseLayer5 = bboxFromMoves(baseline.layers[5].moves.filter((m) => m.type === 'wall-outer'));
    const ovrLayer5 = bboxFromMoves(overridden.layers[5].moves.filter((m) => m.type === 'wall-outer'));
    expect(Math.abs(ovrLayer5.width - baseLayer5.width)).toBeLessThan(0.05);
  }, 60_000);
});
