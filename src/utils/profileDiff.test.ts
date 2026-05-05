import { describe, expect, it } from 'vitest';
import type { PrinterProfile } from '../types/slicer';
import { createProfilePatchForKey, diffProfiles, formatProfileDiffValue } from './profileDiff';

const profile: PrinterProfile = {
  id: 'printer-a',
  name: 'Printer A',
  buildVolume: { x: 220, y: 220, z: 250 },
  nozzleDiameter: 0.4,
  nozzleCount: 1,
  filamentDiameter: 1.75,
  hasHeatedBed: true,
  hasHeatedChamber: false,
  maxNozzleTemp: 280,
  maxBedTemp: 110,
  maxSpeed: 200,
  maxAcceleration: 2000,
  originCenter: false,
  gcodeFlavorType: 'marlin',
  startGCode: 'G28',
  endGCode: 'M104 S0',
};

describe('profileDiff', () => {
  it('reports changed nested keys', () => {
    expect(diffProfiles(profile, {
      ...profile,
      name: 'Printer B',
      buildVolume: { ...profile.buildVolume, z: 300 },
    })).toEqual([
      { keyPath: 'buildVolume.z', before: 250, after: 300 },
      { keyPath: 'name', before: 'Printer A', after: 'Printer B' },
    ]);
  });

  it('creates a nested patch without dropping sibling values', () => {
    expect(createProfilePatchForKey(profile, 'buildVolume.x', 250)).toEqual({
      buildVolume: { x: 250, y: 220, z: 250 },
    });
  });

  it('formats diff values for compact display', () => {
    expect(formatProfileDiffValue(undefined)).toBe('unset');
    expect(formatProfileDiffValue(['a', 'b'])).toBe('["a","b"]');
  });
});
