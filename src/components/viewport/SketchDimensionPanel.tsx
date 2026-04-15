import { X } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';

export default function SketchDimensionPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const activeDimensionType = useCADStore((s) => s.activeDimensionType);
  const setActiveDimensionType = useCADStore((s) => s.setActiveDimensionType);
  const dimensionOffset = useCADStore((s) => s.dimensionOffset);
  const setDimensionOffset = useCADStore((s) => s.setDimensionOffset);
  const cancelDimensionTool = useCADStore((s) => s.cancelDimensionTool);

  if (activeTool !== 'dimension') return null;

  const hints: Record<string, string> = {
    linear: 'Click two points or one line',
    angular: 'Click two lines sharing a vertex',
    radial: 'Click a circle or arc',
    diameter: 'Click a circle',
  };

  return (
    <div className="extrude-panel">
      <div className="sketch-palette-header">
        <span className="sketch-palette-dot" style={{ background: '#f59e0b' }} />
        <span className="sketch-palette-title">DIMENSION</span>
        <button className="sketch-palette-close" onClick={cancelDimensionTool} title="Cancel">
          <X size={12} />
        </button>
      </div>

      <div className="sketch-palette-body">
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Type</span>
          <select
            className="measure-select"
            value={activeDimensionType}
            onChange={(e) => setActiveDimensionType(e.target.value as 'linear' | 'angular' | 'radial' | 'diameter')}
          >
            <option value="linear">Linear</option>
            <option value="angular">Angular</option>
            <option value="radial">Radial</option>
            <option value="diameter">Diameter</option>
          </select>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Offset (mm)</span>
          <input
            type="number"
            className="measure-select"
            value={dimensionOffset}
            min={2}
            max={50}
            step={1}
            onChange={(e) => setDimensionOffset(Number(e.target.value))}
            style={{ width: 70 }}
          />
        </div>

        <div style={{ fontSize: 11, color: '#94a3b8', padding: '4px' }}>
          {hints[activeDimensionType]}
        </div>

        <div className="extrude-panel-actions">
          <button
            className="btn btn-secondary"
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={cancelDimensionTool}
          >
            <X size={14} /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
