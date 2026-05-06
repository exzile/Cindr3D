import { describe, expect, it } from 'vitest';
import { DEFAULT_MATERIAL_PROFILES, DEFAULT_PRINT_PROFILES, DEFAULT_PRINTER_PROFILES } from '../../types/slicer';
import { generateFlowTowerGCode } from './flowTower';
import { generatePressureAdvancePatternGCode } from './pressureAdvancePattern';
import { generateRetractionTowerGCode } from './retractionTower';
import { generateTemperatureTowerGCode } from './temperatureTower';

const printer = DEFAULT_PRINTER_PROFILES[0]; // marlin, maxSpeed 200
const material = DEFAULT_MATERIAL_PROFILES[0]; // nozzleTemp 210, retractionZHop 0.2
const print = DEFAULT_PRINT_PROFILES[0];

describe('retraction tower', () => {
  it('marks retraction band values in layer comments and travels to spike', () => {
    const gcode = generateRetractionTowerGCode(printer, material, print);

    expect(gcode).toContain('retraction=0.20mm');
    expect(gcode).toContain('retraction=2.00mm');
    expect(gcode).toContain('G0 X126 Y100');
  });

  it('inserts z-hop moves around spike travel and omits them when zHop is zero', () => {
    const withHop = generateRetractionTowerGCode(printer, material, print); // retractionZHop=0.2
    const noHop = generateRetractionTowerGCode(printer, { ...material, retractionZHop: 0 }, print);

    const countZMoves = (g: string) => g.split('\n').filter((l) => /^G0 Z/.test(l)).length;
    expect(countZMoves(withHop)).toBeGreaterThan(countZMoves(noHop));
  });
});

describe('temperature tower', () => {
  it('sets nozzleTemp+10 initially and transitions down to nozzleTemp-10', () => {
    const gcode = generateTemperatureTowerGCode(printer, material, print);

    // material.nozzleTemp = 210 → bands: 220, 215, 210, 205, 200
    expect(gcode).toContain('M104 S220');
    expect(gcode).toContain('M109 S220');
    expect(gcode).toContain('temp=220C');
    expect(gcode).toContain('temp=200C');
    expect(gcode).toContain('M104 S200');
    expect(gcode).toContain('M109 S200');
  });

  it('emits temp transition comment before the M104 command at band boundaries', () => {
    const gcode = generateTemperatureTowerGCode(printer, material, print);

    const switchIdx = gcode.indexOf('; switch nozzle temp to 215C');
    const m104Idx = gcode.indexOf('M104 S215');
    expect(switchIdx).toBeGreaterThanOrEqual(0);
    expect(m104Idx).toBeGreaterThan(switchIdx);
  });
});

describe('flow tower', () => {
  it('steps M221 from 90 to 110 and restores 100 after the final band', () => {
    const gcode = generateFlowTowerGCode(printer, material, print);

    expect(gcode).toContain('M221 S90');
    expect(gcode).toContain('M221 S110');
    expect(gcode).toContain('flow=90%');
    expect(gcode).toContain('flow=110%');

    const lastRestore = gcode.lastIndexOf('M221 S100');
    const lastBand = gcode.lastIndexOf('flow=110%');
    expect(lastRestore).toBeGreaterThan(lastBand);
  });
});

describe('pressure advance pattern', () => {
  it('emits 9 rows with marlin M900 commands and restores PA to zero at end', () => {
    const gcode = generatePressureAdvancePatternGCode(printer, material, print);

    expect(gcode).toContain('pressure advance row 1/9');
    expect(gcode).toContain('pressure advance row 9/9');
    expect(gcode).toContain('M900 K0');
    expect(gcode).toContain('M900 K0.04');

    const lastRestore = gcode.lastIndexOf('M900 K0 ; restore');
    expect(lastRestore).toBeGreaterThan(gcode.lastIndexOf('pressure advance row 9/9'));
  });

  it('uses klipper SET_PRESSURE_ADVANCE syntax for klipper flavor', () => {
    const klipper = { ...printer, gcodeFlavorType: 'klipper' as const };
    const gcode = generatePressureAdvancePatternGCode(klipper, material, print);

    expect(gcode).toContain('SET_PRESSURE_ADVANCE ADVANCE=0');
    expect(gcode).not.toContain('M900');
  });
});
