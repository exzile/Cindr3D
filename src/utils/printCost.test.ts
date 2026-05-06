import { describe, expect, it } from 'vitest';
import type { Spool } from '../store/spoolStore';
import type { PrintHistoryJob } from './printHistoryAnalytics';
import {
  averageSpoolCostPerKg,
  effectiveJobDurationSec,
  estimateElectricityCost,
  estimatePrintJobCost,
  exportPrintCostSummaryCsv,
  exportPrintCostSummaryJson,
  summarizePrintCosts,
} from './printCost';

function spool(material: string, costPerKg?: number): Spool {
  return {
    id: `spool-${material}`,
    brand: 'Generic',
    material,
    colorHex: 'ffffff',
    colorName: '',
    initialWeightG: 1000,
    usedWeightG: 0,
    diameterMm: 1.75,
    costPerKg,
    notes: '',
    addedAt: 1,
  };
}

function job(partial: Partial<PrintHistoryJob> = {}): PrintHistoryJob {
  return {
    file: 'tray.gcode',
    profile: '0.2mm',
    material: 'PLA',
    printer: 'Voron',
    startedAt: new Date('2026-05-05T10:00:00'),
    endedAt: new Date('2026-05-05T12:00:00'),
    durationSec: 7200,
    outcome: 'completed',
    ...partial,
  };
}

describe('print cost helpers', () => {
  it('calculates electricity cost from watts, time, and rate', () => {
    expect(estimateElectricityCost(7200, 250, 0.18)).toBeCloseTo(0.09);
  });

  it('prices electricity across sampled time-of-use rates', () => {
    const start = Date.parse('2026-05-05T10:00:00');
    const peakStart = Date.parse('2026-05-05T11:00:00');
    const cost = estimateElectricityCost(
      7200,
      1000,
      0.1,
      start,
      (epochMs) => (epochMs >= peakStart ? 0.3 : 0.1),
    );

    expect(cost).toBeCloseTo(0.4);
  });

  it('uses matching material spool cost before falling back to fleet average', () => {
    expect(averageSpoolCostPerKg([spool('PLA', 22), spool('PETG', 30)], 'PLA')).toBe(22);
    expect(averageSpoolCostPerKg([spool('PLA', 22), spool('PETG', 30)], 'ABS')).toBe(26);
  });

  it('estimates filament, energy, carbon, and total cost per job', () => {
    const estimate = estimatePrintJobCost(job(), [spool('PLA', 25)], {
      printerWatts: 250,
      electricityRatePerKwh: 0.2,
      filamentGramsPerHour: 20,
      co2KgPerKwh: 0.4,
      nowMs: Date.parse('2026-05-05T12:00:00'),
    });

    expect(estimate.filamentG).toBeCloseTo(40);
    expect(estimate.filamentCost).toBeCloseTo(1);
    expect(estimate.energyKwh).toBeCloseTo(0.5);
    expect(estimate.energyCost).toBeCloseTo(0.1);
    expect(estimate.co2Kg).toBeCloseTo(0.2);
    expect(estimate.totalCost).toBeCloseTo(1.1);
  });

  it('uses time-of-use rates for job receipts', () => {
    const estimate = estimatePrintJobCost(job(), [spool('PLA', 25)], {
      printerWatts: 1000,
      electricityRatePerKwh: 0.1,
      electricityRateAt: (epochMs) => (epochMs >= Date.parse('2026-05-05T11:00:00') ? 0.3 : 0.1),
      filamentGramsPerHour: 0,
      co2KgPerKwh: 0.4,
      nowMs: Date.parse('2026-05-05T12:00:00'),
    });

    expect(estimate.energyKwh).toBeCloseTo(2);
    expect(estimate.energyCost).toBeCloseTo(0.4);
    expect(estimate.totalCost).toBeCloseTo(0.4);
  });

  it('uses elapsed wall time for in-progress jobs', () => {
    expect(effectiveJobDurationSec(job({
      endedAt: null,
      durationSec: 0,
      outcome: 'in-progress',
    }), Date.parse('2026-05-05T10:30:00'))).toBe(1800);
  });

  it('summarizes costs by project, material, and printer', () => {
    const summary = summarizePrintCosts([
      job({ file: 'tray.gcode', material: 'PLA', printer: 'A' }),
      job({ file: 'bracket.gcode', material: 'PETG', printer: 'B', durationSec: 3600 }),
    ], [spool('PLA', 20), spool('PETG', 30)], {
      printerWatts: 200,
      electricityRatePerKwh: 0.1,
      filamentGramsPerHour: 10,
      co2KgPerKwh: 0.4,
      nowMs: Date.parse('2026-05-05T12:00:00'),
    });

    expect(summary.totals.runs).toBe(2);
    expect(summary.byProject).toHaveLength(2);
    expect(summary.byMaterial.map((group) => group.key)).toContain('PLA');
    expect(summary.byPrinter.map((group) => group.key)).toContain('A');
    expect(summary.byMonth.map((group) => group.key)).toContain('2026-05');
    expect(summary.byPrinterMonth.map((group) => group.key)).toContain('A|2026-05');
  });

  it('groups monthly rollups using the local calendar month', () => {
    const localMonthJob = job({ startedAt: new Date(2026, 0, 1, 0, 15), endedAt: new Date(2026, 0, 1, 1, 15) });
    const summary = summarizePrintCosts([localMonthJob], [spool('PLA', 20)], {
      printerWatts: 200,
      electricityRatePerKwh: 0.1,
      filamentGramsPerHour: 10,
      co2KgPerKwh: 0.4,
      nowMs: localMonthJob.endedAt?.getTime(),
    });

    expect(summary.byMonth[0].key).toBe('2026-01');
  });

  it('exports job-level sustainability data to CSV and JSON', () => {
    const summary = summarizePrintCosts([job({ file: 'tray,wide.gcode' })], [spool('PLA', 20)], {
      printerWatts: 200,
      electricityRatePerKwh: 0.1,
      filamentGramsPerHour: 10,
      co2KgPerKwh: 0.4,
      nowMs: Date.parse('2026-05-05T12:00:00'),
    });

    const csv = exportPrintCostSummaryCsv(summary);
    expect(csv).toContain('startedAt,printer,file,material,status');
    expect(csv).toContain('"tray,wide.gcode"');

    const parsed = JSON.parse(exportPrintCostSummaryJson(summary));
    expect(parsed.totals.runs).toBe(1);
    expect(parsed.jobs[0].co2Kg).toBeGreaterThan(0);
  });
});
