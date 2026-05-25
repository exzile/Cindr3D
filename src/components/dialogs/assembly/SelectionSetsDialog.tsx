import { useState } from 'react';
import { Plus, Trash2, Tag, Check } from 'lucide-react';
import { DialogShell } from '../common/DialogShell';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import type { SelectionSet } from '../../../types/cad/assembly/relationships';
import './SelectionSetsDialog.css';

export function SelectionSetsDialog({ onClose }: { onClose: () => void }) {
  const selectionSets    = useCADStore((s) => s.selectionSets);
  const addSelectionSet  = useCADStore((s) => s.addSelectionSet);
  const removeSelectionSet = useCADStore((s) => s.removeSelectionSet);
  const renameSelectionSet = useCADStore((s) => s.renameSelectionSet);
  const addBodiesToSelectionSet  = useCADStore((s) => s.addBodiesToSelectionSet);
  const removeBodyFromSelectionSet = useCADStore((s) => s.removeBodyFromSelectionSet);
  const selectSelectionSet = useCADStore((s) => s.selectSelectionSet);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const bodies = useComponentStore((s) => s.bodies);
  const selectedBodyId = useComponentStore((s) => s.selectedBodyId);

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const allBodies = Object.values(bodies);

  const handleCreate = () => {
    const name = newName.trim() || `Selection Set ${selectionSets.length + 1}`;
    const bodyIds = selectedBodyId ? [selectedBodyId] : [];
    const id = addSelectionSet(name, bodyIds);
    setNewName('');
    setExpandedId(id);
    setStatusMessage(`Created "${name}"${bodyIds.length ? ' with selected body' : ''}`);
  };

  const handleRenameConfirm = (ss: SelectionSet) => {
    if (editingName.trim()) renameSelectionSet(ss.id, editingName.trim());
    setEditingId(null);
  };

  const handleAddSelected = (id: string) => {
    if (!selectedBodyId) { setStatusMessage('No body selected in viewport'); return; }
    addBodiesToSelectionSet(id, [selectedBodyId]);
    setStatusMessage(`Added body to selection set`);
  };

  return (
    <DialogShell title="Selection Sets" onClose={onClose} cancelLabel="Close">
      {/* Create row */}
      <div className="dialog-field ss-create-row">
        <input
          className="dialog-input ss-create-input"
          type="text"
          placeholder="New set name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
        />
        <button className="btn btn-primary ss-create-btn" onClick={handleCreate}>
          <Plus size={13} /> Create
        </button>
      </div>

      {selectionSets.length === 0 && (
        <div className="ss-empty">No selection sets. Create one above.</div>
      )}

      {/* Set list */}
      <div className="ss-list">
        {selectionSets.map((ss) => (
          <div key={ss.id} className="ss-item">
            {/* Header row */}
            <div className="ss-item__header">
              <button
                className="btn-icon ss-item__expand"
                onClick={() => setExpandedId(expandedId === ss.id ? null : ss.id)}
                title="Expand bodies"
              >
                <Tag size={13} />
              </button>

              {editingId === ss.id ? (
                <input
                  className="dialog-input ss-item__name-input"
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => handleRenameConfirm(ss)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRenameConfirm(ss); if (e.key === 'Escape') setEditingId(null); }}
                />
              ) : (
                <span
                  className="ss-item__name"
                  onDoubleClick={() => { setEditingId(ss.id); setEditingName(ss.name); }}
                  title="Double-click to rename"
                >
                  {ss.name}
                  <span className="ss-item__count">({ss.bodyIds.length})</span>
                </span>
              )}

              <div className="ss-item__actions">
                <button
                  className="btn-icon"
                  title="Select these bodies"
                  onClick={() => selectSelectionSet(ss.id)}
                >
                  <Check size={12} />
                </button>
                <button
                  className="btn-icon"
                  title="Add selected body to set"
                  onClick={() => handleAddSelected(ss.id)}
                  disabled={!selectedBodyId}
                >
                  <Plus size={12} />
                </button>
                <button
                  className="btn-icon danger"
                  title="Delete selection set"
                  onClick={() => { removeSelectionSet(ss.id); setStatusMessage(`Deleted "${ss.name}"`); }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* Body list (expanded) */}
            {expandedId === ss.id && ss.bodyIds.length > 0 && (
              <div className="ss-item__bodies">
                {ss.bodyIds.map((bodyId) => {
                  const b = bodies[bodyId];
                  return (
                    <div key={bodyId} className="ss-body-row">
                      <span className="ss-body-row__name">{b?.name ?? bodyId}</span>
                      <button
                        className="btn-icon danger"
                        title="Remove from set"
                        onClick={() => removeBodyFromSelectionSet(ss.id, bodyId)}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {expandedId === ss.id && ss.bodyIds.length === 0 && (
              <div className="ss-item__empty">No bodies. Select a body and click +.</div>
            )}
          </div>
        ))}
      </div>

      {allBodies.length === 0 && (
        <div className="ss-empty">No bodies in the assembly.</div>
      )}
    </DialogShell>
  );
}
