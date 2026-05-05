import { describe, expect, it } from 'vitest';

import { buildPrintHistoryAnalytics, inferMaterialLabel, inferProfileLabel } from './printHistoryAnalytics';
import type { PrintHistoryEntry } from '../types/printer.types';

const history: PrintHistoryEntry[] = [
  { timestamp: '2026-05-01 09:00:00', kind: 'start', file: 'gearbox_PLA_standard.gcode', message: 'Starting print "gearbox_PLA_standard.gcode" profile=Standard material=PLA' },
  { timestamp: '2026-05-01 10:00:00', kind: 'finish', file: 'gearbox_PLA_standard.gcode', message: 'Finished print "gearbox_PLA_standard.gcode"', durationSec: 3600 },
  { timestamp: '2026-05-02 09:00:00', kind: 'start', file: 'gearbox_PLA_standard.gcode', message: 'Starting print "gearbox_PLA_standard.gcode" profile=Standard material=PLA' },
  { timestamp: '2026-05-02 09:30:00', kind: 'cancel', file: 'gearbox_PLA_standard.gcode', message: 'Cancelled print "gearbox_PLA_standard.gcode"', durationSec: 1800 },
  { timestamp: '2026-05-03 09:00:00', kind: 'start', file: 'gearbox_PLA_standard.gcode', message: 'Starting print "gearbox_PLA_standard.gcode" profile=Standard material=PLA' },
  { timestamp: '2026-05-03 09:20:00', kind: 'cancel', file: 'gearbox_PLA_standard.gcode', message: 'Cancelled print "gearbox_PLA_standard.gcode"', durationSec: 1200 },
];

describe('print history analytics', () => {
  it('infers material and profile labels from messages and filenames', () => {
    const entry = history[0];

    expect(inferMaterialLabel(entry)).toBe('PLA');
    expect(inferProfileLabel(entry)).toBe('Standard');
  });

  it('aggregates failure rate and last working profile', () => {
    const analytics = buildPrintHistoryAnalytics(history, 'Voron 2.4');
    const fileGroup = analytics.byFile[0];

    expect(fileGroup.label).toBe('gearbox_PLA_standard.gcode');
    expect(fileGroup.total).toBe(3);
    expect(fileGroup.failureRate).toBeCloseTo(66.666, 2);
    expect(fileGroup.lastSuccess?.profile).toBe('Standard');
    expect(analytics.byMaterial[0].label).toBe('PLA');
    expect(analytics.byPrinter[0].label).toBe('Voron 2.4');
    expect(analytics.insights[0].detail).toContain('Last working profile was Standard');
  });
});
