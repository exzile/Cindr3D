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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Unable to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function fallbackProvider(): VisionProviderConfig {
  return {
    provider: 'openai',
    model: '',
    apiKey: '',
  };
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
  const tuningKind = tuningKindForTest(testType);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const nextFrames = await Promise.all(Array.from(files).map(async (file): Promise<VisionFrameSample> => ({
      cameraId: 'manual-upload',
      cameraLabel: 'Manual upload',
      capturedAt: Date.now(),
      mimeType: file.type || 'image/jpeg',
      dataUrl: await readFileAsDataUrl(file),
      size: file.size,
    })));
    const store = useVisionStore.getState();
    for (const frame of nextFrames) {
      store.recordFrame({
        id: `${frame.cameraId}-${frame.capturedAt}-${Math.random().toString(36).slice(2, 7)}`,
        printerId,
        printerName: printerId || 'Selected printer',
        createdAt: frame.capturedAt,
        frame,
      });
    }
    onFrames([...frames, ...nextFrames]);
  };

  const runAnalysis = async () => {
    if (!tuningKind || frames.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const state = useVisionStore.getState();
      const contextFrames = state.recentFrames.slice(0, 25).map((record) => record.frame);
      const context: TuningTowerContext = {
        kind: tuningKind,
        printer: {
          printerId,
          printerName: printerId || 'Selected printer',
        },
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
      <section className="calib-step__panel">
        <h3>Attach camera frames for AI analysis</h3>
        <p>Camera capture panel (Task F) will appear here after merge.</p>
        <input type="file" accept="image/*" multiple onChange={(event) => void handleFiles(event.target.files)} />
        <span className="calib-step__muted">{frames.length} frame(s) attached</span>
      </section>

      <section className="calib-step__panel">
        <h3>Manual measurements</h3>
        {testType === 'pressure-advance' && (
          <label><span>Best PA value observed</span><input type="number" step={0.0001} onChange={(event) => onManualMeasurement('value', Number(event.target.value))} /></label>
        )}
        {testType === 'first-layer' && (
          <label><span>Z offset delta (mm)</span><input type="number" step={0.001} onChange={(event) => onManualMeasurement('value', Number(event.target.value))} /></label>
        )}
        {testType === 'temperature-tower' && (
          <label><span>Best temperature (C)</span><input type="number" step={1} onChange={(event) => onManualMeasurement('value', Number(event.target.value))} /></label>
        )}
        {testType === 'retraction' && (
          <label><span>Best retraction distance (mm)</span><input type="number" step={0.1} onChange={(event) => onManualMeasurement('value', Number(event.target.value))} /></label>
        )}
        {testType === 'input-shaper' && (
          <>
            <label><span>Frequency X (Hz)</span><input type="number" step={0.1} onChange={(event) => onManualMeasurement('freqX', Number(event.target.value))} /></label>
            <label><span>Frequency Y (Hz)</span><input type="number" step={0.1} onChange={(event) => onManualMeasurement('freqY', Number(event.target.value))} /></label>
          </>
        )}
        {!['pressure-advance', 'first-layer', 'temperature-tower', 'retraction', 'input-shaper'].includes(testType) && (
          <label>
            <span>Observations / measurements</span>
            <textarea onChange={(event) => onManualMeasurement('value', event.target.value.length)} />
          </label>
        )}
      </section>

      <section className="calib-step__panel">
        <h3>AI analysis</h3>
        <button type="button" disabled={frames.length === 0 || !tuningKind || loading} onClick={() => void runAnalysis()}>
          {loading ? 'Analysing...' : 'Analyse with AI'}
        </button>
        {!tuningKind && <span className="calib-step__muted">This calibration uses manual measurement only.</span>}
        {error && <span className="calib-step__error">{error}</span>}
      </section>
    </div>
  );
}
