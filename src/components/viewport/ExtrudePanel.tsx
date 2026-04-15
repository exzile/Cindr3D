import { X, Check } from 'lucide-react';
import {
  useCADStore,
  type ExtrudeDirection,
  type ExtrudeOperation,
} from '../../store/cadStore';
import ExpressionInput from '../ui/ExpressionInput';

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
  const thinEnabled = useCADStore((s) => s.extrudeThinEnabled);
  const setThinEnabled = useCADStore((s) => s.setExtrudeThinEnabled);
  const thinThickness = useCADStore((s) => s.extrudeThinThickness);
  const setThinThickness = useCADStore((s) => s.setExtrudeThinThickness);
  const thinSide = useCADStore((s) => s.extrudeThinSide);
  const setThinSide = useCADStore((s) => s.setExtrudeThinSide);
  // D67 start options
  const startType = useCADStore((s) => s.extrudeStartType);
  const setStartType = useCADStore((s) => s.setExtrudeStartType);
  const startOffset = useCADStore((s) => s.extrudeStartOffset);
  const setStartOffset = useCADStore((s) => s.setExtrudeStartOffset);
  // D68 extent type
  const extentType = useCADStore((s) => s.extrudeExtentType);
  const setExtentType = useCADStore((s) => s.setExtrudeExtentType);
  // D69 taper angle
  const taperAngle = useCADStore((s) => s.extrudeTaperAngle);
  const setTaperAngle = useCADStore((s) => s.setExtrudeTaperAngle);
  // D102 body kind
  const bodyKind = useCADStore((s) => s.extrudeBodyKind);
  const setBodyKind = useCADStore((s) => s.setExtrudeBodyKind);
  const units = useCADStore((s) => s.units);

  // Hide the panel until the user has actually picked a profile in the viewport
  if (activeTool !== 'extrude' || !selectedId) return null;

  const extrudable = sketches.filter((s) => s.entities.length > 0);
  const isCutMode = distance < 0;
  const canCommit = !!selectedId && (extentType === 'all' || Math.abs(distance) > 0.01);
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

        {/* D67: Start options */}
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Start</span>
          <select
            className="measure-select"
            value={startType}
            onChange={(e) => setStartType(e.target.value as 'profile' | 'offset')}
          >
            <option value="profile">Profile Plane</option>
            <option value="offset">Offset</option>
          </select>
        </div>
        {startType === 'offset' && (
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Offset</span>
            <div className="extrude-input">
              <ExpressionInput value={startOffset} onChange={setStartOffset} step={0.1} />
              <span className="extrude-unit">{units}</span>
            </div>
          </div>
        )}

        {/* D68: Extent type */}
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Extent</span>
          <select
            className="measure-select"
            value={extentType}
            onChange={(e) => setExtentType(e.target.value as 'distance' | 'all')}
          >
            <option value="distance">Distance</option>
            <option value="all">All</option>
          </select>
        </div>

        {extentType === 'distance' && (
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Distance</span>
            <div className="extrude-input">
              <ExpressionInput value={distance} onChange={setDistance} step={0.1} />
              <span className="extrude-unit">{units}</span>
            </div>
          </div>
        )}

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

        {/* D69: Taper angle */}
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Taper</span>
          <div className="extrude-input">
            <input
              type="number"
              step="0.5"
              min="-89"
              max="89"
              value={taperAngle}
              onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setTaperAngle(Math.max(-89, Math.min(89, v))); }}
            />
            <span className="extrude-unit">°</span>
          </div>
        </div>

        {/* D66: Thin Extrude controls */}
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Thin Extrude</span>
          <label className="sketch-palette-check">
            <input type="checkbox" checked={thinEnabled} onChange={() => setThinEnabled(!thinEnabled)} />
            <span className="sketch-palette-checkmark" />
          </label>
        </div>
        {thinEnabled && (
          <>
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">Thickness</span>
              <div className="extrude-input">
                <input
                  type="number"
                  step="0.1"
                  min="0.01"
                  value={thinThickness}
                  onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && v > 0) setThinThickness(v); }}
                />
                <span className="extrude-unit">{units}</span>
              </div>
            </div>
            <div className="sketch-palette-row">
              <span className="sketch-palette-label">Side</span>
              <select
                className="measure-select"
                value={thinSide}
                onChange={(e) => setThinSide(e.target.value as 'inside' | 'outside' | 'center')}
              >
                <option value="inside">Inside</option>
                <option value="outside">Outside</option>
                <option value="center">Center</option>
              </select>
            </div>
          </>
        )}

        {/* D102: Body kind — Solid vs Surface */}
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Output</span>
          <select
            className="measure-select"
            value={bodyKind}
            onChange={(e) => setBodyKind(e.target.value as 'solid' | 'surface')}
          >
            <option value="solid">Solid Body</option>
            <option value="surface">Surface Body</option>
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
