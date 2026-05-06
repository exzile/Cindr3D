import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAMBER_CONTROL } from '../../store/chamberControlStore';
import {
  computeChamberRampCommand,
  parseChamberTemperaturePayload,
  resolveChamberReading,
  shouldChamberCooldown,
  shouldChamberPreheat,
} from './chamberControl';

describe('chamber control helpers', () => {
  it('prefers RRF chamber heaters in auto mode', () => {
    const reading = resolveChamberReading({
      heat: {
        chamberHeaters: [2],
        bedHeaters: [],
        heaters: [
          { current: 22, active: 0, standby: 0, state: 'off', min: 0, max: 300, avgPwm: 0, sensor: 0 },
          { current: 23, active: 0, standby: 0, state: 'off', min: 0, max: 300, avgPwm: 0, sensor: 1 },
          { current: 41.5, active: 45, standby: 0, state: 'active', min: 0, max: 120, avgPwm: 0.4, sensor: 2 },
        ],
      },
    }, DEFAULT_CHAMBER_CONTROL);

    expect(reading.source).toBe('rrf');
    expect(reading.temperatureC).toBe(41.5);
    expect(reading.targetC).toBe(45);
  });

  it('reads chamber temperature from Klipper-style sensors or MQTT payloads', () => {
    const sensorReading = resolveChamberReading({
      sensors: {
        analog: [{ name: 'enclosure_temp', type: 'temperature', lastReading: 37.2 }],
        endstops: [],
        probes: [],
      },
    }, { ...DEFAULT_CHAMBER_CONTROL, source: 'klipper' });

    expect(sensorReading.source).toBe('klipper');
    expect(sensorReading.temperatureC).toBe(37.2);
    expect(parseChamberTemperaturePayload('{"temperature":42.8}')).toBe(42.8);
    expect(parseChamberTemperaturePayload('39.1')).toBe(39.1);
  });

  it('computes ramp targets and policy transitions', () => {
    const startedAt = Date.parse('2026-05-06T12:00:00Z');
    const config = {
      ...DEFAULT_CHAMBER_CONTROL,
      enabled: true,
      targetTemperatureC: 55,
      rampEnabled: true,
      rampActive: true,
      rampStartedAt: startedAt,
      rampStartTemperatureC: 35,
      rampStepC: 5,
      rampStepMinutes: 10,
    };

    expect(computeChamberRampCommand(config, startedAt + 21 * 60 * 1000)?.targetC).toBe(45);
    expect(shouldChamberPreheat('idle', 'processing', config)).toBe(true);
    expect(shouldChamberCooldown('processing', 'idle', config)).toBe(true);
  });
});
