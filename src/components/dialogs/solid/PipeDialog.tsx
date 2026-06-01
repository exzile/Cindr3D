import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import '../common/ToolPanel.css';

export function PipeDialog({ onClose }: { onClose: () => void }) {
  const sketches = useCADStore((s) => s.sketches);
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const commitPipe = useCADStore((s) => s.commitPipe);
  const updatePipeGeometry = useCADStore((s) => s.updatePipeGeometry);

  const [pathSketchId, setPathSketchId] = useState<string>(
    (p.pathSketchId as string) ?? (sketches[0]?.id ?? ''),
  );
  const [outerDiameter, setOuterDiameter] = useState(Number(p.outerDiameter ?? 10));
  const [hollow, setHollow] = useState<boolean>(p.hollow !== false);
  const [wallThickness, setWallThickness] = useState(Number(p.wallThickness ?? 1));
  const [operation, setOperation] = useState<'new-body' | 'join' | 'cut'>(
    (p.operation as 'new-body' | 'join' | 'cut') ?? 'new-body',
  );

  const handleApply = () => {
    const params = { outerDiameter, hollow, wallThickness, operation, pathSketchId };
    if (editing) {
      updatePipeGeometry(editing.id, params);
    } else {
      commitPipe(params);
    }
    onClose();
  };

  return (
    <div className="tool-panel-overlay">
      <div className="tool-panel" style={{ width: 272 }}>
        <div className="tp-header">
          <div className="tp-header-icon" style={{ background: '#0891b2' }} />
          <span className="tp-header-title">{editing ? 'EDIT PIPE' : 'PIPE'}</span>
          <button className="tp-close" onClick={onClose} title="Cancel"><X size={14} /></button>
        </div>

        <div className="tp-body">
          <div className="tp-section">
            <div className="tp-row">
              <span className="tp-label">Path Sketch</span>
              <select className="tp-select" value={pathSketchId}
                onChange={(e) => setPathSketchId(e.target.value)}>
                {sketches.length === 0
                  ? <option value="">— no sketches —</option>
                  : sketches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
                }
              </select>
            </div>

            <div className="tp-row">
              <span className="tp-label">Outer Ø</span>
              <div className="tp-input-group">
                <input
                  type="number"
                  value={outerDiameter}
                  step={0.5}
                  min={0.1}
                  onChange={(e) => setOuterDiameter(Math.max(0.1, parseFloat(e.target.value) || 10))}
                />
                <span className="tp-unit">mm</span>
              </div>
            </div>

            <div className="tp-row">
              <span className="tp-label">Hollow</span>
              <label className="tp-toggle">
                <input type="checkbox" checked={hollow} onChange={(e) => setHollow(e.target.checked)} />
                <span className="tp-toggle-track" />
              </label>
            </div>

            {hollow && (
              <div className="tp-row">
                <span className="tp-label">Wall</span>
                <div className="tp-input-group">
                  <input
                    type="number"
                    value={wallThickness}
                    step={0.1}
                    min={0.01}
                    onChange={(e) => setWallThickness(Math.max(0.01, parseFloat(e.target.value) || 1))}
                  />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
            )}

            <div className="tp-divider" />

            <div className="tp-row">
              <span className="tp-label">Operation</span>
              <select className="tp-select" value={operation}
                onChange={(e) => setOperation(e.target.value as 'new-body' | 'join' | 'cut')}>
                <option value="new-body">New Body</option>
                <option value="join">Join</option>
                <option value="cut">Cut</option>
              </select>
            </div>
          </div>
        </div>

        <div className="tp-actions">
          <button className="tp-btn tp-btn-cancel" onClick={onClose}>
            <X size={13} /> Cancel
          </button>
          <button className="tp-btn tp-btn-ok" onClick={handleApply}>
            <Check size={13} /> {editing ? 'Update' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
