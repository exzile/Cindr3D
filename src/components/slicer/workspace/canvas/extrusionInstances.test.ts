import { describe, expect, it } from 'vitest';
import type { SliceLayer, SliceMove } from '../../../../types/slicer';
import {
  buildColorContext,
  buildLayerInstances,
  colorForMove,
  inferDenseSkinWidths,
  lineWidthForMove,
} from './extrusionInstances';
import {
  FLOW_HIGH_COLOR,
  FLOW_LOW_COLOR,
  SPEED_HIGH_COLOR,
  SPEED_LOW_COLOR,
} from '../preview/constants';

function move(overrides: Partial<SliceMove> = {}): SliceMove {
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

function layer(moves: SliceMove[], z = 0.2, layerTime = 5): SliceLayer {
  return { z, layerIndex: 0, layerTime, moves } as SliceLayer;
}

const HIDDEN: ReadonlySet<string> = new Set();

describe('lineWidthForMove', () => {
  it('returns nominal width for outer-wall moves regardless of E noise', () => {
    const quiet = move({ type: 'wall-outer', extrusion: 0.01, lineWidth: 0.42 });
    const noisy = { ...quiet, extrusion: 0.08 };
    expect(lineWidthForMove(quiet, 1, 0.2, 1.75)).toBeCloseTo(0.42, 4);
    expect(lineWidthForMove(noisy, 1, 0.2, 1.75)).toBeCloseTo(0.42, 4);
  });

  it('returns nominal width for inner-wall moves', () => {
    const m = move({ type: 'wall-inner', lineWidth: 0.45 });
    expect(lineWidthForMove(m, 1, 0.2, 1.75)).toBeCloseTo(0.45, 4);
  });

  it('returns nominal width for top-bottom (skin) moves', () => {
    const m = move({ type: 'top-bottom', lineWidth: 0.4 });
    expect(lineWidthForMove(m, 1, 0.2, 1.75)).toBeCloseTo(0.4, 4);
  });

  it('derives volumetric width for infill from extrusion volume', () => {
    // E = 0.08 mm of 1.75 mm filament over a 10 mm × 0.2 mm bead:
    //   volume = pi × 0.875² × 0.08 ≈ 0.1924 mm³
    //   width = 0.1924 / (10 × 0.2) ≈ 0.0962 mm
    const m = move({ type: 'infill', from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, extrusion: 0.08, lineWidth: 0.42 });
    const width = lineWidthForMove(m, 10, 0.2, 1.75);
    expect(width).toBeGreaterThan(0.05);
    expect(width).toBeLessThan(0.5);
  });

  it('caps volumetric width at 3x nominal to absorb E spikes', () => {
    const m = move({ type: 'infill', extrusion: 100, lineWidth: 0.4 });
    const width = lineWidthForMove(m, 10, 0.2, 1.75);
    expect(width).toBeLessThanOrEqual(0.4 * 3 + 1e-5);
  });

  it('falls back to nominal width when extrusion is zero', () => {
    const m = move({ type: 'infill', extrusion: 0, lineWidth: 0.4 });
    expect(lineWidthForMove(m, 10, 0.2, 1.75)).toBeCloseTo(0.4, 4);
  });

  it('uses move.layerHeight override when present (raft sub-layers)', () => {
    const m = move({ type: 'infill', extrusion: 0.05, lineWidth: 0.4, layerHeight: 0.3, from: { x: 0, y: 0 }, to: { x: 5, y: 0 } });
    const a = lineWidthForMove(m, 5, 0.2, 1.75);
    const b = lineWidthForMove(m, 5, 999, 1.75);
    expect(a).toBeCloseTo(b, 5);
  });
});

describe('inferDenseSkinWidths', () => {
  function topBottomMove(x: number, width = 0.5): SliceMove {
    return {
      type: 'top-bottom',
      from: { x, y: 0 },
      to: { x, y: 20 },
      speed: 30,
      extrusion: 1,
      lineWidth: width,
      layerHeight: 0.2,
    };
  }

  it('widens dense parallel skin lines to their measured pitch', () => {
    const widths = inferDenseSkinWidths([
      topBottomMove(0),
      topBottomMove(0.5),
      topBottomMove(1),
      topBottomMove(1.5),
    ]);
    expect(widths.size).toBe(4);
    for (const w of widths.values()) {
      expect(w).toBeGreaterThan(0.5);
      expect(w).toBeLessThan(0.52);
    }
  });

  it('leaves sparse spacing alone when the pitch is meaningfully wider than the line width', () => {
    const widths = inferDenseSkinWidths([
      topBottomMove(0),
      topBottomMove(0.7),
      topBottomMove(1.4),
      topBottomMove(2.1),
    ]);
    expect(widths.size).toBe(0);
  });
});

describe('buildLayerInstances', () => {
  it('builds one instance per non-zero-length extrusion move', () => {
    const l = layer([
      move({ type: 'wall-outer' }),
      move({ type: 'wall-inner', from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }),
      move({ type: 'travel', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }),
    ]);
    const ctx = buildColorContext(l, 'type', undefined);
    const data = buildLayerInstances({
      layer: l, layerHeight: 0.2, filamentDiameter: 1.75,
      isCurrentLayer: false, currentLayerMoveCount: undefined,
      showTravel: true, hiddenTypes: HIDDEN, colorContext: ctx,
    });
    expect(data.count).toBe(2);
    expect(data.travelPositions.length).toBe(6);
  });

  it('respects hiddenTypes — moves of hidden types do not create instances', () => {
    const l = layer([
      move({ type: 'wall-outer' }),
      move({ type: 'infill', from: { x: 0, y: 0 }, to: { x: 5, y: 0 } }),
    ]);
    const ctx = buildColorContext(l, 'type', undefined);
    const hidden = new Set(['infill']);
    const data = buildLayerInstances({
      layer: l, layerHeight: 0.2, filamentDiameter: 1.75,
      isCurrentLayer: false, currentLayerMoveCount: undefined,
      showTravel: false, hiddenTypes: hidden, colorContext: ctx,
    });
    expect(data.count).toBe(1);
    expect(data.moveRefs[0].type).toBe('wall-outer');
  });

  it('truncates current-layer moves at currentLayerMoveCount', () => {
    const l = layer([
      move({ type: 'wall-outer', from: { x: 0, y: 0 }, to: { x: 5, y: 0 } }),
      move({ type: 'wall-outer', from: { x: 5, y: 0 }, to: { x: 5, y: 5 } }),
      move({ type: 'wall-outer', from: { x: 5, y: 5 }, to: { x: 0, y: 5 } }),
    ]);
    const ctx = buildColorContext(l, 'type', undefined);
    const data = buildLayerInstances({
      layer: l, layerHeight: 0.2, filamentDiameter: 1.75,
      isCurrentLayer: true, currentLayerMoveCount: 2,
      showTravel: false, hiddenTypes: HIDDEN, colorContext: ctx,
    });
    expect(data.count).toBe(2);
  });

  it('records the layer-relative moveIndex on each instance for picking', () => {
    const l = layer([
      move({ type: 'travel' }),
      move({ type: 'wall-outer', from: { x: 0, y: 0 }, to: { x: 5, y: 0 } }),
      move({ type: 'wall-inner', from: { x: 5, y: 0 }, to: { x: 5, y: 5 } }),
    ]);
    const ctx = buildColorContext(l, 'type', undefined);
    const data = buildLayerInstances({
      layer: l, layerHeight: 0.2, filamentDiameter: 1.75,
      isCurrentLayer: false, currentLayerMoveCount: undefined,
      showTravel: false, hiddenTypes: HIDDEN, colorContext: ctx,
    });
    expect(data.moveRefs[0].moveIndex).toBe(1);
    expect(data.moveRefs[1].moveIndex).toBe(2);
  });

  it('places instance endpoint Z at layer.z minus half the layer height', () => {
    const l = layer([
      move({ type: 'wall-outer', from: { x: 0, y: 0 }, to: { x: 5, y: 0 } }),
    ], 1.0);
    const ctx = buildColorContext(l, 'type', undefined);
    const data = buildLayerInstances({
      layer: l, layerHeight: 0.2, filamentDiameter: 1.75,
      isCurrentLayer: false, currentLayerMoveCount: undefined,
      showTravel: false, hiddenTypes: HIDDEN, colorContext: ctx,
    });
    expect(data.iA[2]).toBeCloseTo(0.9, 5);
    expect(data.iB[2]).toBeCloseTo(0.9, 5);
  });

  it('encodes capsule radius as half the gcode line width', () => {
    const l = layer([
      move({ type: 'wall-outer', lineWidth: 0.45, from: { x: 0, y: 0 }, to: { x: 5, y: 0 } }),
    ]);
    const ctx = buildColorContext(l, 'type', undefined);
    const data = buildLayerInstances({
      layer: l, layerHeight: 0.2, filamentDiameter: 1.75,
      isCurrentLayer: false, currentLayerMoveCount: undefined,
      showTravel: false, hiddenTypes: HIDDEN, colorContext: ctx,
    });
    expect(data.iRadius[0]).toBeCloseTo(0.225, 5);
    expect(data.iRadius[1]).toBeCloseTo(0.225, 5);
  });

  it('encodes iHalfHeight as half the layer height (independent of line width)', () => {
    const l = layer([
      move({ type: 'wall-outer', lineWidth: 0.45, from: { x: 0, y: 0 }, to: { x: 5, y: 0 } }),
    ]);
    const ctx = buildColorContext(l, 'type', undefined);
    const data = buildLayerInstances({
      layer: l, layerHeight: 0.2, filamentDiameter: 1.75,
      isCurrentLayer: false, currentLayerMoveCount: undefined,
      showTravel: false, hiddenTypes: HIDDEN, colorContext: ctx,
    });
    // 0.20 mm layer height → 0.10 mm half-height. Distinct from line-width
    // half-radius of 0.225 — confirms width and height scale independently.
    expect(data.iHalfHeight[0]).toBeCloseTo(0.1, 5);
  });

  it('uses move.layerHeight override for iHalfHeight when present (raft sub-layers)', () => {
    const l = layer([
      move({ type: 'wall-outer', lineWidth: 0.4, from: { x: 0, y: 0 }, to: { x: 5, y: 0 }, layerHeight: 0.3 }),
    ]);
    const ctx = buildColorContext(l, 'type', undefined);
    const data = buildLayerInstances({
      layer: l, layerHeight: 0.2, filamentDiameter: 1.75,
      isCurrentLayer: false, currentLayerMoveCount: undefined,
      showTravel: false, hiddenTypes: HIDDEN, colorContext: ctx,
    });
    expect(data.iHalfHeight[0]).toBeCloseTo(0.15, 5);
  });

  it('skips zero-length non-travel moves entirely', () => {
    const l = layer([
      move({ type: 'wall-outer', from: { x: 5, y: 5 }, to: { x: 5, y: 5 } }),
      move({ type: 'wall-outer', from: { x: 0, y: 0 }, to: { x: 5, y: 0 } }),
    ]);
    const ctx = buildColorContext(l, 'type', undefined);
    const data = buildLayerInstances({
      layer: l, layerHeight: 0.2, filamentDiameter: 1.75,
      isCurrentLayer: false, currentLayerMoveCount: undefined,
      showTravel: false, hiddenTypes: HIDDEN, colorContext: ctx,
    });
    expect(data.count).toBe(1);
  });

  it('emits a bounding sphere that contains every instance endpoint plus its radius', () => {
    const l = layer([
      move({ type: 'wall-outer', from: { x: 10, y: 10 }, to: { x: 20, y: 10 } }),
      move({ type: 'wall-outer', from: { x: 20, y: 10 }, to: { x: 20, y: 30 }, lineWidth: 0.6 }),
      move({ type: 'wall-outer', from: { x: 20, y: 30 }, to: { x: 5, y: 30 }, lineWidth: 0.5 }),
    ]);
    const ctx = buildColorContext(l, 'type', undefined);
    const data = buildLayerInstances({
      layer: l, layerHeight: 0.2, filamentDiameter: 1.75,
      isCurrentLayer: false, currentLayerMoveCount: undefined,
      showTravel: false, hiddenTypes: HIDDEN, colorContext: ctx,
    });
    expect(data.boundsRadius).toBeGreaterThan(0);
    // Every endpoint must lie inside the sphere (with capsule radius slack).
    for (let i = 0; i < data.count; i++) {
      const dx = data.iA[i * 3]     - data.boundsCenter.x;
      const dy = data.iA[i * 3 + 1] - data.boundsCenter.y;
      const dz = data.iA[i * 3 + 2] - data.boundsCenter.z;
      expect(Math.hypot(dx, dy, dz)).toBeLessThanOrEqual(data.boundsRadius + 1e-6);
      const ex = data.iB[i * 3]     - data.boundsCenter.x;
      const ey = data.iB[i * 3 + 1] - data.boundsCenter.y;
      const ez = data.iB[i * 3 + 2] - data.boundsCenter.z;
      expect(Math.hypot(ex, ey, ez)).toBeLessThanOrEqual(data.boundsRadius + 1e-6);
    }
  });

  it('returns zero bounds radius when there are no extrusion instances', () => {
    const l = layer([move({ type: 'travel' })]);
    const ctx = buildColorContext(l, 'type', undefined);
    const data = buildLayerInstances({
      layer: l, layerHeight: 0.2, filamentDiameter: 1.75,
      isCurrentLayer: false, currentLayerMoveCount: undefined,
      showTravel: false, hiddenTypes: HIDDEN, colorContext: ctx,
    });
    expect(data.count).toBe(0);
    expect(data.boundsRadius).toBe(0);
  });

  it('captures retractions (travel moves with extrusion < 0)', () => {
    const l = layer([
      move({ type: 'travel', from: { x: 5, y: 5 }, to: { x: 5, y: 5 }, extrusion: -0.5 }),
      move({ type: 'wall-outer' }),
    ]);
    const ctx = buildColorContext(l, 'type', undefined);
    const data = buildLayerInstances({
      layer: l, layerHeight: 0.2, filamentDiameter: 1.75,
      isCurrentLayer: false, currentLayerMoveCount: undefined,
      showTravel: false, hiddenTypes: HIDDEN, colorContext: ctx,
    });
    expect(data.retractPositions.length).toBe(3);
    expect(data.retractPositions[0]).toBe(5);
    expect(data.retractPositions[1]).toBe(5);
  });
});

describe('colorForMove ramp parity with the legend', () => {
  // The legend renders speed/flow/width gradients via CSS using the
  // SPEED_LOW/HIGH and FLOW_LOW/HIGH constants. The 3D preview must lerp
  // those same constants — otherwise the gradient swatch in the legend
  // doesn't match the bead colors on the build plate.
  const ctxFor = (mode: 'speed' | 'flow') => ({
    mode,
    speedRange: [30, 90] as [number, number],
    flowRange:  [0.02, 0.08] as [number, number],
    widthRange: [0, 1] as [number, number],
    layerTimeT: 0,
    medianWallWidth: 0,
  });

  it('speed mode at the low end of range matches SPEED_LOW_COLOR exactly', () => {
    const m = move({ type: 'wall-outer', speed: 30 });
    const [r, g, b] = colorForMove(m, ctxFor('speed'));
    expect(r).toBeCloseTo(SPEED_LOW_COLOR.r, 4);
    expect(g).toBeCloseTo(SPEED_LOW_COLOR.g, 4);
    expect(b).toBeCloseTo(SPEED_LOW_COLOR.b, 4);
  });

  it('speed mode at the high end of range matches SPEED_HIGH_COLOR exactly', () => {
    const m = move({ type: 'wall-outer', speed: 90 });
    const [r, g, b] = colorForMove(m, ctxFor('speed'));
    expect(r).toBeCloseTo(SPEED_HIGH_COLOR.r, 4);
    expect(g).toBeCloseTo(SPEED_HIGH_COLOR.g, 4);
    expect(b).toBeCloseTo(SPEED_HIGH_COLOR.b, 4);
  });

  it('flow mode at the low end of range matches FLOW_LOW_COLOR exactly', () => {
    const m = move({ type: 'infill', extrusion: 0.02 });
    const [r, g, b] = colorForMove(m, ctxFor('flow'));
    expect(r).toBeCloseTo(FLOW_LOW_COLOR.r, 4);
    expect(g).toBeCloseTo(FLOW_LOW_COLOR.g, 4);
    expect(b).toBeCloseTo(FLOW_LOW_COLOR.b, 4);
  });

  it('flow mode at the high end of range matches FLOW_HIGH_COLOR exactly', () => {
    const m = move({ type: 'infill', extrusion: 0.08 });
    const [r, g, b] = colorForMove(m, ctxFor('flow'));
    expect(r).toBeCloseTo(FLOW_HIGH_COLOR.r, 4);
    expect(g).toBeCloseTo(FLOW_HIGH_COLOR.g, 4);
    expect(b).toBeCloseTo(FLOW_HIGH_COLOR.b, 4);
  });
});
