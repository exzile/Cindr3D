import { describe, expect, it } from 'vitest';

import { buildBox, sliceGeometry } from './_helpers/slicerSystemHelpers';

describe('Coasting, wiping, and scarf seams', () => {
  it('emits coasting travel at reduced wall speed when enabled', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 3), {
      coastingEnabled: true,
      coastingVolume: 0.04,
      coastingSpeed: 50,
      minVolumeBeforeCoasting: 0,
      wallCount: 1,
    });

    expect(result.gcode).toContain('; Coast');
    expect(result.gcode).toContain('F900');
  }, 60_000);

  it('emits wipe markers and extra prime when wipe retraction is enabled', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 3), {
      wipeRetractionDistance: 1,
      wipeRetractionExtraPrime: 0.05,
      travelSpeed: 120,
      wallCount: 1,
    });

    expect(result.gcode).toContain(';WIPE_START');
    expect(result.gcode).toContain(';WIPE_END');
    expect(result.gcode).toContain('; Wipe');
  }, 60_000);

  it('emits Z-blended scarf seam moves on outer walls', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 3), {
      scarfSeamLength: 12,
      scarfSeamStepLength: 2,
      scarfSeamStartHeight: 0,
      scarfSeamStartSpeedRatio: 0.4,
      wallCount: 1,
    });

    const zExtrusionLines = result.gcode
      .split('\n')
      .filter((line) => line.startsWith('G1 ') && /\bZ\d+\.\d{3}\b/.test(line) && /\bE\d/.test(line));

    expect(zExtrusionLines.length).toBeGreaterThan(0);
    expect(result.gcode).toContain(';WIDTH:');
  }, 60_000);
});
