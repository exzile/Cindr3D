import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { computeLayerTimeRange, computeRange } from './utils';
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
  Z_SEAM_COLOR,
} from './constants';
import type { SliceLayer, SliceMove } from '../../../../types/slicer';

/**
 * Slicer preview parity tests — verify the per-feature color palette and
 * per-layer scalar range helpers match the conventions used by Cura and
 * OrcaSlicer for their G-code preview viewports.
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
    expect(c.r).toBeGreaterThan(0.5);
    expect(c.g).toBeLessThan(0.4);
    expect(c.b).toBeLessThan(0.4);
  });

  it('inner-wall is green-dominant (Cura/Orca convention)', () => {
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
    expect(c.b).toBeLessThan(0.05);
  });

  it('support is magenta/purple', () => {
    const c = MOVE_TYPE_THREE_COLORS.support;
    expect(c.r).toBeGreaterThan(c.g);
    expect(c.b).toBeGreaterThan(c.g);
    expect(c.g).toBeLessThan(0.2);
  });

  it('tree support is teal and distinct from grid support', () => {
    expect(MOVE_TYPE_COLORS['support-tree']).toBe('#2ec4b6');
    expect(MOVE_TYPE_COLORS['support-tree']).not.toBe(MOVE_TYPE_COLORS.support);
  });

  it('bridge is bright red (visually distinct from outer wall)', () => {
    const c = MOVE_TYPE_THREE_COLORS.bridge;
    expect(c.r).toBeGreaterThan(0.9);
  });

  it('travel is dark gray', () => {
    const c = MOVE_TYPE_THREE_COLORS.travel;
    expect(Math.abs(c.r - c.g)).toBeLessThan(0.05);
    expect(Math.abs(c.g - c.b)).toBeLessThan(0.05);
    expect(c.r).toBeLessThan(0.5);
  });

  it('skirt and brim share the same color', () => {
    expect(MOVE_TYPE_COLORS.skirt).toBe(MOVE_TYPE_COLORS.brim);
  });

  it('ironing is light green', () => {
    const c = MOVE_TYPE_THREE_COLORS.ironing;
    expect(c.g).toBeGreaterThan(0.5);
    expect(c.r).toBeLessThan(0.5);
  });

  it('every move type has a label and a color', () => {
    const types: SliceMove['type'][] = [
      'wall-outer', 'wall-inner', 'gap-fill', 'infill', 'top-bottom', 'support', 'support-tree',
      'skirt', 'brim', 'raft', 'bridge', 'travel', 'ironing',
    ];
    for (const t of types) {
      expect(MOVE_TYPE_COLORS[t]).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(MOVE_TYPE_LABELS[t]).toBeTruthy();
      expect(MOVE_TYPE_THREE_COLORS[t]).toBeInstanceOf(THREE.Color);
    }
  });

  it('hex colors and THREE colors agree', () => {
    const types: SliceMove['type'][] = [
      'wall-outer', 'wall-inner', 'gap-fill', 'infill', 'top-bottom', 'support', 'support-tree',
      'skirt', 'brim', 'raft', 'bridge', 'travel', 'ironing',
    ];
    for (const t of types) {
      const fromHex = new THREE.Color(MOVE_TYPE_COLORS[t]);
      expect(MOVE_TYPE_THREE_COLORS[t].getHexString()).toBe(fromHex.getHexString());
    }
  });

  it('z-seam marker color is a valid preview color', () => {
    expect(Z_SEAM_COLOR).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe('Preview color ramps — direction + range', () => {
  it('speed ramp: low end is blue (slow), high end is red (fast)', () => {
    expect(SPEED_LOW_COLOR.b).toBeGreaterThan(SPEED_LOW_COLOR.r);
    expect(SPEED_HIGH_COLOR.r).toBeGreaterThan(SPEED_HIGH_COLOR.b);
  });

  it('flow ramp: low end is green, high end is red', () => {
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

  it('merges ranges across two layers', () => {
    const a = makeLayer([makeMove({ speed: 30 })]);
    const b = makeLayer([makeMove({ speed: 100 })]);
    expect(computeRange([a, b], 1, 'speed')).toEqual([30, 100]);
  });

  it('respects the maxLayer parameter', () => {
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
      makeLayer([], 0.2, 100),
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

describe('Move type label parity', () => {
  it('label keys exactly match color keys', () => {
    expect(Object.keys(MOVE_TYPE_LABELS).sort()).toEqual(Object.keys(MOVE_TYPE_COLORS).sort());
  });

  it('skirt and brim have distinct labels', () => {
    expect(MOVE_TYPE_LABELS.skirt).not.toBe(MOVE_TYPE_LABELS.brim);
  });

  it('every label is non-empty and human-readable', () => {
    for (const t of Object.keys(MOVE_TYPE_LABELS)) {
      const label = MOVE_TYPE_LABELS[t as SliceMove['type']];
      expect(label.length).toBeGreaterThan(0);
      expect(label).toMatch(/^[A-Za-z]/);
    }
  });
});
