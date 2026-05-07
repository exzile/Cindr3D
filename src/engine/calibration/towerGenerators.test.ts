import { describe, expect, it } from 'vitest';
import { DEFAULT_MATERIAL_PROFILES, DEFAULT_PRINT_PROFILES, DEFAULT_PRINTER_PROFILES } from '../../types/slicer';
import { generateRetractionTowerGCode } from './retractionTower';
import { generateTemperatureTowerGCode } from './temperatureTower';
import { generateFlowTowerGCode } from './flowTower';
import { generatePressureAdvancePatternGCode } from './pressureAdvancePattern';

const printer  = DEFAULT_PRINTER_PROFILES[0];  // marlin
const material = DEFAULT_MATERIAL_PROFILES[0]; // nozzleTemp=210, retractionZHop=0.2
const print    = DEFAULT_PRINT_PROFILES[0];

// ---------------------------------------------------------------------------
// Retraction tower
// ---------------------------------------------------------------------------

describe('retraction tower', () => {
  it('marks retraction band values in layer comments and travels to spike', () => {
    const gcode = generateRetractionTowerGCode(printer, material, print);

    // First band (0.20 mm) and last band (2.00 mm) should appear in layer comments
    expect(gcode).toContain('retraction=0.20mm');
    expect(gcode).toContain('retraction=2.00mm');

    // Spike travel target is hard-coded to X126 Y100
    expect(gcode).toContain('G0 X126 Y100');
  });

  it('inserts z-hop moves around spike travel and omits them when zHop is zero', () => {
    const countZMoves = (g: string) =>
      g.split('\n').filter((line) => /^G0 Z/.test(line)).length;

    const withHop = generateRetractionTowerGCode(
      printer,
      { ...material, retractionZHop: 0.5 },
      print,
    );
    const noHop = generateRetractionTowerGCode(
      printer,
      { ...material, retractionZHop: 0 },
      print,
    );

    expect(countZMoves(withHop)).toBeGreaterThan(countZMoves(noHop));
  });
});

// ---------------------------------------------------------------------------
// Temperature tower
// ---------------------------------------------------------------------------

describe('temperature tower', () => {
  const nozzle = material.nozzleTemp; // 210

  it('covers max (+10°C) and min (−10°C) bands in layer comments', () => {
    const gcode = generateTemperatureTowerGCode(printer, material, print);

    expect(gcode).toContain(`temp=${nozzle + 10}C`);
    expect(gcode).toContain(`temp=${nozzle - 10}C`);
    expect(gcode).toContain(`M104 S${nozzle + 10}`);
    expect(gcode).toContain(`M104 S${nozzle - 10}`);
  });

  it('emits the switch comment before the M104 command on every band transition', () => {
    const gcode = generateTemperatureTowerGCode(printer, material, print);

    // Second band transition: from nozzle+10 → nozzle+5
    const switchTo = nozzle + 5;
    const commentIdx = gcode.indexOf(`; switch nozzle temp to ${switchTo}C`);
    const commandIdx = gcode.indexOf(`M104 S${switchTo}`);

    // Comment must be present and precede the M104
    expect(commentIdx).toBeGreaterThanOrEqual(0);
    expect(commentIdx).toBeLessThan(commandIdx);
  });
});

// ---------------------------------------------------------------------------
// Flow tower
// ---------------------------------------------------------------------------

describe('flow tower', () => {
  it('steps from 90% to 110% and restores M221 S100 after the last band', () => {
    const gcode = generateFlowTowerGCode(printer, material, print);

    expect(gcode).toContain('M221 S90');
    expect(gcode).toContain('M221 S110');
    expect(gcode).toContain('flow=90%');
    expect(gcode).toContain('flow=110%');

    // Restore M221 S100 must appear after the last band layer comment
    const restoreIdx  = gcode.lastIndexOf('M221 S100');
    const lastBandIdx = gcode.lastIndexOf('flow=110%');
    expect(restoreIdx).toBeGreaterThan(lastBandIdx);
  });
});

// ---------------------------------------------------------------------------
// Pressure advance pattern — Marlin
// ---------------------------------------------------------------------------

describe('pressure advance pattern (marlin)', () => {
  it('generates 9 rows with M900 K commands and restores K to 0 at the end', () => {
    const gcode = generatePressureAdvancePatternGCode(
      { ...printer, gcodeFlavorType: 'marlin' },
      material,
      print,
    );

    expect(gcode).toContain('pressure advance row 1/9');
    expect(gcode).toContain('pressure advance row 9/9');

    // Row 2 should use K=0.04 for Marlin (step 0.04; trailing zeros stripped by formatNumber)
    expect(gcode).toContain('M900 K0.04');

    // Restore M900 K0 appears after the last row comment
    const restoreIdx  = gcode.lastIndexOf('M900 K0 ;');
    const lastRowIdx  = gcode.lastIndexOf('pressure advance row 9/9');
    expect(restoreIdx).toBeGreaterThan(lastRowIdx);
  });
});

// ---------------------------------------------------------------------------
// Pressure advance pattern — Klipper
// ---------------------------------------------------------------------------

describe('pressure advance pattern (klipper)', () => {
  it('uses SET_PRESSURE_ADVANCE and does not emit M900', () => {
    const gcode = generatePressureAdvancePatternGCode(
      { ...printer, gcodeFlavorType: 'klipper' },
      material,
      print,
    );

    // Row 1 sets K=0 (trailing zeros stripped: "0" not "0.0000")
    expect(gcode).toContain('SET_PRESSURE_ADVANCE ADVANCE=0');
    expect(gcode).not.toContain('M900');
  });
});
