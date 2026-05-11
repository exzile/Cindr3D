import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

type Axis = 'X' | 'Y' | 'Z';

const AXIS_PRESETS: Record<Axis, [number, number, number]> = {
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1],
};

export function RectangularPatternDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitLinearPattern = useCADStore((s) => s.commitLinearPattern);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const meshFeatures = features.filter((f) => f.mesh != null);

  const [featureId, setFeatureId] = useState(meshFeatures[0]?.id ?? '');
  const [dir1, setDir1] = useState<[number, number, number]>([1, 0, 0]);
  const [count1, setCount1] = useState(3);
  const [spacing1, setSpacing1] = useState(20);
  const [dir2, setDir2] = useState<[number, number, number]>([0, 0, 1]);
  const [count2, setCount2] = useState(3);
  const [spacing2, setSpacing2] = useState(20);

  const handleDir1Preset = (axis: Axis) => setDir1(AXIS_PRESETS[axis]);
  const handleDir2Preset = (axis: Axis) => setDir2(AXIS_PRESETS[axis]);

  const handleApply = () => {
    if (!featureId) {
      setStatusMessage('Rectangular Pattern: select a feature first');
      return;
    }
    commitLinearPattern(featureId, {
      dirX: dir1[0], dirY: dir1[1], dirZ: dir1[2],
      spacing: spacing1,
      count: count1,
      dir2X: dir2[0], dir2Y: dir2[1], dir2Z: dir2[2],
      spacing2,
      count2,
    });
    onClose();
  };

  return (
    <DialogShell title="Rectangular Pattern" onClose={onClose} size="sm" onConfirm={handleApply} confirmDisabled={!featureId}>
      <div className="form-group">
        <label>Feature</label>
        <select value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
          {meshFeatures.length === 0 && <option value="">— no features —</option>}
          {meshFeatures.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>

      {/* Direction 1 */}
      <div className="form-group">
        <label>Direction 1 Axis</label>
        <div className="direction-inputs">
          {(['X', 'Y', 'Z'] as Axis[]).map((ax) => (
            <button key={ax} type="button" className="btn btn-secondary" onClick={() => handleDir1Preset(ax)}>{ax}</button>
          ))}
        </div>
      </div>
      <div className="settings-grid">
        <div className="form-group">
          <label>Count 1</label>
          <input type="number" value={count1} min={2} max={100} onChange={(e) => setCount1(Math.max(2, parseInt(e.target.value) || 2))} />
        </div>
        <div className="form-group">
          <label>Spacing 1 (mm)</label>
          <input type="number" value={spacing1} min={0.1} step={1} onChange={(e) => setSpacing1(parseFloat(e.target.value) || 20)} />
        </div>
      </div>

      {/* Direction 2 */}
      <div className="form-group">
        <label>Direction 2 Axis</label>
        <div className="direction-inputs">
          {(['X', 'Y', 'Z'] as Axis[]).map((ax) => (
            <button key={ax} type="button" className="btn btn-secondary" onClick={() => handleDir2Preset(ax)}>{ax}</button>
          ))}
        </div>
      </div>
      <div className="settings-grid">
        <div className="form-group">
          <label>Count 2</label>
          <input type="number" value={count2} min={2} max={100} onChange={(e) => setCount2(Math.max(2, parseInt(e.target.value) || 2))} />
        </div>
        <div className="form-group">
          <label>Spacing 2 (mm)</label>
          <input type="number" value={spacing2} min={0.1} step={1} onChange={(e) => setSpacing2(parseFloat(e.target.value) || 20)} />
        </div>
      </div>

      <p className="dialog-hint">
        Creates a {count1} × {count2} grid ({count1 * count2} total instances).
      </p>
    </DialogShell>
  );
}
