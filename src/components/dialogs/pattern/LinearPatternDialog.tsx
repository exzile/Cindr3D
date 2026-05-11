import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function LinearPatternDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitLinearPattern = useCADStore((s) => s.commitLinearPattern);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const meshFeatures = features.filter((f) => f.mesh != null);

  const [featureId, setFeatureId] = useState(meshFeatures[0]?.id ?? '');
  const [count, setCount] = useState(3);
  const [spacing, setSpacing] = useState(20);
  const [distribution, setDistribution] = useState<'spacing' | 'extent'>('spacing');
  const [directionX, setDirectionX] = useState(1);
  const [directionY, setDirectionY] = useState(0);
  const [directionZ, setDirectionZ] = useState(0);
  const [useSecond, setUseSecond] = useState(false);
  const [count2, setCount2] = useState(2);
  const [spacing2, setSpacing2] = useState(20);
  const [distribution2, setDistribution2] = useState<'spacing' | 'extent'>('spacing');
  const [dir2X, setDir2X] = useState(0);
  const [dir2Y, setDir2Y] = useState(0);
  const [dir2Z, setDir2Z] = useState(1);

  const effectiveSpacing = distribution === 'extent' ? spacing / Math.max(1, count - 1) : spacing;
  const effectiveSpacing2 = distribution2 === 'extent' ? spacing2 / Math.max(1, count2 - 1) : spacing2;

  const handleAxisPreset = (axis: 'X' | 'Y' | 'Z') => {
    setDirectionX(axis === 'X' ? 1 : 0);
    setDirectionY(axis === 'Y' ? 1 : 0);
    setDirectionZ(axis === 'Z' ? 1 : 0);
  };

  const handleApply = () => {
    if (!featureId) {
      setStatusMessage('Linear Pattern: select a feature first');
      return;
    }
    commitLinearPattern(featureId, {
      dirX: directionX, dirY: directionY, dirZ: directionZ,
      spacing: effectiveSpacing,
      count,
      ...(useSecond ? {
        dir2X, dir2Y, dir2Z,
        spacing2: effectiveSpacing2,
        count2,
      } : {}),
    });
    onClose();
  };

  return (
    <DialogShell title="Linear Pattern" onClose={onClose} onConfirm={handleApply}>
      <div className="form-group">
        <label>Feature</label>
        <select value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
          {meshFeatures.length === 0 && <option value="">No mesh features</option>}
          {meshFeatures.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="settings-grid">
        <div className="form-group">
          <label>Count</label>
          <input type="number" value={count} onChange={(e) => setCount(Math.max(2, parseInt(e.target.value) || 2))} min={2} max={100} />
        </div>
        <div className="form-group">
          <label>Distribution</label>
          <select value={distribution} onChange={(e) => setDistribution(e.target.value as 'spacing' | 'extent')}>
            <option value="spacing">Spacing</option>
            <option value="extent">Extent</option>
          </select>
        </div>
        <div className="form-group">
          <label>{distribution === 'extent' ? 'Total Extent (mm)' : 'Spacing (mm)'}</label>
          <input type="number" value={spacing} onChange={(e) => setSpacing(parseFloat(e.target.value) || 10)} step={1} />
        </div>
      </div>
      <div className="form-group">
        <label>Direction (X, Y, Z)</label>
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          {(['X', 'Y', 'Z'] as const).map((ax) => (
            <button key={ax} className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => handleAxisPreset(ax)}>{ax} Axis</button>
          ))}
        </div>
        <div className="direction-inputs">
          <input type="number" value={directionX} onChange={(e) => setDirectionX(parseFloat(e.target.value) || 0)} step={0.1} />
          <input type="number" value={directionY} onChange={(e) => setDirectionY(parseFloat(e.target.value) || 0)} step={0.1} />
          <input type="number" value={directionZ} onChange={(e) => setDirectionZ(parseFloat(e.target.value) || 0)} step={0.1} />
        </div>
      </div>
      <label className="checkbox-label">
        <input type="checkbox" checked={useSecond} onChange={(e) => setUseSecond(e.target.checked)} />
        Second Direction
      </label>
      {useSecond && (
        <>
          <div className="form-group">
            <label>Direction 2 (X, Y, Z)</label>
            <div className="direction-inputs">
              <input type="number" value={dir2X} onChange={(e) => setDir2X(parseFloat(e.target.value) || 0)} step={0.1} />
              <input type="number" value={dir2Y} onChange={(e) => setDir2Y(parseFloat(e.target.value) || 0)} step={0.1} />
              <input type="number" value={dir2Z} onChange={(e) => setDir2Z(parseFloat(e.target.value) || 0)} step={0.1} />
            </div>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Count 2</label>
              <input type="number" value={count2} onChange={(e) => setCount2(Math.max(2, parseInt(e.target.value) || 2))} min={2} />
            </div>
            <div className="form-group">
              <label>Distribution 2</label>
              <select value={distribution2} onChange={(e) => setDistribution2(e.target.value as 'spacing' | 'extent')}>
                <option value="spacing">Spacing</option>
                <option value="extent">Extent</option>
              </select>
            </div>
            <div className="form-group">
              <label>{distribution2 === 'extent' ? 'Extent 2 (mm)' : 'Spacing 2 (mm)'}</label>
              <input type="number" value={spacing2} onChange={(e) => setSpacing2(parseFloat(e.target.value) || 10)} />
            </div>
          </div>
        </>
      )}
    </DialogShell>
  );
}
