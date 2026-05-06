import { describe, expect, it } from 'vitest';
import { DEFAULT_DOOR_SENSOR } from '../../store/doorSensorStore';
import { parseDoorPayload, resolveDoorOpenFromModel } from './doorSensor';

describe('door sensor helpers', () => {
  it('parses direct and JSON door payloads', () => {
    expect(parseDoorPayload('open', DEFAULT_DOOR_SENSOR)).toBe(true);
    expect(parseDoorPayload('closed', DEFAULT_DOOR_SENSOR)).toBe(false);
    expect(parseDoorPayload('{"doorOpen":true}', DEFAULT_DOOR_SENSOR)).toBe(true);
    expect(parseDoorPayload('{"state":"closed"}', DEFAULT_DOOR_SENSOR)).toBe(false);
  });

  it('resolves door state from RRF/Klipper-style sensors', () => {
    expect(resolveDoorOpenFromModel({
      sensors: {
        analog: [],
        endstops: [{ type: 'enclosure door', triggered: true }],
        probes: [],
      },
    }, { ...DEFAULT_DOOR_SENSOR, source: 'rrf' })).toBe(true);
  });
});
