import { useState, useEffect, type FocusEvent, type MouseEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import type { Feature } from '../../../types/cad';

/** SOL-I1: Fillet type discriminator — CORR-3: added chord-length */
export type FilletMode = 'constant' | 'variable' | 'full-round' | 'chord-length';

/** CORR-3: per-edge radius set (mirrors SDK ConstantRadiusEdgeSet / VariableRadiusEdgeSet / ChordLengthEdgeSet) */
export interface FilletEdgeSet {
  /** subset of selected edges assigned to this set */
  edgeIds: string[];
  type: 'constant' | 'variable' | 'chord-length';
  /** constant / variable start */
  radius?: number;
  /** variable end */
  endRadius?: number;
  /** chord-length mode */
  chordLength?: number;
  /** variable: optional intermediate control points {t: 0-1, r: mm} */
  radiiPoints?: { t: number; r: number }[];
}

export interface FilletParams {
  radius: number;
  edgeIds: string[];
  /** SOL-I1: fillet mode */
  mode: FilletMode;
  startRadius?: number;
  endRadius?: number;
  /** CORR-3: chord-length mode value */
  chordLength?: number;
  setback: boolean;
  /** SDK-9: setback distance at each vertex where three or more edges meet */
  setbackDistance: number;
  propagate: boolean;
  /** CORR-11: G2 curvature-continuous fillet (smoother blend than G1 tangent) */
  isG2: boolean;
  /** CORR-12: rolling-ball corner setback solution method */
  isRollingBallCorner: boolean;
  /**
   * CORR-3: optional per-edge edge-sets (overrides global mode/radius when present).
   * When non-empty, each set carries its own type + radius/chordLength for a subset
   * of the selected edges. Matches SDK FilletFeatureInput edge-set API.
   */
  edgeSets?: FilletEdgeSet[];
}

interface FilletDialogProps {
  open: boolean;
  selectedEdgeCount: number;
  onClose: () => void;
  onConfirm: (params: FilletParams) => void;
}

function FilletDialogUI({ open, selectedEdgeCount, onClose, onConfirm }: FilletDialogProps) {
  // filletLiveRadius is updated by FilletGizmo drags so the dialog reflects
  // the radius while the user drags the on-canvas handle.
  const filletLiveRadius = useCADStore((s) => s.filletLiveRadius);
  const setFilletLiveRadius = useCADStore((s) => s.setFilletLiveRadius);
  const [radius, setRadius] = useState(() => filletLiveRadius);
  // Sync gizmo drag → dialog input (no loop: input onChange only fires on user events).
  useEffect(() => { setRadius(filletLiveRadius); }, [filletLiveRadius]);
  const [mode, setMode] = useState<FilletMode>('constant');
  const [startRadius, setStartRadius] = useState(1);
  const [endRadius, setEndRadius] = useState(4);
  const [chordLength, setChordLength] = useState(5);
  const [setback, setSetback] = useState(false);
  const [setbackDistance, setSetbackDistance] = useState(1);
  const [isRollingBallCorner, setIsRollingBallCorner] = useState(false);
  const [propagate, setPropagate] = useState(true);
  const [isG2, setIsG2] = useState(false);
  // CORR-3: per-edge edge sets — optional, appended below the global mode
  const [edgeSets, setEdgeSets] = useState<FilletEdgeSet[]>([]);
  const [showEdgeSets, setShowEdgeSets] = useState(false);

  if (!open) return null;

  const handleOK = () => {
    const params: FilletParams = {
      radius,
      edgeIds: [],
      mode,
      setback,
      setbackDistance: setback ? setbackDistance : 0,
      propagate,
      isG2,
      isRollingBallCorner: setback && isRollingBallCorner,
    };
    if (mode === 'variable') {
      params.startRadius = startRadius;
      params.endRadius = endRadius;
    }
    if (mode === 'chord-length') {
      params.chordLength = chordLength;
    }
    if (edgeSets.length > 0) {
      params.edgeSets = edgeSets;
    }
    onConfirm(params);
  };

  const addEdgeSet = () => {
    setEdgeSets((prev) => [...prev, { edgeIds: [], type: 'constant', radius: 2 }]);
    setShowEdgeSets(true);
  };

  const removeEdgeSet = (i: number) => setEdgeSets((prev) => prev.filter((_, idx) => idx !== i));

  const updateEdgeSet = (i: number, patch: Partial<FilletEdgeSet>) =>
    setEdgeSets((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));

  const clamp = (val: number, min: number, max: number) =>
    Math.max(min, Math.min(max, val));
  const selectNumberText = (e: FocusEvent<HTMLInputElement> | MouseEvent<HTMLInputElement>) => {
    e.currentTarget.select();
  };

  return (
    <DialogShell
      title="Fillet"
      onClose={onClose}
      size="sm"
      overlayClassName="edge-pick-dialog"
      onConfirm={handleOK}
      confirmDisabled={selectedEdgeCount === 0}
    >
      <p className="dialog-hint">
        {selectedEdgeCount} edge(s) selected
      </p>

      {/* SOL-I1 / CORR-3: Fillet mode */}
      <div className="form-group">
        <label>Type</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as FilletMode)}>
          <option value="constant">Constant Radius</option>
          <option value="variable">Variable Radius</option>
          <option value="chord-length">Chord Length</option>
          <option value="full-round">Full Round</option>
        </select>
      </div>

      {mode === 'constant' && (
        <div className="form-group">
          <label>Radius (mm)</label>
          <input
            type="number"
            value={radius}
            onFocus={selectNumberText}
            onClick={selectNumberText}
            onChange={(e) => {
              const r = clamp(parseFloat(e.target.value) || 2, 0.01, 500);
              setRadius(r);
              setFilletLiveRadius(r);
            }}
            min={0.01}
            max={500}
            step={0.5}
          />
        </div>
      )}

      {mode === 'variable' && (
        <>
          <div className="settings-grid">
            <div className="form-group">
              <label>Start Radius (mm)</label>
              <input
                type="number"
                value={startRadius}
                onFocus={selectNumberText}
                onClick={selectNumberText}
                onChange={(e) => setStartRadius(clamp(parseFloat(e.target.value) || 1, 0.01, 500))}
                min={0.01}
                max={500}
                step={0.5}
              />
            </div>
            <div className="form-group">
              <label>End Radius (mm)</label>
              <input
                type="number"
                value={endRadius}
                onFocus={selectNumberText}
                onClick={selectNumberText}
                onChange={(e) => setEndRadius(clamp(parseFloat(e.target.value) || 4, 0.01, 500))}
                min={0.01}
                max={500}
                step={0.5}
              />
            </div>
          </div>
        </>
      )}

      {/* CORR-3: Chord Length mode */}
      {mode === 'chord-length' && (
        <div className="form-group">
          <label>Chord Length (mm)</label>
          <input
            type="number"
            value={chordLength}
            onFocus={selectNumberText}
            onClick={selectNumberText}
            onChange={(e) => setChordLength(clamp(parseFloat(e.target.value) || 5, 0.01, 1000))}
            min={0.01}
            max={1000}
            step={0.5}
          />
          <p className="dialog-hint" style={{ marginTop: 4 }}>
            Chord length controls the width of the fillet arc rather than its radius.
            r = chordLen / (2 sin(θ/2)) for the edge dihedral angle θ.
          </p>
        </div>
      )}

      {mode === 'full-round' && (
        <p className="dialog-hint">
          Select three edge sets: Side Face 1 → Center Face → Side Face 2.
          The fillet radius is computed automatically to create a tangent blend.
        </p>
      )}

      {/* CORR-3: Per-edge edge sets — lets each edge have its own radius type */}
      <div className="form-group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ marginBottom: 0 }}>Edge Sets</label>
          <button
            className="btn btn-xs"
            style={{ padding: '2px 8px', fontSize: 11 }}
            onClick={addEdgeSet}
            title="Add an edge set with its own radius type (SDK FilletFeatureInput edge-set API)"
          >
            <Plus size={11} /> Add Set
          </button>
        </div>
        {edgeSets.length === 0 && (
          <p className="dialog-hint" style={{ marginTop: 4 }}>
            Optional: add per-edge radius sets to assign different types to subsets of selected edges.
          </p>
        )}
        {showEdgeSets && edgeSets.map((set, i) => (
          <div key={i} style={{ border: '1px solid #555', borderRadius: 4, padding: '6px 8px', marginTop: 6, position: 'relative' }}>
            <button
              style={{ position: 'absolute', top: 4, right: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#cc4444', padding: 0 }}
              onClick={() => removeEdgeSet(i)}
              title="Remove this edge set"
            >
              <Trash2 size={12} />
            </button>
            <div className="settings-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
              <div className="form-group" style={{ marginBottom: 4 }}>
                <label style={{ fontSize: 11 }}>Type</label>
                <select
                  style={{ fontSize: 11 }}
                  value={set.type}
                  onChange={(e) => updateEdgeSet(i, { type: e.target.value as FilletEdgeSet['type'] })}
                >
                  <option value="constant">Constant</option>
                  <option value="variable">Variable</option>
                  <option value="chord-length">Chord Length</option>
                </select>
              </div>
              {set.type === 'constant' && (
                <div className="form-group" style={{ marginBottom: 4 }}>
                  <label style={{ fontSize: 11 }}>Radius (mm)</label>
                  <input type="number" style={{ fontSize: 11 }} value={set.radius ?? 2} min={0.01} step={0.5}
                    onFocus={selectNumberText}
                    onClick={selectNumberText}
                    onChange={(e) => updateEdgeSet(i, { radius: Math.max(0.01, parseFloat(e.target.value) || 2) })} />
                </div>
              )}
              {set.type === 'variable' && (
                <>
                  <div className="form-group" style={{ marginBottom: 4 }}>
                    <label style={{ fontSize: 11 }}>Start R (mm)</label>
                    <input type="number" style={{ fontSize: 11 }} value={set.radius ?? 1} min={0.01} step={0.5}
                      onFocus={selectNumberText}
                      onClick={selectNumberText}
                      onChange={(e) => updateEdgeSet(i, { radius: Math.max(0.01, parseFloat(e.target.value) || 1) })} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 4 }}>
                    <label style={{ fontSize: 11 }}>End R (mm)</label>
                    <input type="number" style={{ fontSize: 11 }} value={set.endRadius ?? 4} min={0.01} step={0.5}
                      onFocus={selectNumberText}
                      onClick={selectNumberText}
                      onChange={(e) => updateEdgeSet(i, { endRadius: Math.max(0.01, parseFloat(e.target.value) || 4) })} />
                  </div>
                </>
              )}
              {set.type === 'chord-length' && (
                <div className="form-group" style={{ marginBottom: 4 }}>
                  <label style={{ fontSize: 11 }}>Chord Len (mm)</label>
                  <input type="number" style={{ fontSize: 11 }} value={set.chordLength ?? 5} min={0.01} step={0.5}
                    onFocus={selectNumberText}
                    onClick={selectNumberText}
                    onChange={(e) => updateEdgeSet(i, { chordLength: Math.max(0.01, parseFloat(e.target.value) || 5) })} />
                </div>
              )}
            </div>
            <p className="dialog-hint" style={{ margin: '4px 0 0', fontSize: 10 }}>
              Edge IDs assigned automatically from the current selection when this set is the only one, or via edge picker (deferred).
            </p>
          </div>
        ))}
      </div>

      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={propagate}
            onChange={(e) => setPropagate(e.target.checked)}
          />
          Propagate Along Tangent Edges
        </label>
      </div>

      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={setback}
            onChange={(e) => setSetback(e.target.checked)}
          />
          Setback
        </label>
      </div>
      {setback && (
        <>
          <div className="form-group" style={{ paddingLeft: 16 }}>
            <label>Setback Distance (mm)</label>
            <input
              type="number"
              value={setbackDistance}
              onFocus={selectNumberText}
              onClick={selectNumberText}
              onChange={(e) => setSetbackDistance(Math.max(0, parseFloat(e.target.value) || 0))}
              min={0}
              max={500}
              step={0.5}
            />
          </div>
          <div className="form-group" style={{ paddingLeft: 16 }}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isRollingBallCorner}
                onChange={(e) => setIsRollingBallCorner(e.target.checked)}
              />
              Rolling Ball Corner
            </label>
          </div>
        </>
      )}

      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={isG2}
            onChange={(e) => setIsG2(e.target.checked)}
          />
          G2 Smooth (curvature continuity)
        </label>
      </div>
    </DialogShell>
  );
}

// ── Store-connected wrapper (used via activeDialog='fillet') ─────────────────
export function FilletDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const filletEdgeIds = useCADStore((s) => s.filletEdgeIds);
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const renameFeature = useCADStore((s) => s.renameFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const commitFillet = useCADStore((s) => s.commitFillet);

  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};
  const existingEdgeIds = typeof p.edgeIds === 'string' ? p.edgeIds.split(',').filter(Boolean) : [];

  const handleConfirm = (params: FilletParams) => {
    const edgeIds = filletEdgeIds.length > 0 ? filletEdgeIds : existingEdgeIds;
    const edgeIdsStr = edgeIds.join(',');
    if (editing) {
      updateFeatureParams(editing.id, { ...params, edgeIds: edgeIdsStr });
      renameFeature(editing.id, `Fillet (r=${params.radius})`);
      setStatusMessage(`Updated fillet: r=${params.radius}`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Fillet (r=${params.radius})`,
        type: 'fillet',
        params: { ...params, edgeIds: edgeIdsStr },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      // Actually round the geometry (was previously a no-op stub).
      commitFillet(params.radius, 4);
    }
    onClose();
  };

  return (
    <FilletDialogUI
      open={true}
      selectedEdgeCount={filletEdgeIds.length || existingEdgeIds.length}
      onClose={onClose}
      onConfirm={handleConfirm}
    />
  );
}
