import { useState, useEffect, useRef, useCallback } from 'react';
import type { VisionFrameSample } from '../../services/vision/failureDetector';
import type { TuningTowerRecommendation } from '../../services/vision/tuningWizards';
import { usePrinterStore } from '../../store/printerStore';
import { useCalibrationStore } from '../../store/calibrationStore';
import { StepPickFilament } from './steps/StepPickFilament';
import { StepSetupCheck } from './steps/StepSetupCheck';
import { StepSlicePreview } from './steps/StepSlicePreview';
import { StepQueue } from './steps/StepQueue';
import { StepMonitor } from './steps/StepMonitor';
import { StepInspect } from './steps/StepInspect';
import { StepApplyResult } from './steps/StepApplyResult';
import './CalibrationWizard.css';

// ── Resize constants ────────────────────────────────────────────────────────
const PANEL_MIN_W = 420;
const PANEL_MIN_H = 440;
const PANEL_DEF_W = 800;
const PANEL_DEF_H = 780;

function clampVal(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export interface CalibrationWizardProps {
  testType: string;
  printerId?: string;
  sessionId?: string;
  onClose: () => void;
}

interface CalibrationWizardState {
  step: number;
  spoolId: string;
  filamentMaterial: string;
  frames: VisionFrameSample[];
  recommendation: TuningTowerRecommendation | null;
  manualMeasurements: Record<string, number>;
}

const TOTAL_STEPS = 7;

function stepTitle(step: number): string {
  switch (step) {
    case 1: return 'Pick filament';
    case 2: return 'Setup checks';
    case 3: return 'Load & slice';
    case 4: return 'Send to printer';
    case 5: return 'Monitor';
    case 6: return 'Inspect';
    case 7: return 'Apply result';
    default: return 'Calibration wizard';
  }
}

export function CalibrationWizard({ testType, printerId, sessionId, onClose }: CalibrationWizardProps) {
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const resolvedPrinterId = printerId ?? activePrinterId;

  const createWizardSession = useCalibrationStore((s) => s.createWizardSession);
  const updateWizardSessionById = useCalibrationStore((s) => s.updateWizardSessionById);
  const completeWizardSession = useCalibrationStore((s) => s.completeWizardSession);
  const deleteWizardSession = useCalibrationStore((s) => s.deleteWizardSession);
  const [resolvedSessionId, setResolvedSessionId] = useState(sessionId ?? '');

  // Lazy-init: resume from a saved session when provided.
  const [state, setState] = useState<CalibrationWizardState>(() => {
    const existing = sessionId
      ? useCalibrationStore.getState().wizardSessions.find((item) => item.id === sessionId)
      : null;
    const resume = existing?.testType === testType;
    return {
      step:             resume ? existing!.step    : 1,
      spoolId:          resume ? existing!.spoolId : '',
      filamentMaterial: resume ? (existing!.filamentMaterial ?? 'PLA') : 'PLA',
      frames: [],
      recommendation: null,
      manualMeasurements: {},
    };
  });

  // Register a session on mount if the caller did not create one first.
  useEffect(() => {
    if (!resolvedPrinterId) return;
    if (!resolvedSessionId) {
      const id = createWizardSession(resolvedPrinterId, testType, state.spoolId);
      setResolvedSessionId(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist step + filament selection whenever they change.
  useEffect(() => {
    if (!resolvedSessionId) return;
    updateWizardSessionById(resolvedSessionId, {
      step: state.step,
      spoolId: state.spoolId,
      filamentMaterial: state.filamentMaterial,
    });
  }, [state.step, state.spoolId, state.filamentMaterial, resolvedSessionId, updateWizardSessionById]);

  const updateState = (patch: Partial<CalibrationWizardState>) =>
    setState((current) => ({ ...current, ...patch }));

  const updateMeasurement = (key: string, value: number) => {
    if (!Number.isFinite(value)) return;
    setState((current) => ({
      ...current,
      manualMeasurements: { ...current.manualMeasurements, [key]: value },
    }));
  };

  // ── Panel resize ───────────────────────────────────────────────────────────
  const [panelSize, setPanelSize] = useState(() => ({
    w: Math.min(PANEL_DEF_W, window.innerWidth  - 32),
    h: Math.min(PANEL_DEF_H, window.innerHeight - 36),
  }));
  // Ref so the resize closure always reads the latest size without being
  // recreated on every render.
  const sizeRef = useRef(panelSize);
  useEffect(() => { sizeRef.current = panelSize; }, [panelSize]);

  const startResize = useCallback(
    (e: React.PointerEvent, dirX: number, dirY: number) => {
      e.preventDefault();
      e.stopPropagation();
      const ox = e.clientX;
      const oy = e.clientY;
      const ow = sizeRef.current.w;
      const oh = sizeRef.current.h;

      const onMove = (ev: PointerEvent) => {
        const maxW = clampVal(window.innerWidth  - 32, PANEL_MIN_W, 1600);
        const maxH = clampVal(window.innerHeight - 36, PANEL_MIN_H, 1200);
        const next = {
          w: dirX !== 0 ? clampVal(ow + (ev.clientX - ox) * dirX, PANEL_MIN_W, maxW) : ow,
          h: dirY !== 0 ? clampVal(oh + (ev.clientY - oy) * dirY, PANEL_MIN_H, maxH) : oh,
        };
        sizeRef.current = next;
        setPanelSize(next);
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup',   onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup',   onUp);
    },
    [],
  );

  const goBack = () => updateState({ step: Math.max(1, state.step - 1) });
  const goNext = () => updateState({ step: Math.min(TOTAL_STEPS, state.step + 1) });

  const handleCancel = () => {
    if (resolvedSessionId) deleteWizardSession(resolvedSessionId);
    onClose();
  };

  const handleFinish = () => {
    if (resolvedSessionId) completeWizardSession(resolvedSessionId);
    onClose();
  };

  /** Close without ending the session — user can resume from the calibration card. */
  const handleMinimize = () => {
    onClose();
  };

  const body = (() => {
    switch (state.step) {
      case 1:
        return (
          <StepPickFilament
            printerId={resolvedPrinterId}
            spoolId={state.spoolId}
            filamentMaterial={state.filamentMaterial}
            onChange={(update) => updateState(update)}
          />
        );
      case 2:
        return <StepSetupCheck printerId={resolvedPrinterId} testType={testType} />;
      case 3:
        return (
          <StepSlicePreview
            testType={testType}
            filamentMaterial={state.filamentMaterial}
          />
        );
      case 4:
        return <StepQueue testType={testType} printerId={resolvedPrinterId} />;
      case 5:
        return <StepMonitor onMinimize={handleMinimize} />;
      case 6:
        return (
          <StepInspect
            testType={testType}
            printerId={resolvedPrinterId}
            spoolId={state.spoolId}
            frames={state.frames}
            onFrames={(frames) => updateState({ frames })}
            onRecommendation={(recommendation) => updateState({ recommendation })}
            onManualMeasurement={updateMeasurement}
          />
        );
      case 7:
        return (
          <StepApplyResult
            testType={testType}
            printerId={resolvedPrinterId}
            recommendation={state.recommendation}
            manualMeasurements={state.manualMeasurements}
            onDone={handleFinish}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <div className="calib-wizard" role="dialog" aria-modal="true" aria-labelledby="calib-wizard-title">
      <div
        className="calib-wizard__panel"
        style={{ width: panelSize.w, height: panelSize.h, maxHeight: panelSize.h }}
      >
        {/* ── Resize handles (8 edges + corners) ──────────────────────────── */}
        <div className="calib-wizard__resize calib-wizard__resize--n"  onPointerDown={(e) => startResize(e,  0, -1)} />
        <div className="calib-wizard__resize calib-wizard__resize--s"  onPointerDown={(e) => startResize(e,  0,  1)} />
        <div className="calib-wizard__resize calib-wizard__resize--e"  onPointerDown={(e) => startResize(e,  1,  0)} />
        <div className="calib-wizard__resize calib-wizard__resize--w"  onPointerDown={(e) => startResize(e, -1,  0)} />
        <div className="calib-wizard__resize calib-wizard__resize--ne" onPointerDown={(e) => startResize(e,  1, -1)} />
        <div className="calib-wizard__resize calib-wizard__resize--se" onPointerDown={(e) => startResize(e,  1,  1)} />
        <div className="calib-wizard__resize calib-wizard__resize--sw" onPointerDown={(e) => startResize(e, -1,  1)} />
        <div className="calib-wizard__resize calib-wizard__resize--nw" onPointerDown={(e) => startResize(e, -1, -1)} />

        <header className="calib-wizard__header">
          {/* Animated step-progress bar along the header bottom edge */}
          <div
            className="calib-wizard__progress"
            style={{ width: `${(state.step / TOTAL_STEPS) * 100}%` }}
            aria-hidden="true"
          />
          <div>
            <h2 id="calib-wizard-title">{stepTitle(state.step)}</h2>
            <span className="calib-wizard__step-indicator">Step {state.step} of {TOTAL_STEPS}</span>
          </div>
          <div className="calib-wizard__header-actions">
            <button type="button" className="calib-wizard__minimize" onClick={handleMinimize} title="Minimize — resume from calibration cards">
              Minimize
            </button>
            <button type="button" className="calib-wizard__cancel" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </header>

        <div className="calib-wizard__body">
          {body}
        </div>

        <footer className="calib-wizard__footer">
          <span className="calib-wizard__step-indicator">{testType}</span>
          <div className="calib-wizard__actions">
            <button type="button" className="calib-wizard__back" disabled={state.step === 1} onClick={goBack}>
              Back
            </button>
            <button
              type="button"
              className="calib-wizard__next"
              onClick={state.step === TOTAL_STEPS ? handleFinish : goNext}
            >
              {state.step === TOTAL_STEPS ? 'Save & Close' : 'Next'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
