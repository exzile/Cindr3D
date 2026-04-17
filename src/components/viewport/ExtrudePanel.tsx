import './ExtrudePanel.css';
import { X, Check, ArrowUpFromLine, Scissors } from 'lucide-react';
import {
  useCADStore,
  type ExtrudeDirection,
  type ExtrudeOperation,
} from '../../store/cadStore';
import ExpressionInput from '../ui/ExpressionInput';
import { GeometryEngine } from '../../engine/GeometryEngine';

export default function ExtrudePanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);
  const selectedIds = useCADStore((s) => s.extrudeSelectedSketchIds);
  const setSelectedIds = useCADStore((s) => s.setExtrudeSelectedSketchIds);
  const distance = useCADStore((s) => s.extrudeDistance);
  const setDistance = useCADStore((s) => s.setExtrudeDistance);
  const distance2 = useCADStore((s) => s.extrudeDistance2);
  const setDistance2 = useCADStore((s) => s.setExtrudeDistance2);
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
  const startType = useCADStore((s) => s.extrudeStartType);
  const setStartType = useCADStore((s) => s.setExtrudeStartType);
  const startOffset = useCADStore((s) => s.extrudeStartOffset);
  const setStartOffset = useCADStore((s) => s.setExtrudeStartOffset);
  const extentType = useCADStore((s) => s.extrudeExtentType);
  const setExtentType = useCADStore((s) => s.setExtrudeExtentType);
  const taperAngle = useCADStore((s) => s.extrudeTaperAngle);
  const setTaperAngle = useCADStore((s) => s.setExtrudeTaperAngle);
  const extrudeSymmetricFullLength = useCADStore((s) => s.extrudeSymmetricFullLength);
  const setExtrudeSymmetricFullLength = useCADStore((s) => s.setExtrudeSymmetricFullLength);
  const bodyKind = useCADStore((s) => s.extrudeBodyKind);
  const setBodyKind = useCADStore((s) => s.setExtrudeBodyKind);
  const units = useCADStore((s) => s.units);

  const features = useCADStore((s) => s.features);
  const usedSketchIds = new Set(
    features.filter((f) => f.type === 'extrude').map((f) => f.sketchId),
  );
  const extrudable = sketches.filter((s) =>
    s.entities.length > 0 &&
    !usedSketchIds.has(s.id) &&
    !s.name.startsWith('Press Pull Profile'),
  );
  // Also include the currently selected sketch (may be a Press Pull profile)
  const activeSketchIds = new Set(selectedIds.map((id) => id.split('::')[0]));
  const allRelevant = [
    ...extrudable,
    ...sketches.filter((s) => activeSketchIds.has(s.id) && !extrudable.includes(s)),
  ];
  const profileOptions = allRelevant.flatMap((sketch) => {
    const count = GeometryEngine.sketchToShapes(sketch).length;
    return Array.from({ length: count }, (_, index) => ({
      id: `${sketch.id}::${index}`,
      label: `${sketch.name} • Profile ${index + 1}`,
      sketchId: sketch.id,
    })).filter(({ sketchId, id }) => {
      const source = allRelevant.find((s) => s.id === sketchId);
      if (!source) return false;
      const profileIndex = Number(id.split('::')[1]);
      return Number.isFinite(profileIndex) && GeometryEngine.createProfileSketch(source, profileIndex) !== null;
    });
  });

  // Press Pull profiles are selected by their raw sketch ID (no ::index).
  // Add them to profileOptions if they're currently selected but not already listed.
  for (const id of selectedIds) {
    if (id.includes('::')) continue; // already handled above
    if (profileOptions.some((o) => o.id === id)) continue;
    const sk = sketches.find((s) => s.id === id);
    if (sk) profileOptions.push({ id, label: sk.name, sketchId: id });
  }

  const selectedSketches = selectedIds
    .map((id) => {
      const [sketchId] = id.split('::');
      return sketches.find((s) => s.id === sketchId);
    })
    .filter(Boolean) as typeof extrudable;

  const allClosedProfiles = selectedSketches.length > 0 && selectedSketches.every((s) => GeometryEngine.isSketchClosedProfile(s));
  const effectiveBodyKind: 'solid' | 'surface' = allClosedProfiles ? bodyKind : 'surface';
  const isCutMode = operation === 'cut';
  const canCommit = selectedIds.length > 0 && (extentType === 'all' || Math.abs(distance) > 0.01);

  if (activeTool !== 'extrude' || selectedIds.length === 0) return null;

  return (
    <div className="tool-panel">
      {/* ── Header ── */}
      <div className="tp-header">
        <div className={`tp-header-icon ${isCutMode ? 'cut' : 'extrude'}`}>
          {isCutMode ? <Scissors size={12} /> : <ArrowUpFromLine size={12} />}
        </div>
        <span className="tp-header-title">{isCutMode ? 'Press-Pull Cut' : 'Extrude'}</span>
        <button className="tp-close" onClick={cancelExtrudeTool} title="Cancel (Esc)">
          <X size={14} />
        </button>
      </div>

      <div className="tp-body">
        {/* ── Profile section ── */}
        <div className="tp-section">
          <div className="tp-section-title">Profile</div>
          <select
            className="tp-select"
            value={selectedIds}
            multiple
            size={Math.min(4, Math.max(2, profileOptions.length))}
            onChange={(e) => {
              const ids = Array.from(e.currentTarget.selectedOptions).map((o) => o.value);
              setSelectedIds(ids);
            }}
          >
            {profileOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="tp-divider" />

        {/* ── Geometry section ── */}
        <div className="tp-section">
          <div className="tp-section-title">Geometry</div>

          <div className="tp-row">
            <span className="tp-label">Direction</span>
            <select
              className="tp-select"
              value={direction}
              onChange={(e) => setDirection(e.target.value as ExtrudeDirection)}
            >
              <option value="positive">One Side</option>
              <option value="symmetric">Symmetric</option>
              <option value="negative">Reversed</option>
              <option value="two-sides">Two Sides</option>
            </select>
          </div>

          <div className="tp-row">
            <span className="tp-label">Extent</span>
            <select
              className="tp-select"
              value={extentType}
              onChange={(e) => setExtentType(e.target.value as 'distance' | 'all')}
            >
              <option value="distance">Distance</option>
              <option value="all">All</option>
            </select>
          </div>

          {extentType === 'distance' && (
            <>
              <div className="tp-row">
                <span className="tp-label">{direction === 'two-sides' ? 'Side 1' : 'Distance'}</span>
                <div className="tp-input-group">
                  <ExpressionInput value={distance} onChange={setDistance} step={0.1} />
                  <span className="tp-unit">{units}</span>
                </div>
              </div>
              {direction === 'symmetric' && (
                <div className="tp-row">
                  <span className="tp-label">Full Length</span>
                  <label className="tp-toggle">
                    <input type="checkbox" checked={extrudeSymmetricFullLength} onChange={() => setExtrudeSymmetricFullLength(!extrudeSymmetricFullLength)} />
                    <span className="tp-toggle-track" />
                  </label>
                </div>
              )}
              {direction === 'two-sides' && (
                <div className="tp-row">
                  <span className="tp-label">Side 2</span>
                  <div className="tp-input-group">
                    <ExpressionInput value={distance2} onChange={setDistance2} step={0.1} />
                    <span className="tp-unit">{units}</span>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="tp-row">
            <span className="tp-label">Start</span>
            <select
              className="tp-select"
              value={startType}
              onChange={(e) => setStartType(e.target.value as 'profile' | 'offset')}
            >
              <option value="profile">Profile Plane</option>
              <option value="offset">Offset</option>
            </select>
          </div>

          {startType === 'offset' && (
            <div className="tp-row">
              <span className="tp-label">Offset</span>
              <div className="tp-input-group">
                <ExpressionInput value={startOffset} onChange={setStartOffset} step={0.1} />
                <span className="tp-unit">{units}</span>
              </div>
            </div>
          )}

          {effectiveBodyKind === 'solid' && (
            <div className="tp-row">
              <span className="tp-label">Taper</span>
              <div className="tp-input-group">
                <input
                  type="number"
                  step="0.5"
                  min="-89"
                  max="89"
                  value={taperAngle}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) setTaperAngle(Math.max(-89, Math.min(89, v)));
                  }}
                />
                <span className="tp-unit">°</span>
              </div>
            </div>
          )}
        </div>

        <div className="tp-divider" />

        {/* ── Options section ── */}
        <div className="tp-section">
          <div className="tp-section-title">Options</div>

          {effectiveBodyKind === 'solid' && (
            <>
              <div className="tp-row">
                <span className="tp-label">Operation</span>
                <select
                  className="tp-select"
                  value={operation}
                  onChange={(e) => setOperation(e.target.value as ExtrudeOperation)}
                >
                  <option value="new-body">New Body</option>
                  <option value="join">Join</option>
                  <option value="cut">Cut</option>
                  <option value="intersect">Intersect</option>
                  <option value="new-component">New Component</option>
                </select>
              </div>

              <div className="tp-row">
                <span className="tp-label">Thin</span>
                <label className="tp-toggle">
                  <input
                    type="checkbox"
                    checked={thinEnabled}
                    onChange={() => setThinEnabled(!thinEnabled)}
                  />
                  <span className="tp-toggle-track" />
                </label>
              </div>

              {thinEnabled && (
                <>
                  <div className="tp-row">
                    <span className="tp-label">Thickness</span>
                    <div className="tp-input-group">
                      <input
                        type="number"
                        step="0.1"
                        min="0.01"
                        value={thinThickness}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isNaN(v) && v > 0) setThinThickness(v);
                        }}
                      />
                      <span className="tp-unit">{units}</span>
                    </div>
                  </div>
                  <div className="tp-row">
                    <span className="tp-label">Side</span>
                    <select
                      className="tp-select"
                      value={thinSide}
                      onChange={(e) => setThinSide(e.target.value as 'side1' | 'side2' | 'center')}
                    >
                      <option value="side1">Side 1</option>
                      <option value="side2">Side 2</option>
                      <option value="center">Center</option>
                    </select>
                  </div>
                </>
              )}
            </>
          )}

          <div className="tp-row">
            <span className="tp-label">Output</span>
            <select
              className="tp-select"
              value={effectiveBodyKind}
              onChange={(e) => setBodyKind(e.target.value as 'solid' | 'surface')}
            >
              <option value="solid" disabled={!allClosedProfiles}>Solid Body</option>
              <option value="surface">Surface Body</option>
            </select>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="tp-actions">
          <button className="tp-btn tp-btn-cancel" onClick={cancelExtrudeTool}>
            <X size={13} /> Cancel
          </button>
          <button
            className="tp-btn tp-btn-ok"
            onClick={commitExtrude}
            disabled={!canCommit}
          >
            <Check size={13} /> OK
          </button>
        </div>
      </div>
    </div>
  );
}
