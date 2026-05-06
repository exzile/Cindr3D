import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send, Play, Pause, X, Clapperboard,
  SkipBack, RotateCcw, Gauge, Scissors, Magnet, Download, Bot,
} from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { usePrinterStore } from '../../../../store/printerStore';
import { useAiAssistantStore } from '../../../../store/aiAssistantStore';
import { validatePlate } from '../../../../store/slicer/plateValidation';
import { formatSlicerLength, formatSlicerTime } from './format';
import './SlicerWorkspaceBottomBar.css';

const SIM_SPEEDS = [1, 2, 5, 10, 25, 50, 100];

export function SlicerWorkspaceBottomBar() {
  const sliceProgress = useSlicerStore((s) => s.sliceProgress);
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const previewMode = useSlicerStore((s) => s.previewMode);
  const previewLayer = useSlicerStore((s) => s.previewLayer);
  const startSlice = useSlicerStore((s) => s.startSlice);
  const cancelSlice = useSlicerStore((s) => s.cancelSlice);
  const sendToPrinter = useSlicerStore((s) => s.sendToPrinter);
  const activePrinter = useSlicerStore((s) => s.getActivePrinterProfile());
  const connected = usePrinterStore((s) => s.connected);
  const uploading = usePrinterStore((s) => s.uploading);
  const uploadProgress = usePrinterStore((s) => s.uploadProgress);
  const downloadGCode = useSlicerStore((s) => s.downloadGCode);
  const sectionEnabled = useSlicerStore((s) => s.previewSectionEnabled);
  const sectionZ = useSlicerStore((s) => s.previewSectionZ);
  const setSectionEnabled = useSlicerStore((s) => s.setPreviewSectionEnabled);
  const setSectionZ = useSlicerStore((s) => s.setPreviewSectionZ);
  const aiPanelOpen = useAiAssistantStore((s) => s.panelOpen);
  const toggleAiPanel = useAiAssistantStore((s) => s.togglePanel);

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
  const [sectionSnap, setSectionSnap] = useState(true);
  const sendResetTimerRef = useRef<number | null>(null);
  const scrubWasPlayingRef = useRef(false);

  const isSlicing = sliceProgress.stage === 'preparing'
    || sliceProgress.stage === 'slicing'
    || sliceProgress.stage === 'generating';
  const hasResult = sliceResult !== null;
  const totalPrintTime = sliceResult?.printTime ?? 0;

  // Validate the plate up front so we can both disable and explain the
  // Slice button. We re-derive on every render because the plate changes
  // are infrequent compared to other render triggers; computing this is
  // cheap (O(N²) overlap test on AABBs of ~1-10 plate objects).
  const buildVolume = activePrinter?.buildVolume ?? { x: 220, y: 220, z: 250 };
  const validation = validatePlate(plateObjects, buildVolume, { originCenter: activePrinter?.originCenter });
  const sliceDisabledReason: string | null = (() => {
    if (plateObjects.length === 0) return 'Add an object to the plate before slicing';
    if (validation.outOfBounds.length > 0) return `${validation.outOfBounds.length} object${validation.outOfBounds.length === 1 ? '' : 's'} outside build volume`;
    if (validation.overlapping.length > 0) return 'Objects overlap — move or auto-arrange before slicing';
    return null;
  })();

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

  const snapToLayerZ = useCallback((rawZ: number): number => {
    const layers = sliceResult?.layers;
    if (!layers || layers.length === 0) return rawZ;
    let lo = 0;
    let hi = layers.length - 1;
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
          type="button"
          className="slicer-bottom-bar__slice-btn"
          onClick={() => startSlice()}
          disabled={sliceDisabledReason !== null}
          title={sliceDisabledReason ?? 'Slice the plate'}
        >
          <Play size={16} /> Slice
        </button>
      ) : (
        <button type="button" className="slicer-bottom-bar__cancel-btn" onClick={() => cancelSlice()}>
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
          <span>Time: <span className="slicer-bottom-bar__stat-value">{formatSlicerTime(sliceResult.printTime)}</span></span>
          <span>Filament: <span className="slicer-bottom-bar__stat-value">{formatSlicerLength(sliceResult.filamentUsed)}</span></span>
          <span>Weight: <span className="slicer-bottom-bar__stat-value">{sliceResult.filamentWeight.toFixed(1)}g</span></span>
          <span>Cost: <span className="slicer-bottom-bar__stat-value">${sliceResult.filamentCost.toFixed(2)}</span></span>
          <span>Layers: <span className="slicer-bottom-bar__stat-value">{sliceResult.layerCount}</span></span>
        </div>
      )}

      {sliceProgress.stage === 'error' && (
        <div className="slicer-bottom-bar__error">
          {sliceProgress.message}
        </div>
      )}

      <div className="slicer-bottom-bar__spacer" />

      {previewMode === 'preview' && hasResult && !isSlicing && (
        <div className="slicer-bottom-bar__group slicer-bottom-bar__group--view" aria-label="Preview controls">
          <button
            type="button"
            className={`slicer-bottom-bar__sim-btn${simEnabled ? ' is-active' : ''}`}
            onClick={() => setSimEnabled(!simEnabled)}
            title="Toggle nozzle simulation"
          >
            <Clapperboard size={14} /> Simulate
          </button>
          <button
            type="button"
            className={`slicer-bottom-bar__btn${sectionEnabled ? ' is-active' : ''}`}
            title="Toggle section plane - clips everything above the slider Z"
            onClick={() => {
              if (!sectionEnabled && sliceResult) {
                const snap = sliceResult.layers[previewLayer]?.z ?? sectionZ;
                setSectionZ(snap);
              }
              setSectionEnabled(!sectionEnabled);
            }}
          >
            <Scissors size={14} /> Section
          </button>
        </div>
      )}

      {previewMode === 'preview' && hasResult && sectionEnabled && (
        <label className="slicer-bottom-bar__section" title="Section plane Z height">
          <button
            type="button"
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

      {previewMode === 'preview' && hasResult && simEnabled && (
        <div className="slicer-bottom-bar__sim-controls">
          <button
            type="button"
            className="slicer-bottom-bar__sim-ctrl"
            onClick={() => { resetSim(); }}
            title="Reset simulation (0:00)"
          >
            <SkipBack size={13} />
          </button>
          <button
            type="button"
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
                <option key={sp} value={sp}>{sp}x</option>
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
              onPointerDown={() => {
                scrubWasPlayingRef.current = simPlaying;
                if (simPlaying) setSimPlaying(false);
              }}
              onPointerUp={() => {
                if (scrubWasPlayingRef.current) setSimPlaying(true);
                scrubWasPlayingRef.current = false;
              }}
              onChange={(e) => setSimTime(Number(e.target.value))}
            />
          </div>
          <span className="slicer-bottom-bar__sim-time">
            {formatSlicerTime(simTime)} / {formatSlicerTime(totalPrintTime)}
          </span>
          {simTime >= totalPrintTime && totalPrintTime > 0 && (
            <button
              type="button"
              className="slicer-bottom-bar__sim-ctrl"
              onClick={() => { resetSim(); setSimPlaying(true); }}
              title="Restart simulation"
            >
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      )}

      {hasResult && !isSlicing && (
        <div className="slicer-bottom-bar__group slicer-bottom-bar__group--export" aria-label="Output controls">
          <button
            type="button"
            className="slicer-bottom-bar__btn"
            onClick={() => downloadGCode()}
            title="Export .gcode to file"
          >
            <Download size={14} /> Export
          </button>
          {connected && (
            <button
              type="button"
              className={`slicer-bottom-bar__btn slicer-bottom-bar__btn--accent${sending === 'sending' ? ' is-sending' : ''}${sending === 'sent' ? ' is-sent' : ''}${sending === 'error' ? ' is-error' : ''}`}
              onClick={handleSend}
              disabled={sending === 'sending' || uploading}
              title={sendError ?? undefined}
            >
              <Send size={14} />{' '}
              {(sending === 'sending' || uploading) ? `Uploading ${Math.round(uploadProgress)}%`
                : sending === 'sent' ? 'Sent'
                : sending === 'error' ? 'Send failed'
                : 'Send to Printer'}
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        className={`slicer-bottom-bar__btn slicer-bottom-bar__btn--ai${aiPanelOpen ? ' is-active' : ''}`}
        onClick={toggleAiPanel}
        title="Toggle AI Assistant"
      >
        <Bot size={14} /> AI
      </button>
    </div>
  );
}
