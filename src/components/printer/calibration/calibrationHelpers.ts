/**
 * Pure helpers for the printer-calibration panel:
 *   • G-code download (Blob → anchor click)
 *   • Date / status / record formatters used by the calibration-items table
 *   • Form-input parsers for the wear-component fields
 *   • Test-type → calibration-item lookup helpers
 *
 * Extracted from PrinterCalibrationPanel.tsx so the component file can focus
 * on stateful UI orchestration.
 */
import { CALIBRATION_ITEMS, type CalibrationItemId, useCalibrationStore } from '../../../store/calibrationStore';
import { CALIBRATION_CARDS } from './calibrationContent';

export function downloadGCode(filename: string, gcode: string): void {
  const blob = new Blob([gcode], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function formatDate(epochMs: number | null): string {
  if (!epochMs) return 'Never';
  return new Date(epochMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function statusLabel(status: string, daysUntilDue?: number | null): string {
  if (status === 'never') return 'Not recorded';
  if (status === 'overdue') return daysUntilDue == null ? 'Overdue' : `${Math.abs(daysUntilDue)}d overdue`;
  if (status === 'upcoming') return daysUntilDue == null ? 'Upcoming' : `Due in ${Math.max(0, daysUntilDue)}d`;
  return 'Current';
}

export function defaultCalibrationRecords(
  records: ReturnType<typeof useCalibrationStore.getState>['calibrationByPrinterId'][string] | undefined,
) {
  return CALIBRATION_ITEMS.map((item) => records?.[item.id] ?? {
    itemId: item.id,
    lastRunAt: null,
    intervalDays: item.defaultIntervalDays,
    note: '',
  });
}

export function parseNonNegativeNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

export function parseOptionalNonNegativeNumber(value: string): number | null | undefined {
  if (value.trim() === '') return null;
  return parseNonNegativeNumber(value) ?? undefined;
}

export function titleForTestType(testType: string): string {
  return CALIBRATION_CARDS.find((card) => card.testType === testType)?.title
    ?? testType.replace(/-/g, ' ');
}

export function testRecordItemIds(testType: string): CalibrationItemId[] {
  const card = CALIBRATION_CARDS.find((item) => item.testType === testType);
  if (card && card.linkedItemIds.length > 0) return card.linkedItemIds;
  return CALIBRATION_ITEMS.some((item) => item.id === testType)
    ? [testType as CalibrationItemId]
    : [];
}
