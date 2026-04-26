import { describe, expect, it } from 'vitest';
import type { MaterialProfile, PrinterProfile } from '../../../../types/slicer';

import { finalizeGCodeStats } from '../footer';

function makePrinter(overrides: Partial<PrinterProfile> = {}): PrinterProfile {
  return {
    filamentDiameter: 1.75,
    printTimeEstimationFactor: 1.0,
    ...overrides,
  } as unknown as PrinterProfile;
}

function makeMaterial(overrides: Partial<MaterialProfile> = {}): MaterialProfile {
  return {
    density: 1.24, // g/cm³ for PLA
    costPerKg: 25,
    ...overrides,
  } as unknown as MaterialProfile;
}

describe('finalizeGCodeStats', () => {
  it('computes filament weight from extrusion length × cross-section × density', () => {
    // 1.75mm filament: cross-section ≈ π × 0.875² ≈ 2.405 mm²
    // 1000mm extruded → ~2405 mm³ → 2.405 cm³ → 2.405 × 1.24 = 2.9822g
    const stats = finalizeGCodeStats([], 0, 1000, makePrinter(), makeMaterial());
    expect(stats.filamentWeight).toBeCloseTo(2.98, 1);
  });

  it('computes filament cost as (weight kg) × ($/kg)', () => {
    const stats = finalizeGCodeStats([], 0, 10_000, makePrinter(), makeMaterial({ costPerKg: 30 }));
    // 10,000mm → ~29.8g → 0.0298kg → ~$0.89
    expect(stats.filamentCost).toBeCloseTo(0.89, 1);
  });

  it('applies printTimeEstimationFactor to total time', () => {
    const stats = finalizeGCodeStats([], 600, 0, makePrinter({ printTimeEstimationFactor: 1.2 }), makeMaterial());
    expect(stats.estimatedTime).toBeCloseTo(720, 5);
  });

  it('uses 1.0 as the default time estimation factor when undefined', () => {
    const printer = makePrinter();
    delete (printer as unknown as { printTimeEstimationFactor?: number }).printTimeEstimationFactor;
    const stats = finalizeGCodeStats([], 600, 0, printer, makeMaterial());
    expect(stats.estimatedTime).toBe(600);
  });

  it('replaces PRINT_TIME_PLACEHOLDER comment with formatted time', () => {
    const gcode = [
      '; some header',
      '; PRINT_TIME_PLACEHOLDER',
      'G28',
    ];
    finalizeGCodeStats(gcode, 3725, 0, makePrinter(), makeMaterial()); // 1h 2m 5s
    expect(gcode[1]).toMatch(/Estimated print time: 1h 2m/);
  });

  it('replaces FILAMENT_USED_PLACEHOLDER comment with formatted filament info', () => {
    const gcode = [
      '; FILAMENT_USED_PLACEHOLDER',
      'G28',
    ];
    finalizeGCodeStats(gcode, 0, 12345, makePrinter(), makeMaterial());
    expect(gcode[0]).toMatch(/Filament used: 12345.0mm/);
    expect(gcode[0]).toMatch(/g\)/);
  });

  it('leaves G-code unchanged when neither placeholder is present', () => {
    const gcode = ['G28', 'G1 X10'];
    const before = gcode.join('\n');
    finalizeGCodeStats(gcode, 100, 50, makePrinter(), makeMaterial());
    expect(gcode.join('\n')).toBe(before);
  });

  it('handles zero extrusion (e.g. travel-only test slice)', () => {
    const stats = finalizeGCodeStats([], 100, 0, makePrinter(), makeMaterial());
    expect(stats.filamentWeight).toBe(0);
    expect(stats.filamentCost).toBe(0);
  });

  it('formats time as Hh Mm with hours zeroed when print is sub-hour', () => {
    const gcode = ['; PRINT_TIME_PLACEHOLDER'];
    finalizeGCodeStats(gcode, 1800, 0, makePrinter(), makeMaterial()); // 30m
    expect(gcode[0]).toMatch(/Estimated print time: 0h 30m/);
  });

  it('handles longer prints (multi-hour) correctly', () => {
    const gcode = ['; PRINT_TIME_PLACEHOLDER'];
    finalizeGCodeStats(gcode, 18_000, 0, makePrinter(), makeMaterial()); // 5h 0m
    expect(gcode[0]).toMatch(/Estimated print time: 5h 0m/);
  });
});
