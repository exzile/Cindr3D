import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function PlaneCutDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const [plane, setPlane] = useState<'XY' | 'XZ' | 'YZ'>('XY');
  const [offset, setOffset] = useState(0);
  const [keep, setKeep] = useState<'Above' | 'Below' | 'Both'>('Above');
  const [cap, setCap] = useState<'Open' | 'Closed'>('Closed');

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Plane Cut')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Plane Cut ${n}`,
      type: 'split-body',
      params: { isPlaneCut: true, plane, offset, keep, cap },
      bodyKind: 'mesh',
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    });
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel">
        <div className="dialog-header">
          <span className="dialog-title">Plane Cut</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Plane</label>
            <select value={plane} onChange={(e) => setPlane(e.target.value as typeof plane)}>
              <option value="XY">XY</option>
              <option value="XZ">XZ</option>
              <option value="YZ">YZ</option>
            </select>
          </div>
          <div className="form-group">
            <label>Offset (mm)</label>
            <input
              type="number"
              value={offset}
              onChange={(e) => setOffset(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="form-group">
            <label>Keep</label>
            <select value={keep} onChange={(e) => setKeep(e.target.value as typeof keep)}>
              <option value="Above">Above</option>
              <option value="Below">Below</option>
              <option value="Both">Both</option>
            </select>
          </div>
          <div className="form-group">
            <label>Cap</label>
            <select value={cap} onChange={(e) => setCap(e.target.value as typeof cap)}>
              <option value="Open">Open</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
          <p className="dialog-hint">Trims or splits the mesh body with the selected plane.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}
