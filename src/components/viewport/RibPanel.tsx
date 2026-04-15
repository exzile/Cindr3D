import { X, Check } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';

export default function RibPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);
  const selectedId = useCADStore((s) => s.ribSelectedSketchId);
  const setSelectedId = useCADStore((s) => s.setRibSelectedSketchId);
  const thickness = useCADStore((s) => s.ribThickness);
  const setThickness = useCADStore((s) => s.setRibThickness);
  const height = useCADStore((s) => s.ribHeight);
  const setHeight = useCADStore((s) => s.setRibHeight);
  const direction = useCADStore((s) => s.ribDirection);
  const setDirection = useCADStore((s) => s.setRibDirection);
  const commitRib = useCADStore((s) => s.commitRib);
  const cancelRibTool = useCADStore((s) => s.cancelRibTool);
  const units = useCADStore((s) => s.units);

  if (activeTool !== 'rib') return null;

  const profilable = sketches.filter((s) => s.entities.length > 0);
  const canCommit = !!selectedId;

  return (
    <div className="extrude-panel">
      <div className="sketch-palette-header">
        <span className="sketch-palette-dot" style={{ background: '#f59e0b' }} />
        <span className="sketch-palette-title">RIB</span>
        <button className="sketch-palette-close" onClick={cancelRibTool} title="Cancel">
          <X size={12} />
        </button>
      </div>

      <div className="sketch-palette-body">
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Profile</span>
          <select
            className="measure-select"
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value || null)}
          >
            <option value="" disabled>Select a profile</option>
            {profilable.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Thickness</span>
          <div className="extrude-input">
            <input
              type="number"
              step="0.1"
              min="0.01"
              value={thickness}
              onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && v > 0) setThickness(v); }}
            />
            <span className="extrude-unit">{units}</span>
          </div>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Height</span>
          <div className="extrude-input">
            <input
              type="number"
              step="0.5"
              min="0.01"
              value={height}
              onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && v > 0) setHeight(v); }}
            />
            <span className="extrude-unit">{units}</span>
          </div>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Direction</span>
          <select
            className="measure-select"
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'normal' | 'flip' | 'symmetric')}
          >
            <option value="normal">Normal</option>
            <option value="flip">Flipped</option>
            <option value="symmetric">Symmetric</option>
          </select>
        </div>

        <div className="extrude-panel-actions">
          <button className="btn btn-secondary" onClick={cancelRibTool}>
            <X size={14} /> Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={commitRib}
            disabled={!canCommit}
          >
            <Check size={14} /> OK
          </button>
        </div>
      </div>
    </div>
  );
}
