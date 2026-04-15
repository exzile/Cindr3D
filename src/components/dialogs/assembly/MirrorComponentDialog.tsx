import { useState } from 'react';
import { X } from 'lucide-react';
import type { Component, ConstructionPlane } from '../../../types/cad';

export interface MirrorComponentParams {
  componentId: string;
  mirrorPlane: 'XY' | 'XZ' | 'YZ' | string;
  createLinked: boolean;
}

interface Props {
  open: boolean;
  components: Component[];
  constructionPlanes: ConstructionPlane[];
  onOk: (params: MirrorComponentParams) => void;
  onClose: () => void;
}

export function MirrorComponentDialog({ open, components, constructionPlanes, onOk, onClose }: Props) {
  const [componentId, setComponentId] = useState('');
  const [mirrorPlane, setMirrorPlane] = useState<string>('XY');
  const [createLinked, setCreateLinked] = useState(false);

  if (!open) return null;

  const pickable = components.filter((c) => c.parentId !== null);

  const handleOk = () => {
    if (!componentId) return;
    onOk({ componentId, mirrorPlane, createLinked });
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Mirror Component</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Component</label>
            <select value={componentId} onChange={(e) => setComponentId(e.target.value)}>
              <option value="">— select component —</option>
              {pickable.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Mirror Plane</label>
            <select value={mirrorPlane} onChange={(e) => setMirrorPlane(e.target.value)}>
              <option value="XY">XY Plane</option>
              <option value="XZ">XZ Plane</option>
              <option value="YZ">YZ Plane</option>
              {constructionPlanes.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={createLinked}
                onChange={(e) => setCreateLinked(e.target.checked)}
              />
              Create Linked Copy
            </label>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOk} disabled={!componentId}>
            Mirror
          </button>
        </div>
      </div>
    </div>
  );
}
