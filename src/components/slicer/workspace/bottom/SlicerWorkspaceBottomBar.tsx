import * as React from 'react';
import { Eye, EyeOff, Download, Send, Play, X } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { usePrinterStore } from '../../../../store/printerStore';
import { colors, sharedStyles } from '../../../../utils/theme';

const btnBase = sharedStyles.btnBase;
const btnAccent = sharedStyles.btnAccent;
const btnDanger = sharedStyles.btnDanger;

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
    <div style={{
      background: colors.panel,
      borderTop: `1px solid ${colors.panelBorder}`,
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minHeight: 48,
    }}>
      {!isSlicing ? (
        <button
          style={{
            ...btnAccent,
            padding: '8px 24px',
            fontSize: 14,
            fontWeight: 700,
            background: '#4466ff',
            borderColor: '#4466ff',
            opacity: plateObjects.length === 0 ? 0.5 : 1,
            cursor: plateObjects.length === 0 ? 'not-allowed' : 'pointer',
          }}
          onClick={() => startSlice()}
          disabled={plateObjects.length === 0}
        >
          <Play size={16} /> Slice
        </button>
      ) : (
        <button style={{ ...btnDanger, padding: '8px 16px', fontSize: 13 }} onClick={() => cancelSlice()}>
          <X size={14} /> Cancel
        </button>
      )}

      {isSlicing && (
        <div style={{ flex: 1, maxWidth: 300 }}>
          <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 2 }}>
            {sliceProgress.message} {sliceProgress.totalLayers > 0 && `(${sliceProgress.currentLayer}/${sliceProgress.totalLayers})`}
          </div>
          <div style={{ background: colors.bg, borderRadius: 4, height: 6, overflow: 'hidden' }}>
            <div style={{
              background: colors.accent,
              height: '100%',
              width: `${sliceProgress.percent}%`,
              borderRadius: 4,
              transition: 'width 0.2s',
            }} />
          </div>
        </div>
      )}

      {hasResult && !isSlicing && (
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: colors.textDim }}>
          <span>Time: <span style={{ color: colors.text }}>{formatTime(sliceResult!.printTime)}</span></span>
          <span>Filament: <span style={{ color: colors.text }}>{formatLength(sliceResult!.filamentUsed)}</span></span>
          <span>Weight: <span style={{ color: colors.text }}>{sliceResult!.filamentWeight.toFixed(1)}g</span></span>
          <span>Cost: <span style={{ color: colors.text }}>${sliceResult!.filamentCost.toFixed(2)}</span></span>
          <span>Layers: <span style={{ color: colors.text }}>{sliceResult!.layerCount}</span></span>
        </div>
      )}

      {sliceProgress.stage === 'error' && (
        <div style={{ color: colors.danger, fontSize: 12 }}>
          {sliceProgress.message}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {hasResult && (
        <button
          style={{
            ...btnBase,
            background: previewMode === 'preview' ? colors.accent : colors.panelLight,
            color: previewMode === 'preview' ? '#fff' : colors.text,
            borderColor: previewMode === 'preview' ? colors.accent : colors.panelBorder,
          }}
          onClick={() => setPreviewMode(previewMode === 'model' ? 'preview' : 'model')}
        >
          {previewMode === 'preview' ? <Eye size={14} /> : <EyeOff size={14} />}
          Preview
        </button>
      )}

      {previewMode === 'preview' && hasResult && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: colors.textDim }}>Layer:</span>
          <input
            type="range"
            min={0}
            max={previewLayerMax}
            value={previewLayer}
            onChange={(e) => setPreviewLayer(parseInt(e.target.value))}
            style={{ width: 120, accentColor: colors.accent }}
          />
          <span style={{ fontSize: 11, color: colors.text, minWidth: 40 }}>
            {previewLayer}/{previewLayerMax}
          </span>
        </div>
      )}

      {hasResult && (
        <>
          <button style={btnBase} onClick={() => downloadGCode()}>
            <Download size={14} /> Export G-code
          </button>
          {connected && (
            <button style={btnAccent} onClick={() => sendToPrinter()}>
              <Send size={14} /> Send to Printer
            </button>
          )}
        </>
      )}
    </div>
  );
}
