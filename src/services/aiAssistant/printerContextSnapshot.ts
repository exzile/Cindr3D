/**
 * printerContextSnapshot — pure builder for the markdown block the chat
 * send-site prepends to the system prompt. Reads from the global Zustand
 * stores (printerStore / calibrationStore / visionStore) at call time so
 * the model sees the *current* state, not a stale snapshot from when the
 * component first rendered.
 *
 * Pure: no React, no side effects, no caching. Returns either a short
 * markdown summary or an empty string when there is no active printer
 * to describe.
 */

import { usePrinterStore } from '../../store/printerStore';
import {
  CALIBRATION_ITEMS,
  useCalibrationStore,
  type CalibrationItemId,
  type CalibrationResult,
} from '../../store/calibrationStore';
import { useVisionStore } from '../../store/visionStore';

const CALIBRATION_LABELS: Record<CalibrationItemId, string> = Object.fromEntries(
  CALIBRATION_ITEMS.map((item) => [item.id, item.label]),
) as Record<CalibrationItemId, string>;

function fmtAge(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

interface FlatCalibrationResult {
  itemId: CalibrationItemId;
  result: CalibrationResult;
}

function recentCalibrations(printerId: string, limit: number): FlatCalibrationResult[] {
  const calibration = useCalibrationStore.getState();
  const records = calibration.calibrationByPrinterId[printerId];
  if (!records) return [];
  const flat: FlatCalibrationResult[] = [];
  for (const item of CALIBRATION_ITEMS) {
    const rec = records[item.id];
    if (!rec?.results) continue;
    for (const result of rec.results) {
      flat.push({ itemId: item.id, result });
    }
  }
  flat.sort((a, b) => b.result.recordedAt - a.result.recordedAt);
  return flat.slice(0, limit);
}

/**
 * Build a tight Markdown summary of the active printer's current state plus
 * a small amount of recent calibration / vision / diagnosis history. Returns
 * `''` when no printer is configured at all (so the caller can decide whether
 * to prepend anything to the system prompt).
 */
export function buildPrinterContextSnapshot(now: number = Date.now()): string {
  const printerState = usePrinterStore.getState();
  const printers = printerState.printers;
  const activeId = printerState.activePrinterId;
  const activePrinter = printers.find((p) => p.id === activeId);

  if (!activePrinter) {
    return 'No active printer is configured.';
  }

  const model = printerState.model;
  const status = model.state?.status ?? 'disconnected';
  const job = model.job;
  const fileName = job?.file?.fileName ?? job?.lastFileName;
  const currentLayer = job?.layer;
  const totalLayers = job?.file?.numLayers;

  const lines: string[] = [];
  lines.push(`- **Printer**: ${activePrinter.name} (id: ${activeId})`);
  lines.push(`- **Status**: ${status}${printerState.connected ? ' (connected)' : ' (offline)'}`);
  if (fileName) {
    const layerPart = currentLayer !== undefined
      ? ` — layer ${currentLayer}${totalLayers ? `/${totalLayers}` : ''}`
      : '';
    lines.push(`- **Current job**: ${fileName}${layerPart}`);
  }

  const calibrations = recentCalibrations(activeId, 3);
  if (calibrations.length > 0) {
    lines.push('- **Recent calibrations**:');
    for (const { itemId, result } of calibrations) {
      const label = CALIBRATION_LABELS[itemId] ?? itemId;
      const value = result.appliedValue !== null && Number.isFinite(result.appliedValue)
        ? ` value=${result.appliedValue}`
        : '';
      const conf = result.aiConfidence !== null && Number.isFinite(result.aiConfidence)
        ? ` aiConf=${result.aiConfidence.toFixed(2)}`
        : '';
      lines.push(`  - ${label}${value}${conf} (${fmtAge(result.recordedAt, now)})`);
    }
  }

  const vision = useVisionStore.getState();
  const checks = vision.recentChecks
    .filter((record) => record.printerId === activeId)
    .slice(0, 3);
  if (checks.length > 0) {
    lines.push('- **Recent failure checks**:');
    for (const check of checks) {
      const r = check.result;
      lines.push(`  - ${r.category} (${r.severity}, conf=${r.confidence.toFixed(2)}) — ${fmtAge(check.createdAt, now)}`);
    }
  }

  const diagnoses = vision.recentDiagnoses
    .filter((record) => record.printerId === activeId)
    .slice(0, 3);
  if (diagnoses.length > 0) {
    lines.push('- **Recent print diagnoses**:');
    for (const diag of diagnoses) {
      const head = diag.result.summary.length > 120
        ? `${diag.result.summary.slice(0, 117)}...`
        : diag.result.summary;
      lines.push(`  - ${head} (${fmtAge(diag.createdAt, now)})`);
    }
  }

  return lines.join('\n');
}
