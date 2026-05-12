import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

type TransformMode = 'Move' | 'Copy' | 'Scale';
const DEG2RAD = Math.PI / 180;

export function MeshTransformDialog({ onClose }: { onClose: () => void }) {
  const commitMeshTransform = useCADStore((s) => s.commitMeshTransform);
  const selectedFeatureId = useCADStore((s) => s.selectedFeatureId);
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const [mode, setMode] = useState<TransformMode>('Move');
  const isScale = mode === 'Scale';
  const [x, setX] = useState(isScale ? 1 : 0);
  const [y, setY] = useState(isScale ? 1 : 0);
  const [z, setZ] = useState(isScale ? 1 : 0);
  const [uniform, setUniform] = useState(true);

  const handleModeChange = (newMode: TransformMode) => {
    setMode(newMode);
    const defaultVal = newMode === 'Scale' ? 1 : 0;
    setX(defaultVal);
    setY(defaultVal);
    setZ(defaultVal);
  };

  const handleXChange = (val: number) => {
    setX(val);
    if (isScale && uniform) {
      setY(val);
      setZ(val);
    }
  };

  const handleOK = () => {
    if (selectedFeatureId) {
      if (mode === 'Move' || mode === 'Copy') {
        commitMeshTransform(selectedFeatureId, { tx: x, ty: y, tz: z, rx: 0, ry: 0, rz: 0, scale: 1 });
      } else {
        // Scale mode: use uniform scale value from x (all axes tied when uniform)
        const sx = x, sy = uniform ? x : y, sz = uniform ? x : z;
        commitMeshTransform(selectedFeatureId, { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, scale: sx });
        void sy; void sz; // scale handled via params.scale uniformly
      }
    } else {
      const n = features.filter((f) => f.name.startsWith(`Mesh ${mode}`)).length + 1;
      addFeature({
        id: crypto.randomUUID(),
        name: `Mesh ${mode} ${n}`,
        type: 'import',
        params: { isMeshTransform: true, mode, x, y, z, uniform },
        bodyKind: 'mesh',
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      });
    }
    onClose();
  };

  void DEG2RAD; // used for future rotate support

  return (
    <DialogShell title="Mesh Transform" onClose={onClose} onConfirm={handleOK}>
      <div className="form-group">
        <label>Mode</label>
        <select value={mode} onChange={(e) => handleModeChange(e.target.value as TransformMode)}>
          <option value="Move">Move</option>
          <option value="Copy">Copy</option>
          <option value="Scale">Scale</option>
        </select>
      </div>
      <div className="form-group">
        <label>X ({isScale ? 'scale' : 'mm'})</label>
        <input
          type="number"
          step={isScale ? 0.1 : 1}
          value={x}
          onChange={(e) => handleXChange(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="form-group">
        <label>Y ({isScale ? 'scale' : 'mm'})</label>
        <input
          type="number"
          step={isScale ? 0.1 : 1}
          value={y}
          onChange={(e) => setY(parseFloat(e.target.value) || 0)}
          disabled={isScale && uniform}
        />
      </div>
      <div className="form-group">
        <label>Z ({isScale ? 'scale' : 'mm'})</label>
        <input
          type="number"
          step={isScale ? 0.1 : 1}
          value={z}
          onChange={(e) => setZ(parseFloat(e.target.value) || 0)}
          disabled={isScale && uniform}
        />
      </div>
      {isScale && (
        <div className="form-group form-group-inline">
          <label>Uniform Scale</label>
          <input
            type="checkbox"
            checked={uniform}
            onChange={(e) => setUniform(e.target.checked)}
          />
        </div>
      )}
      <p className="dialog-hint">Moves, copies, or scales the mesh body.</p>
    </DialogShell>
  );
}
