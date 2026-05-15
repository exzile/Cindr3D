/**
 * usePrintCompletionScore — side-effect-only hook that captures one camera
 * frame at print-completion, runs `printDiagnostics`, and stores the result in
 * `useVisionStore.recentDiagnoses`.
 *
 * Mirrors the `useStatusTransitions` pattern in `duetNotifications/` — watches
 * the active printer's `model.state.status` and fires on the
 * `processing → idle` edge.
 *
 * Constraints (per `feedback_memory_first.md`):
 *   - Provider config comes from `useAiAssistantStore` (BYOK). No fallback
 *     provider with an empty key.
 *   - Missing key OR missing camera → silently skip (no toast, no error).
 *   - Once-per-job guard: every job gets its own `jobKey` (printer + file +
 *     completion timestamp) so a status flicker can't re-fire the capture for
 *     the same print.
 */
import { useEffect, useRef } from 'react';
import { usePrinterStore } from '../store/printerStore';
import { useAiAssistantStore } from '../store/aiAssistantStore';
import { useSlicerStore } from '../store/slicerStore';
import { getDuetPrefs } from '../utils/duetPrefs';
import { summarizePrinterModel, type VisionProviderConfig } from '../services/vision/failureDetector';
import {
  capturePrintCompletionFrame,
  recordPrintQualityScore,
  type PrintJobContext,
} from '../services/calibration/printQualityCapture';

export function usePrintCompletionScore(): void {
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const printers = usePrinterStore((s) => s.printers);
  const status = usePrinterStore((s) => s.model.state?.status);
  const jobFileName = usePrinterStore((s) => s.model.job?.file?.fileName);
  const jobLastFileName = usePrinterStore((s) => s.model.job?.lastFileName);
  const numLayers = usePrinterStore((s) => s.model.job?.file?.numLayers);
  const jobDuration = usePrinterStore((s) => s.model.job?.duration);
  const lastDuration = usePrinterStore((s) => s.model.job?.lastDuration);

  const aiProvider = useAiAssistantStore((s) => s.provider);
  const aiModel = useAiAssistantStore((s) => s.model);
  const aiApiKey = useAiAssistantStore((s) => s.apiKey);

  const prevStatusRef = useRef<string>('');
  const lastCapturedJobKeyRef = useRef<string>('');

  useEffect(() => {
    const current = status ?? 'disconnected';
    const prev = prevStatusRef.current;
    prevStatusRef.current = current;

    // Only fire on the processing → idle edge.
    if (!(prev === 'processing' && current === 'idle')) return;

    // Provider must be configured (BYOK). Silent skip — user opted out.
    if (!aiApiKey.trim() || !aiModel.trim()) return;

    // Once-per-job guard. Same file completing twice gets distinct keys via
    // duration so a re-print is captured again.
    const fileName = jobFileName ?? jobLastFileName ?? 'unknown-job';
    const durationKey = String(jobDuration ?? lastDuration ?? Date.now());
    const jobKey = `${activePrinterId}::${fileName}::${durationKey}`;
    if (lastCapturedJobKeyRef.current === jobKey) return;
    lastCapturedJobKeyRef.current = jobKey;

    const printer = printers.find((p) => p.id === activePrinterId);
    const printerName = printer?.name ?? 'Active printer';

    // Pull a fresh snapshot of the duet model + slicer material at the moment
    // the print finished (the effect deps already ensure we're reading "now").
    const model = usePrinterStore.getState().model;
    const material = useSlicerStore.getState().getActiveMaterialProfile();

    const context: PrintJobContext = {
      fileName,
      totalLayers: typeof numLayers === 'number' ? numLayers : undefined,
      printTimeSec: typeof jobDuration === 'number'
        ? jobDuration
        : typeof lastDuration === 'number' ? lastDuration : undefined,
      materialName: material?.name,
    };

    const provider: VisionProviderConfig = {
      provider: aiProvider,
      model: aiModel,
      apiKey: aiApiKey,
    };

    // Fire-and-forget — service layer handles all errors as `null` returns.
    void (async () => {
      const prefs = getDuetPrefs();
      const frame = await capturePrintCompletionFrame(prefs);
      if (!frame) return;
      const snapshot = summarizePrinterModel(activePrinterId, printerName, model);
      await recordPrintQualityScore({
        printerId: activePrinterId,
        printerName,
        frame,
        context,
        provider,
        printerSnapshot: snapshot,
      });
    })();
    // We intentionally exclude `model`/`material` lookups from deps — they're
    // read freshly inside the async body. The deps below are the edge trigger.
  }, [
    status,
    activePrinterId,
    printers,
    jobFileName,
    jobLastFileName,
    numLayers,
    jobDuration,
    lastDuration,
    aiProvider,
    aiModel,
    aiApiKey,
  ]);
}
