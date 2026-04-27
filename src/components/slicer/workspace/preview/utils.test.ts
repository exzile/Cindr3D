import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  buildLayerGeometry,
  computeLayerTimeRange,
  computeRange,
  getMoveColor,
} from './utils';
import {
  FLOW_HIGH_COLOR,
  FLOW_LOW_COLOR,
  LAYER_TIME_HIGH_COLOR,
  LAYER_TIME_LOW_COLOR,
  MOVE_TYPE_COLORS,
  MOVE_TYPE_LABELS,
  MOVE_TYPE_THREE_COLORS,
  SPEED_HIGH_COLOR,
  SPEED_LOW_COLOR,
  WIDTH_HIGH_COLOR,
  WIDTH_LOW_COLOR,
} from './constants';
import type { SliceLayer, SliceMove } from '../../../../types/slicer';

/**
 * Slicer preview parity tests — verify the move-to-color mapping and
 * layer-buffer accumulation match the conventions used by Cura and
 * OrcaSlicer for their G-code preview viewports.
 *
 * Cura/Orca visual convention:
 *   - Outer Wall: red          - Inner Wall: green
 *   - Infill: orange/brown     - Top/Bottom: Orca-style purple
 *   - Support: magenta         - Skirt/Brim: gray
 *   - Bridge: bright red       - Travel: dark gray (dashed)
 *   - Ironing: light green
 *
 * Speed mode: blue→red (slow→fast)
 * Flow mode:  green→red (low→high)
 * Width mode: blue→orange (thin→thick)
 * Layer-time: green→red (fast→slow)
 */

function makeMove(overrides: Partial<SliceMove> = {}): SliceMove {
  return {
    type: 'wall-outer',
    from: { x: 0, y: 0 },
    to: { x: 10, y: 0 },
    speed: 60,
    extrusion: 0.05,
    lineWidth: 0.4,
    ...overrides,
  } as SliceMove;
}

function makeLayer(moves: SliceMove[], z = 0.2, layerTime = 5): SliceLayer {
  return {
    z,
    layerIndex: 0,
    layerTime,
    moves,
  } as SliceLayer;
}

describe('Preview color palette — Cura/OrcaSlicer parity', () => {
  it('outer-wall is red (Cura/Orca convention)', () => {
    const c = MOVE_TYPE_THREE_COLORS['wall-outer'];
    // Red dominant, green/blue low.
    expect(c.r).toBeGreaterThan(0.5);
    expect(c.g).toBeLessThan(0.4);
    expect(c.b).toBeLessThan(0.4);
  });

  it('inner-wall is green-dominant (Cura/Orca convention)', () => {
    // THREE.Color stores values in linear space; the perceptual-green hex
    // ends up around 0.5 in linear. Just verify g dominates over r/b.
    const c = MOVE_TYPE_THREE_COLORS['wall-inner'];
    expect(c.g).toBeGreaterThan(c.r);
    expect(c.g).toBeGreaterThan(c.b);
  });

  it('top-bottom (skin) is Orca-style purple', () => {
    const c = MOVE_TYPE_THREE_COLORS['top-bottom'];
    expect(MOVE_TYPE_COLORS['top-bottom']).toBe('#5f56c8');
    expect(c.b).toBeGreaterThan(c.g);
    expect(c.r).toBeGreaterThan(c.g);
  });

  it('infill is orange/brown (red-dominant, low blue — Cura/Orca convention)', () => {
    const c = MOVE_TYPE_THREE_COLORS.infill;
    expect(c.r).toBeGreaterThan(c.g);
    expect(c.g).toBeGreaterThan(c.b);
    expect(c.b).toBeLessThan(0.05);  // very little blue
  });

  it('support is magenta/purple (red + blue dominant, green low — Cura/Orca convention)', () => {
    const c = MOVE_TYPE_THREE_COLORS.support;
    expect(c.r).toBeGreaterThan(c.g);
    expect(c.b).toBeGreaterThan(c.g);
    expect(c.g).toBeLessThan(0.2);
  });

  it('bridge is bright red (visually distinct from outer wall)', () => {
    const c = MOVE_TYPE_THREE_COLORS.bridge;
    expect(c.r).toBeGreaterThan(0.9);
  });

  it('travel is dark gray (low contrast — typical for travel dashes)', () => {
    const c = MOVE_TYPE_THREE_COLORS.travel;
    expect(Math.abs(c.r - c.g)).toBeLessThan(0.05);
    expect(Math.abs(c.g - c.b)).toBeLessThan(0.05);
    expect(c.r).toBeLessThan(0.5);
  });

  it('skirt and brim share the same color (unified adhesion family)', () => {
    expect(MOVE_TYPE_COLORS.skirt).toBe(MOVE_TYPE_COLORS.brim);
  });

  it('ironing is light green (a light/saturated variant of skin)', () => {
    const c = MOVE_TYPE_THREE_COLORS.ironing;
    expect(c.g).toBeGreaterThan(0.5);
    expect(c.r).toBeLessThan(0.5);
  });

  it('all 11 move types have a label and a color', () => {
    const types: SliceMove['type'][] = [
      'wall-outer', 'wall-inner', 'infill', 'top-bottom', 'support',
      'skirt', 'brim', 'raft', 'bridge', 'travel', 'ironing',
    ];
    for (const t of types) {
      expect(MOVE_TYPE_COLORS[t]).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(MOVE_TYPE_LABELS[t]).toBeTruthy();
      expect(MOVE_TYPE_THREE_COLORS[t]).toBeInstanceOf(THREE.Color);
    }
  });

  it('hex colors and THREE colors agree (THREE derived from hex)', () => {
    const types: SliceMove['type'][] = [
      'wall-outer', 'wall-inner', 'infill', 'top-bottom', 'support',
      'skirt', 'bridge', 'travel', 'ironing',
    ];
    for (const t of types) {
      const fromHex = new THREE.Color(MOVE_TYPE_COLORS[t]);
      expect(MOVE_TYPE_THREE_COLORS[t].getHexString()).toBe(fromHex.getHexString());
    }
  });
});

describe('Preview color ramps — direction + range', () => {
  it('speed ramp: low end is blue (slow), high end is red (fast) — matches Cura', () => {
    expect(SPEED_LOW_COLOR.b).toBeGreaterThan(SPEED_LOW_COLOR.r);
    expect(SPEED_HIGH_COLOR.r).toBeGreaterThan(SPEED_HIGH_COLOR.b);
  });

  it('flow ramp: low end is green, high end is red — matches OrcaSlicer', () => {
    expect(FLOW_LOW_COLOR.g).toBeGreaterThan(FLOW_LOW_COLOR.r);
    expect(FLOW_HIGH_COLOR.r).toBeGreaterThan(FLOW_HIGH_COLOR.g);
  });

  it('width ramp: low end is blue (thin), high end is orange (thick)', () => {
    expect(WIDTH_LOW_COLOR.b).toBeGreaterThan(WIDTH_LOW_COLOR.r);
    expect(WIDTH_HIGH_COLOR.r).toBeGreaterThan(WIDTH_HIGH_COLOR.b);
  });

  it('layer-time ramp: low end is green (fast), high end is red (slow)', () => {
    expect(LAYER_TIME_LOW_COLOR.g).toBeGreaterThan(LAYER_TIME_LOW_COLOR.r);
    expect(LAYER_TIME_HIGH_COLOR.r).toBeGreaterThan(LAYER_TIME_HIGH_COLOR.g);
  });
});

describe('getMoveColor — type mode', () => {
  it('returns the move-type color for "type" mode', () => {
    const move = makeMove({ type: 'wall-outer' });
    const c = getMoveColor(move, 'type', [0, 1]);
    const expected = MOVE_TYPE_THREE_COLORS['wall-outer'];
    expect(c.r).toBeCloseTo(expected.r, 5);
    expect(c.g).toBeCloseTo(expected.g, 5);
    expect(c.b).toBeCloseTo(expected.b, 5);
  });

  it('returns the inner-wall color for inner walls', () => {
    const move = makeMove({ type: 'wall-inner' });
    const c = getMoveColor(move, 'type', [0, 1]);
    expect(c.g).toBeGreaterThan(c.r);
  });

  it('returns the bridge color for bridge moves', () => {
    const move = makeMove({ type: 'bridge' });
    const c = getMoveColor(move, 'type', [0, 1]);
    expect(c.r).toBeGreaterThan(0.9);
  });

  it('falls back to gray for unknown move types', () => {
    const move = makeMove({ type: 'unknown' as SliceMove['type'] });
    const c = getMoveColor(move, 'type', [0, 1]);
    expect(Math.abs(c.r - c.g)).toBeLessThan(0.05);
    expect(Math.abs(c.g - c.b)).toBeLessThan(0.05);
  });
});

describe('getMoveColor — speed mode', () => {
  it('returns SPEED_LOW_COLOR at the low end of the range', () => {
    const c = getMoveColor(makeMove({ speed: 30 }), 'speed', [30, 90]);
    expect(c.r).toBeCloseTo(SPEED_LOW_COLOR.r, 4);
    expect(c.g).toBeCloseTo(SPEED_LOW_COLOR.g, 4);
    expect(c.b).toBeCloseTo(SPEED_LOW_COLOR.b, 4);
  });

  it('returns SPEED_HIGH_COLOR at the high end of the range', () => {
    const c = getMoveColor(makeMove({ speed: 90 }), 'speed', [30, 90]);
    expect(c.r).toBeCloseTo(SPEED_HIGH_COLOR.r, 4);
    expect(c.g).toBeCloseTo(SPEED_HIGH_COLOR.g, 4);
    expect(c.b).toBeCloseTo(SPEED_HIGH_COLOR.b, 4);
  });

  it('returns a midpoint blend at the range midpoint', () => {
    const c = getMoveColor(makeMove({ speed: 60 }), 'speed', [30, 90]);
    const expectedR = (SPEED_LOW_COLOR.r + SPEED_HIGH_COLOR.r) / 2;
    expect(c.r).toBeCloseTo(expectedR, 3);
  });

  it('clamps below-range values to the low color', () => {
    const c = getMoveColor(makeMove({ speed: 10 }), 'speed', [30, 90]);
    expect(c.r).toBeCloseTo(SPEED_LOW_COLOR.r, 4);
  });

  it('clamps above-range values to the high color', () => {
    const c = getMoveColor(makeMove({ speed: 200 }), 'speed', [30, 90]);
    expect(c.r).toBeCloseTo(SPEED_HIGH_COLOR.r, 4);
  });
});

describe('getMoveColor — flow mode', () => {
  it('uses extrusion (not lineWidth or speed) for flow mode interpolation', () => {
    const lowR = getMoveColor(makeMove({ extrusion: 0.01 }), 'flow', [0.01, 0.10]).r;
    // Capture .r BEFORE next call (scratch color is reused).
    const highR = getMoveColor(makeMove({ extrusion: 0.10 }), 'flow', [0.01, 0.10]).r;
    expect(highR).toBeGreaterThan(lowR);
  });

  it('returns FLOW_LOW_COLOR at min extrusion', () => {
    const c = getMoveColor(makeMove({ extrusion: 0.02 }), 'flow', [0.02, 0.08]);
    expect(c.g).toBeCloseTo(FLOW_LOW_COLOR.g, 4);
  });

  it('returns FLOW_HIGH_COLOR at max extrusion', () => {
    const c = getMoveColor(makeMove({ extrusion: 0.08 }), 'flow', [0.02, 0.08]);
    expect(c.r).toBeCloseTo(FLOW_HIGH_COLOR.r, 4);
  });
});

describe('getMoveColor — width mode', () => {
  it('uses lineWidth for width mode interpolation', () => {
    const narrowR = getMoveColor(makeMove({ lineWidth: 0.3 }), 'width', [0.3, 0.6]).r;
    const wideR = getMoveColor(makeMove({ lineWidth: 0.6 }), 'width', [0.3, 0.6]).r;
    expect(wideR).toBeGreaterThan(narrowR);
  });

  it('returns WIDTH_LOW_COLOR at min lineWidth', () => {
    const c = getMoveColor(makeMove({ lineWidth: 0.3 }), 'width', [0.3, 0.6]);
    expect(c.b).toBeCloseTo(WIDTH_LOW_COLOR.b, 4);
  });

  it('returns WIDTH_HIGH_COLOR at max lineWidth', () => {
    const c = getMoveColor(makeMove({ lineWidth: 0.6 }), 'width', [0.3, 0.6]);
    expect(c.r).toBeCloseTo(WIDTH_HIGH_COLOR.r, 4);
  });
});

describe('getMoveColor — layer-time mode', () => {
  it('returns LAYER_TIME_LOW_COLOR (green) for layerTimeT=0', () => {
    const c = getMoveColor(makeMove(), 'layer-time', [0, 1], 0);
    expect(c.g).toBeCloseTo(LAYER_TIME_LOW_COLOR.g, 4);
    expect(c.r).toBeCloseTo(LAYER_TIME_LOW_COLOR.r, 4);
  });

  it('returns LAYER_TIME_HIGH_COLOR (red) for layerTimeT=1', () => {
    const c = getMoveColor(makeMove(), 'layer-time', [0, 1], 1);
    expect(c.r).toBeCloseTo(LAYER_TIME_HIGH_COLOR.r, 4);
  });

  it('returns midpoint blend for layerTimeT=0.5', () => {
    const c = getMoveColor(makeMove(), 'layer-time', [0, 1], 0.5);
    const expectedR = (LAYER_TIME_LOW_COLOR.r + LAYER_TIME_HIGH_COLOR.r) / 2;
    expect(c.r).toBeCloseTo(expectedR, 3);
  });

  it('clamps layerTimeT below 0 to the low color', () => {
    const c = getMoveColor(makeMove(), 'layer-time', [0, 1], -0.5);
    expect(c.g).toBeCloseTo(LAYER_TIME_LOW_COLOR.g, 4);
  });

  it('clamps layerTimeT above 1 to the high color', () => {
    const c = getMoveColor(makeMove(), 'layer-time', [0, 1], 2);
    expect(c.r).toBeCloseTo(LAYER_TIME_HIGH_COLOR.r, 4);
  });

  it('layer-time mode does NOT depend on per-move scalars (every move same color)', () => {
    const a = getMoveColor(makeMove({ speed: 30 }), 'layer-time', [0, 1], 0.5);
    const b = getMoveColor(makeMove({ speed: 90 }), 'layer-time', [0, 1], 0.5);
    expect(a.r).toBeCloseTo(b.r, 5);
    expect(a.g).toBeCloseTo(b.g, 5);
    expect(a.b).toBeCloseTo(b.b, 5);
  });
});

describe('computeRange', () => {
  it('returns [min, max] of speed across all moves', () => {
    const layer = makeLayer([
      makeMove({ speed: 30 }),
      makeMove({ speed: 90 }),
      makeMove({ speed: 60 }),
    ]);
    expect(computeRange([layer], 0, 'speed')).toEqual([30, 90]);
  });

  it('skips travel moves when computing range', () => {
    const layer = makeLayer([
      makeMove({ type: 'travel', speed: 200 }),
      makeMove({ type: 'wall-outer', speed: 60 }),
    ]);
    expect(computeRange([layer], 0, 'speed')).toEqual([60, 61]);
  });

  it('computeRange across two layers merges the ranges', () => {
    const a = makeLayer([makeMove({ speed: 30 })]);
    const b = makeLayer([makeMove({ speed: 100 })]);
    expect(computeRange([a, b], 1, 'speed')).toEqual([30, 100]);
  });

  it('respects the maxLayer parameter (only counts layers up to maxLayer)', () => {
    const a = makeLayer([makeMove({ speed: 30 })]);
    const b = makeLayer([makeMove({ speed: 100 })]);
    expect(computeRange([a, b], 0, 'speed')).toEqual([30, 31]);
  });

  it('returns [min, min+1] when all values equal (avoids div by 0)', () => {
    const layer = makeLayer([
      makeMove({ speed: 60 }),
      makeMove({ speed: 60 }),
    ]);
    expect(computeRange([layer], 0, 'speed')).toEqual([60, 61]);
  });

  it('returns [0, 1] when no extruding moves exist (only travel)', () => {
    const layer = makeLayer([
      makeMove({ type: 'travel' }),
      makeMove({ type: 'travel' }),
    ]);
    expect(computeRange([layer], 0, 'speed')).toEqual([0, 1]);
  });

  it('field=extrusion uses move.extrusion (not lineWidth)', () => {
    const layer = makeLayer([
      makeMove({ extrusion: 0.01, lineWidth: 99 }),
      makeMove({ extrusion: 0.05, lineWidth: 99 }),
    ]);
    expect(computeRange([layer], 0, 'extrusion')).toEqual([0.01, 0.05]);
  });

  it('field=width uses move.lineWidth', () => {
    const layer = makeLayer([
      makeMove({ lineWidth: 0.3 }),
      makeMove({ lineWidth: 0.6 }),
    ]);
    expect(computeRange([layer], 0, 'width')).toEqual([0.3, 0.6]);
  });
});

describe('computeLayerTimeRange', () => {
  it('returns [min, max] across the layer window', () => {
    const layers: SliceLayer[] = [
      makeLayer([], 0.2, 5),
      makeLayer([], 0.4, 12),
      makeLayer([], 0.6, 8),
    ];
    expect(computeLayerTimeRange(layers, 2)).toEqual([5, 12]);
  });

  it('respects minLayer parameter', () => {
    const layers: SliceLayer[] = [
      makeLayer([], 0.2, 100),  // ignored
      makeLayer([], 0.4, 5),
      makeLayer([], 0.6, 12),
    ];
    expect(computeLayerTimeRange(layers, 2, 1)).toEqual([5, 12]);
  });

  it('returns [min, min+1] when all layerTimes equal', () => {
    const layers = [makeLayer([], 0.2, 5), makeLayer([], 0.4, 5)];
    expect(computeLayerTimeRange(layers, 1)).toEqual([5, 6]);
  });

  it('returns [0, 1] for an empty window', () => {
    const layers = [makeLayer([], 0.2, 5)];
    expect(computeLayerTimeRange(layers, -1)).toEqual([0, 1]);
  });
});

describe('buildLayerGeometry — extrusion buffer', () => {
  it('extrusionPositions stores from + to (each as 3 floats × 2 vertices) per non-travel move', () => {
    const layer = makeLayer([
      makeMove({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }),
      makeMove({ from: { x: 10, y: 0 }, to: { x: 10, y: 10 } }),
    ], 0.2);
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    // 2 moves × 6 floats = 12.
    expect(data.extrusionPositions.length).toBe(12);
    expect(data.extrusionPositions[0]).toBeCloseTo(0, 4);   // first.from.x
    expect(data.extrusionPositions[3]).toBeCloseTo(10, 4);  // first.to.x
    expect(data.extrusionPositions[2]).toBeCloseTo(0.2, 4); // first.from.z
    expect(data.extrusionPositions[5]).toBeCloseTo(0.2, 4); // first.to.z
  });

  it('extrusionColors has 3 floats × 2 vertices per move (matching positions)', () => {
    const layer = makeLayer([makeMove(), makeMove()]);
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    expect(data.extrusionColors.length).toBe(data.extrusionPositions.length);
  });

  it('travelPositions stores from + to per travel move', () => {
    const layer = makeLayer([
      makeMove({ type: 'wall-outer' }),
      makeMove({ type: 'travel', from: { x: 0, y: 0 }, to: { x: 50, y: 50 } }),
    ], 0.4);
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    expect(data.travelPositions.length).toBe(6);
    expect(data.travelPositions[0]).toBe(0);    // travel.from.x
    expect(data.travelPositions[3]).toBe(50);   // travel.to.x
  });

  it('extrusion and travel buffers are populated independently', () => {
    const layer = makeLayer([
      makeMove({ type: 'wall-outer' }),
      makeMove({ type: 'travel' }),
      makeMove({ type: 'wall-inner' }),
    ]);
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    // 2 extruding moves
    expect(data.extrusionPositions.length).toBe(2 * 6);
    // 1 travel move
    expect(data.travelPositions.length).toBe(1 * 6);
  });

  it('retractionPoints captures only travel moves with extrusion < 0', () => {
    const layer = makeLayer([
      makeMove({ type: 'travel', extrusion: 0, from: { x: 5, y: 5 } }),
      makeMove({ type: 'travel', extrusion: -0.5, from: { x: 7, y: 7 } }),
      makeMove({ type: 'wall-outer', extrusion: 0.05 }),
    ]);
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    expect(data.retractionPoints.length).toBe(3);
    expect(data.retractionPoints[0]).toBe(7);
    expect(data.retractionPoints[1]).toBe(7);
  });

  it('all buffers are Float32Array (matches three.js BufferAttribute requirements)', () => {
    const layer = makeLayer([makeMove()]);
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    expect(data.extrusionPositions).toBeInstanceOf(Float32Array);
    expect(data.extrusionColors).toBeInstanceOf(Float32Array);
    expect(data.travelPositions).toBeInstanceOf(Float32Array);
    expect(data.retractionPoints).toBeInstanceOf(Float32Array);
  });

  it('handles an empty layer gracefully', () => {
    const layer = makeLayer([]);
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    expect(data.extrusionPositions.length).toBe(0);
    expect(data.travelPositions.length).toBe(0);
    expect(data.retractionPoints.length).toBe(0);
  });
});

describe('buildLayerGeometry — color attribution per mode', () => {
  it('"type" mode uses MOVE_TYPE_THREE_COLORS for each segment', () => {
    const layer = makeLayer([
      makeMove({ type: 'wall-outer' }),
      makeMove({ type: 'wall-inner' }),
    ]);
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    // First 3 floats = first vertex color = wall-outer.
    const outer = MOVE_TYPE_THREE_COLORS['wall-outer'];
    expect(data.extrusionColors[0]).toBeCloseTo(outer.r, 4);
    expect(data.extrusionColors[1]).toBeCloseTo(outer.g, 4);
    expect(data.extrusionColors[2]).toBeCloseTo(outer.b, 4);
    // Move 2's first vertex color (offset 6) = wall-inner.
    const inner = MOVE_TYPE_THREE_COLORS['wall-inner'];
    expect(data.extrusionColors[6]).toBeCloseTo(inner.r, 4);
  });

  it('both vertices of a single move share the same color', () => {
    const layer = makeLayer([makeMove({ type: 'support' })]);
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    expect(data.extrusionColors[0]).toBeCloseTo(data.extrusionColors[3], 5);
    expect(data.extrusionColors[1]).toBeCloseTo(data.extrusionColors[4], 5);
    expect(data.extrusionColors[2]).toBeCloseTo(data.extrusionColors[5], 5);
  });

  it('"speed" mode produces different colors for moves with different speeds', () => {
    const layer = makeLayer([
      makeMove({ speed: 30 }),
      makeMove({ speed: 90 }),
    ]);
    const data = buildLayerGeometry(layer, 'speed', [30, 90]);
    expect(data.extrusionColors[0]).not.toBeCloseTo(data.extrusionColors[6], 4);
  });

  it('"layer-time" mode produces the same color for every move on the layer', () => {
    const layer = makeLayer([
      makeMove({ speed: 30 }),
      makeMove({ speed: 90 }),
    ]);
    const data = buildLayerGeometry(layer, 'layer-time', [0, 1], 0.5);
    expect(data.extrusionColors[0]).toBeCloseTo(data.extrusionColors[6], 5);
    expect(data.extrusionColors[1]).toBeCloseTo(data.extrusionColors[7], 5);
  });
});

describe('buildLayerGeometry — z value attribution', () => {
  it('every vertex z equals layer.z', () => {
    const z = 1.234;
    const layer = makeLayer([makeMove()], z);
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    for (let i = 2; i < data.extrusionPositions.length; i += 3) {
      expect(data.extrusionPositions[i]).toBeCloseTo(z, 5);
    }
  });

  it('travel z values also match layer.z', () => {
    const z = 0.7;
    const layer = makeLayer([
      makeMove({ type: 'travel' }),
    ], z);
    const data = buildLayerGeometry(layer, 'type', [0, 1]);
    expect(data.travelPositions[2]).toBeCloseTo(z, 5);
    expect(data.travelPositions[5]).toBeCloseTo(z, 5);
  });
});

describe('Move type label parity', () => {
  it('label keys exactly match color keys', () => {
    expect(Object.keys(MOVE_TYPE_LABELS).sort()).toEqual(Object.keys(MOVE_TYPE_COLORS).sort());
  });

  it('skirt and brim have distinct labels (UI legend differentiates them)', () => {
    expect(MOVE_TYPE_LABELS.skirt).not.toBe(MOVE_TYPE_LABELS.brim);
  });

  it('every label is non-empty and human-readable', () => {
    for (const t of Object.keys(MOVE_TYPE_LABELS)) {
      const label = MOVE_TYPE_LABELS[t as SliceMove['type']];
      expect(label.length).toBeGreaterThan(0);
      expect(label).toMatch(/^[A-Za-z]/);  // starts with a letter
    }
  });
});
