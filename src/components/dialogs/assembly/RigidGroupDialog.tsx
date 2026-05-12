import { useState } from 'react';
import { useComponentStore } from '../../../store/componentStore';
import { DialogShell } from '../common/DialogShell';
import { useCADStore } from '../../../store/cadStore';
import './RigidGroupDialog.css';

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
    <DialogShell title="Rigid Group" onClose={onClose} onConfirm={handleOK}>
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
            <div className="rigid-group__list">
              {componentList.length === 0 ? (
                <p className="rigid-group__empty">
                  No components available.
                </p>
              ) : (
                componentList.map((comp) => (
                  <label key={comp.id} className="rigid-group__item">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(comp.id)}
                      onChange={() => toggleId(comp.id)}
                    />
                    <span
                      className="rigid-group__color-dot"
                      style={{ background: comp.color }}
                    />
                    {comp.name}
                  </label>
                ))
              )}
            </div>
          </div>
    </DialogShell>
  );
}
