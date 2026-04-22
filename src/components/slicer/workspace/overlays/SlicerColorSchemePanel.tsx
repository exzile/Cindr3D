import { X } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { MOVE_TYPE_COLORS, MOVE_TYPE_LABELS } from '../preview/constants';
import './SlicerColorSchemePanel.css';

const ALL_TYPES = Object.keys(MOVE_TYPE_LABELS) as (keyof typeof MOVE_TYPE_LABELS)[];

// Types grouped into the extrusion rows (travel + retractions are separate toggles)
const EXTRUSION_TYPES = ALL_TYPES.filter((t) => t !== 'travel');

export function SlicerColorSchemePanel() {
  const colorMode = useSlicerStore((s) => s.previewColorMode);
  const setColorMode = useSlicerStore((s) => s.setPreviewColorMode);
  const hiddenTypes = useSlicerStore((s) => s.previewHiddenTypes);
  const toggleType = useSlicerStore((s) => s.togglePreviewType);
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
          onChange={(e) => setColorMode(e.target.value as 'type' | 'speed' | 'flow')}
        >
          <option value="type">Line Type</option>
          <option value="speed">Speed</option>
          <option value="flow">Flow Rate</option>
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
        ) : (
          <div className="slicer-cs-panel__gradient-legend">
            <div className="slicer-cs-panel__gradient-bar" />
            <div className="slicer-cs-panel__gradient-labels">
              <span>{colorMode === 'speed' ? 'Slow' : 'Low'}</span>
              <span>{colorMode === 'speed' ? 'Fast' : 'High'}</span>
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
