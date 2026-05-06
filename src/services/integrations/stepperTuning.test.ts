import { describe, expect, it } from 'vitest';
import { buildStepperTuningCommands, buildStepperWiggleCommands } from './stepperTuning';

describe('stepper tuning helpers', () => {
  it('builds RRF/Marlin current and mode commands', () => {
    expect(buildStepperTuningCommands('duet', 'X', {
      currentMa: 900,
      microsteps: 32,
      mode: 'spreadcycle',
      driverIndex: 2,
    })).toEqual(['M906 X900', 'M350 X32', 'M569 P2 S0']);

    expect(buildStepperTuningCommands('marlin', 'Y', {
      currentMa: 760,
      microsteps: 16,
      mode: 'stealthchop',
      driverIndex: 1,
    })).toContain('M569 S1 Y');
  });

  it('builds Klipper and wiggle commands', () => {
    expect(buildStepperTuningCommands('klipper', 'Z', {
      currentMa: 850,
      microsteps: 16,
      mode: 'spreadcycle',
      driverIndex: 0,
    })).toContain('SET_TMC_CURRENT STEPPER=stepper_z CURRENT=0.85');

    expect(buildStepperWiggleCommands('X')).toEqual(['G91', 'G1 X1 F1200', 'G1 X-1 F1200', 'G90']);
  });

  it('uses Klipper extruder section names for E axes', () => {
    expect(buildStepperTuningCommands('klipper', 'E', {
      currentMa: 700,
      microsteps: 32,
      mode: 'stealthchop',
      driverIndex: 0,
    })).toContain('SET_TMC_CURRENT STEPPER=extruder CURRENT=0.70');

    expect(buildStepperTuningCommands('klipper', 'E', {
      currentMa: 720,
      microsteps: 32,
      mode: 'stealthchop',
      driverIndex: 1,
    })).toContain('SET_TMC_CURRENT STEPPER=extruder1 CURRENT=0.72');
  });
});
