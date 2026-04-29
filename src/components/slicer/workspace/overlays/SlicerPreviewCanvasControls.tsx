import { useCallback } from 'react';
import { ChevronDown, ChevronUp, Palette } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import './SlicerPreviewCanvasControls.css';

export function SlicerPreviewCanvasControls() {
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const previewMode = useSlicerStore((s) => s.previewMode);
  const previewLayer = useSlicerStore((s) => s.previewLayer);
  const previewLayerStart = useSlicerStore((s) => s.previewLayerStart);
  const previewLayerMax = useSlicerStore((s) => s.previewLayerMax);
  const setPreviewLayer = useSlicerStore((s) => s.setPreviewLayer);
  const setPreviewLayerStart = useSlicerStore((s) => s.setPreviewLayerStart);
  const setPreviewLayerRange = useSlicerStore((s) => s.setPreviewLayerRange);
  const colorSchemeOpen = useSlicerStore((s) => s.previewColorSchemeOpen);
  const setColorSchemeOpen = useSlicerStore((s) => s.setPreviewColorSchemeOpen);

  const handleRangeMin = useCallback((v: number) => {
    if (v > previewLayer) setPreviewLayerRange(previewLayer, previewLayer);
    else setPreviewLayerStart(v);
  }, [previewLayer, setPreviewLayerRange, setPreviewLayerStart]);

  const handleRangeMax = useCallback((v: number) => {
    if (v < previewLayerStart) setPreviewLayerRange(previewLayerStart, previewLayerStart);
    else setPreviewLayer(v);
  }, [previewLayerStart, setPreviewLayer, setPreviewLayerRange]);

  if (previewMode !== 'preview' || !sliceResult) return null;

  const rangeLo = previewLayerMax > 0 ? (previewLayerStart / previewLayerMax) * 100 : 0;
  const rangeHi = previewLayerMax > 0 ? (previewLayer / previewLayerMax) * 100 : 100;

  return (
    <div className="slicer-preview-canvas-controls" aria-label="Preview layer controls">
      <button
        type="button"
        className={`slicer-preview-canvas-controls__palette${colorSchemeOpen ? ' is-active' : ''}`}
        onClick={() => setColorSchemeOpen(!colorSchemeOpen)}
        title="Color scheme"
        aria-label="Color scheme"
      >
        <Palette size={17} />
      </button>

      <div className="slicer-preview-layer-control" title="Drag handles to set visible layer range">
        <div className="slicer-preview-layer-control__label">Layers</div>
        <button
          type="button"
          className="slicer-preview-layer-control__step"
          title="Next layer"
          disabled={previewLayer >= previewLayerMax}
          onClick={() => setPreviewLayer(previewLayer + 1)}
        >
          <ChevronUp size={14} />
        </button>
        <div
          className="slicer-preview-layer-control__track"
          style={{
            ['--lo' as string]: `${rangeLo}%`,
            ['--hi' as string]: `${rangeHi}%`,
          }}
        >
          <span className="slicer-preview-layer-control__rail" />
          <span className="slicer-preview-layer-control__fill" />
          <span
            className="slicer-preview-layer-control__handle slicer-preview-layer-control__handle--start"
            aria-hidden="true"
          />
          <span
            className="slicer-preview-layer-control__handle slicer-preview-layer-control__handle--end"
            aria-hidden="true"
          />
          <input
            type="range"
            min={0}
            max={previewLayerMax}
            value={previewLayerStart}
            onChange={(e) => handleRangeMin(Number(e.target.value))}
            aria-label="Start layer"
          />
          <input
            type="range"
            min={0}
            max={previewLayerMax}
            value={previewLayer}
            onChange={(e) => handleRangeMax(Number(e.target.value))}
            aria-label="End layer"
          />
        </div>
        <button
          type="button"
          className="slicer-preview-layer-control__step"
          title="Previous layer"
          disabled={previewLayer <= previewLayerStart}
          onClick={() => setPreviewLayer(previewLayer - 1)}
        >
          <ChevronDown size={14} />
        </button>
        <div className="slicer-preview-layer-control__count">
          {previewLayerStart}-{previewLayer}
          <span>/{previewLayerMax}</span>
        </div>
      </div>
    </div>
  );
}
