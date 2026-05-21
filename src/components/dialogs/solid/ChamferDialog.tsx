import { useState, useEffect, useMemo } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import type { Feature } from '../../../types/cad';
import { parseEdgeLabel } from '../../../utils/geometry/edgeCutCore';
import {
  type ChamferMode,
  type ChamferCornerType,
  type ChamferParams,
  resolveChamferDistance2,
  resolveChamferDistances,
} from '../../../utils/geometry/chamferGeometry';

export type { ChamferMode, ChamferCornerType, ChamferParams };
export { resolveChamferDistance2, resolveChamferDistances };

interface ChamferDialogProps {
  open: boolean;
  selectedEdgeCount: number;
  edgeIds: string[];
  onRemoveEdge: (id: string) => void;
  onClose: () => void;
  onConfirm: (params: ChamferParams) => void;
}

function ChamferDialogUI({ open, selectedEdgeCount, edgeIds, onRemoveEdge, onClose, onConfirm }: ChamferDialogProps) {
  // Memo edge labels: the dialog re-renders on every chamferLiveDistance
  // change (gizmo drag, ~60Hz), but edgeIds only changes when the user adds
  // or removes an edge.
  const edgeLabels = useMemo(() => edgeIds.map((id, i) => parseEdgeLabel(id, i)), [edgeIds]);
  // chamferLiveDistance is updated by ChamferGizmo drags so the dialog
  // reflects the distance while the user drags the on-canvas handle.
  const chamferLiveDistance = useCADStore((s) => s.chamferLiveDistance);
  const setChamferLiveDistance = useCADStore((s) => s.setChamferLiveDistance);
  const [mode, setMode] = useState<ChamferMode>('equal-dist');
  const [distance, setDistance] = useState(() => chamferLiveDistance);
  // Sync gizmo drag → dialog input (no loop: input onChange only fires on user events).
  useEffect(() => { setDistance(chamferLiveDistance); }, [chamferLiveDistance]);
  const [distance2, setDistance2] = useState(2);
  const [angle, setAngle] = useState(45);
  const [propagate, setPropagate] = useState(true);
  const [isFlipped, setIsFlipped] = useState(false);
  const [cornerType, setCornerType] = useState<ChamferCornerType>('patch');

  if (!open) return null;

  const handleOK = () => {
    const params: ChamferParams = {
      mode,
      distance,
      edgeIds: [],
      propagate,
      cornerType,
    };
    if (mode === 'two-dist') {
      params.distance2 = distance2;
      params.isFlipped = isFlipped;
    }
    if (mode === 'dist-angle') {
      params.angle = angle;
      params.isFlipped = isFlipped;
    }
    onConfirm(params);
  };

  const clamp = (val: number, min: number, max: number) =>
    Math.max(min, Math.min(max, val));

  return (
    <DialogShell
      title="Chamfer"
      onClose={onClose}
      size="sm"
      overlayClassName="edge-pick-dialog"
      onConfirm={handleOK}
      confirmDisabled={selectedEdgeCount === 0}
    >
      <p className="dialog-hint">
        {selectedEdgeCount} edge(s) selected
      </p>

      {edgeIds.length > 0 && (
        <div style={{ maxHeight: 110, overflowY: 'auto', border: '1px solid #444', borderRadius: 4, marginBottom: 8 }}>
          {edgeIds.map((id, i) => (
            <div
              key={id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '3px 6px',
                borderBottom: i < edgeIds.length - 1 ? '1px solid #333' : 'none',
                fontSize: 11,
              }}
            >
              <span style={{ fontFamily: 'monospace', color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 4 }}>
                {edgeLabels[i]}
              </span>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cc4444', padding: '0 2px', fontSize: 14, lineHeight: 1 }}
                onClick={() => onRemoveEdge(id)}
                title="Remove edge"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="form-group">
        <label>Mode</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as ChamferMode)}
        >
          <option value="equal-dist">Equal Distance</option>
          <option value="two-dist">Two Distances</option>
          <option value="dist-angle">Distance + Angle</option>
          <option value="three-face">Three Face</option>
        </select>
      </div>

      {mode === 'three-face' ? (
        <p className="dialog-hint">
          Select edges at the intersection of three faces. The chamfer is
          automatically sized to blend all three faces tangentially.
        </p>
      ) : (
        <div className="form-group">
          <label>Distance (mm)</label>
          <input
            type="number"
            value={distance}
            onChange={(e) => {
              const d = clamp(parseFloat(e.target.value) || 2, 0.01, 500);
              setDistance(d);
              setChamferLiveDistance(d);
            }}
            min={0.01}
            max={500}
            step={0.5}
          />
        </div>
      )}

      {mode === 'two-dist' && (
        <div className="form-group">
          <label>Distance 2 (mm)</label>
          <input
            type="number"
            value={distance2}
            onChange={(e) => setDistance2(clamp(parseFloat(e.target.value) || 2, 0.01, 500))}
            min={0.01}
            max={500}
            step={0.5}
          />
        </div>
      )}

      {mode === 'dist-angle' && (
        <div className="form-group">
          <label>Angle (°)</label>
          <input
            type="number"
            value={angle}
            onChange={(e) => setAngle(clamp(parseFloat(e.target.value) || 45, 1, 89))}
            min={1}
            max={89}
            step={1}
          />
        </div>
      )}

      {(mode === 'two-dist' || mode === 'dist-angle') && (
        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={isFlipped}
              onChange={(e) => setIsFlipped(e.target.checked)}
            />
            Flip Faces
          </label>
        </div>
      )}

      <div className="form-group">
        <label>Corner Type</label>
        <select value={cornerType} onChange={(e) => setCornerType(e.target.value as ChamferCornerType)}>
          <option value="patch">Patch</option>
          <option value="miter">Miter</option>
        </select>
      </div>

      {mode !== 'three-face' && (
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
      )}
    </DialogShell>
  );
}

// ── Store-connected wrapper (used via activeDialog='chamfer') ────────────────
export function ChamferDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const chamferEdgeIds = useCADStore((s) => s.chamferEdgeIds);
  const removeChamferEdge = useCADStore((s) => s.removeChamferEdge);
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const commitChamfer = useCADStore((s) => s.commitChamfer);
  const replayEdgeCutFeature = useCADStore((s) => s.replayEdgeCutFeature);

  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const handleConfirm = (params: ChamferParams) => {
    const edgeIds = chamferEdgeIds.length > 0 ? chamferEdgeIds : (typeof p.edgeIds === 'string' ? p.edgeIds.split(',').filter(Boolean) : []);
    const edgeIdsStr = edgeIds.join(',');
    if (editing) {
      updateFeatureParams(editing.id, { ...params, edgeIds: edgeIdsStr });
      // Re-run CSG with the updated params.
      replayEdgeCutFeature(editing.id);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Chamfer (d=${params.distance})`,
        type: 'chamfer',
        params: { ...params, edgeIds: edgeIdsStr },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      // Close immediately so the UI is responsive; defer the CSG compute.
      // chamferEdgeIds stays in the store until the next chamfer dialog open.
      onClose();
      const [d1, d2] = resolveChamferDistances(params);
      // Pass featureId so the non-destructive path stores the result on the
      // chamfer node instead of mutating the parent.
      setTimeout(() => commitChamfer(d1, d2, feature.id, params as Record<string, unknown>), 0);
      return;
    }
    onClose();
  };

  return (
    <ChamferDialogUI
      open={true}
      selectedEdgeCount={chamferEdgeIds.length}
      edgeIds={chamferEdgeIds}
      onRemoveEdge={removeChamferEdge}
      onClose={onClose}
      onConfirm={handleConfirm}
    />
  );
}
