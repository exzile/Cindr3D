import { useState } from 'react';
import { X } from 'lucide-react';
import { useComponentStore } from '../../../store/componentStore';
import { useCADStore } from '../../../store/cadStore';

export function RigidGroupDialog({ onClose }: { onClose: () => void }) {
  const addRigidGroup    = useComponentStore((s) => s.addRigidGroup);
  const rigidGroups      = useComponentStore((s) => s.rigidGroups);
  const components       = useComponentStore((s) => s.components);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const n = rigidGroups.length + 1;
  const [groupName, setGroupName]       = useState(`Rigid Group ${n}`);
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());

  const componentList = Object.values(components);

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOK = () => {
    const ids = Array.from(selectedIds);
    if (ids.length < 2) {
      setStatusMessage('Rigid Group: select at least 2 components');
      return;
    }
    addRigidGroup(ids, groupName || `Rigid Group ${n}`);
    setStatusMessage(`Created rigid group: ${groupName || `Rigid Group ${n}`}`);
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
            <label className="dialog-label">Components</label>
            <div style={{ border: '1px solid var(--border)', borderRadius: 4, maxHeight: 180, overflowY: 'auto', padding: '4px 0' }}>
              {componentList.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 12, padding: '4px 8px', margin: 0 }}>
                  No components available.
                </p>
              ) : (
                componentList.map((comp) => (
                  <label
                    key={comp.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', cursor: 'pointer', fontSize: 13 }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(comp.id)}
                      onChange={() => toggleId(comp.id)}
                    />
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: comp.color,
                        flexShrink: 0,
                      }}
                    />
                    {comp.name}
                  </label>
                ))
              )}
            </div>
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
