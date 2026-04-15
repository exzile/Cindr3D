/**
 * D197–D203 AnalysisPanel
 *
 * Floating panel for controlling the active analysis overlay.
 * Renders different controls depending on which analysis is active.
 * Shows when activeAnalysis !== null; Close button calls setActiveAnalysis(null).
 */
import { X } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';

const TITLES: Record<string, string> = {
  'zebra': 'ZEBRA ANALYSIS',
  'draft': 'DRAFT ANALYSIS',
  'curvature-map': 'CURVATURE MAP',
  'isocurve': 'ISOCURVE ANALYSIS',
  'accessibility': 'ACCESSIBILITY',
  'min-radius': 'MINIMUM RADIUS',
  'curvature-comb': 'CURVATURE COMB',
};

const DOT_COLORS: Record<string, string> = {
  'zebra': '#e5e5e5',
  'draft': '#f59e0b',
  'curvature-map': '#10b981',
  'isocurve': '#6366f1',
  'accessibility': '#22c55e',
  'min-radius': '#ef4444',
  'curvature-comb': '#3b82f6',
};

export default function AnalysisPanel() {
  const activeAnalysis = useCADStore((s) => s.activeAnalysis);
  const analysisParams = useCADStore((s) => s.analysisParams);
  const setActiveAnalysis = useCADStore((s) => s.setActiveAnalysis);
  const setAnalysisParams = useCADStore((s) => s.setAnalysisParams);

  if (!activeAnalysis) return null;

  const title = TITLES[activeAnalysis] ?? 'ANALYSIS';
  const dotColor = DOT_COLORS[activeAnalysis] ?? '#888';

  return (
    <div className="extrude-panel">
      <div className="sketch-palette-header">
        <span className="sketch-palette-dot" style={{ background: dotColor }} />
        <span className="sketch-palette-title">{title}</span>
        <button
          className="sketch-palette-close"
          onClick={() => setActiveAnalysis(null)}
          title="Close"
        >
          <X size={12} />
        </button>
      </div>

      <div className="sketch-palette-body">

        {/* ── Zebra ──────────────────────────────────────────────── */}
        {activeAnalysis === 'zebra' && (
          <>
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">Direction</span>
              <select
                className="measure-select"
                value={analysisParams.direction}
                onChange={(e) => setAnalysisParams({ direction: e.target.value as 'x' | 'y' | 'z' })}
              >
                <option value="x">X Axis</option>
                <option value="y">Y Axis</option>
                <option value="z">Z Axis</option>
              </select>
            </div>
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">Frequency</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={analysisParams.frequency}
                  style={{ flex: 1 }}
                  onChange={(e) => setAnalysisParams({ frequency: Number(e.target.value) })}
                />
                <span style={{ minWidth: 24, textAlign: 'right', fontSize: 11 }}>{analysisParams.frequency}</span>
              </div>
            </div>
          </>
        )}

        {/* ── Draft ──────────────────────────────────────────────── */}
        {activeAnalysis === 'draft' && (
          <>
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">Pull Dir</span>
              <select
                className="measure-select"
                value={analysisParams.direction}
                onChange={(e) => setAnalysisParams({ direction: e.target.value as 'x' | 'y' | 'z' })}
              >
                <option value="x">X Axis</option>
                <option value="y">Y Axis</option>
                <option value="z">Z Axis</option>
              </select>
            </div>
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">Min Angle</span>
              <div className="extrude-input">
                <input
                  type="number"
                  step={1}
                  min={0}
                  max={89}
                  value={analysisParams.minAngle}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) setAnalysisParams({ minAngle: Math.max(0, Math.min(89, v)) });
                  }}
                />
                <span className="extrude-unit">°</span>
              </div>
            </div>
          </>
        )}

        {/* ── Curvature Map ──────────────────────────────────────── */}
        {activeAnalysis === 'curvature-map' && (
          <div className="sketch-palette-row">
            <span className="sketch-palette-label" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Blue = flat &nbsp;→&nbsp; Red = high curvature
            </span>
          </div>
        )}

        {/* ── Isocurve ───────────────────────────────────────────── */}
        {activeAnalysis === 'isocurve' && (
          <>
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">U Count</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={analysisParams.uCount}
                  style={{ flex: 1 }}
                  onChange={(e) => setAnalysisParams({ uCount: Number(e.target.value) })}
                />
                <span style={{ minWidth: 24, textAlign: 'right', fontSize: 11 }}>{analysisParams.uCount}</span>
              </div>
            </div>
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">V Count</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={analysisParams.vCount}
                  style={{ flex: 1 }}
                  onChange={(e) => setAnalysisParams({ vCount: Number(e.target.value) })}
                />
                <span style={{ minWidth: 24, textAlign: 'right', fontSize: 11 }}>{analysisParams.vCount}</span>
              </div>
            </div>
          </>
        )}

        {/* ── Accessibility ──────────────────────────────────────── */}
        {activeAnalysis === 'accessibility' && (
          <>
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">Direction</span>
              <select
                className="measure-select"
                value={analysisParams.direction}
                onChange={(e) => setAnalysisParams({ direction: e.target.value as 'x' | 'y' | 'z' })}
              >
                <option value="x">X Axis</option>
                <option value="y">Y Axis</option>
                <option value="z">Z Axis</option>
              </select>
            </div>
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">Threshold</span>
              <div className="extrude-input">
                <input
                  type="number"
                  step={1}
                  min={0}
                  max={89}
                  value={analysisParams.minAngle}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) setAnalysisParams({ minAngle: Math.max(0, Math.min(89, v)) });
                  }}
                />
                <span className="extrude-unit">°</span>
              </div>
            </div>
          </>
        )}

        {/* ── Minimum Radius ─────────────────────────────────────── */}
        {activeAnalysis === 'min-radius' && (
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Min Radius</span>
            <div className="extrude-input">
              <input
                type="number"
                step={0.1}
                min={0.01}
                value={analysisParams.minRadius}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v) && v > 0) setAnalysisParams({ minRadius: v });
                }}
              />
              <span className="extrude-unit">mm</span>
            </div>
          </div>
        )}

        {/* ── Curvature Comb ─────────────────────────────────────── */}
        {activeAnalysis === 'curvature-comb' && (
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Scale</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
              <input
                type="range"
                min={0.1}
                max={10}
                step={0.1}
                value={analysisParams.combScale}
                style={{ flex: 1 }}
                onChange={(e) => setAnalysisParams({ combScale: Number(e.target.value) })}
              />
              <span style={{ minWidth: 32, textAlign: 'right', fontSize: 11 }}>{analysisParams.combScale.toFixed(1)}</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
