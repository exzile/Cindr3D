import { useState } from 'react';
import type { VisionFrameSample } from '../../services/vision/failureDetector';
import type { TuningTowerRecommendation } from '../../services/vision/tuningWizards';
import { usePrinterStore } from '../../store/printerStore';
import { StepPickPrinter } from './steps/StepPickPrinter';
import { StepPickFilament } from './steps/StepPickFilament';
import { StepSetupCheck } from './steps/StepSetupCheck';
import { StepLoadModel } from './steps/StepLoadModel';
import { StepSlicePreview } from './steps/StepSlicePreview';
import { StepQueue } from './steps/StepQueue';
import { StepMonitor } from './steps/StepMonitor';
import { StepInspect } from './steps/StepInspect';
import { StepApplyResult } from './steps/StepApplyResult';
import './CalibrationWizard.css';

export interface CalibrationWizardProps {
  testType: string;
  printerId?: string;
  onClose: () => void;
}

interface CalibrationWizardState {
  step: number;
  printerIdsel: string;
  spoolId: string;
  frames: VisionFrameSample[];
  recommendation: TuningTowerRecommendation | null;
  manualMeasurements: Record<string, number>;
}

const TOTAL_STEPS = 9;

function stepTitle(step: number): string {
  switch (step) {
    case 1: return 'Pick printer';
    case 2: return 'Pick filament';
    case 3: return 'Setup checks';
    case 4: return 'Load model';
    case 5: return 'Slice preview';
    case 6: return 'Queue';
    case 7: return 'Monitor';
    case 8: return 'Inspect';
    case 9: return 'Apply result';
    default: return 'Calibration wizard';
  }
}

export function CalibrationWizard({ testType, printerId, onClose }: CalibrationWizardProps) {
  const activePrinterId = usePrinterStore((state) => state.activePrinterId);
  const [state, setState] = useState<CalibrationWizardState>({
    step: 1,
    printerIdsel: printerId ?? activePrinterId,
    spoolId: '',
    frames: [],
    recommendation: null,
    manualMeasurements: {},
  });

  const updateState = (patch: Partial<CalibrationWizardState>) => {
    setState((current) => ({ ...current, ...patch }));
  };

  const updateMeasurement = (key: string, value: number) => {
    if (!Number.isFinite(value)) return;
    setState((current) => ({
      ...current,
      manualMeasurements: {
        ...current.manualMeasurements,
        [key]: value,
      },
    }));
  };

  const goBack = () => updateState({ step: Math.max(1, state.step - 1) });
  const goNext = () => updateState({ step: Math.min(TOTAL_STEPS, state.step + 1) });

  const body = (() => {
    switch (state.step) {
      case 1:
        return <StepPickPrinter selectedId={state.printerIdsel} onChange={(id) => updateState({ printerIdsel: id })} />;
      case 2:
        return <StepPickFilament printerId={state.printerIdsel} spoolId={state.spoolId} onChange={(spoolId) => updateState({ spoolId })} />;
      case 3:
        return <StepSetupCheck printerId={state.printerIdsel} testType={testType} />;
      case 4:
        return <StepLoadModel testType={testType} />;
      case 5:
        return <StepSlicePreview />;
      case 6:
        return <StepQueue />;
      case 7:
        return <StepMonitor onClose={onClose} />;
      case 8:
        return (
          <StepInspect
            testType={testType}
            printerId={state.printerIdsel}
            spoolId={state.spoolId}
            frames={state.frames}
            onFrames={(frames) => updateState({ frames })}
            onRecommendation={(recommendation) => updateState({ recommendation })}
            onManualMeasurement={updateMeasurement}
          />
        );
      case 9:
        return (
          <StepApplyResult
            testType={testType}
            printerId={state.printerIdsel}
            recommendation={state.recommendation}
            manualMeasurements={state.manualMeasurements}
            onDone={onClose}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <div className="calib-wizard" role="dialog" aria-modal="true" aria-labelledby="calib-wizard-title">
      <div className="calib-wizard__panel">
        <header className="calib-wizard__header">
          <div>
            <h2 id="calib-wizard-title">{stepTitle(state.step)}</h2>
            <span className="calib-wizard__step-indicator">Step {state.step} of {TOTAL_STEPS}</span>
          </div>
          <button type="button" className="calib-wizard__cancel" onClick={onClose}>
            Cancel
          </button>
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
            <button type="button" className="calib-wizard__next" onClick={state.step === TOTAL_STEPS ? onClose : goNext}>
              {state.step === TOTAL_STEPS ? 'Finish' : 'Next'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
