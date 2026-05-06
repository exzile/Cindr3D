import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature, BooleanOperation } from '../../../types/cad';

type CombineOperation = Extract<BooleanOperation, 'join' | 'cut' | 'intersect'>;

export function CombineDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const [operation, setOperation] = useState<CombineOperation>((p.operation as CombineOperation) ?? 'join');
  const [keepTools, setKeepTools] = useState(p.keepTools !== false && !!p.keepTools);
  const [targetId, setTargetId] = useState<string>(String(p.targetId ?? ''));
  const [toolId, setToolId] = useState<string>(String(p.toolId ?? ''));

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const commitCombine = useCADStore((s) => s.commitCombine);
  const recommitCombine = useCADStore((s) => s.recommitCombine);

  const meshFeatures = features.filter((f) => !!f.mesh);

  const handleApply = () => {
    if (editing) {
      recommitCombine(editing.id, { operation, keepTools, targetId, toolId });
    } else if (targetId && toolId) {
      commitCombine(targetId, toolId, operation, keepTools);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Combine (${operation})`,
        type: 'combine',
        params: { operation, keepTools, targetId, toolId },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Created ${operation} operation${keepTools ? ' (keep tools)' : ''}`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Combine Bodies' : 'Combine Bodies'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Target Body</label>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">(select target)</option>
              {meshFeatures.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Tool Body</label>
            <select value={toolId} onChange={(e) => setToolId(e.target.value)}>
              <option value="">(select tool)</option>
              {meshFeatures.filter((f) => f.id !== targetId).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as CombineOperation)}>
              <option value="join">Join (Union)</option>
              <option value="cut">Cut (Subtract)</option>
              <option value="intersect">Intersect</option>
            </select>
          </div>
          <div className="boolean-preview">
            <div className="boolean-diagram">
              {operation === 'join' && <div className="bool-icon join">A + B</div>}
              {operation === 'cut' && <div className="bool-icon cut">A - B</div>}
              {operation === 'intersect' && <div className="bool-icon intersect">A &cap; B</div>}
            </div>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={keepTools} onChange={(e) => setKeepTools(e.target.checked)} />
            Keep Tools (preserve tool bodies)
          </label>
          <p className="dialog-hint">Select a target body and a tool body to combine.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}
