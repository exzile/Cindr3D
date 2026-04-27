import { describe, expect, it } from 'vitest';
import type {
  MaterialProfile,
  PrinterProfile,
  PrintProfile,
  SliceMove,
} from '../../../../types/slicer';

import { GCodeEmitter } from '../emitter';

function makePrinter(overrides: Partial<PrinterProfile> = {}): PrinterProfile {
  return {
    filamentDiameter: 1.75,
    scaleFanSpeedTo01: false,
    firmwareRetraction: false,
    ...overrides,
  } as unknown as PrinterProfile;
}

function makeMaterial(overrides: Partial<MaterialProfile> = {}): MaterialProfile {
  return {
    flowRate: 1.0,
    retractionDistance: 0.8,
    retractionSpeed: 25,
    retractionZHop: 0,
    nozzleTemp: 210,
    bedTemp: 60,
    ...overrides,
  } as unknown as MaterialProfile;
}

function makePrint(overrides: Partial<PrintProfile> = {}): PrintProfile {
  return {
    travelSpeed: 150,
    accelerationEnabled: true,
    jerkEnabled: true,
    flowRateCompensationFactor: 1.0,
    maxFlowRate: 0,
    zHopWhenRetracted: false,
    zHopHeight: 0,
    zHopSpeed: 150,
    retractionExtraPrimeAmount: 0,
    wipeRetractionDistance: 0,
    wipeRetractionExtraPrime: 0,
    ...overrides,
  } as unknown as PrintProfile;
}

function makeEmitter(opts: {
  printer?: Partial<PrinterProfile>;
  material?: Partial<MaterialProfile>;
  print?: Partial<PrintProfile>;
  flavor?: 'marlin' | 'reprap' | 'duet' | 'klipper';
  relativeExtrusion?: boolean;
} = {}) {
  const gcode: string[] = [];
  const emitter = new GCodeEmitter({
    gcode,
    printer: makePrinter(opts.printer),
    material: makeMaterial(opts.material),
    print: makePrint(opts.print),
    flavor: opts.flavor ?? 'marlin',
    relativeExtrusion: opts.relativeExtrusion ?? false,
  });
  return { emitter, gcode };
}

describe('GCodeEmitter — calculateExtrusion', () => {
  it('1.75mm filament: 1mm extrusion at 0.4 lw × 0.2 lh ≈ 0.0333mm of filament', () => {
    const { emitter } = makeEmitter();
    // Volume of extrudate per mm = 0.4 × 0.2 = 0.08mm³
    // Filament cross-section = π × 0.875² ≈ 2.405mm²
    // Filament needed per mm = 0.08 / 2.405 ≈ 0.03326mm
    expect(emitter.calculateExtrusion(1, 0.4, 0.2)).toBeCloseTo(0.03326, 4);
  });

  it('scales linearly with distance', () => {
    const { emitter } = makeEmitter();
    const e10 = emitter.calculateExtrusion(10, 0.4, 0.2);
    const e1 = emitter.calculateExtrusion(1, 0.4, 0.2);
    expect(e10).toBeCloseTo(e1 * 10, 5);
  });

  it('scales linearly with line width', () => {
    const { emitter } = makeEmitter();
    const wide = emitter.calculateExtrusion(10, 0.6, 0.2);
    const narrow = emitter.calculateExtrusion(10, 0.3, 0.2);
    expect(wide).toBeCloseTo(narrow * 2, 5);
  });

  it('scales linearly with layer height', () => {
    const { emitter } = makeEmitter();
    const tall = emitter.calculateExtrusion(10, 0.4, 0.3);
    const short = emitter.calculateExtrusion(10, 0.4, 0.1);
    expect(tall).toBeCloseTo(short * 3, 5);
  });

  it('honors material flowRate multiplier', () => {
    const baseline = makeEmitter({ material: { flowRate: 1.0 } }).emitter;
    const high = makeEmitter({ material: { flowRate: 1.2 } }).emitter;
    expect(high.calculateExtrusion(10, 0.4, 0.2)).toBeCloseTo(
      baseline.calculateExtrusion(10, 0.4, 0.2) * 1.2,
      6,
    );
  });

  it('honors flowRateCompensationFactor from print profile', () => {
    const { emitter } = makeEmitter({ print: { flowRateCompensationFactor: 1.05 } });
    const base = makeEmitter().emitter;
    expect(emitter.calculateExtrusion(10, 0.4, 0.2)).toBeCloseTo(
      base.calculateExtrusion(10, 0.4, 0.2) * 1.05,
      6,
    );
  });

  it('honors per-layer flow override (currentLayerFlow)', () => {
    const { emitter } = makeEmitter();
    const base = emitter.calculateExtrusion(10, 0.4, 0.2);
    emitter.currentLayerFlow = 1.1;
    expect(emitter.calculateExtrusion(10, 0.4, 0.2)).toBeCloseTo(base * 1.1, 6);
  });

  it('uses larger filament cross-section for 2.85mm filament', () => {
    const small = makeEmitter({ printer: { filamentDiameter: 1.75 } }).emitter;
    const big = makeEmitter({ printer: { filamentDiameter: 2.85 } }).emitter;
    // 1.75² / 2.85² ≈ 0.377 → big filament needs ~37.7% as much length.
    const ratio = big.calculateExtrusion(1, 0.4, 0.2) / small.calculateExtrusion(1, 0.4, 0.2);
    expect(ratio).toBeCloseTo((1.75 / 2.85) ** 2, 4);
  });
});

describe('GCodeEmitter — fanSpeedArg', () => {
  it('uses 0-255 scale by default (Marlin)', () => {
    const { emitter } = makeEmitter();
    expect(emitter.fanSpeedArg(50)).toBe('128');
  });

  it('uses 0-1 scale when scaleFanSpeedTo01 is set (Klipper/Duet)', () => {
    const { emitter } = makeEmitter({ printer: { scaleFanSpeedTo01: true } });
    expect(emitter.fanSpeedArg(50)).toBe('0.500');
  });
});

describe('GCodeEmitter — setAccel', () => {
  it('emits M204 with the rounded value when accelerationEnabled', () => {
    const { emitter, gcode } = makeEmitter();
    emitter.setAccel(1500.4, 1000);
    expect(gcode.find((l) => l.startsWith('M204 S1500'))).toBeTruthy();
  });

  it('falls back to the second arg when value is undefined', () => {
    const { emitter, gcode } = makeEmitter();
    emitter.setAccel(undefined, 800);
    expect(gcode.find((l) => l.startsWith('M204 S800'))).toBeTruthy();
  });

  it('skips the emit when accel hasn’t changed (no duplicate M204)', () => {
    const { emitter, gcode } = makeEmitter();
    emitter.setAccel(1000, 1000);
    emitter.setAccel(1000, 1000);
    const m204Lines = gcode.filter((l) => l.startsWith('M204'));
    expect(m204Lines.length).toBe(1);
  });

  it('is a no-op when accelerationEnabled is false', () => {
    const { emitter, gcode } = makeEmitter({ print: { accelerationEnabled: false } });
    emitter.setAccel(1500, 1000);
    expect(gcode.filter((l) => l.startsWith('M204'))).toHaveLength(0);
  });
});

describe('GCodeEmitter — setJerk per flavor', () => {
  it('emits Marlin M205 X/Y for the marlin flavor', () => {
    const { emitter, gcode } = makeEmitter({ flavor: 'marlin' });
    emitter.setJerk(8, 5);
    expect(gcode.find((l) => /^M205 X8 Y8/.test(l))).toBeTruthy();
  });

  it('emits RepRap M566 in mm/min for the duet flavor', () => {
    const { emitter, gcode } = makeEmitter({ flavor: 'duet' });
    emitter.setJerk(10, 5);
    // 10 mm/s × 60 = 600 mm/min
    expect(gcode.find((l) => /^M566 X600 Y600/.test(l))).toBeTruthy();
  });

  it('emits SET_VELOCITY_LIMIT for the klipper flavor', () => {
    const { emitter, gcode } = makeEmitter({ flavor: 'klipper' });
    emitter.setJerk(7, 5);
    expect(gcode.find((l) => /SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=7/.test(l))).toBeTruthy();
  });

  it('skips redundant jerk emits', () => {
    const { emitter, gcode } = makeEmitter();
    emitter.setJerk(5, 5);
    emitter.setJerk(5, 5);
    expect(gcode.filter((l) => l.startsWith('M205'))).toHaveLength(1);
  });
});

describe('GCodeEmitter — extrudeTo', () => {
  it('emits a G1 X/Y/E/F line and updates internal state', () => {
    const { emitter, gcode } = makeEmitter();
    const result = emitter.extrudeTo(10, 0, 60, 0.4, 0.2);
    expect(emitter.currentX).toBe(10);
    expect(emitter.currentY).toBe(0);
    expect(result.distance).toBeCloseTo(10, 5);
    expect(result.extrusion).toBeGreaterThan(0);
    expect(result.time).toBeCloseTo(10 / 60, 5);
    const g1 = gcode.find((l) => l.startsWith('G1 '));
    expect(g1).toMatch(/X10\.000/);
    expect(g1).toMatch(/Y0\.000/);
    expect(g1).toMatch(/F3600/); // 60mm/s × 60 = 3600 mm/min
  });

  it('accumulates totalExtruded across multiple moves', () => {
    const { emitter } = makeEmitter();
    emitter.extrudeTo(10, 0, 60, 0.4, 0.2);
    emitter.extrudeTo(10, 10, 60, 0.4, 0.2);
    expect(emitter.totalExtruded).toBeCloseTo(emitter.currentE, 6);
    expect(emitter.totalExtruded).toBeGreaterThan(0);
  });

  it('emits relative E values when relativeExtrusion is true', () => {
    const { emitter, gcode } = makeEmitter({ relativeExtrusion: true });
    emitter.extrudeTo(10, 0, 60, 0.4, 0.2);
    const g1 = gcode.find((l) => l.startsWith('G1 '));
    // In relative mode, E is the per-move delta, not the running total.
    const eMatch = g1?.match(/E(\d+\.\d+)/);
    expect(eMatch).toBeTruthy();
    const e = parseFloat(eMatch![1]);
    // Per-mm extrusion ≈ 0.0333; for 10mm that's ~0.333.
    expect(e).toBeCloseTo(0.333, 1);
  });

  it('emits absolute (running-total) E by default', () => {
    const { emitter, gcode } = makeEmitter();
    emitter.extrudeTo(10, 0, 60, 0.4, 0.2);
    emitter.extrudeTo(20, 0, 60, 0.4, 0.2);
    const g1Lines = gcode.filter((l) => l.startsWith('G1 '));
    const e1 = parseFloat(g1Lines[0].match(/E(\d+\.\d+)/)![1]);
    const e2 = parseFloat(g1Lines[1].match(/E(\d+\.\d+)/)![1]);
    expect(e2).toBeGreaterThan(e1);
  });

  it('clamps speed to maxFlowRate / (lineWidth * layerHeight) when set', () => {
    const { emitter } = makeEmitter({
      print: { maxFlowRate: 8 }, // 8 mm³/s cap
    });
    // Flow at 100 mm/s with 0.4 lw × 0.2 lh = 8 mm³/s — exactly at cap.
    // At 200 mm/s would be 16 mm³/s → clamped down to 100.
    const result = emitter.extrudeTo(10, 0, 200, 0.4, 0.2);
    expect(result.speed).toBeCloseTo(100, 4);
  });

  it('does NOT clamp when maxFlowRate is 0 (disabled)', () => {
    const { emitter } = makeEmitter({ print: { maxFlowRate: 0 } });
    const result = emitter.extrudeTo(10, 0, 250, 0.4, 0.2);
    expect(result.speed).toBe(250);
  });

  it('reduces speed for wide lines when flowEqualizationRatio is enabled', () => {
    const { emitter } = makeEmitter({
      print: {
        flowEqualizationRatio: 1,
        wallLineWidth: 0.4,
      },
    });
    const result = emitter.extrudeTo(10, 0, 100, 0.8, 0.2);
    expect(result.speed).toBeCloseTo(50, 4);
  });

  it('blends flow-equalized speed with the requested speed', () => {
    const { emitter } = makeEmitter({
      print: {
        flowEqualizationRatio: 0.5,
        wallLineWidth: 0.4,
      },
    });
    const result = emitter.extrudeTo(10, 0, 100, 0.8, 0.2);
    expect(result.speed).toBeCloseTo(75, 4);
  });
});

describe('GCodeEmitter — retract / unretract round-trip', () => {
  it('idempotent: retract called twice only emits one retract line', () => {
    const { emitter, gcode } = makeEmitter();
    emitter.retract();
    emitter.retract();
    const retractEmits = gcode.filter((l) => /^G1 E[-\d]/.test(l) && /F\d+/.test(l));
    // Only one E retraction emit — second retract is a no-op.
    expect(retractEmits.length).toBeLessThanOrEqual(1);
  });

  it('isRetracted state flips on retract and back on unretract', () => {
    const { emitter } = makeEmitter();
    expect(emitter.isRetracted).toBe(false);
    emitter.retract();
    expect(emitter.isRetracted).toBe(true);
    emitter.unretract();
    expect(emitter.isRetracted).toBe(false);
  });

  it('emits firmware retract (G10) when configured', () => {
    const { emitter, gcode } = makeEmitter({ printer: { firmwareRetraction: true } });
    emitter.retract();
    expect(gcode.some((l) => /^G10/.test(l))).toBe(true);
  });

  it('emits firmware unretract (G11) when configured', () => {
    const { emitter, gcode } = makeEmitter({ printer: { firmwareRetraction: true } });
    emitter.retract();
    emitter.unretract();
    expect(gcode.some((l) => /^G11/.test(l))).toBe(true);
  });
});

describe('GCodeEmitter — rawTravelTo', () => {
  it('emits G0 X/Y/F (no E) and updates currentX/Y', () => {
    const { emitter, gcode } = makeEmitter();
    emitter.rawTravelTo(50, 25, 200);
    expect(emitter.currentX).toBe(50);
    expect(emitter.currentY).toBe(25);
    const g0 = gcode.find((l) => l.startsWith('G0 '));
    expect(g0).toMatch(/X50\.000/);
    expect(g0).toMatch(/Y25\.000/);
    expect(g0).toMatch(/F12000/); // 200 × 60
    expect(g0).not.toMatch(/E\d/);
  });

  it('appends an inline comment when one is provided', () => {
    const { emitter, gcode } = makeEmitter();
    emitter.rawTravelTo(10, 0, 100, 'lift to start');
    const g0 = gcode.find((l) => l.startsWith('G0 '));
    expect(g0).toMatch(/; lift to start/);
  });
});

describe('GCodeEmitter — printed-part travel routing', () => {
  const directTravelTestSetup = (print: Partial<PrintProfile> = {}) => {
    const setup = makeEmitter({
      material: { retractionDistance: 0 },
      print: {
        accelerationEnabled: false,
        jerkEnabled: false,
        avoidCrossingPerimeters: true,
        ...print,
      },
    });
    setup.emitter.extrudeTo(10, 0, 20, 0.4, 0.2);
    setup.emitter.rawTravelTo(10, 5, 150);
    setup.gcode.length = 0;
    return setup;
  };

  it('detours avoidPrintedParts travels around already emitted extrusion segments', () => {
    const { emitter, gcode } = directTravelTestSetup({ avoidPrintedParts: true });
    const moves: SliceMove[] = [];

    emitter.travelTo(0, -5, moves);

    const travelLines = gcode.filter((line) => line.startsWith('G0 '));
    expect(travelLines.length).toBeGreaterThan(1);
    expect(moves.length).toBeGreaterThan(1);
    expect(emitter.currentX).toBe(0);
    expect(emitter.currentY).toBe(-5);
  });

  it('keeps direct travels when printed-part avoidance is disabled', () => {
    const { emitter, gcode } = directTravelTestSetup({ avoidPrintedParts: false });
    const moves: SliceMove[] = [];

    emitter.travelTo(0, -5, moves);

    const travelLines = gcode.filter((line) => line.startsWith('G0 '));
    expect(travelLines).toHaveLength(1);
    expect(moves).toHaveLength(1);
  });

  it('treats missing avoidPrintedParts as enabled for safer default routing', () => {
    const { emitter, gcode } = directTravelTestSetup();
    const moves: SliceMove[] = [];

    emitter.travelTo(0, -5, moves);

    expect(gcode.filter((line) => line.startsWith('G0 ')).length).toBeGreaterThan(1);
    expect(moves.length).toBeGreaterThan(1);
  });

  it('does not detour printed segments when avoidCrossingPerimeters is disabled', () => {
    const { emitter, gcode } = directTravelTestSetup({
      avoidCrossingPerimeters: false,
      avoidPrintedParts: true,
    });
    const moves: SliceMove[] = [];

    emitter.travelTo(0, -5, moves);

    expect(gcode.filter((line) => line.startsWith('G0 '))).toHaveLength(1);
    expect(moves).toHaveLength(1);
  });

  it('clears printed-segment obstacles when a new layer obstacle set is applied', () => {
    const { emitter, gcode } = directTravelTestSetup({ avoidPrintedParts: true });
    const moves: SliceMove[] = [];

    emitter.setLayerObstacles([]);
    emitter.travelTo(0, -5, moves);

    expect(gcode.filter((line) => line.startsWith('G0 '))).toHaveLength(1);
    expect(moves).toHaveLength(1);
  });

  it('can emit multiple detour segments when a travel crosses several printed paths', () => {
    const { emitter, gcode } = makeEmitter({
      material: { retractionDistance: 0 },
      print: {
        accelerationEnabled: false,
        jerkEnabled: false,
        avoidCrossingPerimeters: true,
        avoidPrintedParts: true,
      },
    });
    const moves: SliceMove[] = [];

    emitter.extrudeTo(10, 0, 20, 0.4, 0.2);
    emitter.rawTravelTo(0, -2, 150);
    emitter.extrudeTo(10, -2, 20, 0.4, 0.2);
    emitter.rawTravelTo(10, 5, 150);
    gcode.length = 0;

    emitter.travelTo(0, -5, moves);

    expect(gcode.filter((line) => line.startsWith('G0 ')).length).toBeGreaterThan(2);
    expect(moves.length).toBeGreaterThan(2);
  });
});

describe('GCodeEmitter — startEndState bridge', () => {
  it('exposes a live view of the emitter state (writes propagate)', () => {
    const { emitter } = makeEmitter();
    const state = emitter.startEndState;
    state.currentX = 99;
    state.currentE = 12.5;
    expect(emitter.currentX).toBe(99);
    expect(emitter.currentE).toBe(12.5);
  });

  it('reflects relativeExtrusion flag in templateUsesAbsoluteExtrusion', () => {
    const abs = makeEmitter({ relativeExtrusion: false }).emitter;
    const rel = makeEmitter({ relativeExtrusion: true }).emitter;
    expect(abs.startEndState.templateUsesAbsoluteExtrusion).toBe(true);
    expect(rel.startEndState.templateUsesAbsoluteExtrusion).toBe(false);
  });
});
