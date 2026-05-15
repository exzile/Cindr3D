/**
 * useLayerFailureSampler — proactive failure detection during a live print.
 *
 * Subscribes to the active printer's `model.state.status` + `model.job.layer`
 * and, whenever the layer index advances by at least `layerStep` (configurable
 * per call, default 5) AND the printer is in an active-print state, captures
 * a camera frame, runs `classifyPrintFrame` from the vision service, and
 * records the result through `useVisionStore.recordCheck`.
 *
 * Owns its own per-printer "last sampled layer" guard so we never run the
 * detector twice on the same layer (and so resuming a paused print doesn't
 * re-trigger on the current layer either).
 *
 * Skips silently when no API key is configured — the provider config comes
 * from `useAiAssistantStore` (no `fallbackProvider()` with empty key, per
 * memory/gotchas.md).
 *
 * When the detector flags `category !== 'none'` with `confidence >
 * settings.confidenceThreshold` AND `settings.autoPauseEnabled`, the hook
 * calls `pausePrint()` from the printer store (the firmware-agnostic action
 * that maps to `M25` for Duet).
 *
 * Mount once at a per-active-printer surface (e.g. `DuetNotifications`).
 * The hook's body is otherwise inert when the printer is idle / no key /
 * no camera frame source.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAiAssistantStore } from '../store/aiAssistantStore';
import { usePrinterStore } from '../store/printerStore';
import { useVisionStore } from '../store/visionStore';
import {
  captureVisionFrame,
  classifyPrintFrame,
  summarizePrinterModel,
  type VisionCheckResult,
  type VisionFrameSample,
} from '../services/vision/failureDetector';
import { getDuetPrefs } from '../utils/duetPrefs';

const ACTIVE_PRINT_STATUSES = new Set<string>([
  'processing',
  'simulating',
  'resuming',
]);

export type LayerFailureSamplerState =
  | 'disabled-no-key'
  | 'idle'
  | 'active'
  | 'running'
  | 'error';

export interface LayerFailureSamplerStatus {
  state: LayerFailureSamplerState;
  lastSampledLayer: number | null;
  lastCheck: {
    layer: number;
    result: VisionCheckResult;
    at: number;
  } | null;
  lastError: string | null;
}

export interface UseLayerFailureSamplerOptions {
  /**
   * Minimum number of layers between samples. Default 5. The detector runs
   * on the *first* layer the hook observes after activation as well, so a
   * just-started print at layer 1 will trigger a check even before
   * layer >= step.
   */
  layerStep?: number;
}

const INITIAL_STATUS: LayerFailureSamplerStatus = {
  state: 'idle',
  lastSampledLayer: null,
  lastCheck: null,
  lastError: null,
};

interface SampleDeps {
  printerId: string;
  printerName: string;
  layer: number;
}

/**
 * Pure step-gate helper. Exposed for unit-testing the once-per-layer guard.
 *
 *   - On the first sample for a print (lastSampled === null), accept any
 *     layer >= 1.
 *   - On subsequent samples, accept only when `layer - lastSampled >= step`.
 *   - When the layer goes backward (rare — manual restart), reset and accept.
 */
export function shouldSampleLayer(
  currentLayer: number | undefined,
  lastSampledLayer: number | null,
  layerStep: number,
): boolean {
  if (currentLayer === undefined || !Number.isFinite(currentLayer) || currentLayer < 1) return false;
  if (lastSampledLayer === null) return true;
  if (currentLayer < lastSampledLayer) return true; // restart / new job
  return currentLayer - lastSampledLayer >= Math.max(1, layerStep);
}

/**
 * Pure activity check — kept here so callers and tests can reuse it.
 * Returns true when the printer is in a state where layer-by-layer
 * sampling makes sense.
 */
export function isActivePrintStatus(status: string | undefined): boolean {
  return Boolean(status && ACTIVE_PRINT_STATUSES.has(status));
}

export function useLayerFailureSampler(options: UseLayerFailureSamplerOptions = {}): LayerFailureSamplerStatus {
  const layerStep = Math.max(1, Math.round(options.layerStep ?? 5));

  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const status = usePrinterStore((s) => s.model.state?.status);
  const layer = usePrinterStore((s) => s.model.job?.layer);
  const fileName = usePrinterStore((s) => s.model.job?.file?.fileName);

  const provider = useAiAssistantStore((s) => s.provider);
  const aiModel = useAiAssistantStore((s) => s.model);
  const apiKey = useAiAssistantStore((s) => s.apiKey);

  const [samplerStatus, setSamplerStatus] = useState<LayerFailureSamplerStatus>(INITIAL_STATUS);

  // Per-printer/job "last sampled layer" guard. Reset when the printer
  // changes or when the job file changes mid-life. We key by
  // `${printerId}|${fileName ?? ''}`.
  const lastSampledByJobRef = useRef<Map<string, number>>(new Map());
  const inFlightRef = useRef<boolean>(false);

  const providerReady = apiKey.trim().length > 0 && aiModel.trim().length > 0;
  const active = isActivePrintStatus(status);

  // Clear guard when the active printer changes so a new printer starts fresh.
  useEffect(() => {
    lastSampledByJobRef.current = new Map();
    setSamplerStatus(INITIAL_STATUS);
  }, [activePrinterId]);

  const runCheck = useCallback(async (deps: SampleDeps): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSamplerStatus((prev) => ({ ...prev, state: 'running', lastError: null }));

    const visionState = useVisionStore.getState();
    const settings = visionState.failureSettings;

    let frame: VisionFrameSample;
    try {
      frame = await captureVisionFrame(getDuetPrefs());
    } catch (err) {
      inFlightRef.current = false;
      const msg = err instanceof Error ? err.message : String(err);
      setSamplerStatus((prev) => ({ ...prev, state: 'error', lastError: msg }));
      return;
    }

    try {
      const ps = usePrinterStore.getState();
      const result = await classifyPrintFrame({
        frame,
        settings,
        provider: { provider, model: aiModel, apiKey },
        context: {
          printer: summarizePrinterModel(deps.printerId, deps.printerName, ps.model),
        },
      });

      visionState.recordCheck({
        id: crypto.randomUUID(),
        printerId: deps.printerId,
        printerName: deps.printerName,
        cameraId: frame.cameraId,
        cameraLabel: frame.cameraLabel,
        createdAt: Date.now(),
        result,
      });

      // Auto-pause when the detector is confident enough AND user opted in.
      // shouldPause already factors in the threshold + autoPauseEnabled.
      if (result.shouldPause && !result.requiresConfirmation) {
        try { await usePrinterStore.getState().pausePrint(); }
        catch { /* surface via state below; pause failure shouldn't block status update */ }
      }

      setSamplerStatus({
        state: 'active',
        lastSampledLayer: deps.layer,
        lastCheck: { layer: deps.layer, result, at: Date.now() },
        lastError: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSamplerStatus((prev) => ({ ...prev, state: 'error', lastError: msg }));
    } finally {
      inFlightRef.current = false;
    }
  }, [provider, aiModel, apiKey]);

  // Drive the once-per-N-layers loop. Re-run whenever the relevant inputs
  // change — Zustand subscriptions handle the firmware-update churn.
  useEffect(() => {
    if (!providerReady) {
      setSamplerStatus((prev) => prev.state === 'disabled-no-key' ? prev : { ...INITIAL_STATUS, state: 'disabled-no-key' });
      return;
    }
    if (!active) {
      setSamplerStatus((prev) => prev.state === 'idle' ? prev : { ...prev, state: 'idle' });
      return;
    }
    if (!activePrinterId) return;

    const key = `${activePrinterId}|${fileName ?? ''}`;
    const lastSampled = lastSampledByJobRef.current.get(key) ?? null;
    if (!shouldSampleLayer(layer, lastSampled, layerStep)) {
      // Mark "active" so the UI knows we're armed, even if no sample fires yet.
      setSamplerStatus((prev) => prev.state === 'running' ? prev : { ...prev, state: 'active' });
      return;
    }

    // Reserve this layer in the guard BEFORE the async fetch so a rapid
    // re-render (multiple model updates within the same layer) doesn't double-fire.
    const currentLayer = layer as number;
    lastSampledByJobRef.current.set(key, currentLayer);

    const printers = usePrinterStore.getState().printers;
    const printerName = printers.find((p) => p.id === activePrinterId)?.name ?? 'Active printer';
    void runCheck({ printerId: activePrinterId, printerName, layer: currentLayer });
  }, [providerReady, active, activePrinterId, fileName, layer, layerStep, runCheck]);

  return useMemo(() => samplerStatus, [samplerStatus]);
}
