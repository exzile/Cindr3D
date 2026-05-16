import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function CircularPatternDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitCircularPattern = useCADStore((s) => s.commitCircularPattern);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const meshFeatures = features.filter((f) => f.mesh != null);

  const [featureId, setFeatureId] = useState(meshFeatures[0]?.id ?? '');
  const [count, setCount] = useState(6);
  const [totalAngle, setTotalAngle] = useState(360);
  const [axis, setAxis] = useState<'X' | 'Y' | 'Z'>('Y');
  const [originX, setOriginX] = useState(0);
  const [originY, setOriginY] = useState(0);
  const [originZ, setOriginZ] = useState(0);
  const [computeType, setComputeType] = useState<'identical' | 'adjusted' | 'optimized'>('identical');

  const axisVec: Record<'X' | 'Y' | 'Z', [number, number, number]> = {
    X: [1, 0, 0],
    Y: [0, 1, 0],
    Z: [0, 0, 1],
  };

  const handleApply = () => {
    if (!featureId) {
      setStatusMessage('Circular Pattern: select a feature first');
      return;
    }
    const [ax, ay, az] = axisVec[axis];
    commitCircularPattern(featureId, {
      axisX: ax, axisY: ay, axisZ: az,
      originX, originY, originZ,
      count, totalAngle,
    });
    onClose();
  };

  return (
    <DialogShell title="Circular Pattern" onClose={onClose} size="sm" onConfirm={handleApply}>
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
        <label>Axis</label>
        <select value={axis} onChange={(e) => setAxis(e.target.value as 'X' | 'Y' | 'Z')}>
          <option value="X">X Axis</option>
          <option value="Y">Y Axis</option>
          <option value="Z">Z Axis</option>
        </select>
      </div>
      <div className="settings-grid">
        <div className="form-group">
          <label>Count</label>
          <input type="number" value={count} onChange={(e) => setCount(Math.max(2, parseInt(e.target.value) || 2))} min={2} max={100} />
        </div>
        <div className="form-group">
          <label>Total Angle (°)</label>
          <input type="number" value={totalAngle} onChange={(e) => setTotalAngle(parseFloat(e.target.value) || 360)} min={1} max={360} />
        </div>
      </div>
      <div className="form-group">
        <label>Compute Type</label>
        <select value={computeType} onChange={(e) => setComputeType(e.target.value as 'identical' | 'adjusted' | 'optimized')}>
          <option value="identical">Identical</option>
          <option value="adjusted">Adjusted</option>
          <option value="optimized">Optimized</option>
        </select>
      </div>
      <div className="form-group">
        <label>Axis Origin (X, Y, Z)</label>
        <div className="direction-inputs">
          <input type="number" value={originX} onChange={(e) => setOriginX(parseFloat(e.target.value) || 0)} step={1} />
          <input type="number" value={originY} onChange={(e) => setOriginY(parseFloat(e.target.value) || 0)} step={1} />
          <input type="number" value={originZ} onChange={(e) => setOriginZ(parseFloat(e.target.value) || 0)} step={1} />
        </div>
      </div>
    </DialogShell>
  );
}
