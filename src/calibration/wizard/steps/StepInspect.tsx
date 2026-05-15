import { useEffect, useMemo, useState } from 'react';
import {
  analyzeTuningTower,
  type AnalyzeTuningTowerInput,
  type TuningTowerRecommendation,
  type TuningWizardKind,
  type TuningTowerContext,
} from '../../../services/vision/tuningWizards';
import { useVisionStore } from '../../../store/visionStore';
import { useAiAssistantStore } from '../../../store/aiAssistantStore';
import { useSlicerStore } from '../../../store/slicerStore';
import type { VisionFrameSample, VisionProviderConfig } from '../../../services/vision/failureDetector';
import { CalibrationCameraCapture } from '../../camera/CalibrationCameraCapture';

interface StepInspectProps {
  testType: string;
  printerId: string;
  spoolId: string;
  frames: VisionFrameSample[];
  onFrames: (frames: VisionFrameSample[]) => void;
  onRecommendation: (r: TuningTowerRecommendation) => void;
  onManualMeasurement: (key: string, value: number) => void;
}

function tuningKindForTest(testType: string): TuningWizardKind | null {
  if (testType === 'pressure-advance') return 'pressure-advance';
  if (testType === 'first-layer') return 'first-layer-squish';
  if (testType === 'temperature-tower') return 'temperature';
  if (testType === 'retraction') return 'retraction';
  if (testType === 'input-shaper') return 'input-shaper';
  return null;
}

interface PressureAdvanceContext {
  startValue: number;
  endValue: number;
  startZ: number;
  endZ: number;
  stepPerMm: number;
  stepSize: number;
  bandCount: number;
}

/**
 * Pull the active print profile's pressure-advance tuning-tower processor and
 * derive the start/end/step parameters the AI needs to map a visible band on
 * the printed tower back to a numeric PA value.
 */
function usePressureAdvanceContext(): PressureAdvanceContext | null {
  const printProfile = useSlicerStore((s) => s.getActivePrintProfile());
  return useMemo(() => {
    const proc = printProfile?.layerProcessors?.find(
      (p) => p.kind === 'tuning-tower' && p.tuningParameter === 'pressure-advance',
    );
    if (!proc) return null;
    const startZ = proc.tuningStartZ ?? 0;
    const endZ = proc.tuningEndZ ?? 50;
    const startValue = proc.tuningStartValue ?? 0;
    const endValue = proc.tuningEndValue ?? 0.1;
    const stepSize = proc.tuningStepSize ?? 5;
    const span = Math.max(0.001, endZ - startZ);
    const stepPerMm = (endValue - startValue) / span;
    const bandCount = stepSize > 0 ? Math.max(1, Math.round(span / stepSize) + 1) : Math.round(span);
    return { startValue, endValue, startZ, endZ, stepPerMm, stepSize, bandCount };
  }, [printProfile]);
}

// ── Health checklist items ────────────────────────────────────────────────────
const HEALTH_CHECKS = [
  { key: 'motion',     label: 'Motion quality',          detail: 'No visible ringing or ghosting on vertical walls' },
  { key: 'thermal',   label: 'Thermal stability',        detail: 'Consistent layer colour, no delamination or under-extrusion bands' },
  { key: 'extrusion', label: 'Extrusion consistency',    detail: 'Uniform line width, no gaps or blobs on perimeters' },
  { key: 'firstLayer',label: 'First layer adhesion',     detail: 'Flat and well-squished, no corner lifting' },
  { key: 'dims',      label: 'Dimensional accuracy',     detail: '≈ 20 mm on all three axes when measured with calipers' },
];

// ── Manual measurement fields by test type ────────────────────────────────────
function ManualFields({
  testType,
  paValue,
  onManualMeasurement,
}: {
  testType: string;
  paValue?: number | null;
  onManualMeasurement: (key: string, value: number) => void;
}) {
  if (testType === 'pressure-advance') return (
    <div className="calib-inspect-field">
      <span className="calib-inspect-field__label">Best PA value</span>
      <input
        className="calib-inspect-field__input"
        type="number" step={0.0001} min={0} placeholder="e.g. 0.045"
        value={paValue ?? ''}
        onChange={(e) => onManualMeasurement('value', Number(e.target.value))}
      />
      <span className="calib-inspect-field__unit">PA</span>
    </div>
  );

  if (testType === 'first-layer') return (
    <div className="calib-inspect-field">
      <span className="calib-inspect-field__label">Z offset delta</span>
      <input
        className="calib-inspect-field__input"
        type="number" step={0.001} placeholder="e.g. −0.05"
        onChange={(e) => onManualMeasurement('value', Number(e.target.value))}
      />
      <span className="calib-inspect-field__unit">mm</span>
    </div>
  );

  if (testType === 'temperature-tower') return (
    <div className="calib-inspect-field">
      <span className="calib-inspect-field__label">Best temperature</span>
      <input
        className="calib-inspect-field__input"
        type="number" step={1} min={150} max={320} placeholder="e.g. 215"
        onChange={(e) => onManualMeasurement('value', Number(e.target.value))}
      />
      <span className="calib-inspect-field__unit">°C</span>
    </div>
  );

  if (testType === 'retraction') return (
    <div className="calib-inspect-field">
      <span className="calib-inspect-field__label">Best retraction distance</span>
      <input
        className="calib-inspect-field__input"
        type="number" step={0.1} min={0} placeholder="e.g. 1.0"
        onChange={(e) => onManualMeasurement('value', Number(e.target.value))}
      />
      <span className="calib-inspect-field__unit">mm</span>
    </div>
  );

  if (testType === 'input-shaper') return (
    <>
      <div className="calib-inspect-field">
        <span className="calib-inspect-field__label">Resonance freq X</span>
        <input
          className="calib-inspect-field__input"
          type="number" step={0.1} min={0} placeholder="e.g. 48.2"
          onChange={(e) => onManualMeasurement('freqX', Number(e.target.value))}
        />
        <span className="calib-inspect-field__unit">Hz</span>
      </div>
      <div className="calib-inspect-field">
        <span className="calib-inspect-field__label">Resonance freq Y</span>
        <input
          className="calib-inspect-field__input"
          type="number" step={0.1} min={0} placeholder="e.g. 44.6"
          onChange={(e) => onManualMeasurement('freqY', Number(e.target.value))}
        />
        <span className="calib-inspect-field__unit">Hz</span>
      </div>
    </>
  );

  if (testType === 'flow-rate') return (
    <div className="calib-inspect-field">
      <span className="calib-inspect-field__label">Flow multiplier</span>
      <input
        className="calib-inspect-field__input"
        type="number" step={1} min={50} max={150} placeholder="e.g. 96"
        onChange={(e) => onManualMeasurement('value', Number(e.target.value))}
      />
      <span className="calib-inspect-field__unit">%</span>
    </div>
  );

  // Generic fallback (e.g. dimensional-accuracy, max-volumetric-speed)
  return (
    <div className="calib-inspect-field calib-inspect-field--full">
      <span className="calib-inspect-field__label">Observations / notes</span>
      <textarea
        className="calib-inspect-field__textarea"
        placeholder="Describe what you observed…"
        onChange={(e) => onManualMeasurement('value', e.target.value.length)}
      />
    </div>
  );
}

export function StepInspect({
  testType,
  printerId,
  spoolId,
  frames,
  onFrames,
  onRecommendation,
  onManualMeasurement,
}: StepInspectProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthChecked, setHealthChecked] = useState<Record<string, boolean>>({});
  const [recommendation, setRecommendation] = useState<TuningTowerRecommendation | null>(null);
  const [paValue, setPaValue] = useState<number | null>(null);
  const tuningKind = tuningKindForTest(testType);
  const isFirmwareHealth = testType === 'firmware-health';
  const isPressureAdvance = testType === 'pressure-advance';
  const paContext = usePressureAdvanceContext();

  const aiProvider = useAiAssistantStore((s) => s.provider);
  const aiModel = useAiAssistantStore((s) => s.model);
  const aiApiKey = useAiAssistantStore((s) => s.apiKey);
  const setAiPanelOpen = useAiAssistantStore((s) => s.setPanelOpen);
  const providerReady = aiApiKey.trim().length > 0 && aiModel.trim().length > 0;
  const providerConfig: VisionProviderConfig = useMemo(
    () => ({ provider: aiProvider, model: aiModel, apiKey: aiApiKey }),
    [aiProvider, aiModel, aiApiKey],
  );

  // Reset state when the user moves between tests so a stale PA recommendation
  // never bleeds into, say, a retraction inspection.
  useEffect(() => {
    setRecommendation(null);
    setPaValue(null);
    setError(null);
  }, [testType]);

  const handleManualMeasurement = (key: string, value: number) => {
    if (key === 'value' && isPressureAdvance) {
      setPaValue(Number.isFinite(value) ? value : null);
    }
    onManualMeasurement(key, value);
  };

  const applyPaRecommendation = (rec: TuningTowerRecommendation) => {
    if (rec.bestValue === undefined || !Number.isFinite(rec.bestValue)) return;
    const rounded = Number(rec.bestValue.toFixed(4));
    setPaValue(rounded);
    onManualMeasurement('value', rounded);
  };

  const toggleHealth = (key: string, checked: boolean) => {
    setHealthChecked((prev) => ({ ...prev, [key]: checked }));
    onManualMeasurement(key, checked ? 1 : 0);
  };

  const runAnalysis = async () => {
    if (!tuningKind || frames.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const state = useVisionStore.getState();
      const contextFrames = state.recentFrames.slice(0, 25).map((r) => r.frame);
      const context: TuningTowerContext = {
        kind: tuningKind,
        printer: { printerId, printerName: printerId || 'Selected printer' },
        operatorNotes: [`spool:${spoolId || 'unknown'}`, `test:${testType}`, `contextFrames:${contextFrames.length}`],
      };
      if (isPressureAdvance && paContext) {
        context.startValue = paContext.startValue;
        context.stepPerMm = paContext.stepPerMm;
        context.towerHeightMm = paContext.endZ - paContext.startZ;
        context.operatorNotes?.push(
          `pa.range=${paContext.startValue}-${paContext.endValue}`,
          `pa.bands=${paContext.bandCount}`,
          `pa.stepSizeMm=${paContext.stepSize}`,
          `pa.zRange=${paContext.startZ}-${paContext.endZ}mm`,
        );
      }
      const input: AnalyzeTuningTowerInput = {
        frames,
        context,
        provider: providerConfig,
      };
      const result = await analyzeTuningTower(input);
      setRecommendation(result);
      onRecommendation(result);
      if (isPressureAdvance) applyPaRecommendation(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="calib-step">

      {/* ── Firmware health checklist ──────────────────────────────────────── */}
      {isFirmwareHealth && (
        <section className="calib-step__panel">
          <strong className="calib-inspect__section-title">Health checklist</strong>
          <p className="calib-step__muted">
            Print the firmware-health reference cube, then inspect it against each criterion below.
          </p>
          <div className="calib-inspect__checks">
            {HEALTH_CHECKS.map(({ key, label, detail }) => (
              <label key={key} className="calib-inspect__check-row">
                <input
                  type="checkbox"
                  className="calib-inspect__check-input"
                  checked={healthChecked[key] ?? false}
                  onChange={(e) => toggleHealth(key, e.target.checked)}
                />
                <div className="calib-inspect__check-text">
                  <span className="calib-inspect__check-label">{label}</span>
                  <span className="calib-step__muted">{detail}</span>
                </div>
              </label>
            ))}
          </div>
        </section>
      )}

      {/* ── Manual measurements ────────────────────────────────────────────── */}
      {!isFirmwareHealth && (
        <section className="calib-step__panel">
          <strong className="calib-inspect__section-title">Manual measurements</strong>
          <p className="calib-step__muted">
            {isPressureAdvance
              ? 'Measure the printed tower and enter the PA value of the best band, or let AI analysis fill it in.'
              : 'Measure your printed result and enter the best observed value.'}
          </p>
          <div className="calib-inspect__fields">
            <ManualFields
              testType={testType}
              paValue={isPressureAdvance ? paValue : undefined}
              onManualMeasurement={handleManualMeasurement}
            />
          </div>
        </section>
      )}

      {/* ── Pressure-advance photo guidance ────────────────────────────────── */}
      {isPressureAdvance && (
        <section className="calib-step__panel calib-inspect__pa-guidance">
          <strong className="calib-inspect__section-title">Photo tips for best AI analysis</strong>
          <p className="calib-step__muted">
            Frame the printed tower so every band is visible top-to-bottom.
            Even, diffuse light from the side reveals corner bulge and gaps clearly.
          </p>
          <ul className="calib-inspect__tips">
            <li>Side-on view, perpendicular to the corner being judged.</li>
            <li>Fill the frame with the tower — avoid wide shots with bed clutter.</li>
            <li>Diffuse lighting (a piece of paper over a desk lamp works well) — no harsh hotspots.</li>
            <li>Two photos help: one of each of the two opposing corners.</li>
          </ul>
          {paContext && (
            <div className="calib-inspect__pa-params">
              <span><strong>PA range:</strong> {paContext.startValue.toFixed(3)} → {paContext.endValue.toFixed(3)}</span>
              <span><strong>Bands:</strong> {paContext.bandCount} (every {paContext.stepSize} mm)</span>
              <span><strong>Z range:</strong> {paContext.startZ}–{paContext.endZ} mm</span>
            </div>
          )}
        </section>
      )}

      {/* ── Camera capture ─────────────────────────────────────────────────── */}
      <section className="calib-step__panel">
        <strong className="calib-inspect__section-title">
          {isFirmwareHealth ? 'Documentation photos (optional)' : 'Camera frames for AI analysis'}
        </strong>
        {!isFirmwareHealth && (
          <p className="calib-step__muted">
            Capture or upload clear photos of the print to enable AI-assisted analysis.
            {frames.length > 0 && <> &nbsp;<strong>{frames.length}</strong> frame(s) attached.</>}
          </p>
        )}
        {isFirmwareHealth && (
          <p className="calib-step__muted">
            Optionally attach photos of the reference cube for your records.
            {frames.length > 0 && <> &nbsp;<strong>{frames.length}</strong> photo(s) attached.</>}
          </p>
        )}
        <CalibrationCameraCapture printerId={printerId} onFramesCaptured={onFrames} />
      </section>

      {/* ── AI analysis ────────────────────────────────────────────────────── */}
      {!isFirmwareHealth && (
        <section className="calib-step__panel">
          <strong className="calib-inspect__section-title">AI analysis</strong>
          {tuningKind ? (
            <>
              <p className="calib-step__muted">
                {providerReady
                  ? 'Attach at least one camera frame above, then click Analyse to get an AI recommendation.'
                  : 'Set your AI provider API key in the AI Assistant panel to enable photo-based analysis.'}
              </p>
              <div className="calib-inspect__ai-actions">
                <button
                  type="button"
                  disabled={frames.length === 0 || loading || !providerReady}
                  onClick={() => void runAnalysis()}
                >
                  {loading ? 'Analysing…' : 'Analyse with AI'}
                </button>
                {!providerReady && (
                  <button
                    type="button"
                    className="calib-inspect__ai-config-btn"
                    onClick={() => setAiPanelOpen(true)}
                  >
                    Configure AI provider
                  </button>
                )}
              </div>
              {recommendation && (
                <RecommendationCard
                  recommendation={recommendation}
                  isPressureAdvance={isPressureAdvance}
                  onApply={() => applyPaRecommendation(recommendation)}
                />
              )}
            </>
          ) : (
            <p className="calib-step__muted">
              This calibration type uses manual measurement only — AI analysis is not available.
            </p>
          )}
          {error && <span className="calib-step__error">{error}</span>}
        </section>
      )}
    </div>
  );
}

// ── Inline AI recommendation card ────────────────────────────────────────────
function RecommendationCard({
  recommendation,
  isPressureAdvance,
  onApply,
}: {
  recommendation: TuningTowerRecommendation;
  isPressureAdvance: boolean;
  onApply: () => void;
}) {
  const confidencePct = Math.round(Math.min(1, Math.max(0, recommendation.confidence)) * 100);
  const hasValue = recommendation.bestValue !== undefined && Number.isFinite(recommendation.bestValue);
  const valueLabel = hasValue
    ? (isPressureAdvance ? recommendation.bestValue!.toFixed(4) : String(recommendation.bestValue))
    : 'manual review';
  return (
    <div className="calib-inspect__rec">
      <div className="calib-inspect__rec-head">
        <div className="calib-inspect__rec-value">
          <span className="calib-inspect__rec-label">Recommended</span>
          <span className="calib-inspect__rec-number">{valueLabel}</span>
        </div>
        <div className="calib-inspect__rec-confidence">
          <span className="calib-inspect__rec-label">Confidence</span>
          <div className="calib-inspect__rec-bar" aria-label={`Confidence ${confidencePct}%`}>
            <div className="calib-inspect__rec-bar-fill" style={{ width: `${confidencePct}%` }} />
          </div>
          <span className="calib-inspect__rec-pct">{confidencePct}%</span>
        </div>
      </div>
      {recommendation.summary && (
        <p className="calib-inspect__rec-summary">{recommendation.summary}</p>
      )}
      {recommendation.evidence.length > 0 && (
        <details className="calib-inspect__rec-details" open>
          <summary>Evidence ({recommendation.evidence.length})</summary>
          <ul>{recommendation.evidence.map((item, i) => <li key={`ev-${i}`}>{item}</li>)}</ul>
        </details>
      )}
      {recommendation.missingMeasurements && recommendation.missingMeasurements.length > 0 && (
        <details className="calib-inspect__rec-details calib-inspect__rec-details--warn">
          <summary>Missing measurements ({recommendation.missingMeasurements.length})</summary>
          <ul>{recommendation.missingMeasurements.map((item, i) => <li key={`mm-${i}`}>{item}</li>)}</ul>
        </details>
      )}
      {recommendation.suggestedActions.length > 0 && (
        <details className="calib-inspect__rec-details">
          <summary>Suggested actions ({recommendation.suggestedActions.length})</summary>
          <ul>{recommendation.suggestedActions.map((item, i) => <li key={`sa-${i}`}>{item}</li>)}</ul>
        </details>
      )}
      {isPressureAdvance && hasValue && (
        <button type="button" className="calib-inspect__rec-apply" onClick={onApply}>
          Use {recommendation.bestValue!.toFixed(4)} as best PA value
        </button>
      )}
    </div>
  );
}
