import { Eye, EyeOff, Download, Send, Play, X } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { usePrinterStore } from '../../../../store/printerStore';
import './SlicerWorkspaceBottomBar.css';

export function SlicerWorkspaceBottomBar() {
  const sliceProgress = useSlicerStore((s) => s.sliceProgress);
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const previewMode = useSlicerStore((s) => s.previewMode);
  const previewLayer = useSlicerStore((s) => s.previewLayer);
  const previewLayerMax = useSlicerStore((s) => s.previewLayerMax);
  const startSlice = useSlicerStore((s) => s.startSlice);
  const cancelSlice = useSlicerStore((s) => s.cancelSlice);
  const setPreviewMode = useSlicerStore((s) => s.setPreviewMode);
  const setPreviewLayer = useSlicerStore((s) => s.setPreviewLayer);
  const downloadGCode = useSlicerStore((s) => s.downloadGCode);
  const sendToPrinter = useSlicerStore((s) => s.sendToPrinter);
  const connected = usePrinterStore((s) => s.connected);

  const isSlicing = sliceProgress.stage === 'preparing' || sliceProgress.stage === 'slicing' || sliceProgress.stage === 'generating';
  const hasResult = sliceResult !== null;

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const formatLength = (mm: number) => {
    if (mm > 1000) return `${(mm / 1000).toFixed(2)}m`;
    return `${mm.toFixed(0)}mm`;
  };

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

      {hasResult && (
        <button
          className={`slicer-bottom-bar__preview-btn${previewMode === 'preview' ? ' is-active' : ''}`}
          onClick={() => setPreviewMode(previewMode === 'model' ? 'preview' : 'model')}
        >
          {previewMode === 'preview' ? <Eye size={14} /> : <EyeOff size={14} />}
          Preview
        </button>
      )}

      {previewMode === 'preview' && hasResult && (
        <div className="slicer-bottom-bar__layer-slider">
          <span className="slicer-bottom-bar__layer-label">Layer:</span>
          <input
            type="range"
            min={0}
            max={previewLayerMax}
            value={previewLayer}
            onChange={(e) => setPreviewLayer(parseInt(e.target.value))}
            className="slicer-bottom-bar__layer-input"
          />
          <span className="slicer-bottom-bar__layer-count">
            {previewLayer}/{previewLayerMax}
          </span>
        </div>
      )}

      {hasResult && (
        <>
          <button className="slicer-bottom-bar__btn" onClick={() => downloadGCode()}>
            <Download size={14} /> Export G-code
          </button>
          {connected && (
            <button className="slicer-bottom-bar__btn slicer-bottom-bar__btn--accent" onClick={() => sendToPrinter()}>
              <Send size={14} /> Send to Printer
            </button>
          )}
        </>
      )}
    </div>
  );
}
