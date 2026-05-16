import { useState, useEffect } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import type { Feature } from '../../../types/cad';

const clampDeg = (a: number) => Math.max(1, Math.min(89, a));

/**
 * Resolve the face-2 setback from the dialog mode (mirrors Fusion):
 *  - equal-dist / three-face → equal to face-1 distance
 *  - two-dist                → explicit second distance
 *  - dist-angle              → distance · tan(angle from face 1)
 */
export function resolveChamferDistance2(p: ChamferParams): number {
  if (p.mode === 'two-dist') return p.distance2 ?? p.distance;
  if (p.mode === 'dist-angle') {
    const a = clampDeg(p.angle ?? 45);
    return Math.max(0.01, p.distance * Math.tan((a * Math.PI) / 180));
  }
  return p.distance;
}

/** SOL-I6: 'three-face' added per Fusion SDK ThreeEdgeChamferEdge */
export type ChamferMode = 'equal-dist' | 'two-dist' | 'dist-angle' | 'three-face';

export interface ChamferParams {
  mode: ChamferMode;
  distance: number;
  distance2?: number;
  angle?: number;
  edgeIds: string[];
  propagate: boolean;
}

interface ChamferDialogProps {
  open: boolean;
  selectedEdgeCount: number;
  onClose: () => void;
  onConfirm: (params: ChamferParams) => void;
}

function ChamferDialogUI({ open, selectedEdgeCount, onClose, onConfirm }: ChamferDialogProps) {
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

  if (!open) return null;

  const handleOK = () => {
    const params: ChamferParams = {
      mode,
      distance,
      edgeIds: [],
      propagate,
    };
    if (mode === 'two-dist') {
      params.distance2 = distance2;
    }
    if (mode === 'dist-angle') {
      params.angle = angle;
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
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const commitChamfer = useCADStore((s) => s.commitChamfer);

  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const handleConfirm = (params: ChamferParams) => {
    const edgeIds = chamferEdgeIds.length > 0 ? chamferEdgeIds : (typeof p.edgeIds === 'string' ? p.edgeIds.split(',').filter(Boolean) : []);
    const edgeIdsStr = edgeIds.join(',');
    if (editing) {
      updateFeatureParams(editing.id, { ...params, edgeIds: edgeIdsStr });
      setStatusMessage(`Updated chamfer: d=${params.distance}`);
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
      // Actually bevel the geometry (was previously a no-op stub, exactly as
      // commitFillet was before the fillet fix). The dialog mode resolves the
      // face-2 setback; the gizmo/preview drive the primary distance.
      commitChamfer(params.distance, resolveChamferDistance2(params));
    }
    onClose();
  };

  return (
    <ChamferDialogUI
      open={true}
      selectedEdgeCount={chamferEdgeIds.length}
      onClose={onClose}
      onConfirm={handleConfirm}
    />
  );
}
