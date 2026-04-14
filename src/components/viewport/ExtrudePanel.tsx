import { X, Check } from 'lucide-react';
import {
  useCADStore,
  type ExtrudeDirection,
  type ExtrudeOperation,
} from '../../store/cadStore';

export default function ExtrudePanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);
  const selectedId = useCADStore((s) => s.extrudeSelectedSketchId);
  const setSelectedId = useCADStore((s) => s.setExtrudeSelectedSketchId);
  const distance = useCADStore((s) => s.extrudeDistance);
  const setDistance = useCADStore((s) => s.setExtrudeDistance);
  const direction = useCADStore((s) => s.extrudeDirection);
  const setDirection = useCADStore((s) => s.setExtrudeDirection);
  const operation = useCADStore((s) => s.extrudeOperation);
  const setOperation = useCADStore((s) => s.setExtrudeOperation);
  const commitExtrude = useCADStore((s) => s.commitExtrude);
  const cancelExtrudeTool = useCADStore((s) => s.cancelExtrudeTool);
  const units = useCADStore((s) => s.units);

  // Hide the panel until the user has actually picked a profile in the viewport
  if (activeTool !== 'extrude' || !selectedId) return null;

  const extrudable = sketches.filter((s) => s.entities.length > 0);
  const isCutMode = distance < 0;
  const canCommit = !!selectedId && Math.abs(distance) > 0.01;
  // When the user drags the gizmo through zero, the Operation dropdown should
  // reflect reality: negative distance == cut.
  const effectiveOperation = isCutMode ? 'cut' : operation;

  return (
    <div className="extrude-panel">
      <div className="sketch-palette-header">
        <span
          className="sketch-palette-dot"
          style={{ background: isCutMode ? '#ef4444' : '#3b82f6' }}
        />
        <span className="sketch-palette-title">{isCutMode ? 'PRESS-PULL CUT' : 'EXTRUDE'}</span>
        <button
          className="sketch-palette-close"
          onClick={cancelExtrudeTool}
          title="Cancel"
        >
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
            {extrudable.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Direction</span>
          <select
            className="measure-select"
            value={direction}
            onChange={(e) => setDirection(e.target.value as ExtrudeDirection)}
          >
            <option value="normal">One Side</option>
            <option value="symmetric">Symmetric</option>
            <option value="reverse">Reversed</option>
          </select>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Distance</span>
          <div className="extrude-input">
            <input
              type="number"
              step="0.1"
              value={distance}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) setDistance(v);
              }}
            />
            <span className="extrude-unit">{units}</span>
          </div>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Operation</span>
          <select
            className="measure-select"
            value={effectiveOperation}
            disabled={isCutMode}
            title={isCutMode ? 'Negative distance → auto-switched to Cut' : undefined}
            onChange={(e) => setOperation(e.target.value as ExtrudeOperation)}
          >
            <option value="new-body">New Body</option>
            <option value="join">Join</option>
            <option value="cut">Cut</option>
          </select>
        </div>

        <div className="extrude-panel-actions">
          <button className="btn btn-secondary" onClick={cancelExtrudeTool}>
            <X size={14} /> Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={commitExtrude}
            disabled={!canCommit}
          >
            <Check size={14} /> OK
          </button>
        </div>
      </div>
    </div>
  );
}
