import { FileDown, Zap } from 'lucide-react';
import { downloadDXF } from '../../../../utils/dxfExport';
import type { SketchPaletteState } from './useSketchPaletteState';

interface SketchPaletteDisplaySectionProps {
  state: SketchPaletteState;
}

export function SketchPaletteDisplaySection({ state }: SketchPaletteDisplaySectionProps) {
  return (
    <>
      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Points</span>
        <label className="sketch-palette-check">
          <input
            type="checkbox"
            checked={state.showSketchPoints}
            onChange={() => state.setShowSketchPoints(!state.showSketchPoints)}
          />
          <span className="sketch-palette-checkmark" />
        </label>
      </div>

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Dimensions</span>
        <label className="sketch-palette-check">
          <input
            type="checkbox"
            checked={state.showSketchDimensions}
            onChange={() => state.setShowSketchDimensions(!state.showSketchDimensions)}
          />
          <span className="sketch-palette-checkmark" />
        </label>
      </div>

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Constraints</span>
        <label className="sketch-palette-check">
          <input
            type="checkbox"
            checked={state.showSketchConstraints}
            onChange={() => state.setShowSketchConstraints(!state.showSketchConstraints)}
          />
          <span className="sketch-palette-checkmark" />
        </label>
      </div>

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Projected Geom.</span>
        <label className="sketch-palette-check">
          <input
            type="checkbox"
            checked={state.showProjectedGeometries}
            onChange={() => state.setShowProjectedGeometries(!state.showProjectedGeometries)}
          />
          <span className="sketch-palette-checkmark" />
        </label>
      </div>

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">3D Sketch</span>
        <label className="sketch-palette-check">
          <input
            type="checkbox"
            checked={state.sketch3DMode}
            onChange={state.toggleSketch3DMode}
          />
          <span className="sketch-palette-checkmark" />
        </label>
      </div>

      {state.sketch3DMode && (
        <div className="sketch-palette-row sketch-palette-row--wrap">
          <span className="sketch-palette-label">Plane</span>
          <span
            className={`sketch-palette-plane-label${
              state.sketch3DActivePlane ? ' sketch-palette-plane-label--active' : ''
            }`}
          >
            {state.sketch3DActivePlane ? 'Custom Face' : state.activeSketch?.plane ?? 'XY'}
          </span>
          {state.sketch3DActivePlane && (
            <button
              className="spl-btn spl-btn--offset"
              title="Reset to sketch primary plane"
              onClick={() => state.setSketch3DActivePlane(null)}
            >
              ×
            </button>
          )}
        </div>
      )}

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Construction Geom.</span>
        <label className="sketch-palette-check">
          <input
            type="checkbox"
            checked={state.showConstructionGeometries}
            onChange={() => state.setShowConstructionGeometries(!state.showConstructionGeometries)}
          />
          <span className="sketch-palette-checkmark" />
        </label>
      </div>

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Defer Solve</span>
        <label className="sketch-palette-check">
          <input
            type="checkbox"
            checked={state.sketchComputeDeferred}
            onChange={() => state.setSketchComputeDeferred(!state.sketchComputeDeferred)}
          />
          <span className="sketch-palette-checkmark" />
        </label>
      </div>

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Solve</span>
        <button
          className="spl-btn"
          title="Run constraint solver on the active sketch"
          onClick={() => state.solveSketch()}
        >
          <Zap size={14} />
        </button>
      </div>

      <div className="sketch-palette-row">
        <span className="sketch-palette-label">Export</span>
        <button
          className="spl-btn"
          title="Export sketch as DXF (for laser cutting / CNC)"
          onClick={() => {
            if (state.activeSketch) downloadDXF(state.activeSketch);
          }}
        >
          <FileDown size={14} />
        </button>
      </div>

      <div className="sketch-palette-footer">
        <button className="sketch-palette-finish" onClick={state.finishSketch}>
          Finish Sketch
        </button>
      </div>
    </>
  );
}
