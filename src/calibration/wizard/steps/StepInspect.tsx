import { useCallback, useEffect, useState } from 'react';
import type { TuningTowerRecommendation } from '../../../services/vision/tuningWizards';
import type { VisionFrameSample } from '../../../services/vision/failureDetector';
import { useTestContext } from './inspect/useTestContext';
import { useTuningAnalysis } from './inspect/useTuningAnalysis';
import {
  isFirmwareHealthTest,
  isPressureAdvanceTest,
  isFirstLayerTest,
  isTemperatureTowerTest,
  isRetractionTest,
  isMaxVolSpeedTest,
} from './inspect/inspectHelpers';
import { HealthChecklist } from './inspect/HealthChecklist';
import { ManualFields } from './inspect/ManualFields';
import { PhotoGuidance } from './inspect/PhotoGuidance';
import { CameraCaptureSection } from './inspect/CameraCaptureSection';
import { AiAnalysisSection } from './inspect/AiAnalysisSection';

interface StepInspectProps {
  testType: string;
  printerId: string;
  spoolId: string;
  frames: VisionFrameSample[];
  onFrames: (frames: VisionFrameSample[]) => void;
  onRecommendation: (r: TuningTowerRecommendation) => void;
  onManualMeasurement: (key: string, value: number) => void;
}

/**
 * Thin composer for the calibration-wizard "Inspect" step. The real work lives
 * in `./inspect/*`:
 *   - `useTestContext`     — per-test data (tower params, pad layout, …)
 *   - `useTuningAnalysis`  — AI vision workflow
 *   - `HealthChecklist`    — firmware-health checklist
 *   - `ManualFields`       — per-test manual measurement inputs
 *   - `PhotoGuidance`      — per-test photo-tips panel
 *   - `CameraCaptureSection` — camera frames
 *   - `AiAnalysisSection`  — Analyse button + result card
 */
export function StepInspect({
  testType,
  printerId,
  spoolId,
  frames,
  onFrames,
  onRecommendation,
  onManualMeasurement,
}: StepInspectProps) {
  const testCtx = useTestContext(testType);
  const analysis = useTuningAnalysis();

  // Controlled values so the AI recommendation can populate the manual input.
  const [paValue, setPaValue] = useState<number | null>(null);
  const [firstLayerValue, setFirstLayerValue] = useState<number | null>(null);
  const [temperatureValue, setTemperatureValue] = useState<number | null>(null);
  const [retractionValue, setRetractionValue] = useState<number | null>(null);
  const [maxVolSpeedValue, setMaxVolSpeedValue] = useState<number | null>(null);

  const isFirmwareHealth = isFirmwareHealthTest(testType);
  const isPressureAdvance = isPressureAdvanceTest(testType);
  const isFirstLayer = isFirstLayerTest(testType);
  const isTemperature = isTemperatureTowerTest(testType);
  const isRetraction = isRetractionTest(testType);
  const isMaxVolSpeed = isMaxVolSpeedTest(testType);
  /** Any tower-style test whose recommendation auto-fills a numeric manual field. */
  const isAutoFillTest = isPressureAdvance || isFirstLayer || isTemperature || isRetraction || isMaxVolSpeed;

  // Reset on testType change so a stale recommendation / value never bleeds
  // into a different test.
  useEffect(() => {
    analysis.reset();
    setPaValue(null);
    setFirstLayerValue(null);
    setTemperatureValue(null);
    setRetractionValue(null);
    setMaxVolSpeedValue(null);
  }, [testType, analysis.reset]);

  const handleManualMeasurement = useCallback((key: string, value: number) => {
    if (key === 'value') {
      const v = Number.isFinite(value) ? value : null;
      if      (isPressureAdvance) setPaValue(v);
      else if (isFirstLayer)      setFirstLayerValue(v);
      else if (isTemperature)     setTemperatureValue(v);
      else if (isRetraction)      setRetractionValue(v);
      else if (isMaxVolSpeed)     setMaxVolSpeedValue(v);
    }
    onManualMeasurement(key, value);
  }, [isPressureAdvance, isFirstLayer, isTemperature, isRetraction, isMaxVolSpeed, onManualMeasurement]);

  const applyRecommendation = useCallback(() => {
    const rec = analysis.recommendation;
    if (!rec || rec.bestValue === undefined || !Number.isFinite(rec.bestValue)) return;
    if (isPressureAdvance) {
      const rounded = Number(rec.bestValue.toFixed(4));
      setPaValue(rounded);
      onManualMeasurement('value', rounded);
    } else if (isFirstLayer) {
      const rounded = Number(rec.bestValue.toFixed(3));
      setFirstLayerValue(rounded);
      onManualMeasurement('value', rounded);
    } else if (isTemperature) {
      const rounded = Math.round(rec.bestValue);
      setTemperatureValue(rounded);
      onManualMeasurement('value', rounded);
    } else if (isRetraction) {
      const rounded = Number(rec.bestValue.toFixed(1));
      setRetractionValue(rounded);
      onManualMeasurement('value', rounded);
    } else if (isMaxVolSpeed) {
      const rounded = Number(rec.bestValue.toFixed(1));
      setMaxVolSpeedValue(rounded);
      onManualMeasurement('value', rounded);
    }
  }, [analysis.recommendation, isPressureAdvance, isFirstLayer, isTemperature, isRetraction, isMaxVolSpeed, onManualMeasurement]);

  // Whenever a recommendation arrives, surface it through the wizard callback
  // and auto-fill the matching manual field.
  useEffect(() => {
    if (!analysis.recommendation) return;
    onRecommendation(analysis.recommendation);
    if (isAutoFillTest) applyRecommendation();
  }, [analysis.recommendation, isAutoFillTest, onRecommendation, applyRecommendation]);

  const handleAnalyse = useCallback(() => {
    void analysis.runAnalysis(frames, testCtx, printerId, spoolId);
  }, [analysis, frames, testCtx, printerId, spoolId]);

  // Per-test display formatting for the recommendation card.
  //   PA           — 4 decimals  (e.g. 0.0450)
  //   first-layer  — 3 decimals  (e.g. −0.050 mm)
  //   temperature  — integer °C  (e.g. 215)
  //   retraction   — 1 decimal mm (e.g. 1.0)
  //   max-vol-spd  — 1 decimal mm³/s (e.g. 11.5)
  const formatBestValue = (v: number): string => {
    if (isPressureAdvance) return v.toFixed(4);
    if (isFirstLayer)      return v.toFixed(3);
    if (isTemperature)     return `${Math.round(v)}`;
    if (isRetraction)      return v.toFixed(1);
    if (isMaxVolSpeed)     return v.toFixed(1);
    return String(v);
  };
  const valueLabel = isPressureAdvance ? 'best PA value'
                   : isFirstLayer      ? 'Z-offset delta'
                   : isTemperature     ? 'best temperature'
                   : isRetraction      ? 'best retraction distance'
                   : isMaxVolSpeed     ? 'max volumetric flow'
                   :                     'best value';

  return (
    <div className="calib-step">
      {isFirmwareHealth ? (
        <HealthChecklist onCheck={(key, checked) => onManualMeasurement(key, checked ? 1 : 0)} />
      ) : (
        <>
          <section className="calib-step__panel">
            <strong className="calib-inspect__section-title">Manual measurements</strong>
            <p className="calib-step__muted">
              {isPressureAdvance
                ? 'Measure the printed tower and enter the PA value of the best band, or let AI analysis fill it in.'
                : isFirstLayer
                ? 'Inspect the printed pads and enter the Z-offset delta, or let AI analysis fill it in.'
                : isTemperature
                ? 'Inspect each band on the printed tower and enter the temperature of the cleanest one, or let AI analysis fill it in.'
                : isRetraction
                ? 'Find the band with the cleanest travel (no strings) and enter its retraction distance, or let AI analysis fill it in.'
                : isMaxVolSpeed
                ? 'Find the Z height where the wall first goes rough and enter the maximum volumetric flow, or let AI analysis fill it in.'
                : 'Measure your printed result and enter the best observed value.'}
            </p>
            <div className="calib-inspect__fields">
              <ManualFields
                testType={testType}
                paValue={isPressureAdvance ? paValue : undefined}
                firstLayerValue={isFirstLayer ? firstLayerValue : undefined}
                temperatureValue={isTemperature ? temperatureValue : undefined}
                retractionValue={isRetraction ? retractionValue : undefined}
                maxVolSpeedValue={isMaxVolSpeed ? maxVolSpeedValue : undefined}
                onMeasurement={handleManualMeasurement}
              />
            </div>
          </section>

          <PhotoGuidance context={testCtx} />
        </>
      )}

      <CameraCaptureSection
        testType={testType}
        printerId={printerId}
        framesCount={frames.length}
        onFramesCaptured={onFrames}
      />

      {!isFirmwareHealth && (
        <AiAnalysisSection
          tuningKind={testCtx.kind}
          currentTestType={testType}
          providerReady={analysis.providerReady}
          framesCount={frames.length}
          loading={analysis.loading}
          error={analysis.error}
          recommendation={analysis.recommendation}
          formatBestValue={formatBestValue}
          valueLabel={valueLabel}
          onApplyRecommendation={isAutoFillTest ? applyRecommendation : undefined}
          onAnalyse={handleAnalyse}
          onConfigureProvider={() => analysis.setAiPanelOpen(true)}
        />
      )}
    </div>
  );
}
