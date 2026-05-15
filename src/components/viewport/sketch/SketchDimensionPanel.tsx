import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { DimensionToolType } from '../../../types/cad';
import './SketchPalette.css';

export default function SketchDimensionPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const activeDimensionType = useCADStore((s) => s.activeDimensionType);
  const setActiveDimensionType = useCADStore((s) => s.setActiveDimensionType);
  const dimensionOffset = useCADStore((s) => s.dimensionOffset);
  const setDimensionOffset = useCADStore((s) => s.setDimensionOffset);
  const dimensionDrivenMode = useCADStore((s) => s.dimensionDrivenMode);
  const setDimensionDrivenMode = useCADStore((s) => s.setDimensionDrivenMode);
  const dimensionOrientation = useCADStore((s) => s.dimensionOrientation);
  const setDimensionOrientation = useCADStore((s) => s.setDimensionOrientation);
  const cancelDimensionTool = useCADStore((s) => s.cancelDimensionTool);
  const dimensionToleranceMode = useCADStore((s) => s.dimensionToleranceMode);
  const setDimensionToleranceMode = useCADStore((s) => s.setDimensionToleranceMode);
  const dimensionToleranceUpper = useCADStore((s) => s.dimensionToleranceUpper);
  const setDimensionToleranceUpper = useCADStore((s) => s.setDimensionToleranceUpper);
  const dimensionToleranceLower = useCADStore((s) => s.dimensionToleranceLower);
  const setDimensionToleranceLower = useCADStore((s) => s.setDimensionToleranceLower);

  if (activeTool !== 'dimension') return null;

  const hints: Record<string, string> = {
    auto: 'Click an entity — type is inferred (Fusion-style)',
    linear: 'Click two points or one line',
    angular: 'Click two lines sharing a vertex',
    radial: 'Click a circle or arc',
    diameter: 'Click a circle',
    'arc-length': 'Click an arc or circle',
    aligned: 'Click two entities (true length along direction)',
  };

  return (
    <div className="sketch-palette sketch-palette--dimension">
      <div className="sketch-palette-header">
        <span className="sketch-palette-dot" />
        <span className="sketch-palette-title">DIMENSION</span>
        <button className="sketch-palette-close" onClick={cancelDimensionTool} title="Cancel">
          <X size={12} />
        </button>
      </div>

      <div className="sketch-palette-body">
        {/* Dimension Type */}
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Type</span>
          <select
            className="sketch-palette-input--narrow"
            value={activeDimensionType}
            onChange={(e) => setActiveDimensionType(e.target.value as DimensionToolType)}
          >
            <option value="auto">Auto (smart)</option>
            <option value="linear">Linear</option>
            <option value="angular">Angular</option>
            <option value="radial">Radial</option>
            <option value="diameter">Diameter</option>
            <option value="arc-length">Arc Length</option>
            <option value="aligned">Aligned</option>
          </select>
        </div>

        {/* Offset */}
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Offset (mm)</span>
          <input
            type="number"
            className="sketch-palette-input--narrow"
            value={dimensionOffset}
            min={2}
            max={50}
            step={1}
            onChange={(e) => setDimensionOffset(Number(e.target.value))}
          />
        </div>

        {/* CORR-1: Orientation — only meaningful for auto/linear/aligned */}
        {(activeDimensionType === 'auto' ||
          activeDimensionType === 'linear' ||
          activeDimensionType === 'aligned') && (
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Orientation</span>
            <select
              className="sketch-palette-input--narrow"
              value={dimensionOrientation}
              onChange={(e) => setDimensionOrientation(
                e.target.value as 'horizontal' | 'vertical' | 'auto'
              )}
            >
              <option value="auto">Auto</option>
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
          </div>
        )}

        {/* SK-A3: Reference (Driven) toggle */}
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Reference</span>
          <label className="sketch-palette-check">
            <input
              type="checkbox"
              checked={dimensionDrivenMode}
              onChange={() => setDimensionDrivenMode(!dimensionDrivenMode)}
            />
            <span className="sketch-palette-checkmark" />
          </label>
        </div>

        {/* SK-A8: Tolerance */}
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Tolerance</span>
          <select
            className="sketch-palette-input--narrow"
            value={dimensionToleranceMode}
            onChange={(e) => setDimensionToleranceMode(e.target.value as 'none' | 'symmetric' | 'deviation')}
          >
            <option value="none">None</option>
            <option value="symmetric">Symmetric ±</option>
            <option value="deviation">Deviation +/−</option>
          </select>
        </div>
        {dimensionToleranceMode === 'symmetric' && (
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">± (mm)</span>
            <input
              type="number"
              className="sketch-palette-input--narrow"
              value={dimensionToleranceUpper}
              min={0}
              step={0.01}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v >= 0) {
                  setDimensionToleranceUpper(v);
                  setDimensionToleranceLower(v);
                }
              }}
            />
          </div>
        )}
        {dimensionToleranceMode === 'deviation' && (
          <>
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">+ (mm)</span>
              <input
                type="number"
                className="sketch-palette-input--narrow"
                value={dimensionToleranceUpper}
                min={0}
                step={0.01}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v >= 0) setDimensionToleranceUpper(v);
                }}
              />
            </div>
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">− (mm)</span>
              <input
                type="number"
                className="sketch-palette-input--narrow"
                value={dimensionToleranceLower}
                min={0}
                step={0.01}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v >= 0) setDimensionToleranceLower(v);
                }}
              />
            </div>
          </>
        )}

        {/* Hint text */}
        <div className="sketch-palette-hint">
          {hints[activeDimensionType]}
        </div>

        {/* Cancel button */}
        <div className="sketch-palette-footer">
          <button className="sketch-palette-finish" onClick={cancelDimensionTool}>
            <X size={12} /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
