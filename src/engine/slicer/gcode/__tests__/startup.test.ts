import { describe, expect, it } from 'vitest';

import { finalizeGCodeStats } from '../footer';
import { syncStateFromGCode } from '../startEnd';
import { appendHeaderPlaceholders, appendStartGCode } from '../startup';
import type { StartEndMachineState } from '../../../../types/slicer-gcode.types';
import type {
  MaterialProfile,
  PrinterProfile,
  PrintProfile,
} from '../../../../types/slicer';

function state(): StartEndMachineState {
  return {
    currentX: 0,
    currentY: 0,
    currentZ: 0,
    currentE: 0,
    isRetracted: false,
    extrudedSinceRetract: 0,
    templateUsesAbsolutePositioning: true,
    templateUsesAbsoluteExtrusion: true,
  };
}

const printer = {
  name: 'Test Printer',
  nozzleDiameter: 0.4,
  filamentDiameter: 1.75,
  hasHeatedBed: true,
  hasHeatedChamber: false,
  gcodeFlavorType: 'marlin',
  waitForBuildPlate: true,
  waitForNozzle: true,
  startGCode: '',
  endGCode: '',
} as unknown as PrinterProfile;

const material = {
  name: 'PLA',
  nozzleTemp: 210,
  nozzleTempFirstLayer: 215,
  bedTemp: 60,
  bedTempFirstLayer: 65,
  chamberTemp: 0,
  linearAdvanceEnabled: false,
  linearAdvanceFactor: 0,
  flowRate: 1,
  density: 1.24,
  costPerKg: 20,
} as unknown as MaterialProfile;

const print = {
  layerHeight: 0.2,
  infillDensity: 20,
  infillPattern: 'grid',
  relativeExtrusion: false,
  buildVolumeFanSpeed: 0,
  initialLayersBuildVolumeFanSpeed: 0,
  primeBlobEnable: false,
  firstLayerSpeed: 30,
} as unknown as PrintProfile;

describe('G-code startup', () => {
  it('keeps startGCodeMustBeFirst templates as the first emitted line', () => {
    const gcode: string[] = [];
    appendStartGCode({
      gcode,
      printer: {
        ...printer,
        startGCodeMustBeFirst: true,
        startGCode: 'START_PRINT BED_TEMP={bedTemp} EXTRUDER_TEMP={nozzleTemp}',
      },
      material,
      print,
      relativeExtrusion: false,
      flavor: 'klipper',
      startEndState: state(),
    });

    expect(gcode[0]).toBe('START_PRINT BED_TEMP=65 EXTRUDER_TEMP=215');
    expect(gcode[1]).toBe('; ----- Slicer startup continuation -----');
  });

  it('uses first-layer temperatures for template variables and generated heatup', () => {
    const gcode: string[] = [];
    appendStartGCode({
      gcode,
      printer: { ...printer, startGCode: 'M104 S{nozzleTemp}\nM140 S{bedTemp}' },
      material,
      print,
      relativeExtrusion: false,
      flavor: 'marlin',
      startEndState: state(),
    });

    expect(gcode.some((line) => /^M104 S210\b/.test(line))).toBe(false);
    expect(gcode.some((line) => /^M104 S215\b/.test(line) || /^M109 S215\b/.test(line))).toBe(true);
    expect(gcode.some((line) => /^M140 S65\b/.test(line) || /^M190 S65\b/.test(line))).toBe(true);
  });

  it('syncs XYZE and retract state from start-template movement commands', () => {
    const s = state();
    syncStateFromGCode([
      'G28',
      'G91',
      'G1 X5 Y-2 Z0.4',
      'M83',
      'G1 E-1.2',
      'G10',
      'G11',
      'G92 X9 Y8 Z7 E0',
    ].join('\n'), s);

    expect(s.currentX).toBeCloseTo(9);
    expect(s.currentY).toBeCloseTo(8);
    expect(s.currentZ).toBeCloseTo(7);
    expect(s.currentE).toBeCloseTo(0);
    expect(s.isRetracted).toBe(false);
    expect(s.templateUsesAbsolutePositioning).toBe(false);
    expect(s.templateUsesAbsoluteExtrusion).toBe(false);
  });

  it('replaces stats placeholders wherever the header is emitted', () => {
    const gcode = ['START_PRINT'];
    appendHeaderPlaceholders(gcode, printer, material, print);
    finalizeGCodeStats(
      gcode,
      3600,
      100,
      { filamentDiameter: 1.75, printTimeEstimationFactor: 1 } as PrinterProfile,
      material,
    );

    expect(gcode[0]).toBe('START_PRINT');
    expect(gcode.some((line) => line.includes('PRINT_TIME_PLACEHOLDER'))).toBe(false);
    expect(gcode.some((line) => line.includes('FILAMENT_USED_PLACEHOLDER'))).toBe(false);
    expect(gcode).toContain('; Estimated print time: 1h 0m');
  });
});
