import { X } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import type { PreviewColorMode } from '../../../../types/slicer-preview.types';
import { MOVE_TYPE_COLORS, MOVE_TYPE_LABELS, Z_SEAM_COLOR } from '../preview/constants';
import './SlicerColorSchemePanel.css';

// Per-mode gradient bar backgrounds (inline style overrides the CSS default).
const GRADIENT_BARS: Partial<Record<PreviewColorMode, string>> = {
  speed:       'linear-gradient(to right, #2255cc, #cc2222)',
  flow:        'linear-gradient(to right, #22bb44, #cc2222)',
  width:       'linear-gradient(to right, #2255cc, #cc6600)',
  'layer-time':'linear-gradient(to right, #22bb44, #cc2222)',
};
const GRADIENT_LOW_LABEL: Partial<Record<PreviewColorMode, string>> = {
  speed: 'Slow', flow: 'Low', width: 'Thin', 'layer-time': 'Fast',
};
const GRADIENT_HIGH_LABEL: Partial<Record<PreviewColorMode, string>> = {
  speed: 'Fast', flow: 'High', width: 'Thick', 'layer-time': 'Slow',
};

const ALL_TYPES = Object.keys(MOVE_TYPE_LABELS) as (keyof typeof MOVE_TYPE_LABELS)[];

// Types grouped into the extrusion rows (travel + retractions are separate toggles)
const EXTRUSION_TYPES = ALL_TYPES.filter((t) => t !== 'travel');

export function SlicerColorSchemePanel() {
  const colorMode = useSlicerStore((s) => s.previewColorMode);
  const setColorMode = useSlicerStore((s) => s.setPreviewColorMode);
  const hiddenTypes = useSlicerStore((s) => s.previewHiddenTypes);
  const toggleType = useSlicerStore((s) => s.togglePreviewType);
  const renderMode = useSlicerStore((s) => s.previewRenderMode);
  const setRenderMode = useSlicerStore((s) => s.setPreviewRenderMode);
  const showTravel = useSlicerStore((s) => s.previewShowTravel);
  const setShowTravel = useSlicerStore((s) => s.setPreviewShowTravel);
  const showRetractions = useSlicerStore((s) => s.previewShowRetractions);
  const setShowRetractions = useSlicerStore((s) => s.setPreviewShowRetractions);
  const close = useSlicerStore((s) => s.setPreviewColorSchemeOpen);

  const hiddenSet = new Set(hiddenTypes);

  return (
    <div className="slicer-cs-panel">
      <div className="slicer-cs-panel__header">
        <span className="slicer-cs-panel__title">Color Scheme</span>
        <button className="slicer-cs-panel__close" onClick={() => close(false)} aria-label="Close">
          <X size={13} />
        </button>
      </div>

      <div className="slicer-cs-panel__mode-row">
        <span className="slicer-cs-panel__mode-label">Color by</span>
        <select
          className="slicer-cs-panel__mode-select"
          value={colorMode}
          onChange={(e) => setColorMode(e.target.value as PreviewColorMode)}
        >
          <option value="type">Line Type</option>
          <option value="speed">Speed</option>
          <option value="flow">Flow Rate</option>
          <option value="width">Line Width</option>
          <option value="layer-time">Layer Time</option>
          <option value="wall-quality">Wall Quality</option>
          <option value="seam">Seam</option>
        </select>
      </div>

      <div className="slicer-cs-panel__mode-row">
        <span className="slicer-cs-panel__mode-label">View</span>
        <select
          className="slicer-cs-panel__mode-select"
          value={renderMode}
          onChange={(e) => setRenderMode(e.target.value as 'solid' | 'wireframe')}
        >
          <option value="solid">Solid</option>
          <option value="wireframe">Wireframe</option>
        </select>
      </div>

      <div className="slicer-cs-panel__divider" />

      <div className="slicer-cs-panel__list">
        {colorMode === 'type' ? (
          <>
            {EXTRUSION_TYPES.map((type) => {
              const visible = !hiddenSet.has(type);
              return (
                <label key={type} className="slicer-cs-panel__row">
                  <input
                    type="checkbox"
                    className="slicer-cs-panel__check"
                    checked={visible}
                    onChange={() => toggleType(type)}
                  />
                  <span className="slicer-cs-panel__label">{MOVE_TYPE_LABELS[type]}</span>
                  <span
                    className="slicer-cs-panel__swatch"
                    style={{ background: MOVE_TYPE_COLORS[type] }}
                  />
                </label>
              );
            })}
          </>
        ) : colorMode === 'seam' ? (
          <div className="slicer-cs-panel__seam-legend">
            <div className="slicer-cs-panel__row slicer-cs-panel__row--static">
              <span className="slicer-cs-panel__label">Z Seam Starts</span>
              <span
                className="slicer-cs-panel__swatch slicer-cs-panel__swatch--seam"
                style={{ background: Z_SEAM_COLOR }}
              />
            </div>
          </div>
        ) : (
          <div className="slicer-cs-panel__gradient-legend">
            <div
              className="slicer-cs-panel__gradient-bar"
              style={{ background: GRADIENT_BARS[colorMode] ?? GRADIENT_BARS.speed }}
            />
            <div className="slicer-cs-panel__gradient-labels">
              <span>{GRADIENT_LOW_LABEL[colorMode] ?? 'Low'}</span>
              <span>{GRADIENT_HIGH_LABEL[colorMode] ?? 'High'}</span>
            </div>
          </div>
        )}

        <div className="slicer-cs-panel__divider" />

        <label className="slicer-cs-panel__row">
          <input
            type="checkbox"
            className="slicer-cs-panel__check"
            checked={showTravel}
            onChange={() => setShowTravel(!showTravel)}
          />
          <span className="slicer-cs-panel__label">Travel Moves</span>
          <span className="slicer-cs-panel__swatch slicer-cs-panel__swatch--travel" />
        </label>

        <label className="slicer-cs-panel__row">
          <input
            type="checkbox"
            className="slicer-cs-panel__check"
            checked={showRetractions}
            onChange={() => setShowRetractions(!showRetractions)}
          />
          <span className="slicer-cs-panel__label">Retractions</span>
          <span className="slicer-cs-panel__swatch slicer-cs-panel__swatch--retraction" />
        </label>
      </div>
    </div>
  );
}
