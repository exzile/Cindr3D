/**
 * printQualityCapture — pure service module that captures one camera frame at
 * print-completion time and runs `printDiagnostics` on it, then stores the
 * result in `useVisionStore.recentDiagnoses`.
 *
 * Design notes:
 *   - All capture / network work is wrapped in try/catch and fails soft (returns
 *     `null`) so a missing camera or missing API key NEVER throws into the
 *     caller. The hook that drives this only fires side-effects.
 *   - Provider config comes in via the argument (the caller pulls it from
 *     `useAiAssistantStore` — see `feedback_memory_first.md` "no fallback
 *     provider with empty key").
 *   - The "quality bucket" is a derivation of `PrintDiagnosisResult`, exposed
 *     here so the UI + the test share one source of truth.
 */
import { previewCameraStreamUrl, cameraDisplayUrl, prefsWithCamera, cameraByIdFromPrefs } from '../../utils/cameraStreamUrl';
import type { DuetPrefs } from '../../types/duet-prefs.types';
import type { VisionFrameSample, VisionProviderConfig, VisionPrinterSnapshot } from '../../services/vision/failureDetector';
import {
  diagnosePrint,
  type PrintDiagnosisResult,
  type PrintDiagnosticsTelemetry,
} from '../../services/vision/printDiagnostics';
import { useVisionStore, type PrintDiagnosisRecord } from '../../store/visionStore';
import { generateId } from '../../utils/generateId';

export type PrintQualityBucket = 'ok' | 'warn' | 'fail';

export interface PrintJobContext {
  fileName?: string;
  totalLayers?: number;
  printTimeSec?: number;
  materialName?: string;
}

export interface RecordPrintQualityInput {
  printerId: string;
  printerName: string;
  frame: VisionFrameSample;
  context: PrintJobContext;
  provider: VisionProviderConfig;
  /** Light printer snapshot so the analyzer has telemetry to ground the diagnosis in. */
  printerSnapshot: VisionPrinterSnapshot;
}

/**
 * Bucket the diagnosis into a 3-level traffic light. Exported (and tested) so
 * the card UI doesn't reinvent the rule.
 */
export function bucketDiagnosis(result: PrintDiagnosisResult): PrintQualityBucket {
  const topConfidence = result.rankedCauses.reduce(
    (max, cause) => (cause.confidence > max ? cause.confidence : max),
    0,
  );
  if (topConfidence >= 0.7) return 'fail';
  if (result.needsHumanReview || result.rankedCauses.length > 0 || topConfidence > 0.3) {
    return 'warn';
  }
  return 'ok';
}

/**
 * Capture one snapshot from the primary (active) camera configured in `prefs`.
 * Returns `null` when:
 *   - no camera is configured / enabled
 *   - the camera is a browser-USB device (no remote snapshot URL)
 *   - the snapshot fetch fails for any reason
 * Never throws — the caller treats `null` as "user opted out / no camera".
 */
export async function capturePrintCompletionFrame(prefs: DuetPrefs): Promise<VisionFrameSample | null> {
  try {
    const camera = cameraByIdFromPrefs(prefs);
    if (!camera || camera.sourceType === 'browser-usb') return null;
    const cameraPrefs = prefsWithCamera(prefs, camera.id);
    const streamUrl = previewCameraStreamUrl(cameraPrefs);
    if (!streamUrl) return null;
    const displayUrl = cameraDisplayUrl(streamUrl, cameraPrefs.webcamUsername, cameraPrefs.webcamPassword);
    const response = await fetch(displayUrl, { cache: 'no-store' });
    if (!response.ok) return null;
    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);
    return {
      cameraId: camera.id,
      cameraLabel: camera.label,
      capturedAt: Date.now(),
      mimeType: blob.type || 'image/jpeg',
      dataUrl,
      size: blob.size,
    };
  } catch {
    return null;
  }
}

/**
 * Run the diagnostics analyzer on the captured frame and record the result.
 * Returns `null` when capture/analysis can't proceed (missing API key, missing
 * frame, analyzer error) — caller should fail soft.
 */
export async function recordPrintQualityScore(
  input: RecordPrintQualityInput,
): Promise<PrintDiagnosisRecord | null> {
  if (!input.provider.apiKey.trim()) return null;
  if (!input.provider.model.trim()) return null;

  const telemetry: PrintDiagnosticsTelemetry = {
    printer: input.printerSnapshot,
    operatorNotes: collectOperatorNotes(input.context),
  };

  try {
    const result = await diagnosePrint({
      frames: [input.frame],
      telemetry,
      provider: input.provider,
    });
    const record: PrintDiagnosisRecord = {
      id: generateId('print-quality'),
      printerId: input.printerId,
      printerName: input.printerName,
      createdAt: Date.now(),
      result,
    };
    useVisionStore.getState().recordDiagnosis(record);
    return record;
  } catch {
    return null;
  }
}

function collectOperatorNotes(ctx: PrintJobContext): string[] {
  const notes: string[] = ['source:print-completion-capture'];
  if (ctx.fileName) notes.push(`job.fileName=${ctx.fileName}`);
  if (typeof ctx.totalLayers === 'number') notes.push(`job.totalLayers=${ctx.totalLayers}`);
  if (typeof ctx.printTimeSec === 'number') notes.push(`job.printTimeSec=${ctx.printTimeSec}`);
  if (ctx.materialName) notes.push(`job.material=${ctx.materialName}`);
  return notes;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read camera frame.'));
    reader.readAsDataURL(blob);
  });
}
