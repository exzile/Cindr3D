import './RevolvePanel.css';
import { X, Check, RefreshCw } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export default function RevolvePanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);

  const profileMode = useCADStore((s) => s.revolveProfileMode);
  const setProfileMode = useCADStore((s) => s.setRevolveProfileMode);
  const revolveFaceBoundary = useCADStore((s) => s.revolveFaceBoundary);

  const selectedId = useCADStore((s) => s.revolveSelectedSketchId);
  const setSelectedId = useCADStore((s) => s.setRevolveSelectedSketchId);

  const angle = useCADStore((s) => s.revolveAngle);
  const setAngle = useCADStore((s) => s.setRevolveAngle);
  const axis = useCADStore((s) => s.revolveAxis);
  const setAxis = useCADStore((s) => s.setRevolveAxis);
  const revolveDirection = useCADStore((s) => s.revolveDirection);
  const setRevolveDirection = useCADStore((s) => s.setRevolveDirection);
  const angle2 = useCADStore((s) => s.revolveAngle2);
  const setAngle2 = useCADStore((s) => s.setRevolveAngle2);
  const bodyKind = useCADStore((s) => s.revolveBodyKind);
  const setBodyKind = useCADStore((s) => s.setRevolveBodyKind);
  const isProjectAxis = useCADStore((s) => s.revolveIsProjectAxis);
  const setIsProjectAxis = useCADStore((s) => s.setRevolveIsProjectAxis);

  const commitRevolve = useCADStore((s) => s.commitRevolve);
  const cancelRevolveTool = useCADStore((s) => s.cancelRevolveTool);

  if (activeTool !== 'revolve') return null;

  const revolvable = sketches.filter((s) => s.entities.length > 0);
  const primaryAngle = revolveDirection === 'symmetric' ? angle / 2 : angle;

  const sketchReady = profileMode === 'sketch' && !!selectedId;
  const faceReady = profileMode === 'face' && !!revolveFaceBoundary;
  const canCommit = (sketchReady || faceReady) && Math.abs(primaryAngle) > 0.5;

  const axisOptions = profileMode === 'face'
    ? [['X', 'X axis'], ['Y', 'Y axis'], ['Z', 'Z axis']]
    : [['X', 'X axis'], ['Y', 'Y axis'], ['Z', 'Z axis'], ['centerline', 'Sketch Centerline']];

  return (
    <div className="tool-panel">
      <div className="tp-header">
        <div className="tp-header-icon revolve"><RefreshCw size={12} /></div>
        <span className="tp-header-title">REVOLVE</span>
        <button className="tp-close" onClick={cancelRevolveTool} title="Cancel"><X size={14} /></button>
      </div>

      <div className="tp-body">
        {/* Profile mode toggle */}
        <div className="tp-section">
          <div className="tp-section-title">Profile</div>
          <div className="tp-row">
            <span className="tp-label">Type</span>
            <select
              className="tp-select"
              value={profileMode}
              onChange={(e) => setProfileMode(e.target.value as 'sketch' | 'face')}
            >
              <option value="sketch">Sketch</option>
              <option value="face">Face</option>
            </select>
          </div>

          {profileMode === 'sketch' ? (
            <div className="tp-row">
              <span className="tp-label">Sketch</span>
              <select
                className="tp-select"
                value={selectedId ?? ''}
                onChange={(e) => setSelectedId(e.target.value || null)}
              >
                <option value="" disabled>Select a profile</option>
                {revolvable.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="tp-row">
              <span className="tp-label">Face</span>
              {revolveFaceBoundary ? (
                <span className="tp-chip">
                  Face selected
                  <button
                    className="tp-chip__clear"
                    onClick={() => useCADStore.getState().clearRevolveFace()}
                    title="Clear"
                  ><X size={10} /></button>
                </span>
              ) : (
                <span className="revolve-face-prompt">Click a face in the viewport</span>
              )}
            </div>
          )}
        </div>

        <div className="tp-divider" />

        {/* Axis + Direction */}
        <div className="tp-section">
          <div className="tp-section-title">Axis</div>
          <div className="tp-row">
            <span className="tp-label">Axis</span>
            <select
              className="tp-select"
              value={axis}
              onChange={(e) => setAxis(e.target.value as 'X' | 'Y' | 'Z' | 'centerline')}
            >
              {axisOptions.map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div className="tp-row">
            <span className="tp-label">Direction</span>
            <select
              className="tp-select"
              value={revolveDirection}
              onChange={(e) => setRevolveDirection(e.target.value as 'one-side' | 'symmetric' | 'two-sides')}
            >
              <option value="one-side">One Side</option>
              <option value="symmetric">Symmetric</option>
              <option value="two-sides">Two Sides</option>
            </select>
          </div>
          <div className="tp-row">
            <span className="tp-label">{revolveDirection === 'two-sides' ? 'Angle 1' : 'Angle'}</span>
            <div className="tp-input-group">
              <input
                type="number"
                step="5"
                value={angle}
                onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setAngle(v); }}
              />
              <span className="tp-unit">°</span>
            </div>
          </div>
          {revolveDirection === 'two-sides' && (
            <div className="tp-row">
              <span className="tp-label">Angle 2</span>
              <div className="tp-input-group">
                <input
                  type="number"
                  step="5"
                  value={angle2}
                  onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setAngle2(v); }}
                />
                <span className="tp-unit">°</span>
              </div>
            </div>
          )}
          <div className="tp-row">
            <label className="tp-checkbox-label">
              <input
                type="checkbox"
                checked={isProjectAxis}
                onChange={(e) => setIsProjectAxis(e.target.checked)}
              />
              <span>Project Axis to Profile Plane</span>
            </label>
          </div>
        </div>

        <div className="tp-divider" />

        {/* Output */}
        <div className="tp-section">
          <div className="tp-section-title">Output</div>
          <div className="tp-row">
            <span className="tp-label">Body</span>
            <select
              className="tp-select"
              value={bodyKind}
              onChange={(e) => setBodyKind(e.target.value as 'solid' | 'surface')}
            >
              <option value="solid">Solid Body</option>
              <option value="surface">Surface Body</option>
            </select>
          </div>
        </div>
      </div>

      <div className="tp-actions">
        <button className="tp-btn tp-btn-cancel" onClick={cancelRevolveTool}>
          <X size={13} /> Cancel
        </button>
        <button className="tp-btn tp-btn-ok" onClick={commitRevolve} disabled={!canCommit}>
          <Check size={13} /> OK
        </button>
      </div>
    </div>
  );
}
