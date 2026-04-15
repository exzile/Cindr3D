import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function RigidGroupDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);

  const n = features.filter((f) => f.name.startsWith('Rigid Group')).length + 1;
  const [componentNames, setComponentNames] = useState('');
  const [groupName, setGroupName] = useState(`Rigid Group ${n}`);

  const handleOK = () => {
    const components = componentNames
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    addFeature({
      id: crypto.randomUUID(),
      name: groupName || `Rigid Group ${n}`,
      type: 'import',
      params: { isRigidGroup: true, components: components.join(','), groupName: groupName || `Rigid Group ${n}` },
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
          <span className="dialog-title">Rigid Group</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="dialog-field">
            <label className="dialog-label">Name</label>
            <input
              className="dialog-input"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Components (one per line)</label>
            <textarea
              className="dialog-input"
              rows={5}
              placeholder="Enter component names, one per line"
              value={componentNames}
              onChange={(e) => setComponentNames(e.target.value)}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
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
