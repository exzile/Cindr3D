import { useMemo, useState } from 'react';
import {
  useCalibrationStore,
  type CalibrationItemId,
  type CalibrationResult,
} from '../../../store/calibrationStore';
import { usePrinterStore } from '../../../store/printerStore';
import { useSlicerStore } from '../../../store/slicerStore';
import type { TuningTowerRecommendation } from '../../../services/vision/tuningWizards';
import type { PrinterProfile } from '../../../types/slicer';
import {
  buildConfigSnapshotInstructions,
  buildFlowRateCommands,
  buildInputShaperCommands,
  buildPressureAdvanceCommands,
  buildSaveConfigCommands,
  buildZOffsetCommands,
  getSaveConfigNote,
  isFirmwareApplySupported,
  type CalibrationApplyType,
  type FirmwareFlavor,
} from '../../firmwareApply';

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
  if (testType === 'firmware-health') return 'firmware-health';
  return 'z-offset';
}

function normalizeFirmware(value: string | undefined, fallback: PrinterProfile['gcodeFlavorType']): FirmwareFlavor {
  if (value === 'marlin' || value === 'klipper' || value === 'duet' || value === 'reprap') return value;
  return fallback;
}

function applyTypeForTest(testType: string): CalibrationApplyType | null {
  if (testType === 'pressure-advance') return 'pressure-advance';
  if (testType === 'input-shaper') return 'input-shaper';
  if (testType === 'first-layer') return 'z-offset';
  if (testType === 'flow-rate') return 'flow-rate';
  if (testType === 'bed-mesh') return 'bed-mesh';
  // firmware-health is a pass/fail health check — no firmware value to apply.
  return null;
}

function buildCommandPreview(
  type: string,
  val: number | undefined,
  flavor: FirmwareFlavor,
  manualMeasurements: Record<string, number>,
): string[] {
  const applyType = applyTypeForTest(type);
  if (!applyType) return [`// ${type} is saved as a measurement only.`];
  if (!isFirmwareApplySupported(flavor, applyType)) return [`// ${applyType} apply is not supported for ${flavor}.`];
  if (applyType === 'input-shaper') {
    const freqX = manualMeasurements.freqX;
    const freqY = manualMeasurements.freqY;
    if (freqX == null || freqY == null) return ['No value to apply'];
    return buildInputShaperCommands(flavor, freqX, freqY, 'mzv', 0.1, 0.1);
  }
  if (applyType === 'bed-mesh') return ['// Run bed mesh calibration from the firmware dashboard.'];
  if (val == null) return ['No value to apply'];
  if (applyType === 'pressure-advance') return buildPressureAdvanceCommands(flavor, val);
  if (applyType === 'z-offset') return buildZOffsetCommands(flavor, val);
  if (applyType === 'flow-rate') return buildFlowRateCommands(flavor, val);
  return ['No value to apply'];
}

export function StepApplyResult({
  testType,
  printerId,
  recommendation,
  manualMeasurements,
  onDone,
}: StepApplyResultProps) {
  const [sendError, setSendError] = useState<string | null>(null);
  const printers     = usePrinterStore((state) => state.printers);
  const sendGCode    = usePrinterStore((state) => state.sendGCode);
  const model        = usePrinterStore((state) => state.model);
  const activeProfile = useSlicerStore((state) => state.getActivePrinterProfile());
  const activeSession = useCalibrationStore((state) => state.activeWizardSessions[printerId]);
  const selectedPrinter = printers.find((printer) => printer.id === printerId);
  const value = recommendation?.bestValue ?? manualMeasurements.value;
  const firmware = normalizeFirmware(selectedPrinter?.config.boardType, activeProfile.gcodeFlavorType);

  // Live firmware version from the board object model (Duet/RRF only).
  type LiveBoard = { firmwareName?: string; firmwareVersion?: string };
  const liveBoard = ((model as { boards?: LiveBoard[] }).boards ?? [])[0] as LiveBoard | undefined;
  const liveFirmwareVersion = liveBoard?.firmwareVersion;
  const commandPreview = useMemo(
    () => buildCommandPreview(testType, value, firmware, manualMeasurements),
    [firmware, manualMeasurements, testType, value],
  );
  const saveConfigCommands = useMemo(() => buildSaveConfigCommands(firmware), [firmware]);
  const saveConfigNote = getSaveConfigNote(firmware);
  const measurementEntries = Object.entries(manualMeasurements);

  const saveResult = () => {
    const result: CalibrationResult = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Date.now().toString(),
      recordedAt: Date.now(),
      appliedValue: recommendation?.bestValue ?? manualMeasurements.value ?? manualMeasurements.freqX ?? null,
      measurements: manualMeasurements,
      photoIds: [],
      aiConfidence: recommendation?.confidence ?? null,
      note: recommendation?.summary ?? '',
      // Firmware snapshot — lets history show exactly what was running at calibration time.
      firmwareType: firmware,
      firmwareVersion: liveFirmwareVersion,
      // Spool context from the active wizard session.
      spoolId: activeSession?.spoolId || undefined,
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

  // Firmware health is pass/fail — no firmware command to apply.
  const isFirmwareHealth = testType === 'firmware-health';
  const healthChecks = isFirmwareHealth ? Object.entries(manualMeasurements) : [];
  const healthPassed = healthChecks.length > 0 && healthChecks.every(([, v]) => v === 1);

  return (
    <div className="calib-step">

      {isFirmwareHealth && (
        <div className="calib-step__panel">
          <strong>Firmware health summary</strong>
          {healthChecks.length === 0 ? (
            <span className="calib-step__muted">No checklist items recorded — go back to the Inspect step to fill them in.</span>
          ) : (
            <>
              <ul>
                {[
                  { key: 'motion',     label: 'Motion quality' },
                  { key: 'thermal',    label: 'Thermal stability' },
                  { key: 'extrusion',  label: 'Extrusion consistency' },
                  { key: 'firstLayer', label: 'First layer' },
                  { key: 'dims',       label: 'Dimensional accuracy' },
                ].map(({ key, label }) => {
                  const val = manualMeasurements[key];
                  if (val === undefined) return null;
                  return (
                    <li key={key}>
                      {val === 1 ? '✓' : '✗'} {label}
                    </li>
                  );
                })}
              </ul>
              <strong style={{ color: healthPassed ? '#22c55e' : '#f97316' }}>
                {healthPassed ? 'All checks passed — printer is healthy.' : 'Some checks failed — review the flagged items.'}
              </strong>
            </>
          )}
        </div>
      )}
      {!isFirmwareHealth && (recommendation ? (
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
      ))}
      {!isFirmwareHealth && (
        <div className="calib-step__panel">
          <strong>Recommended value: {value ?? 'manual measurement'}</strong>
          <pre>{commandPreview.join('\n')}</pre>
          <span className="calib-step__muted">{buildConfigSnapshotInstructions(firmware)}</span>
          {saveConfigCommands.length > 0 && <pre>{saveConfigCommands.join('\n')}</pre>}
          {saveConfigNote && <span className="calib-step__muted">{saveConfigNote}</span>}
          <button type="button" onClick={() => void sendPreviewCommands()}>
            Send preview commands
          </button>
          {sendError && <span className="calib-step__error">{sendError}</span>}
        </div>
      )}
      <button type="button" onClick={saveResult}>
        Save result
      </button>
    </div>
  );
}
