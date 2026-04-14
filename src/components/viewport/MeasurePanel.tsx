import { useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';

const PRECISION_OPTIONS = [
  { label: '0.123', digits: 3 },
  { label: '0.12', digits: 2 },
  { label: '0.1', digits: 1 },
  { label: '1', digits: 0 },
];

export default function MeasurePanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const measurePoints = useCADStore((s) => s.measurePoints);
  const clearMeasure = useCADStore((s) => s.clearMeasure);
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  const units = useCADStore((s) => s.units);

  const [precision, setPrecision] = useState(3);

  if (activeTool !== 'measure') return null;

  const fmt = (v: number) => v.toFixed(precision);

  const p1 = measurePoints[0] ?? null;
  const p2 = measurePoints[1] ?? null;

  const distance = p1 && p2
    ? Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2 + (p2.z - p1.z) ** 2)
    : null;

  const dx = p1 && p2 ? p2.x - p1.x : null;
  const dy = p1 && p2 ? p2.y - p1.y : null;
  const dz = p1 && p2 ? p2.z - p1.z : null;

  return (
    <div className="measure-panel">
      {/* Header */}
      <div className="sketch-palette-header">
        <span className="sketch-palette-dot" style={{ background: '#0af' }} />
        <span className="sketch-palette-title">MEASURE</span>
        <button
          className="sketch-palette-close"
          onClick={() => setActiveTool('select')}
          title="Close Measure"
        >
          <X size={12} />
        </button>
      </div>

      <div className="sketch-palette-body">
        {/* Precision */}
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Precision</span>
          <select
            className="measure-select"
            value={precision}
            onChange={(e) => setPrecision(Number(e.target.value))}
          >
            {PRECISION_OPTIONS.map((o) => (
              <option key={o.digits} value={o.digits}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Clear Selection */}
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Clear Selection</span>
          <button
            className="spl-btn"
            onClick={clearMeasure}
            title="Clear selected points"
          >
            <RotateCcw size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="sketch-palette-section-header">
          <span>&#9660; Results</span>
        </div>

        {distance !== null ? (
          <>
            <div className="measure-result-row">
              <span className="measure-result-label">Distance</span>
              <span className="measure-result-value">{fmt(distance)} {units}</span>
            </div>
            <div className="measure-result-row">
              <span className="measure-result-label">X Delta</span>
              <span className="measure-result-value">{fmt(dx!)} {units}</span>
            </div>
            <div className="measure-result-row">
              <span className="measure-result-label">Y Delta</span>
              <span className="measure-result-value">{fmt(dy!)} {units}</span>
            </div>
            <div className="measure-result-row">
              <span className="measure-result-label">Z Delta</span>
              <span className="measure-result-value">{fmt(dz!)} {units}</span>
            </div>
          </>
        ) : (
          <div className="measure-result-row" style={{ opacity: 0.5 }}>
            <span className="measure-result-label">
              {p1 ? 'Click second point' : 'Click first point to measure'}
            </span>
          </div>
        )}

        {/* Selection 1 */}
        <div className="sketch-palette-section-header">
          <span>&#9660; Selection 1</span>
        </div>
        {p1 ? (
          <>
            <div className="measure-result-row">
              <span className="measure-result-label">X Position</span>
              <span className="measure-result-value">{fmt(p1.x)} {units}</span>
            </div>
            <div className="measure-result-row">
              <span className="measure-result-label">Y Position</span>
              <span className="measure-result-value">{fmt(p1.y)} {units}</span>
            </div>
            <div className="measure-result-row">
              <span className="measure-result-label">Z Position</span>
              <span className="measure-result-value">{fmt(p1.z)} {units}</span>
            </div>
          </>
        ) : (
          <div className="measure-result-row" style={{ opacity: 0.5 }}>
            <span className="measure-result-label">No point selected</span>
          </div>
        )}

        {/* Selection 2 */}
        <div className="sketch-palette-section-header">
          <span>&#9660; Selection 2</span>
        </div>
        {p2 ? (
          <>
            <div className="measure-result-row">
              <span className="measure-result-label">X Position</span>
              <span className="measure-result-value">{fmt(p2.x)} {units}</span>
            </div>
            <div className="measure-result-row">
              <span className="measure-result-label">Y Position</span>
              <span className="measure-result-value">{fmt(p2.y)} {units}</span>
            </div>
            <div className="measure-result-row">
              <span className="measure-result-label">Z Position</span>
              <span className="measure-result-value">{fmt(p2.z)} {units}</span>
            </div>
          </>
        ) : (
          <div className="measure-result-row" style={{ opacity: 0.5 }}>
            <span className="measure-result-label">No point selected</span>
          </div>
        )}
      </div>
    </div>
  );
}
