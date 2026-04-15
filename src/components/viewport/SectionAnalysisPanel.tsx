import { X } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';

/**
 * D38 Section Analysis panel — floating panel that lets the user control
 * a clip plane (axis + offset + flip) to see inside solid bodies.
 * Rendered always-mounted; hidden when sectionEnabled is false.
 */
export default function SectionAnalysisPanel() {
  const sectionEnabled = useCADStore((s) => s.sectionEnabled);
  const sectionAxis = useCADStore((s) => s.sectionAxis);
  const sectionOffset = useCADStore((s) => s.sectionOffset);
  const sectionFlip = useCADStore((s) => s.sectionFlip);
  const setSectionEnabled = useCADStore((s) => s.setSectionEnabled);
  const setSectionAxis = useCADStore((s) => s.setSectionAxis);
  const setSectionOffset = useCADStore((s) => s.setSectionOffset);
  const setSectionFlip = useCADStore((s) => s.setSectionFlip);
  const units = useCADStore((s) => s.units);

  if (!sectionEnabled) return null;

  return (
    <div className="extrude-panel">
      <div className="sketch-palette-header">
        <span className="sketch-palette-dot" style={{ background: '#8b5cf6' }} />
        <span className="sketch-palette-title">SECTION ANALYSIS</span>
        <button
          className="sketch-palette-close"
          onClick={() => setSectionEnabled(false)}
          title="Close"
        >
          <X size={12} />
        </button>
      </div>

      <div className="sketch-palette-body">
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Axis</span>
          <select
            className="measure-select"
            value={sectionAxis}
            onChange={(e) => setSectionAxis(e.target.value as 'x' | 'y' | 'z')}
          >
            <option value="x">X Axis</option>
            <option value="y">Y Axis</option>
            <option value="z">Z Axis</option>
          </select>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Offset</span>
          <div className="extrude-input">
            <input
              type="number"
              step="1"
              value={sectionOffset}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) setSectionOffset(v);
              }}
            />
            <span className="extrude-unit">{units}</span>
          </div>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Flip</span>
          <label className="sketch-palette-check">
            <input
              type="checkbox"
              checked={sectionFlip}
              onChange={(e) => setSectionFlip(e.target.checked)}
            />
            <span className="sketch-palette-checkmark" />
          </label>
        </div>
      </div>
    </div>
  );
}
