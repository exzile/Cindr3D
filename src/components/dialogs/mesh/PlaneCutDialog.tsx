import { useState } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function PlaneCutDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitPlaneCut = useCADStore((s) => s.commitPlaneCut);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const meshFeatures = features.filter((f) => f.mesh != null);

  const [featureId, setFeatureId] = useState(meshFeatures[0]?.id ?? '');
  const [planePreset, setPlanePreset] = useState<'XY' | 'XZ' | 'YZ' | 'Custom'>('XY');
  const [offset, setOffset] = useState(0);
  const [keepSide, setKeepSide] = useState<'positive' | 'negative'>('positive');
  const [customNX, setCustomNX] = useState(0);
  const [customNY, setCustomNY] = useState(1);
  const [customNZ, setCustomNZ] = useState(0);

  const planeNormals: Record<string, [number, number, number]> = {
    XY: [0, 1, 0],
    XZ: [0, 0, 1],
    YZ: [1, 0, 0],
  };

  const handleOK = () => {
    if (!featureId) {
      setStatusMessage('Plane Cut: select a feature first');
      return;
    }
    let nx: number, ny: number, nz: number;
    if (planePreset === 'Custom') {
      [nx, ny, nz] = [customNX, customNY, customNZ];
    } else {
      [nx, ny, nz] = planeNormals[planePreset];
    }
    const normal = new THREE.Vector3(nx, ny, nz);
    commitPlaneCut(featureId, normal, offset, keepSide);
    onClose();
  };

  return (
    <DialogShell title="Plane Cut" onClose={onClose} onConfirm={handleOK}>
      <div className="form-group">
        <label>Feature</label>
        <select value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
          {meshFeatures.length === 0 && <option value="">No mesh features</option>}
          {meshFeatures.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Plane</label>
        <select value={planePreset} onChange={(e) => setPlanePreset(e.target.value as typeof planePreset)}>
          <option value="XY">XY (horizontal)</option>
          <option value="XZ">XZ (front vertical)</option>
          <option value="YZ">YZ (side vertical)</option>
          <option value="Custom">Custom Normal</option>
        </select>
      </div>
      {planePreset === 'Custom' && (
        <div className="form-group">
          <label>Normal (X, Y, Z)</label>
          <div className="direction-inputs">
            <input type="number" value={customNX} onChange={(e) => setCustomNX(parseFloat(e.target.value) || 0)} step={0.1} />
            <input type="number" value={customNY} onChange={(e) => setCustomNY(parseFloat(e.target.value) || 0)} step={0.1} />
            <input type="number" value={customNZ} onChange={(e) => setCustomNZ(parseFloat(e.target.value) || 0)} step={0.1} />
          </div>
        </div>
      )}
      <div className="form-group">
        <label>Offset (mm)</label>
        <input type="number" value={offset} onChange={(e) => setOffset(parseFloat(e.target.value) || 0)} />
      </div>
      <div className="form-group">
        <label>Keep Side</label>
        <select value={keepSide} onChange={(e) => setKeepSide(e.target.value as 'positive' | 'negative')}>
          <option value="positive">Positive (above/front/right)</option>
          <option value="negative">Negative (below/back/left)</option>
        </select>
      </div>
      <p className="dialog-hint">Trims the mesh body with the selected plane.</p>
    </DialogShell>
  );
}
