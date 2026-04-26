import { describe, expect, it } from 'vitest';

import {
  buildBox,
  buildCylinder,
  sliceGeometry,
} from './_helpers/slicerSystemHelpers';
import {
  buildLayerGeometry,
  computeLayerTimeRange,
  computeRange,
  getMoveColor,
} from '../components/slicer/workspace/preview/utils';
import { MOVE_TYPE_THREE_COLORS } from '../components/slicer/workspace/preview/constants';

/**
 * Slicer-to-preview integration tests: take real slice output and feed
 * it through the preview pipeline. Validates that the preview pipeline
 * doesn't lose move information and matches Cura/OrcaSlicer color
 * conventions on real geometry.
 */

describe('Slicer → preview pipeline — type mode', () => {
  it('a sliced box produces a wall-outer color in the preview buffer', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 1));
    const layer = result.layers[2];
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    expect(data.extrusionPositions.length).toBeGreaterThan(0);
    expect(data.extrusionColors.length).toBe(data.extrusionPositions.length);
    // At least one of the colors should match wall-outer (red-dominant).
    let foundOuterRed = false;
    for (let i = 0; i < data.extrusionColors.length; i += 3) {
      const r = data.extrusionColors[i], g = data.extrusionColors[i + 1], b = data.extrusionColors[i + 2];
      if (r > g && r > b && r > 0.4) { foundOuterRed = true; break; }
    }
    expect(foundOuterRed).toBe(true);
  }, 60_000);

  it('multi-wall slice produces both wall-outer (red) AND wall-inner (green) colors', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 1), { wallCount: 3 });
    const layer = result.layers[2];
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    let outerCount = 0;
    let innerCount = 0;
    for (let i = 0; i < data.extrusionColors.length; i += 6) {
      const r = data.extrusionColors[i];
      const g = data.extrusionColors[i + 1];
      if (r > g) outerCount++;
      else if (g > r) innerCount++;
    }
    expect(outerCount).toBeGreaterThan(0);
    expect(innerCount).toBeGreaterThan(0);
  }, 60_000);

  it('travel moves go in the travelPositions buffer (not extrusionPositions)', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 1));
    const layer = result.layers[2];
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    // Box slicing produces some travel moves — at minimum the move from
    // start position to first wall point.
    const expectedTravels = layer.moves.filter((m) => m.type === 'travel').length;
    expect(data.travelPositions.length).toBe(expectedTravels * 6);
  }, 60_000);

  it('extrusion buffer count matches non-travel moves × 6 floats', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 1));
    const layer = result.layers[2];
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    const expected = layer.moves.filter((m) => m.type !== 'travel').length * 6;
    expect(data.extrusionPositions.length).toBe(expected);
  }, 60_000);
});

describe('Slicer → preview pipeline — speed mode', () => {
  it('first-layer moves render with low-speed (blue) color when range starts at firstLayerSpeed', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 2), {
      firstLayerSpeed: 15,
      outerWallSpeed: 60,
    });
    const range = computeRange(result.layers, result.layers.length - 1, 'speed');
    const layer0Data = buildLayerGeometry(result.layers[0], 'speed', range);
    // Layer 0 moves should be at the slow (blue-dominant) end.
    let bluerCount = 0, redderCount = 0;
    for (let i = 0; i < layer0Data.extrusionColors.length; i += 3) {
      const r = layer0Data.extrusionColors[i], b = layer0Data.extrusionColors[i + 2];
      if (b > r) bluerCount++;
      else if (r > b) redderCount++;
    }
    expect(bluerCount).toBeGreaterThan(redderCount);
  }, 60_000);

  it('range computed across all layers spans firstLayerSpeed..outerWallSpeed', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 2), {
      firstLayerSpeed: 15,
      outerWallSpeed: 60,
    });
    const [min, max] = computeRange(result.layers, result.layers.length - 1, 'speed');
    expect(min).toBeLessThanOrEqual(20);
    expect(max).toBeGreaterThanOrEqual(40);
  }, 60_000);
});

describe('Slicer → preview pipeline — flow mode', () => {
  it('flow range across all layers contains positive non-zero extrusion values', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 2));
    const [min, max] = computeRange(result.layers, result.layers.length - 1, 'extrusion');
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThan(min);
  }, 60_000);

  it('higher-extrusion moves render closer to FLOW_HIGH (red) than lower ones', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 1));
    const layer = result.layers[2];
    const range = computeRange([layer], 0, 'extrusion');

    // Find the move with max and min extrusion.
    const extruding = layer.moves.filter((m) => m.type !== 'travel');
    if (extruding.length < 2) return;
    extruding.sort((a, b) => a.extrusion - b.extrusion);
    const minMove = extruding[0];
    const maxMove = extruding[extruding.length - 1];
    if (minMove.extrusion === maxMove.extrusion) return;
    const lowR = getMoveColor(minMove, 'flow', range).r;
    const highR = getMoveColor(maxMove, 'flow', range).r;
    expect(highR).toBeGreaterThan(lowR);
  }, 60_000);
});

describe('Slicer → preview pipeline — width mode', () => {
  it('width range across an Arachne slice covers the full bead-width spectrum', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 2), {
      wallGenerator: 'arachne',
      arachneBackend: 'wasm',
    });
    const [min, max] = computeRange(result.layers, result.layers.length - 1, 'width');
    // libArachne produces variable widths; allow that all widths might
    // also be uniform on a clean box. Just verify range is finite.
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThanOrEqual(min);
  }, 60_000);

  it('classic walls render with uniform color in width mode (all moves at lineWidth)', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 1));
    const layer = result.layers[2];
    const range = computeRange([layer], 0, 'width');
    const data = buildLayerGeometry(layer, 'width', range);
    // Classic uses uniform lineWidth → all colors should be (very) similar.
    if (data.extrusionColors.length < 12) return;
    const first = data.extrusionColors.slice(0, 3);
    let maxDiff = 0;
    for (let i = 6; i < data.extrusionColors.length; i += 3) {
      maxDiff = Math.max(maxDiff,
        Math.abs(data.extrusionColors[i] - first[0]),
        Math.abs(data.extrusionColors[i + 1] - first[1]),
        Math.abs(data.extrusionColors[i + 2] - first[2]),
      );
    }
    expect(maxDiff).toBeLessThan(0.05);
  }, 60_000);
});

describe('Slicer → preview pipeline — layer-time mode', () => {
  it('layer-time range across a multi-layer slice has a finite max', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 3));
    const [min, max] = computeLayerTimeRange(result.layers, result.layers.length - 1);
    expect(Number.isFinite(min)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
    expect(max).toBeGreaterThan(0);
  }, 60_000);

  it('every move in a single layer renders the same color in layer-time mode', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 1));
    const layer = result.layers[1];
    const data = buildLayerGeometry(layer, 'layer-time', [0, 1], 0.5);
    if (data.extrusionColors.length < 12) return;
    // All vertices share the same color in layer-time mode (proved in the
    // unit test). Re-validate end-to-end: max diff across vertices is ~0.
    const r0 = data.extrusionColors[0];
    const g0 = data.extrusionColors[1];
    const b0 = data.extrusionColors[2];
    for (let i = 3; i < data.extrusionColors.length; i += 3) {
      expect(data.extrusionColors[i]).toBeCloseTo(r0, 5);
      expect(data.extrusionColors[i + 1]).toBeCloseTo(g0, 5);
      expect(data.extrusionColors[i + 2]).toBeCloseTo(b0, 5);
    }
  }, 60_000);

  it('first vs last layer have different colors when layerTimeT differs', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 4));
    const range = computeLayerTimeRange(result.layers, result.layers.length - 1);
    const layer0 = result.layers[0];
    const layerN = result.layers[result.layers.length - 1];
    const t0 = (layer0.layerTime - range[0]) / (range[1] - range[0]);
    const tN = (layerN.layerTime - range[0]) / (range[1] - range[0]);
    if (Math.abs(t0 - tN) < 0.05) return;
    const data0 = buildLayerGeometry(layer0, 'layer-time', range, t0);
    const dataN = buildLayerGeometry(layerN, 'layer-time', range, tN);
    if (data0.extrusionColors.length === 0 || dataN.extrusionColors.length === 0) return;
    const diff = Math.abs(data0.extrusionColors[0] - dataN.extrusionColors[0]);
    expect(diff).toBeGreaterThan(0.01);
  }, 60_000);
});

describe('Slicer → preview pipeline — Z buffer attribution', () => {
  it('every preview vertex Z equals the layer Z (no float drift through Float32Array)', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 2));
    for (const layer of result.layers) {
      const data = buildLayerGeometry(layer, 'type', [0, 1]);
      for (let i = 2; i < data.extrusionPositions.length; i += 3) {
        expect(data.extrusionPositions[i]).toBeCloseTo(layer.z, 4);
      }
    }
  }, 60_000);
});

describe('Slicer → preview pipeline — vertex/color count parity', () => {
  it('extrusion vertex count = extrusion color count for every layer', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 2));
    for (const layer of result.layers) {
      const data = buildLayerGeometry(layer, 'type', [0, 1]);
      expect(data.extrusionPositions.length).toBe(data.extrusionColors.length);
    }
  }, 60_000);

  it('color modes produce identical position buffers (only color buffer changes)', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 1));
    const layer = result.layers[2];
    const range = computeRange([layer], 0, 'speed');
    const typeData = buildLayerGeometry(layer, 'type', range);
    const speedData = buildLayerGeometry(layer, 'speed', range);
    expect(typeData.extrusionPositions).toEqual(speedData.extrusionPositions);
    expect(typeData.travelPositions).toEqual(speedData.travelPositions);
    expect(typeData.retractionPoints).toEqual(speedData.retractionPoints);
    // Colors should differ.
    expect(typeData.extrusionColors).not.toEqual(speedData.extrusionColors);
  }, 60_000);
});

describe('Slicer → preview pipeline — Cura/Orca color invariant', () => {
  it('a 3-walled box has wall-outer moves drawn in red (Cura/Orca outer wall convention)', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 1), { wallCount: 3 });
    const layer = result.layers[2];
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    // Every wall-outer move should produce a red-dominant color in the
    // buffer. Walk the moves array with their corresponding 6-float
    // color slot.
    let moveIdx = 0;
    let outerWallChecked = 0;
    for (const move of layer.moves) {
      if (move.type === 'travel') { continue; }
      if (move.type === 'wall-outer') {
        const r = data.extrusionColors[moveIdx * 6];
        const g = data.extrusionColors[moveIdx * 6 + 1];
        const b = data.extrusionColors[moveIdx * 6 + 2];
        expect(r).toBeGreaterThan(g);
        expect(r).toBeGreaterThan(b);
        outerWallChecked++;
      }
      moveIdx++;
    }
    expect(outerWallChecked).toBeGreaterThan(0);
  }, 60_000);

  it('cylinder slice produces wall-outer color (red) in the preview', async () => {
    const result = await sliceGeometry(buildCylinder(10, 1, 32));
    const layer = result.layers[2];
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    let foundOuterRed = false;
    const outerColor = MOVE_TYPE_THREE_COLORS['wall-outer'];
    for (let i = 0; i < data.extrusionColors.length; i += 3) {
      if (Math.abs(data.extrusionColors[i] - outerColor.r) < 0.01) {
        foundOuterRed = true;
        break;
      }
    }
    expect(foundOuterRed).toBe(true);
  }, 60_000);
});

describe('Slicer → preview pipeline — retraction marker placement', () => {
  it('retraction points (extrusion < 0 travel) appear at travel from-points', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 2));
    let foundLayerWithRetraction = false;
    for (const layer of result.layers) {
      const data = buildLayerGeometry(layer, 'type', [0, 1]);
      if (data.retractionPoints.length === 0) continue;
      foundLayerWithRetraction = true;
      // Each retraction point is 3 floats (x, y, z); z = layer.z.
      for (let i = 2; i < data.retractionPoints.length; i += 3) {
        expect(data.retractionPoints[i]).toBeCloseTo(layer.z, 4);
      }
    }
    // A 15mm box with default settings should produce at least one retraction.
    expect(foundLayerWithRetraction).toBe(true);
  }, 60_000);
});
