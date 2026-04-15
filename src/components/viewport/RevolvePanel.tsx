import { X, Check } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';

export default function RevolvePanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);
  const selectedId = useCADStore((s) => s.revolveSelectedSketchId);
  const setSelectedId = useCADStore((s) => s.setRevolveSelectedSketchId);
  const angle = useCADStore((s) => s.revolveAngle);
  const setAngle = useCADStore((s) => s.setRevolveAngle);
  const axis = useCADStore((s) => s.revolveAxis);
  const setAxis = useCADStore((s) => s.setRevolveAxis);
  // D70 direction modes
  const revolveDirection = useCADStore((s) => s.revolveDirection);
  const setRevolveDirection = useCADStore((s) => s.setRevolveDirection);
  const angle2 = useCADStore((s) => s.revolveAngle2);
  const setAngle2 = useCADStore((s) => s.setRevolveAngle2);
  const commitRevolve = useCADStore((s) => s.commitRevolve);
  const cancelRevolveTool = useCADStore((s) => s.cancelRevolveTool);

  if (activeTool !== 'revolve') return null;

  const revolvable = sketches.filter((s) => s.entities.length > 0);
  const primaryAngle = revolveDirection === 'symmetric' ? angle / 2 : angle;
  const canCommit = !!selectedId && Math.abs(primaryAngle) > 0.5;

  return (
    <div className="extrude-panel">
      <div className="sketch-palette-header">
        <span className="sketch-palette-dot" style={{ background: '#22c55e' }} />
        <span className="sketch-palette-title">REVOLVE</span>
        <button className="sketch-palette-close" onClick={cancelRevolveTool} title="Cancel">
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
            {revolvable.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Axis</span>
          <select
            className="measure-select"
            value={axis}
            onChange={(e) => setAxis(e.target.value as 'X' | 'Y' | 'Z')}
          >
            <option value="X">X axis</option>
            <option value="Y">Y axis</option>
            <option value="Z">Z axis</option>
          </select>
        </div>

        {/* D70: Direction modes */}
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Direction</span>
          <select
            className="measure-select"
            value={revolveDirection}
            onChange={(e) => setRevolveDirection(e.target.value as 'one-side' | 'symmetric' | 'two-sides')}
          >
            <option value="one-side">One Side</option>
            <option value="symmetric">Symmetric</option>
            <option value="two-sides">Two Sides</option>
          </select>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">{revolveDirection === 'two-sides' ? 'Angle 1' : 'Angle'}</span>
          <div className="extrude-input">
            <input
              type="number"
              step="5"
              value={angle}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) setAngle(v);
              }}
            />
            <span className="extrude-unit">°</span>
          </div>
        </div>

        {revolveDirection === 'two-sides' && (
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Angle 2</span>
            <div className="extrude-input">
              <input
                type="number"
                step="5"
                value={angle2}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v)) setAngle2(v);
                }}
              />
              <span className="extrude-unit">°</span>
            </div>
          </div>
        )}

        <div className="extrude-panel-actions">
          <button className="btn btn-secondary" onClick={cancelRevolveTool}>
            <X size={14} /> Cancel
          </button>
          <button className="btn btn-primary" onClick={commitRevolve} disabled={!canCommit}>
            <Check size={14} /> OK
          </button>
        </div>
      </div>
    </div>
  );
}
