import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Eye, EyeOff, Download, Send, Play, Pause, X, Clapperboard,
  SkipBack, RotateCcw, Gauge, Palette, FlaskConical, Scissors,
  ChevronLeft, ChevronRight, Magnet,
} from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { usePrinterStore } from '../../../../store/printerStore';
import {
  generateFlowTowerGCode,
  generateRetractionTowerGCode,
  generateTemperatureTowerGCode,
} from '../../../../engine/calibration';
import './SlicerWorkspaceBottomBar.css';

const SIM_SPEEDS = [1, 2, 5, 10, 25, 50, 100];

export function SlicerWorkspaceBottomBar() {
  const sliceProgress = useSlicerStore((s) => s.sliceProgress);
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const previewMode = useSlicerStore((s) => s.previewMode);
  const previewLayer = useSlicerStore((s) => s.previewLayer);
  const previewLayerStart = useSlicerStore((s) => s.previewLayerStart);
  const previewLayerMax = useSlicerStore((s) => s.previewLayerMax);
  const startSlice = useSlicerStore((s) => s.startSlice);
  const cancelSlice = useSlicerStore((s) => s.cancelSlice);
  const setPreviewMode = useSlicerStore((s) => s.setPreviewMode);
  const setPreviewLayer = useSlicerStore((s) => s.setPreviewLayer);
  const setPreviewLayerStart = useSlicerStore((s) => s.setPreviewLayerStart);
  const setPreviewLayerRange = useSlicerStore((s) => s.setPreviewLayerRange);
  const downloadGCode = useSlicerStore((s) => s.downloadGCode);
  const sendToPrinter = useSlicerStore((s) => s.sendToPrinter);
  const activePrinter = useSlicerStore((s) => s.getActivePrinterProfile());
  const activeMaterial = useSlicerStore((s) => s.getActiveMaterialProfile());
  const activePrint = useSlicerStore((s) => s.getActivePrintProfile());
  const connected = usePrinterStore((s) => s.connected);
  const uploading = usePrinterStore((s) => s.uploading);
  const uploadProgress = usePrinterStore((s) => s.uploadProgress);
  const colorSchemeOpen = useSlicerStore((s) => s.previewColorSchemeOpen);
  const setColorSchemeOpen = useSlicerStore((s) => s.setPreviewColorSchemeOpen);
  const sectionEnabled = useSlicerStore((s) => s.previewSectionEnabled);
  const sectionZ = useSlicerStore((s) => s.previewSectionZ);
  const setSectionEnabled = useSlicerStore((s) => s.setPreviewSectionEnabled);
  const setSectionZ = useSlicerStore((s) => s.setPreviewSectionZ);

  // Simulation
  const simEnabled = useSlicerStore((s) => s.previewSimEnabled);
  const simPlaying = useSlicerStore((s) => s.previewSimPlaying);
  const simSpeed = useSlicerStore((s) => s.previewSimSpeed);
  const simTime = useSlicerStore((s) => s.previewSimTime);
  const setSimEnabled = useSlicerStore((s) => s.setPreviewSimEnabled);
  const setSimPlaying = useSlicerStore((s) => s.setPreviewSimPlaying);
  const setSimSpeed = useSlicerStore((s) => s.setPreviewSimSpeed);
  const setSimTime = useSlicerStore((s) => s.setPreviewSimTime);
  const resetSim = useSlicerStore((s) => s.resetPreviewSim);

  const [sending, setSending] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const [calibrationMenuOpen, setCalibrationMenuOpen] = useState(false);
  const [sectionSnap, setSectionSnap] = useState(true);
  const sendResetTimerRef = useRef<number | null>(null);
  const calibrationMenuRef = useRef<HTMLDivElement | null>(null);

  const isSlicing = sliceProgress.stage === 'preparing' || sliceProgress.stage === 'slicing' || sliceProgress.stage === 'generating';
  const hasResult = sliceResult !== null;
  const totalPrintTime = sliceResult?.printTime ?? 0;

  const handleSend = async () => {
    if (sendResetTimerRef.current !== null) {
      window.clearTimeout(sendResetTimerRef.current);
      sendResetTimerRef.current = null;
    }
    setSending('sending');
    setSendError(null);
    try {
      await sendToPrinter();
      setSending('sent');
      sendResetTimerRef.current = window.setTimeout(() => {
        sendResetTimerRef.current = null;
        setSending('idle');
      }, 2500);
    } catch (err) {
      setSending('error');
      setSendError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => () => {
    if (sendResetTimerRef.current !== null) {
      window.clearTimeout(sendResetTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!calibrationMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!calibrationMenuRef.current?.contains(event.target as Node)) {
        setCalibrationMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [calibrationMenuOpen]);

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const formatLength = (mm: number) => {
    if (mm > 1000) return `${(mm / 1000).toFixed(2)}m`;
    return `${mm.toFixed(0)}mm`;
  };

  const downloadCalibration = useCallback((filename: string, gcode: string) => {
    const blob = new Blob([gcode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setCalibrationMenuOpen(false);
  }, []);

  // Dual-range slider: two overlapping range inputs, store enforces clamping.
  const handleRangeMin = useCallback((v: number) => {
    if (v > previewLayer) setPreviewLayerRange(previewLayer, previewLayer);
    else setPreviewLayerStart(v);
  }, [previewLayer, setPreviewLayerStart, setPreviewLayerRange]);

  const handleRangeMax = useCallback((v: number) => {
    if (v < previewLayerStart) setPreviewLayerRange(previewLayerStart, previewLayerStart);
    else setPreviewLayer(v);
  }, [previewLayerStart, setPreviewLayer, setPreviewLayerRange]);

  // Percentage fill for the dual-range track.
  const rangeLo = previewLayerMax > 0 ? (previewLayerStart / previewLayerMax) * 100 : 0;
  const rangeHi = previewLayerMax > 0 ? (previewLayer / previewLayerMax) * 100 : 100;

  // Binary search: find the layer Z closest to rawZ among the sorted layer list.
  const snapToLayerZ = useCallback((rawZ: number): number => {
    const layers = sliceResult?.layers;
    if (!layers || layers.length === 0) return rawZ;
    let lo = 0, hi = layers.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (layers[mid].z <= rawZ) lo = mid;
      else hi = mid - 1;
    }
    const a = layers[lo];
    const b = layers[lo + 1];
    if (!b) return a.z;
    return Math.abs(a.z - rawZ) <= Math.abs(b.z - rawZ) ? a.z : b.z;
  }, [sliceResult]);

  return (
    <div className="slicer-bottom-bar">
      {!isSlicing ? (
        <button
          className="slicer-bottom-bar__slice-btn"
          onClick={() => startSlice()}
          disabled={plateObjects.length === 0}
        >
          <Play size={16} /> Slice
        </button>
      ) : (
        <button className="slicer-bottom-bar__cancel-btn" onClick={() => cancelSlice()}>
          <X size={14} /> Cancel
        </button>
      )}

      {isSlicing && (
        <div className="slicer-bottom-bar__progress">
          <div className="slicer-bottom-bar__progress-message">
            {sliceProgress.message} {sliceProgress.totalLayers > 0 && `(${sliceProgress.currentLayer}/${sliceProgress.totalLayers})`}
          </div>
          <div className="slicer-bottom-bar__progress-track">
            <div
              className="slicer-bottom-bar__progress-fill"
              style={{ width: `${sliceProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {hasResult && !isSlicing && (
        <div className="slicer-bottom-bar__stats">
          <span>Time: <span className="slicer-bottom-bar__stat-value">{formatTime(sliceResult!.printTime)}</span></span>
          <span>Filament: <span className="slicer-bottom-bar__stat-value">{formatLength(sliceResult!.filamentUsed)}</span></span>
          <span>Weight: <span className="slicer-bottom-bar__stat-value">{sliceResult!.filamentWeight.toFixed(1)}g</span></span>
          <span>Cost: <span className="slicer-bottom-bar__stat-value">${sliceResult!.filamentCost.toFixed(2)}</span></span>
          <span>Layers: <span className="slicer-bottom-bar__stat-value">{sliceResult!.layerCount}</span></span>
        </div>
      )}

      {sliceProgress.stage === 'error' && (
        <div className="slicer-bottom-bar__error">
          {sliceProgress.message}
        </div>
      )}

      <div className="slicer-bottom-bar__spacer" />

      <div className="slicer-bottom-bar__calibration" ref={calibrationMenuRef}>
        <button
          className={`slicer-bottom-bar__btn${calibrationMenuOpen ? ' is-active' : ''}`}
          onClick={() => setCalibrationMenuOpen((open) => !open)}
          title="Generate calibration G-code"
        >
          <FlaskConical size={14} /> Calibration
        </button>
        {calibrationMenuOpen && (
          <div className="slicer-bottom-bar__calibration-menu">
            <button
              className="slicer-bottom-bar__calibration-item"
              onClick={() => downloadCalibration(
                'calibration-retraction-tower.gcode',
                generateRetractionTowerGCode(activePrinter, activeMaterial, activePrint),
              )}
            >
              Retraction tower
            </button>
            <button
              className="slicer-bottom-bar__calibration-item"
              onClick={() => downloadCalibration(
                'calibration-temperature-tower.gcode',
                generateTemperatureTowerGCode(activePrinter, activeMaterial, activePrint),
              )}
            >
              Temperature tower
            </button>
            <button
              className="slicer-bottom-bar__calibration-item"
              onClick={() => downloadCalibration(
                'calibration-flow-tower.gcode',
                generateFlowTowerGCode(activePrinter, activeMaterial, activePrint),
              )}
            >
              Flow tower
            </button>
          </div>
        )}
      </div>

      {hasResult && (
        <button
          className={`slicer-bottom-bar__preview-btn${previewMode === 'preview' ? ' is-active' : ''}`}
          onClick={() => setPreviewMode(previewMode === 'model' ? 'preview' : 'model')}
          title="Toggle G-code layer preview"
        >
          {previewMode === 'preview' ? <Eye size={14} /> : <EyeOff size={14} />}
          Preview
        </button>
      )}

      {previewMode === 'preview' && hasResult && (
        <button
          className={`slicer-bottom-bar__preview-btn${colorSchemeOpen ? ' is-active' : ''}`}
          onClick={() => setColorSchemeOpen(!colorSchemeOpen)}
          title="Color scheme"
        >
          <Palette size={14} />
        </button>
      )}

      {previewMode === 'preview' && hasResult && (
        <button
          className={`slicer-bottom-bar__btn${sectionEnabled ? ' is-active' : ''}`}
          title="Toggle section plane — clips everything above the slider Z"
          onClick={() => {
            if (!sectionEnabled && sliceResult) {
              // Snap to the current layer Z so the user immediately sees a cut.
              const snap = sliceResult.layers[previewLayer]?.z ?? sectionZ;
              setSectionZ(snap);
            }
            setSectionEnabled(!sectionEnabled);
          }}
        >
          <Scissors size={14} /> Section
        </button>
      )}

      {previewMode === 'preview' && hasResult && sectionEnabled && (
        <label className="slicer-bottom-bar__section" title="Section plane Z height">
          <button
            className={`slicer-bottom-bar__section-snap${sectionSnap ? ' is-active' : ''}`}
            title={sectionSnap ? 'Snapping to layer boundaries (click to go continuous)' : 'Continuous Z (click to snap to layers)'}
            onClick={() => setSectionSnap((v) => !v)}
          >
            <Magnet size={12} />
          </button>
          <input
            type="range"
            min={0}
            max={activePrinter?.buildVolume?.z ?? 250}
            step={sectionSnap ? 0.01 : 0.5}
            value={sectionZ}
            onChange={(e) => {
              const raw = Number(e.target.value);
              setSectionZ(sectionSnap ? snapToLayerZ(raw) : raw);
            }}
          />
          <span className="slicer-bottom-bar__section-val">{sectionZ.toFixed(1)} mm</span>
        </label>
      )}

      {previewMode === 'preview' && hasResult && (
        <div
          className="slicer-bottom-bar__layer-slider slicer-bottom-bar__layer-slider--range"
          title="Drag handles to set start and end layer"
        >
          <span className="slicer-bottom-bar__layer-label">Layers:</span>
          <div
            className="slicer-bottom-bar__dualrange"
            style={{
              ['--lo' as string]: `${rangeLo}%`,
              ['--hi' as string]: `${rangeHi}%`,
            }}
          >
            <input
              type="range"
              min={0}
              max={previewLayerMax}
              value={previewLayerStart}
              onChange={(e) => handleRangeMin(parseInt(e.target.value))}
              aria-label="Start layer"
            />
            <input
              type="range"
              min={0}
              max={previewLayerMax}
              value={previewLayer}
              onChange={(e) => handleRangeMax(parseInt(e.target.value))}
              aria-label="End layer"
            />
          </div>
          <span className="slicer-bottom-bar__layer-count">
            {previewLayerStart}–{previewLayer}/{previewLayerMax}
          </span>
        </div>
      )}

      {/* Step-by-layer buttons — quick ±1 navigation without touching the slider */}
      {previewMode === 'preview' && hasResult && (
        <div className="slicer-bottom-bar__layer-step">
          <button
            className="slicer-bottom-bar__sim-ctrl"
            title="Previous layer (−1)"
            disabled={previewLayer <= previewLayerStart}
            onClick={() => setPreviewLayer(previewLayer - 1)}
          >
            <ChevronLeft size={13} />
          </button>
          <button
            className="slicer-bottom-bar__sim-ctrl"
            title="Next layer (+1)"
            disabled={previewLayer >= previewLayerMax}
            onClick={() => setPreviewLayer(previewLayer + 1)}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}

      {previewMode === 'preview' && hasResult && (
        <button
          className={`slicer-bottom-bar__sim-btn${simEnabled ? ' is-active' : ''}`}
          onClick={() => setSimEnabled(!simEnabled)}
          title="Toggle nozzle simulation"
        >
          <Clapperboard size={14} /> Simulate
        </button>
      )}

      {previewMode === 'preview' && hasResult && simEnabled && (
        <div className="slicer-bottom-bar__sim-controls">
          <button
            className="slicer-bottom-bar__sim-ctrl"
            onClick={() => { resetSim(); }}
            title="Reset simulation (0:00)"
          >
            <SkipBack size={13} />
          </button>
          <button
            className="slicer-bottom-bar__sim-ctrl is-primary"
            onClick={() => setSimPlaying(!simPlaying)}
            title={simPlaying ? 'Pause simulation' : 'Play simulation'}
          >
            {simPlaying ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <label className="slicer-bottom-bar__sim-speed" title="Playback speed multiplier">
            <Gauge size={12} />
            <select
              value={simSpeed}
              onChange={(e) => setSimSpeed(Number(e.target.value))}
            >
              {SIM_SPEEDS.map((sp) => (
                <option key={sp} value={sp}>{sp}×</option>
              ))}
            </select>
          </label>
          <div
            className="slicer-bottom-bar__sim-scrub"
            title="Drag to scrub through the print"
          >
            <input
              type="range"
              min={0}
              max={totalPrintTime > 0 ? totalPrintTime : 1}
              step={totalPrintTime > 0 ? totalPrintTime / 1000 : 0.001}
              value={Math.min(simTime, totalPrintTime || 0)}
              onChange={(e) => setSimTime(Number(e.target.value))}
            />
          </div>
          <span className="slicer-bottom-bar__sim-time">
            {formatTime(simTime)} / {formatTime(totalPrintTime)}
          </span>
          {simTime >= totalPrintTime && totalPrintTime > 0 && (
            <button
              className="slicer-bottom-bar__sim-ctrl"
              onClick={() => { resetSim(); setSimPlaying(true); }}
              title="Restart simulation"
            >
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      )}

      {hasResult && (
        <>
          <button className="slicer-bottom-bar__btn" onClick={() => downloadGCode()}>
            <Download size={14} /> Export G-code
          </button>
          {connected && (
            <button
              className={`slicer-bottom-bar__btn slicer-bottom-bar__btn--accent${sending === 'sending' ? ' is-sending' : ''}${sending === 'sent' ? ' is-sent' : ''}${sending === 'error' ? ' is-error' : ''}`}
              onClick={handleSend}
              disabled={sending === 'sending' || uploading}
              title={sendError ?? undefined}
            >
              <Send size={14} />{' '}
              {(sending === 'sending' || uploading) ? `Uploading ${Math.round(uploadProgress)}%`
                : sending === 'sent' ? 'Sent ✓'
                : sending === 'error' ? 'Send failed'
                : 'Send to Printer'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
