import { useMemo, useState } from 'react';
import { useCalibrationStore, type CalibrationResult } from '../../../store/calibrationStore';
import { usePrinterStore } from '../../../store/printerStore';
import { useSlicerStore } from '../../../store/slicerStore';
import type { TuningTowerRecommendation } from '../../../services/vision/tuningWizards';
import type { PrinterProfile } from '../../../types/slicer';

type CalibrationItemId = 'bed-mesh' | 'pressure-advance' | 'input-shaper' | 'z-offset' | 'first-layer';

interface StepApplyResultProps {
  testType: string;
  printerId: string;
  recommendation: TuningTowerRecommendation | null;
  manualMeasurements: Record<string, number>;
  onDone: () => void;
}

function itemIdForTest(testType: string): CalibrationItemId {
  if (testType === 'pressure-advance') return 'pressure-advance';
  if (testType === 'first-layer') return 'first-layer';
  if (testType === 'input-shaper') return 'input-shaper';
  if (testType === 'bed-mesh') return 'bed-mesh';
  return 'z-offset';
}

function normalizeFirmware(value: string | undefined, fallback: PrinterProfile['gcodeFlavorType']): string {
  return value ?? fallback;
}

function buildCommandPreview(type: string, val: number | undefined, flavor: string): string[] {
  if (!val) return ['No value to apply'];
  if (type === 'pressure-advance') {
    if (flavor === 'klipper') return [`SET_PRESSURE_ADVANCE EXTRUDER=extruder ADVANCE=${val.toFixed(4)}`];
    if (flavor === 'marlin') return [`M900 K${val.toFixed(4)}`];
    return [`M572 D0 S${val.toFixed(4)}`];
  }
  return [`// Apply ${type} = ${val} - see Task D for firmware-specific commands`];
}

export function StepApplyResult({
  testType,
  printerId,
  recommendation,
  manualMeasurements,
  onDone,
}: StepApplyResultProps) {
  const [sendError, setSendError] = useState<string | null>(null);
  const printers = usePrinterStore((state) => state.printers);
  const sendGCode = usePrinterStore((state) => state.sendGCode);
  const activeProfile = useSlicerStore((state) => state.getActivePrinterProfile());
  const selectedPrinter = printers.find((printer) => printer.id === printerId);
  const value = recommendation?.bestValue ?? manualMeasurements.value;
  const firmware = normalizeFirmware(selectedPrinter?.config.boardType, activeProfile.gcodeFlavorType);
  const commandPreview = useMemo(() => buildCommandPreview(testType, value, firmware), [firmware, testType, value]);
  const measurementEntries = Object.entries(manualMeasurements);

  const saveResult = () => {
    const result: CalibrationResult = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Date.now().toString(),
      recordedAt: Date.now(),
      appliedValue: recommendation?.bestValue ?? manualMeasurements.value ?? null,
      measurements: manualMeasurements,
      photoIds: [],
      aiConfidence: recommendation?.confidence ?? null,
      note: recommendation?.summary ?? '',
    };
    useCalibrationStore.getState().addCalibrationResult(printerId, itemIdForTest(testType), result);
    onDone();
  };

  const sendPreviewCommands = async () => {
    setSendError(null);
    try {
      for (const command of commandPreview) {
        if (command.startsWith('//') || command === 'No value to apply') continue;
        await sendGCode(command);
      }
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="calib-step">
      <h3>Apply result</h3>
      {recommendation ? (
        <div className="calib-step__panel">
          <strong>Best value: {recommendation.bestValue ?? 'manual measurement'}</strong>
          <span>Confidence: {Math.round(recommendation.confidence * 100)}%</span>
          <p>{recommendation.summary}</p>
          {recommendation.evidence.length > 0 && (
            <ul>{recommendation.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
          )}
        </div>
      ) : (
        <div className="calib-step__panel">
          <strong>Manual measurements</strong>
          {measurementEntries.length > 0 ? (
            <ul>{measurementEntries.map(([key, measurement]) => <li key={key}>{key}: {measurement}</li>)}</ul>
          ) : (
            <span className="calib-step__muted">No manual measurements entered.</span>
          )}
        </div>
      )}
      <div className="calib-step__panel">
        <strong>Recommended value: {value ?? 'manual measurement'}</strong>
        <pre>{commandPreview.join('\n')}</pre>
        <button type="button" onClick={() => void sendPreviewCommands()}>
          Send preview commands
        </button>
        {sendError && <span className="calib-step__error">{sendError}</span>}
      </div>
      <button type="button" onClick={saveResult}>
        Save result
      </button>
    </div>
  );
}
