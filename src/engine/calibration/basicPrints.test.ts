import { describe, expect, it } from 'vitest';
import { DEFAULT_MATERIAL_PROFILES, DEFAULT_PRINT_PROFILES, DEFAULT_PRINTER_PROFILES } from '../../types/slicer';
import {
  generateCalibrationCubeGCode,
  generateDimensionalAccuracyGCode,
  generateInputShaperTowerGCode,
} from './basicPrints';

const printer = DEFAULT_PRINTER_PROFILES[0];
const material = DEFAULT_MATERIAL_PROFILES[0];
const print = DEFAULT_PRINT_PROFILES[0];

describe('basic calibration prints', () => {
  it('travels to each calibration cube wall start before extruding', () => {
    const gcode = generateCalibrationCubeGCode(printer, material, {
      ...print,
      wallCount: 2,
      lineWidth: 0.4,
      outerWallLineWidth: 0.4,
    });

    expect(gcode).toContain('G0 X20 Y20');
    expect(gcode).toContain('G0 X20.4 Y20.4');
  });

  it('uses at-least target-height layer counts for cube and dimensional gauge', () => {
    const oddLayerPrint = { ...print, firstLayerHeight: 0.3, layerHeight: 0.7 };

    const cube = generateCalibrationCubeGCode(printer, material, oddLayerPrint);
    const gauge = generateDimensionalAccuracyGCode(printer, material, oddLayerPrint);

    expect(cube).toContain('Nominal size: 20 x 20 x 20.6mm.');
    expect(cube).toContain('; layer 30/30');
    expect(gauge).toContain('; layer 15/15');
  });

  it('clamps input-shaper acceleration bands and restores print/travel acceleration', () => {
    const gcode = generateInputShaperTowerGCode(
      { ...printer, maxAcceleration: 2500 },
      material,
      { ...print, accelerationPrint: 1200, accelerationTravel: 1800 },
    );

    expect(gcode).toContain('M204 P2500 T2500');
    expect(gcode).not.toContain('M204 P3000 T3000');
    expect(gcode).toContain('M204 P1200 T1800');
  });
});
