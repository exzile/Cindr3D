import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import { useComponentStore } from '../../../store/componentStore';

type PatternType = 'linear' | 'circular';
type Axis = 'X' | 'Y' | 'Z';

export function ComponentPatternDialog({ onClose }: { onClose: () => void }) {
  const [patternType, setPatternType] = useState<PatternType>('linear');
  const [sourceId, setSourceId] = useState('');
  const [axis, setAxis] = useState<Axis>('X');
  const [count, setCount] = useState(3);
  const [spacing, setSpacing] = useState(20);
  const [circularAxis, setCircularAxis] = useState<Axis>('Y');
  const [circularCount, setCircularCount] = useState(4);

  const components = useComponentStore((s) => s.components);
  const createComponentPattern = useCADStore((s) => s.createComponentPattern);

  // Only child components (non-root) are valid pattern sources
  const pickable = Object.values(components).filter((c) => c.parentId !== null);

  const handleApply = () => {
    if (!sourceId) return;
    createComponentPattern(sourceId, patternType, { axis, count, spacing, circularAxis, circularCount });
    onClose();
  };

  return (
    <DialogShell title="Component Pattern" onClose={onClose} size="sm" onConfirm={handleApply} confirmLabel="Create Pattern" confirmDisabled={!sourceId}>
          <div className="form-group">
            <label>Source Component</label>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">— select component —</option>
              {pickable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Pattern Type</label>
            <div className="btn-group">
              {(['linear', 'circular'] as PatternType[]).map((t) => (
                <button key={t}
                  className={`btn btn-sm ${patternType === t ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setPatternType(t)}>
                  {t === 'linear' ? 'Linear' : 'Circular'}
                </button>
              ))}
            </div>
          </div>
          {patternType === 'linear' ? (
            <>
              <div className="form-group">
                <label>Axis</label>
                <select value={axis} onChange={(e) => setAxis(e.target.value as Axis)}>
                  <option value="X">X Axis</option>
                  <option value="Y">Y Axis</option>
                  <option value="Z">Z Axis</option>
                </select>
              </div>
              <div className="form-group">
                <label>Count</label>
                <input type="number" min={2} max={100} value={count}
                  onChange={(e) => setCount(Number(e.target.value))} />
              </div>
              <div className="form-group">
                <label>Spacing (mm)</label>
                <input type="number" min={0.1} step={1} value={spacing}
                  onChange={(e) => setSpacing(Number(e.target.value))} />
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label>Rotation Axis</label>
                <select value={circularAxis} onChange={(e) => setCircularAxis(e.target.value as Axis)}>
                  <option value="X">X Axis</option>
                  <option value="Y">Y Axis</option>
                  <option value="Z">Z Axis</option>
                </select>
              </div>
              <div className="form-group">
                <label>Count</label>
                <input type="number" min={2} max={100} value={circularCount}
                  onChange={(e) => setCircularCount(Number(e.target.value))} />
              </div>
            </>
          )}
    </DialogShell>
  );
}
