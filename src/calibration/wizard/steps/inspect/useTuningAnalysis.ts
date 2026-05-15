import { useCallback, useMemo, useState } from 'react';
import {
  analyzeTuningTower,
  type AnalyzeTuningTowerInput,
  type TuningTowerRecommendation,
  type TuningTowerContext,
} from '../../../../services/vision/tuningWizards';
import { useVisionStore } from '../../../../store/visionStore';
import { useAiAssistantStore } from '../../../../store/aiAssistantStore';
import type { VisionFrameSample, VisionProviderConfig } from '../../../../services/vision/failureDetector';
import type { InspectTestContext, TowerContext } from './types';

export interface TuningAnalysis {
  /** True when an API key + model are configured for the current provider. */
  providerReady: boolean;
  recommendation: TuningTowerRecommendation | null;
  loading: boolean;
  error: string | null;
  /** Open the AI Assistant panel so the user can enter an API key. */
  setAiPanelOpen: (open: boolean) => void;
  /** Run analysis with the provided frames + per-test context. */
  runAnalysis: (frames: VisionFrameSample[], context: InspectTestContext, printerId: string, spoolId: string) => Promise<void>;
  /** Clear recommendation/error — call when the active testType changes. */
  reset: () => void;
}

/**
 * Pack the numeric ramp parameters of a `TowerContext` into the
 * `TuningTowerContext` the analyzer prompt understands, plus add operator
 * notes that record the band layout so the model can map a height to a value.
 * `prefix` distinguishes notes from different tests (e.g. `pa`, `temperature`).
 */
function packTowerContext(
  ctx: TuningTowerContext,
  notes: string[],
  tower: TowerContext,
  prefix: string,
): void {
  ctx.startValue    = tower.startValue;
  ctx.stepPerMm     = tower.stepPerMm;
  ctx.towerHeightMm = tower.endZ - tower.startZ;
  notes.push(
    `${prefix}.range=${tower.startValue}-${tower.endValue}`,
    `${prefix}.bands=${tower.bandCount}`,
    `${prefix}.stepSizeMm=${tower.stepSize}`,
    `${prefix}.zRange=${tower.startZ}-${tower.endZ}mm`,
  );
}

/**
 * Owns the AI vision workflow for a calibration tower / first-layer test:
 *   - reads provider config from `useAiAssistantStore`
 *   - builds the `TuningTowerContext` from the per-test `InspectTestContext`
 *   - holds loading / error / recommendation state
 *
 * The hook is intentionally agnostic of what calls it — sub-component renders
 * only need `providerReady` + `recommendation`, while the host wires `reset()`
 * onto a `testType` effect.
 */
export function useTuningAnalysis(): TuningAnalysis {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<TuningTowerRecommendation | null>(null);

  const aiProvider = useAiAssistantStore((s) => s.provider);
  const aiModel    = useAiAssistantStore((s) => s.model);
  const aiApiKey   = useAiAssistantStore((s) => s.apiKey);
  const setAiPanelOpen = useAiAssistantStore((s) => s.setPanelOpen);

  const providerReady = aiApiKey.trim().length > 0 && aiModel.trim().length > 0;
  const providerConfig: VisionProviderConfig = useMemo(
    () => ({ provider: aiProvider, model: aiModel, apiKey: aiApiKey }),
    [aiProvider, aiModel, aiApiKey],
  );

  const reset = useCallback(() => {
    setRecommendation(null);
    setError(null);
  }, []);

  const runAnalysis = useCallback(
    async (frames: VisionFrameSample[], inspectCtx: InspectTestContext, printerId: string, spoolId: string) => {
      const { kind, testType, pressureAdvance, firstLayer, temperature, retraction, maxVolSpeed } = inspectCtx;
      if (!kind || frames.length === 0) return;
      setLoading(true);
      setError(null);
      try {
        const state = useVisionStore.getState();
        const contextFrames = state.recentFrames.slice(0, 25).map((r) => r.frame);
        const operatorNotes: string[] = [
          `spool:${spoolId || 'unknown'}`,
          `test:${testType}`,
          `contextFrames:${contextFrames.length}`,
        ];
        const context: TuningTowerContext = {
          kind,
          printer: { printerId, printerName: printerId || 'Selected printer' },
          operatorNotes,
        };
        // Tower-style tests: pass numeric ramp parameters so the model can map
        // a visible band-height back to a value.
        if (pressureAdvance) packTowerContext(context, operatorNotes, pressureAdvance, 'pa');
        if (temperature)     packTowerContext(context, operatorNotes, temperature,     'temperature');
        if (retraction)      packTowerContext(context, operatorNotes, retraction,      'retraction');
        if (maxVolSpeed)     packTowerContext(context, operatorNotes, maxVolSpeed,     'mvs');

        // First-layer: pad layout + temperatures are descriptive (no schema
        // field) — pack into operatorNotes so the model sees them.
        if (firstLayer) {
          const pads = firstLayer.pads.map((p) => `${p.label}@(${p.x},${p.y})`).join(',');
          operatorNotes.push(
            `firstLayer.pads=${pads}`,
            `firstLayer.heightMm=${firstLayer.firstLayerHeightMm}`,
            `firstLayer.lineWidthMm=${firstLayer.lineWidthMm.toFixed(3)}`,
            `firstLayer.bedTempC=${firstLayer.bedTempC}`,
            `firstLayer.nozzleTempC=${firstLayer.nozzleTempC}`,
            `firstLayer.material=${firstLayer.materialName}`,
          );
        }

        const input: AnalyzeTuningTowerInput = { frames, context, provider: providerConfig };
        const result = await analyzeTuningTower(input);
        setRecommendation(result);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setLoading(false);
      }
    },
    [providerConfig],
  );

  // Caller is expected to invoke `reset()` from a testType effect — the hook
  // stays decoupled from testType so it can be reused for other workflows.
  return { providerReady, recommendation, loading, error, setAiPanelOpen, runAnalysis, reset };
}
