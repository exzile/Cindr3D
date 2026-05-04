import { describe, expect, it } from 'vitest';
import { aggregateInventory, filamentLengthToGrams, type Spool } from './spoolStore';

function spool(id: string, material: string, initialWeightG: number, usedWeightG: number): Spool {
  return {
    id,
    brand: 'Generic',
    material,
    colorHex: 'ffffff',
    colorName: '',
    initialWeightG,
    usedWeightG,
    diameterMm: 1.75,
    notes: '',
    addedAt: 1,
  };
}

describe('spoolStore inventory helpers', () => {
  it('aggregates remaining material and low-stock thresholds', () => {
    const summary = aggregateInventory([
      spool('a', 'PLA', 1000, 900),
      spool('b', 'PLA', 500, 250),
      spool('c', 'PETG', 1000, 100),
    ], { PLA: 400 });

    expect(summary.find((entry) => entry.material === 'PLA')).toMatchObject({
      spoolCount: 2,
      remainingG: 350,
      thresholdG: 400,
      lowStock: true,
    });
    expect(summary.find((entry) => entry.material === 'PETG')?.lowStock).toBe(false);
  });

  it('converts filament length to grams using material density', () => {
    expect(filamentLengthToGrams(1000, 1.75, 'PLA')).toBeCloseTo(2.98, 1);
  });
});
