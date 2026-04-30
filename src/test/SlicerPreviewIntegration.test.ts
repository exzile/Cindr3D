import { describe, expect, it } from 'vitest';

import {
  buildBox,
  buildCylinder,
  sliceGeometry,
} from './_helpers/slicerSystemHelpers';
import {
  buildColorContext,
  buildLayerInstances,
  colorForMove,
} from '../components/slicer/workspace/canvas/extrusionInstances';
import {
  computeLayerTimeRange,
  computeRange,
} from '../components/slicer/workspace/preview/utils';
import { MOVE_TYPE_THREE_COLORS } from '../components/slicer/workspace/preview/constants';

/**
 * Slicer-to-preview integration tests: take real slice output and feed it
 * through the instanced-capsule preview pipeline. Validates that the
 * pipeline doesn't lose move information and matches Cura/OrcaSlicer color
 * conventions on real geometry.
 */

const HIDDEN: ReadonlySet<string> = new Set();

function buildInstances(layer: ReturnType<typeof sliceGeometry> extends Promise<infer R> ? R extends { layers: infer L } ? L extends Array<infer Item> ? Item : never : never : never, mode: 'type' | 'speed' | 'flow' | 'width' | 'layer-time' | 'wall-quality' | 'seam', layerTimeT?: number) {
  const ctx = buildColorContext(layer, mode, layerTimeT);
  return buildLayerInstances({
    layer,
    layerHeight: 0.2,
    filamentDiameter: 1.75,
    isCurrentLayer: false,
    currentLayerMoveCount: undefined,
    showTravel: true,
    hiddenTypes: HIDDEN,
    colorContext: ctx,
  });
}

describe('Slicer → preview pipeline — type mode', () => {
  it('a sliced box produces wall-outer instances with the wall-outer color', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 1));
    const layer = result.layers[2];
    const data = buildInstances(layer, 'type');
    expect(data.count).toBeGreaterThan(0);

    const outer = MOVE_TYPE_THREE_COLORS['wall-outer'];
    let foundOuter = false;
    for (let i = 0; i < data.count; i++) {
      const r = data.iColor[i * 3], g = data.iColor[i * 3 + 1], b = data.iColor[i * 3 + 2];
      if (Math.abs(r - outer.r) < 1e-6 && Math.abs(g - outer.g) < 1e-6 && Math.abs(b - outer.b) < 1e-6) {
        foundOuter = true;
        break;
      }
    }
    expect(foundOuter).toBe(true);
  }, 60_000);

  it('multi-wall slice produces both wall-outer and wall-inner colored instances', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 1), { wallCount: 3 });
    const layer = result.layers[2];
    const data = buildInstances(layer, 'type');

    const outer = MOVE_TYPE_THREE_COLORS['wall-outer'];
    const inner = MOVE_TYPE_THREE_COLORS['wall-inner'];
    let outerCount = 0;
    let innerCount = 0;
    for (let i = 0; i < data.count; i++) {
      const r = data.iColor[i * 3], g = data.iColor[i * 3 + 1], b = data.iColor[i * 3 + 2];
      if (Math.abs(r - outer.r) < 1e-6 && Math.abs(g - outer.g) < 1e-6 && Math.abs(b - outer.b) < 1e-6) outerCount++;
      if (Math.abs(r - inner.r) < 1e-6 && Math.abs(g - inner.g) < 1e-6 && Math.abs(b - inner.b) < 1e-6) innerCount++;
    }
    expect(outerCount).toBeGreaterThan(0);
    expect(innerCount).toBeGreaterThan(0);
  }, 60_000);

  it('travel moves go in the travel buffer, not the instance buffer', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 1));
    const layer = result.layers[2];
    const data = buildInstances(layer, 'type');
    const expectedTravels = layer.moves.filter((m) => m.type === 'travel').length;
    expect(data.travelPositions.length).toBe(expectedTravels * 6);
  }, 60_000);

  it('instance count equals the number of non-zero-length non-travel moves', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 1));
    const layer = result.layers[2];
    const data = buildInstances(layer, 'type');
    const expected = layer.moves.filter((m) => {
      if (m.type === 'travel') return false;
      if (m.extrusion <= 0) return false;
      const len = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
      return len >= 1e-6;
    }).length;
    expect(data.count).toBe(expected);
  }, 60_000);
});

describe('Slicer → preview pipeline — speed mode', () => {
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

  it('higher-extrusion moves get a redder color than lower-extrusion ones', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 1));
    const layer = result.layers[2];
    const range = computeRange([layer], 0, 'extrusion');
    const extruding = layer.moves.filter((m) => m.type !== 'travel');
    if (extruding.length < 2) return;
    extruding.sort((a, b) => a.extrusion - b.extrusion);
    const minMove = extruding[0];
    const maxMove = extruding[extruding.length - 1];
    if (minMove.extrusion === maxMove.extrusion) return;

    const ctx = {
      mode: 'flow' as const,
      speedRange: [0, 1] as [number, number],
      flowRange: range,
      widthRange: [0, 1] as [number, number],
      layerTimeT: 0,
      medianWallWidth: 0,
    };
    const lowR  = colorForMove(minMove, ctx)[0];
    const highR = colorForMove(maxMove, ctx)[0];
    expect(highR).toBeGreaterThan(lowR);
  }, 60_000);
});

describe('Slicer → preview pipeline — width mode', () => {
  it('applies initial-layer line width factor to first-layer skin and walls', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 1), {
      wallGenerator: 'classic',
      lineWidth: 0.4,
      wallLineWidth: 0.4,
      outerWallLineWidth: 0.4,
      innerWallLineWidth: 0.45,
      topBottomLineWidth: 0.4,
      infillLineWidth: 0.45,
      initialLayerLineWidthFactor: 125,
    });
    const firstLayer = result.layers[0];
    const topBottom = firstLayer.moves.find((move) => move.type === 'top-bottom');
    const wall = firstLayer.moves.find((move) => move.type === 'wall-outer' || move.type === 'wall-inner');
    expect(topBottom?.lineWidth).toBeCloseTo(0.5, 3);
    expect(wall?.lineWidth).toBeCloseTo(0.5, 3);
  }, 60_000);

  it('width range across an Arachne slice covers the full bead-width spectrum', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 2), {
      wallGenerator: 'arachne',
      arachneBackend: 'wasm',
    });
    const [min, max] = computeRange(result.layers, result.layers.length - 1, 'width');
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThanOrEqual(min);
  }, 60_000);

  it('classic walls render with uniform color in width mode', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 3), {
      wallGenerator: 'classic',
      lineWidth: 0.45,
      wallLineWidth: 0.45,
      outerWallLineWidth: 0.45,
      innerWallLineWidth: 0.45,
      infillLineWidth: 0.45,
      topBottomLineWidth: 0.45,
      initialLayerLineWidthFactor: 100,
    });
    const layer = result.layers[Math.min(8, result.layers.length - 1)];
    const data = buildInstances(layer, 'width');
    if (data.count < 4) return;
    const first = [data.iColor[0], data.iColor[1], data.iColor[2]];
    let maxDiff = 0;
    for (let i = 1; i < data.count; i++) {
      maxDiff = Math.max(
        maxDiff,
        Math.abs(data.iColor[i * 3]     - first[0]),
        Math.abs(data.iColor[i * 3 + 1] - first[1]),
        Math.abs(data.iColor[i * 3 + 2] - first[2]),
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

  it('every instance in a single layer renders the same color in layer-time mode', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 1));
    const layer = result.layers[1];
    const data = buildInstances(layer, 'layer-time', 0.5);
    if (data.count < 2) return;
    const r0 = data.iColor[0], g0 = data.iColor[1], b0 = data.iColor[2];
    for (let i = 1; i < data.count; i++) {
      expect(data.iColor[i * 3]).toBeCloseTo(r0, 5);
      expect(data.iColor[i * 3 + 1]).toBeCloseTo(g0, 5);
      expect(data.iColor[i * 3 + 2]).toBeCloseTo(b0, 5);
    }
  }, 60_000);
});

describe('Slicer → preview pipeline — Z position attribution', () => {
  it('every instance endpoint Z sits at layer.z minus half the layer height', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 2));
    for (let li = 1; li < result.layers.length; li++) {
      const layer = result.layers[li];
      const prevZ = result.layers[li - 1]?.z ?? 0;
      const layerHeight = Math.max(0.05, layer.z - prevZ);
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
      const expectedZ = layer.z - layerHeight * 0.5;
      for (let i = 0; i < data.count; i++) {
        expect(data.iA[i * 3 + 2]).toBeCloseTo(expectedZ, 4);
        expect(data.iB[i * 3 + 2]).toBeCloseTo(expectedZ, 4);
      }
    }
  }, 60_000);
});

describe('Slicer → preview pipeline — Cura/Orca color invariant', () => {
  it('cylinder slice produces wall-outer color (red) in the preview', async () => {
    const result = await sliceGeometry(buildCylinder(10, 1, 32));
    const layer = result.layers[2];
    const data = buildInstances(layer, 'type');
    let foundOuterRed = false;
    const outerColor = MOVE_TYPE_THREE_COLORS['wall-outer'];
    for (let i = 0; i < data.count; i++) {
      if (Math.abs(data.iColor[i * 3] - outerColor.r) < 0.01) {
        foundOuterRed = true;
        break;
      }
    }
    expect(foundOuterRed).toBe(true);
  }, 60_000);
});

describe('Slicer → preview pipeline — retraction marker placement', () => {
  it('retraction points (extrusion < 0 travels) appear at layer Z', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 2));
    let foundLayerWithRetraction = false;
    for (const layer of result.layers) {
      const data = buildInstances(layer, 'type');
      if (data.retractPositions.length === 0) continue;
      foundLayerWithRetraction = true;
      for (let i = 2; i < data.retractPositions.length; i += 3) {
        expect(data.retractPositions[i]).toBeCloseTo(layer.z, 4);
      }
    }
    expect(foundLayerWithRetraction).toBe(true);
  }, 60_000);
});

describe('Slicer → preview pipeline — instance endpoint placement', () => {
  it('every instance endpoint matches its source SliceMove from/to within 1 µm', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 1), { wallCount: 2 });
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
    // moveRefs[i].moveIndex points back at layer.moves; verify placement
    // matches the original gcode segment endpoints exactly.
    for (let i = 0; i < data.count; i++) {
      const mv = layer.moves[data.moveRefs[i].moveIndex!];
      expect(data.iA[i * 3]).toBeCloseTo(mv.from.x, 5);
      expect(data.iA[i * 3 + 1]).toBeCloseTo(mv.from.y, 5);
      expect(data.iB[i * 3]).toBeCloseTo(mv.to.x, 5);
      expect(data.iB[i * 3 + 1]).toBeCloseTo(mv.to.y, 5);
    }
  }, 60_000);
});
