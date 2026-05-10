import { useState } from 'react';
import {
  analyzeTuningTower,
  type AnalyzeTuningTowerInput,
  type TuningTowerRecommendation,
  type TuningWizardKind,
  type TuningTowerContext,
} from '../../../services/vision/tuningWizards';
import { useVisionStore } from '../../../store/visionStore';
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

function fallbackProvider(): VisionProviderConfig {
  return { provider: 'openai', model: '', apiKey: '' };
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
  onManualMeasurement,
}: {
  testType: string;
  onManualMeasurement: (key: string, value: number) => void;
}) {
  if (testType === 'pressure-advance') return (
    <div className="calib-inspect-field">
      <span className="calib-inspect-field__label">Best PA value</span>
      <input
        className="calib-inspect-field__input"
        type="number" step={0.0001} min={0} placeholder="e.g. 0.045"
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
  const tuningKind = tuningKindForTest(testType);
  const isFirmwareHealth = testType === 'firmware-health';

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
      const input: AnalyzeTuningTowerInput = {
        frames,
        context,
        provider: fallbackProvider(),
      };
      const result = await analyzeTuningTower(input);
      onRecommendation(result);
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
            Measure your printed result and enter the best observed value.
          </p>
          <div className="calib-inspect__fields">
            <ManualFields testType={testType} onManualMeasurement={onManualMeasurement} />
          </div>
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
                Attach at least one camera frame above, then click Analyse to get an AI recommendation.
              </p>
              <button
                type="button"
                disabled={frames.length === 0 || loading}
                onClick={() => void runAnalysis()}
              >
                {loading ? 'Analysing…' : 'Analyse with AI'}
              </button>
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
