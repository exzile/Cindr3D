import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function OffsetFaceDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);

  const [offsetDistance, setOffsetDistance] = useState(Number(p.offsetDistance ?? 1));
  const [direction, setDirection] = useState<'outward' | 'inward'>((p.direction as 'outward' | 'inward') ?? 'outward');
  const [extent, setExtent] = useState<'distance' | 'all'>((p.extent as 'distance' | 'all') ?? 'distance');

  const handleOK = () => {
    if (editing) {
      updateFeatureParams(editing.id, { offsetDistance, direction, extent, isOffsetFace: true });
    } else {
      const n = features.filter((f) => f.name.startsWith('Offset Face')).length + 1;
      addFeature({
        id: crypto.randomUUID(),
        name: `Offset Face ${n}`,
        type: 'offset-face',
        params: { offsetDistance, direction, extent, isOffsetFace: true },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      });
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel">
        <div className="dialog-header">
          <span className="dialog-title">{editing ? 'Edit Offset Face' : 'Offset Face'}</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="dialog-field">
            <label className="dialog-label">Offset Distance (mm)</label>
            <input
              className="dialog-input"
              type="number"
              step={0.1}
              value={offsetDistance}
              onChange={(e) => setOffsetDistance(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Direction</label>
            <select
              className="dialog-select"
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'outward' | 'inward')}
            >
              <option value="outward">Outward</option>
              <option value="inward">Inward</option>
            </select>
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Extent</label>
            <select
              className="dialog-select"
              value={extent}
              onChange={(e) => setExtent(e.target.value as 'distance' | 'all')}
            >
              <option value="distance">Distance</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}
