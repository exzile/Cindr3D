import './ExtrudePanel.css';
import { useMemo } from 'react';
import { X, Check, ArrowUpFromLine, Scissors } from 'lucide-react';
import {
  useCADStore,
  type ExtrudeDirection,
  type ExtrudeOperation,
} from '../../store/cadStore';
import ExpressionInput from '../ui/ExpressionInput';
import { ParticipantBodyPicker } from '../ui/ParticipantBodyPicker';
import { GeometryEngine } from '../../engine/GeometryEngine';
import { useComponentStore } from '../../store/componentStore';

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
  // EX-7/EX-8: per-side thin values
  const thinSide2 = useCADStore((s) => s.extrudeThinSide2);
  const setThinSide2 = useCADStore((s) => s.setExtrudeThinSide2);
  const thinThickness2 = useCADStore((s) => s.extrudeThinThickness2);
  const setThinThickness2 = useCADStore((s) => s.setExtrudeThinThickness2);
  const startType = useCADStore((s) => s.extrudeStartType);
  const setStartType = useCADStore((s) => s.setExtrudeStartType);
  const startOffset = useCADStore((s) => s.extrudeStartOffset);
  const setStartOffset = useCADStore((s) => s.setExtrudeStartOffset);
  const startEntityId = useCADStore((s) => s.extrudeStartEntityId);
  void startEntityId; // populated by face-picker interaction (CORR-8 / EX-4)
  const participantBodyIds = useCADStore((s) => s.extrudeParticipantBodyIds);
  const setParticipantBodyIds = useCADStore((s) => s.setExtrudeParticipantBodyIds);
  const confinedFaceIds = useCADStore((s) => s.extrudeConfinedFaceIds);
  const setConfinedFaceIds = useCADStore((s) => s.setExtrudeConfinedFaceIds);
  // EX-15: creationOccurrence — which ComponentOccurrence context the profile lives in
  const creationOccurrence = useCADStore((s) => s.extrudeCreationOccurrence);
  const setCreationOccurrence = useCADStore((s) => s.setExtrudeCreationOccurrence);
  const occurrences = useComponentStore((s) => s.occurrences);
  const occurrenceList = Object.values(occurrences);
  // EX-16: targetBaseFeature — direct-edit mode container
  const targetBaseFeature = useCADStore((s) => s.extrudeTargetBaseFeature);
  const setTargetBaseFeature = useCADStore((s) => s.setExtrudeTargetBaseFeature);
  const extentType = useCADStore((s) => s.extrudeExtentType);
  const setExtentType = useCADStore((s) => s.setExtrudeExtentType);
  const extentType2 = useCADStore((s) => s.extrudeExtentType2);
  const setExtentType2 = useCADStore((s) => s.setExtrudeExtentType2);
  // EX-3: to-object face data
  const toEntityFaceId = useCADStore((s) => s.extrudeToEntityFaceId);
  const clearToEntityFace = useCADStore((s) => s.clearExtrudeToEntityFace);
  // EX-12: directionHint flip
  const toObjectFlip = useCADStore((s) => s.extrudeToObjectFlipDirection);
  const setToObjectFlip = useCADStore((s) => s.setExtrudeToObjectFlipDirection);
  // EX-4: from-entity face data
  const startFaceCentroid = useCADStore((s) => s.extrudeStartFaceCentroid);
  const clearStartFace = useCADStore((s) => s.clearExtrudeStartFace);
  const taperAngle = useCADStore((s) => s.extrudeTaperAngle);
  const setTaperAngle = useCADStore((s) => s.setExtrudeTaperAngle);
  const taperAngle2 = useCADStore((s) => s.extrudeTaperAngle2);
  const setTaperAngle2 = useCADStore((s) => s.setExtrudeTaperAngle2);
  const extrudeSymmetricFullLength = useCADStore((s) => s.extrudeSymmetricFullLength);
  const setExtrudeSymmetricFullLength = useCADStore((s) => s.setExtrudeSymmetricFullLength);
  const bodyKind = useCADStore((s) => s.extrudeBodyKind);
  const setBodyKind = useCADStore((s) => s.setExtrudeBodyKind);
  const units = useCADStore((s) => s.units);
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);

  const features = useCADStore((s) => s.features);
  // EX-13: in edit mode, exclude the editing feature from the "used" set so its
  // sketch re-appears in the profile picker; still block other extrude sketches.
  const usedSketchIds = new Set(
    features
      .filter((f) => f.type === 'extrude' && f.id !== editingFeatureId)
      .map((f) => f.sketchId),
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
  // Memoize the profile-options derivation. sketchToShapes + createProfileSketch
  // are non-trivial — without this they'd re-run on every render of the panel
  // (every cursor move during extrude drag, every store update, etc.). Deps:
  // the underlying sketch list and the selectedIds (for Press-Pull pass-through).
  const profileOptions = useMemo(() => {
    const opts = allRelevant.flatMap((sketch) => {
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
      if (opts.some((o) => o.id === id)) continue;
      const sk = sketches.find((s) => s.id === id);
      if (sk) opts.push({ id, label: sk.name, sketchId: id });
    }
    return opts;
  }, [allRelevant, selectedIds, sketches]);

  const selectedSketches = selectedIds
    .map((id) => {
      const [sketchId] = id.split('::');
      return sketches.find((s) => s.id === sketchId);
    })
    .filter(Boolean) as typeof extrudable;

  // EX-16: base feature containers available as direct-edit targets
  const baseFeatureContainers = features.filter((f) => f.isBaseFeatureContainer);

  const allClosedProfiles = selectedSketches.length > 0 && selectedSketches.every((s) => GeometryEngine.isSketchClosedProfile(s));
  const effectiveBodyKind: 'solid' | 'surface' = allClosedProfiles ? bodyKind : 'surface';
  const isCutMode = operation === 'cut';
  const side2ok = direction !== 'two-sides' || extentType2 === 'all' || extentType2 === 'to-object' || Math.abs(distance2) > 0.01;
  const extent1ok = extentType === 'all' || extentType === 'to-object' || Math.abs(distance) > 0.01;
  const toObjectOk = extentType !== 'to-object' || toEntityFaceId !== null;
  const canCommit = selectedIds.length > 0 && extent1ok && side2ok && toObjectOk;

  if (activeTool !== 'extrude') return null;
  // In edit mode show the panel even if profile selection is still loading
  if (selectedIds.length === 0 && !editingFeatureId) return null;

  return (
    <div className="tool-panel">
      {/* ── Header ── */}
      <div className="tp-header">
        <div className={`tp-header-icon ${isCutMode ? 'cut' : 'extrude'}`}>
          {isCutMode ? <Scissors size={12} /> : <ArrowUpFromLine size={12} />}
        </div>
        <span className="tp-header-title">
          {editingFeatureId ? `Edit ${isCutMode ? 'Cut' : 'Extrude'}` : (isCutMode ? 'Press-Pull Cut' : 'Extrude')}
        </span>
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

          {/* EX-10: when two-sides, each side gets its own independent extent type */}
          {direction !== 'two-sides' ? (
            <>
              <div className="tp-row">
                <span className="tp-label">Extent</span>
                <select
                  className="tp-select"
                  value={extentType}
                  onChange={(e) => setExtentType(e.target.value as 'distance' | 'all' | 'to-object')}
                >
                  <option value="distance">Distance</option>
                  <option value="all">All</option>
                  <option value="to-object">To Object</option>
                </select>
              </div>
              {extentType === 'distance' && (
                <>
                  <div className="tp-row">
                    <span className="tp-label">Distance</span>
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
                </>
              )}
              {/* EX-3/EX-12: To Object — show picked face indicator + flip toggle */}
              {extentType === 'to-object' && (
                <>
                  <div className="tp-row">
                    {toEntityFaceId
                      ? <>
                          <span className="tp-label" style={{ color: '#55cc88' }}>✓ Face selected</span>
                          <button style={{ fontSize: 10, background: 'none', border: 'none', color: '#5588ff', cursor: 'pointer', padding: 0 }} onClick={clearToEntityFace}>Clear</button>
                        </>
                      : <span className="tp-label" style={{ fontSize: 10, color: '#aaaacc' }}>Click a face in viewport to set terminus</span>
                    }
                  </div>
                  {toEntityFaceId && (
                    <div className="tp-row">
                      <span className="tp-label">Flip Direction</span>
                      <label className="tp-toggle">
                        <input type="checkbox" checked={toObjectFlip} onChange={() => setToObjectFlip(!toObjectFlip)} />
                        <span className="tp-toggle-track" />
                      </label>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              {/* Side 1 */}
              <div className="tp-row">
                <span className="tp-label">Side 1 Extent</span>
                <select
                  className="tp-select"
                  value={extentType}
                  onChange={(e) => setExtentType(e.target.value as 'distance' | 'all' | 'to-object')}
                >
                  <option value="distance">Distance</option>
                  <option value="all">All</option>
                  <option value="to-object">To Object</option>
                </select>
              </div>
              {extentType === 'distance' && (
                <div className="tp-row">
                  <span className="tp-label">Side 1 Dist</span>
                  <div className="tp-input-group">
                    <ExpressionInput value={distance} onChange={setDistance} step={0.1} />
                    <span className="tp-unit">{units}</span>
                  </div>
                </div>
              )}
              {extentType === 'to-object' && (
                <>
                  <div className="tp-row">
                    {toEntityFaceId
                      ? <>
                          <span className="tp-label" style={{ color: '#55cc88' }}>✓ Face selected</span>
                          <button style={{ fontSize: 10, background: 'none', border: 'none', color: '#5588ff', cursor: 'pointer', padding: 0 }} onClick={clearToEntityFace}>Clear</button>
                        </>
                      : <span className="tp-label" style={{ fontSize: 10, color: '#aaaacc' }}>Click a face in viewport</span>
                    }
                  </div>
                  {toEntityFaceId && (
                    <div className="tp-row">
                      <span className="tp-label">Flip Dir</span>
                      <label className="tp-toggle">
                        <input type="checkbox" checked={toObjectFlip} onChange={() => setToObjectFlip(!toObjectFlip)} />
                        <span className="tp-toggle-track" />
                      </label>
                    </div>
                  )}
                </>
              )}
              {/* Side 2 */}
              <div className="tp-row">
                <span className="tp-label">Side 2 Extent</span>
                <select
                  className="tp-select"
                  value={extentType2}
                  onChange={(e) => setExtentType2(e.target.value as 'distance' | 'all' | 'to-object')}
                >
                  <option value="distance">Distance</option>
                  <option value="all">All</option>
                  <option value="to-object">To Object</option>
                </select>
              </div>
              {extentType2 === 'distance' && (
                <div className="tp-row">
                  <span className="tp-label">Side 2 Dist</span>
                  <div className="tp-input-group">
                    <ExpressionInput value={distance2} onChange={setDistance2} step={0.1} />
                    <span className="tp-unit">{units}</span>
                  </div>
                </div>
              )}
              {extentType2 === 'to-object' && (
                <>
                <div className="tp-row">
                  {toEntityFaceId
                    ? <>
                        <span className="tp-label" style={{ color: '#55cc88' }}>✓ Face selected</span>
                        <button style={{ fontSize: 10, background: 'none', border: 'none', color: '#5588ff', cursor: 'pointer', padding: 0 }} onClick={clearToEntityFace}>Clear</button>
                      </>
                    : <span className="tp-label" style={{ fontSize: 10, color: '#aaaacc' }}>Click a face in viewport</span>
                  }
                </div>
                {toEntityFaceId && (
                  <div className="tp-row">
                    <span className="tp-label">Flip Dir</span>
                    <label className="tp-toggle">
                      <input type="checkbox" checked={toObjectFlip} onChange={() => setToObjectFlip(!toObjectFlip)} />
                      <span className="tp-toggle-track" />
                    </label>
                  </div>
                )}
                </>
              )}
            </>
          )}

          <div className="tp-row">
            <span className="tp-label">Start</span>
            <select
              className="tp-select"
              value={startType}
              onChange={(e) => setStartType(e.target.value as 'profile' | 'offset' | 'entity')}
            >
              <option value="profile">Profile Plane</option>
              <option value="offset">Offset</option>
              <option value="entity">From Entity</option>
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

          {startType === 'entity' && (
            <div className="tp-row">
              {startFaceCentroid
                ? <>
                    <span className="tp-label" style={{ color: '#55cc88' }}>✓ Start face selected</span>
                    <button style={{ fontSize: 10, background: 'none', border: 'none', color: '#5588ff', cursor: 'pointer', padding: 0 }} onClick={clearStartFace}>Clear</button>
                  </>
                : <span className="tp-label" style={{ fontSize: 10, color: '#aaaacc' }}>Click a face/plane in viewport to set start entity</span>
              }
            </div>
          )}

          {effectiveBodyKind === 'solid' && (
            direction === 'two-sides' ? (
              <>
                <div className="tp-row">
                  <span className="tp-label">Taper 1</span>
                  <div className="tp-input-group">
                    <input type="number" step="0.5" min="-89" max="89" value={taperAngle}
                      onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setTaperAngle(Math.max(-89, Math.min(89, v))); }} />
                    <span className="tp-unit">°</span>
                  </div>
                </div>
                <div className="tp-row">
                  <span className="tp-label">Taper 2</span>
                  <div className="tp-input-group">
                    <input type="number" step="0.5" min="-89" max="89" value={taperAngle2}
                      onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setTaperAngle2(Math.max(-89, Math.min(89, v))); }} />
                    <span className="tp-unit">°</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="tp-row">
                <span className="tp-label">Taper</span>
                <div className="tp-input-group">
                  <input type="number" step="0.5" min="-89" max="89" value={taperAngle}
                    onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setTaperAngle(Math.max(-89, Math.min(89, v))); }} />
                  <span className="tp-unit">°</span>
                </div>
              </div>
            )
          )}

          {/* EX-14: Taper angle geometric validation warning */}
          {effectiveBodyKind === 'solid' && (Math.abs(taperAngle) >= 45 || (direction === 'two-sides' && Math.abs(taperAngle2) >= 45)) && (
            <div className="tp-row" style={{ color: '#ffaa44', fontSize: 10, gap: 4 }}>
              <span>⚠ Taper ≥ 45° may collapse the profile.</span>
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
                    <span className="tp-label">{direction === 'two-sides' ? 'Thickness 1' : 'Thickness'}</span>
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
                    <span className="tp-label">{direction === 'two-sides' ? 'Side 1 Loc' : 'Side'}</span>
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
                  {direction === 'two-sides' && (
                    <>
                      <div className="tp-row">
                        <span className="tp-label">Thickness 2</span>
                        <div className="tp-input-group">
                          <input
                            type="number"
                            step="0.1"
                            min="0.01"
                            value={thinThickness2}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (!Number.isNaN(v) && v > 0) setThinThickness2(v);
                            }}
                          />
                          <span className="tp-unit">{units}</span>
                        </div>
                      </div>
                      <div className="tp-row">
                        <span className="tp-label">Side 2 Loc</span>
                        <select
                          className="tp-select"
                          value={thinSide2}
                          onChange={(e) => setThinSide2(e.target.value as 'side1' | 'side2' | 'center')}
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

          {/* EX-9: Participant Bodies — only relevant for cut/intersect */}
          {(operation === 'cut' || operation === 'intersect') && (
            <div className="tp-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <ParticipantBodyPicker
                selectedIds={participantBodyIds}
                onChange={setParticipantBodyIds}
                label="Participant Bodies"
              />
            </div>
          )}

          {/* SDK-12: Confined Faces — restrict extrude to stay within bounding faces */}
          <div className="tp-row">
            <label className="tp-checkbox-label">
              <input
                type="checkbox"
                checked={confinedFaceIds.length > 0}
                onChange={(e) => { if (!e.target.checked) setConfinedFaceIds([]); }}
              />
              <span>Confined Faces</span>
            </label>
          </div>
          {confinedFaceIds.length > 0 && (
            <div style={{ fontSize: 10, color: '#888', padding: '0 6px 4px' }}>
              {confinedFaceIds.length} bounding face{confinedFaceIds.length > 1 ? 's' : ''} selected
              <button
                style={{ marginLeft: 6, fontSize: 10, background: 'none', border: 'none', color: '#5588ff', cursor: 'pointer', padding: 0 }}
                onClick={() => setConfinedFaceIds([])}
              >
                Clear
              </button>
            </div>
          )}
          {confinedFaceIds.length === 0 && (
            <div style={{ fontSize: 10, color: '#666', padding: '0 6px 4px' }}>
              Enable to limit extrude to selected bounding faces (face-pick via viewport)
            </div>
          )}
          {/* EX-15: Creation Occurrence — profile occurrence context (CORR-4) */}
          {occurrenceList.length > 0 && (
            <div className="tp-row">
              <label className="tp-label">Occurrence</label>
              <select
                className="tp-select"
                value={creationOccurrence ?? ''}
                onChange={(e) => setCreationOccurrence(e.target.value || null)}
                style={{ flex: 1 }}
              >
                <option value="">(Active component)</option>
                {occurrenceList.map((occ) => (
                  <option key={occ.id} value={occ.id}>{occ.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* EX-16: Target Base Feature — direct-edit context */}
          {baseFeatureContainers.length > 0 && (
            <div className="tp-row">
              <label className="tp-label">Base Feature</label>
              <select
                className="tp-select"
                value={targetBaseFeature ?? ''}
                onChange={(e) => setTargetBaseFeature(e.target.value || null)}
                style={{ flex: 1 }}
              >
                <option value="">(Parametric — none)</option>
                {baseFeatureContainers.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
          )}
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
            <Check size={13} /> {editingFeatureId ? 'Update' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
