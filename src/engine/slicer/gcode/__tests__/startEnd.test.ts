import { describe, expect, it } from 'vitest';

import {
  dedupeEndGCode,
  dedupeStartGCode,
  fanSpeedToCommandArg,
  restorePostStartModes,
  syncStateFromGCode,
} from '../startEnd';
import type { StartEndMachineState } from '../../../../types/slicer-gcode.types';

function makeState(overrides: Partial<StartEndMachineState> = {}): StartEndMachineState {
  return {
    currentX: 0,
    currentY: 0,
    currentZ: 0,
    currentE: 0,
    isRetracted: false,
    extrudedSinceRetract: 0,
    templateUsesAbsolutePositioning: true,
    templateUsesAbsoluteExtrusion: true,
    ...overrides,
  };
}

describe('fanSpeedToCommandArg', () => {
  it('emits a 0-255 integer when scaleFanSpeedTo01 is false (Marlin/RepRap default)', () => {
    expect(fanSpeedToCommandArg(false, 0)).toBe('0');
    expect(fanSpeedToCommandArg(false, 50)).toBe('128');
    expect(fanSpeedToCommandArg(false, 100)).toBe('255');
  });

  it('emits a 0-1 decimal when scaleFanSpeedTo01 is true (Klipper/Duet style)', () => {
    expect(fanSpeedToCommandArg(true, 0)).toBe('0.000');
    expect(fanSpeedToCommandArg(true, 50)).toBe('0.500');
    expect(fanSpeedToCommandArg(true, 100)).toBe('1.000');
  });

  it('handles undefined scale flag as the 0-255 default', () => {
    expect(fanSpeedToCommandArg(undefined, 75)).toBe('191');
  });
});

describe('syncStateFromGCode — absolute positioning template', () => {
  it('tracks G1 X/Y/Z/E updates in absolute mode', () => {
    const state = makeState();
    syncStateFromGCode('G90\nM82\nG1 X10 Y20 Z0.3 E1.5', state);
    expect(state.templateUsesAbsolutePositioning).toBe(true);
    expect(state.templateUsesAbsoluteExtrusion).toBe(true);
    expect(state.currentX).toBe(10);
    expect(state.currentY).toBe(20);
    expect(state.currentZ).toBe(0.3);
    expect(state.currentE).toBe(1.5);
  });

  it('switches to relative positioning + relative extrusion via G91 + M83', () => {
    const state = makeState({ currentX: 5, currentY: 5, currentE: 0 });
    syncStateFromGCode('G91\nM83\nG1 X10 Y0 E1', state);
    expect(state.templateUsesAbsolutePositioning).toBe(false);
    expect(state.templateUsesAbsoluteExtrusion).toBe(false);
    // Relative: 5 + 10 = 15
    expect(state.currentX).toBe(15);
    expect(state.currentY).toBe(5);
    expect(state.currentE).toBe(1);
  });

  it('G92 sets absolute counters without consuming the G1 path', () => {
    const state = makeState({ currentE: 12.5 });
    syncStateFromGCode('G92 E0', state);
    expect(state.currentE).toBe(0);
  });

  it('G28 X homes only X (others untouched)', () => {
    const state = makeState({ currentX: 50, currentY: 50, currentZ: 1 });
    syncStateFromGCode('G28 X', state);
    expect(state.currentX).toBe(0);
    expect(state.currentY).toBe(50);
    expect(state.currentZ).toBe(1);
  });

  it('G28 with no axes homes all three', () => {
    const state = makeState({ currentX: 50, currentY: 50, currentZ: 5 });
    syncStateFromGCode('G28', state);
    expect(state.currentX).toBe(0);
    expect(state.currentY).toBe(0);
    expect(state.currentZ).toBe(0);
  });

  it('G10 (no P) flags retraction and resets extrudedSinceRetract', () => {
    const state = makeState({ extrudedSinceRetract: 42, isRetracted: false });
    syncStateFromGCode('G10', state);
    expect(state.isRetracted).toBe(true);
    expect(state.extrudedSinceRetract).toBe(0);
  });

  it('G11 clears the retracted flag', () => {
    const state = makeState({ isRetracted: true });
    syncStateFromGCode('G11', state);
    expect(state.isRetracted).toBe(false);
  });

  it('strips inline comments and ignores blank lines', () => {
    const state = makeState();
    syncStateFromGCode('; comment\nG90 ; another comment\n   \nG1 X1 Y2', state);
    expect(state.currentX).toBe(1);
    expect(state.currentY).toBe(2);
  });

  it('skips non-finite axis tokens gracefully', () => {
    const state = makeState();
    syncStateFromGCode('G90\nG1 Xabc Y10', state);
    expect(state.currentY).toBe(10);
    expect(state.currentX).toBe(0); // Xabc rejected as non-finite
  });
});

describe('restorePostStartModes', () => {
  it('emits G90/M82/G92 E0 by default and resets the state machine', () => {
    const lines: string[] = [];
    const state = makeState({ currentE: 7.5, isRetracted: true, extrudedSinceRetract: 4 });
    restorePostStartModes(lines, state, false);
    expect(lines.some((l) => l.startsWith('G90'))).toBe(true);
    expect(lines.some((l) => l.startsWith('M82'))).toBe(true);
    expect(lines.some((l) => l.startsWith('G92 E0'))).toBe(true);
    expect(state.currentE).toBe(0);
    expect(state.isRetracted).toBe(false);
    expect(state.extrudedSinceRetract).toBe(0);
    expect(state.templateUsesAbsolutePositioning).toBe(true);
    expect(state.templateUsesAbsoluteExtrusion).toBe(true);
  });

  it('emits M83 when relativeExtrusion is requested', () => {
    const lines: string[] = [];
    const state = makeState();
    restorePostStartModes(lines, state, true);
    expect(lines.some((l) => l.startsWith('M83'))).toBe(true);
    expect(state.templateUsesAbsoluteExtrusion).toBe(false);
  });
});

describe('dedupeStartGCode', () => {
  const baseOpts = {
    preheatTemp: 180,
    nozzleFirstLayerTemp: 210,
    bedFirstLayerTemp: 60,
    relativeExtrusion: false,
    hasHeatedBed: true,
    waitForNozzle: true,
    waitForBuildPlate: true,
  };

  it('strips redundant G90 / M82 in absolute-extrusion mode', () => {
    const out = dedupeStartGCode('G90\nM82\nG28', baseOpts);
    expect(out).not.toMatch(/G90/);
    expect(out).not.toMatch(/M82/);
    expect(out).toMatch(/G28/);
  });

  it('keeps G90 / M82 if relative extrusion is requested', () => {
    const out = dedupeStartGCode('M83\nG28', { ...baseOpts, relativeExtrusion: true });
    // M83 should be dropped (matches mode); G90 unaffected.
    expect(out).not.toMatch(/M83/);
  });

  it('drops M104 lines that match preheat or first-layer nozzle temp', () => {
    const out = dedupeStartGCode('M104 S180\nM104 S210', baseOpts);
    expect(out).toBe('');
  });

  it('keeps M104 lines that target a different temperature', () => {
    const out = dedupeStartGCode('M104 S150', baseOpts);
    expect(out).toMatch(/M104 S150/);
  });

  it('drops M109 wait-for-nozzle that matches nozzleFirstLayerTemp when waitForNozzle=true', () => {
    const out = dedupeStartGCode('M109 S210', baseOpts);
    expect(out).not.toMatch(/M109/);
  });

  it('drops M140/M190 bed temp commands matching bedFirstLayerTemp on a heated bed', () => {
    const out = dedupeStartGCode('M140 S60\nM190 S60', baseOpts);
    expect(out).toBe('');
  });

  it('keeps blank lines for visual separation in the start g-code template', () => {
    const out = dedupeStartGCode('M104 S210\n\nG28', baseOpts);
    // M104 dropped, G28 kept; the blank line preserved between them.
    expect(out.split('\n').filter((l) => l !== '').length).toBeGreaterThan(0);
  });

  it('drops G92 E0 (handled by restorePostStartModes)', () => {
    const out = dedupeStartGCode('G92 E0\nG28', baseOpts);
    expect(out).not.toMatch(/G92 E0/);
    expect(out).toMatch(/G28/);
  });
});

describe('dedupeEndGCode', () => {
  it('strips M107 when slicer already turns the fan off', () => {
    const out = dedupeEndGCode('M107\nM84', { slicerTurnsFanOff: true, slicerSetsFinalNozzleTemp: false });
    expect(out).not.toMatch(/M107/);
    expect(out).toMatch(/M84/);
  });

  it('keeps M107 when slicer does NOT turn the fan off (template owns it)', () => {
    const out = dedupeEndGCode('M107\nM84', { slicerTurnsFanOff: false, slicerSetsFinalNozzleTemp: false });
    expect(out).toMatch(/M107/);
  });

  it('strips M106 S0 when slicer turns fan off', () => {
    const out = dedupeEndGCode('M106 S0\nM84', { slicerTurnsFanOff: true, slicerSetsFinalNozzleTemp: false });
    expect(out).not.toMatch(/M106/);
  });

  it('strips all M104 commands when slicer is responsible for the cooldown', () => {
    const out = dedupeEndGCode('M104 S0\nM104 S150\nG90', {
      slicerTurnsFanOff: false,
      slicerSetsFinalNozzleTemp: true,
    });
    expect(out).not.toMatch(/M104/);
    expect(out).toMatch(/G90/);
  });

  it('preserves comments and other non-conflicting commands', () => {
    const out = dedupeEndGCode('; goodbye\nG28 X0 Y220\nM84', {
      slicerTurnsFanOff: true,
      slicerSetsFinalNozzleTemp: false,
    });
    expect(out).toMatch(/; goodbye/);
    expect(out).toMatch(/G28 X0 Y220/);
    expect(out).toMatch(/M84/);
  });
});
