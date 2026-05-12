import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import type { Feature } from '../../../types/cad';
import '../FeatureDialogExtras.css';

// ── Sub-component: per-face thickness row (SOL-I7) ─────────────────────────
interface FaceRowProps {
  index: number;
  faceId: string;
  thickness: number;
  defaultThickness: number;
  showOverride: boolean;
  onThicknessChange: (id: string, value: number) => void;
  onRemove: (id: string) => void;
}
function FaceRow({ index, faceId, thickness, defaultThickness, showOverride, onThicknessChange, onRemove }: FaceRowProps) {
  return (
    <div className="shell-face-item">
      <span className="shell-face-label">Face {index + 1}</span>
      {showOverride && (
        <input
          className="shell-face-thickness"
          type="number"
          value={thickness}
          min={0.1}
          step={0.5}
          placeholder={String(defaultThickness)}
          onChange={(e) => onThicknessChange(faceId, Math.max(0.1, parseFloat(e.target.value) || defaultThickness))}
          title="Per-face thickness override"
        />
      )}
      <button
        type="button"
        className="icon-btn danger"
        onClick={() => onRemove(faceId)}
        title="Remove face"
      >
        <X size={11} />
      </button>
    </div>
  );
}

// ── Main dialog ────────────────────────────────────────────────────────────
export function ShellDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features         = useCADStore((s) => s.features);
  const editing          = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p                = editing?.params ?? {};

  const bodyFeatures = features.filter((f) => !!f.mesh);

  const [selectedBodyId, setSelectedBodyId] = useState<string>(String(p.bodyId ?? bodyFeatures[0]?.id ?? ''));
  const [thickness, setThickness]   = useState(Number(p.thickness ?? 2));
  const [direction, setDirection]   = useState<'inward' | 'outward' | 'symmetric'>((p.direction as 'inward' | 'outward' | 'symmetric') ?? 'inward');
  const [tangentChain, setTangentChain] = useState(p.tangentChain !== false);
  // SOL-I7: individual face offsets mode
  const [individualOffsets, setIndividualOffsets] = useState(!!(p.individualOffsets));

  const shellRemoveFaceIds     = useCADStore((s) => s.shellRemoveFaceIds);
  const removeShellRemoveFace  = useCADStore((s) => s.removeShellRemoveFace);
  const clearShellRemoveFaces  = useCADStore((s) => s.clearShellRemoveFaces);
  const shellFaceThicknesses   = useCADStore((s) => s.shellFaceThicknesses);
  const setShellFaceThickness  = useCADStore((s) => s.setShellFaceThickness);
  const clearShellFaceThicknesses = useCADStore((s) => s.clearShellFaceThicknesses);

  const addFeature          = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const commitShell         = useCADStore((s) => s.commitShell);
  const setStatusMessage    = useCADStore((s) => s.setStatusMessage);

  const removeFacesStr = shellRemoveFaceIds.join(',');

  const handleApply = () => {
    const params = {
      thickness, direction, tangentChain,
      bodyId: selectedBodyId,
      removeFaces: removeFacesStr,
      individualOffsets,
      faceThicknesses: individualOffsets ? shellFaceThicknesses : {},
    };
    if (editing) {
      updateFeatureParams(editing.id, params);
      if (selectedBodyId) commitShell(selectedBodyId, thickness, direction);
      setStatusMessage(`Updated shell (${thickness}mm ${direction})`);
    } else if (selectedBodyId) {
      commitShell(selectedBodyId, thickness, direction);
      setStatusMessage(`Created ${direction} shell with ${thickness}mm thickness`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Shell (${thickness}mm ${direction})`,
        type: 'shell',
        params,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Created ${direction} shell with ${thickness}mm thickness`);
    }
    clearShellRemoveFaces();
    clearShellFaceThicknesses();
    onClose();
  };

  const handleClose = () => {
    clearShellRemoveFaces();
    clearShellFaceThicknesses();
    onClose();
  };

  return (
    <DialogShell title={editing ? 'Edit Shell' : 'Shell'} onClose={handleClose} size="sm" onConfirm={handleApply}>
      <div className="form-group">
        <label>Body</label>
        <select value={selectedBodyId} onChange={(e) => setSelectedBodyId(e.target.value)}>
          {bodyFeatures.length === 0 && <option value="">— no bodies —</option>}
          {bodyFeatures.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Direction</label>
        <select value={direction} onChange={(e) => setDirection(e.target.value as 'inward' | 'outward' | 'symmetric')}>
          <option value="inward">Inward</option>
          <option value="outward">Outward</option>
          <option value="symmetric">Symmetric</option>
        </select>
      </div>
      <div className="form-group">
        <label>Thickness (mm)</label>
        <input
          type="number"
          value={thickness}
          onChange={(e) => setThickness(parseFloat(e.target.value) || 2)}
          step={0.5}
          min={0.1}
        />
      </div>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={tangentChain}
          onChange={(e) => setTangentChain(e.target.checked)}
        />
        Tangent Chain face selection
      </label>

      {/* SOL-I7: Individual Face Offsets toggle */}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={individualOffsets}
          onChange={(e) => setIndividualOffsets(e.target.checked)}
        />
        Individual Face Offsets
      </label>
      {individualOffsets && (
        <p className="dialog-hint">
          Enter a custom thickness for each selected face. Blank = global thickness.
        </p>
      )}

      {/* SOL-I2: Faces to Remove */}
      <div className="form-group">
        <label>Faces to Remove</label>
        <p className="dialog-hint">
          Click faces in the viewport to add them to the removal set.
        </p>
        {shellRemoveFaceIds.length === 0 ? (
          <p className="dialog-hint">No faces selected — all faces will be shelled.</p>
        ) : (
          <div className="shell-face-list">
            {shellRemoveFaceIds.map((id, i) => (
              <FaceRow
                key={id}
                index={i}
                faceId={id}
                thickness={shellFaceThicknesses[id] ?? thickness}
                defaultThickness={thickness}
                showOverride={individualOffsets}
                onThicknessChange={setShellFaceThickness}
                onRemove={removeShellRemoveFace}
              />
            ))}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => { clearShellRemoveFaces(); clearShellFaceThicknesses(); }}
            >
              Clear All
            </button>
          </div>
        )}
      </div>
    </DialogShell>
  );
}
