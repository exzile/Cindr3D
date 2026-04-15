/**
 * ContactSetsDialog (A12) — manage physical contact detection between component pairs.
 */
import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { Component, ContactSetEntry } from '../../../types/cad';

interface Props {
  open: boolean;
  components: Component[];
  contactSets: ContactSetEntry[];
  onAdd: (c1: string, c2: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  onClose: () => void;
}

export function ContactSetsDialog({ open, components, contactSets, onAdd, onToggle, onRemove, onEnableAll, onDisableAll, onClose }: Props) {
  const [sel1, setSel1] = useState('');
  const [sel2, setSel2] = useState('');

  if (!open) return null;

  const handleAdd = () => {
    if (!sel1 || !sel2 || sel1 === sel2) return;
    onAdd(sel1, sel2);
    setSel1('');
    setSel2('');
  };

  const compName = (id: string) => components.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel" style={{ minWidth: 380 }}>
        <div className="dialog-header">
          <span className="dialog-title">Contact Sets</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          {/* A25: bulk enable / disable */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button className="btn btn-secondary" style={{ flex: 1, fontSize: 12 }} onClick={onEnableAll}>
              Enable All
            </button>
            <button className="btn btn-secondary" style={{ flex: 1, fontSize: 12 }} onClick={onDisableAll}>
              Disable All
            </button>
          </div>

          {contactSets.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 8px' }}>
              No contact sets defined.
            </p>
          )}
          {contactSets.map((cs) => (
            <div key={cs.id} className="dialog-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={cs.enabled}
                onChange={() => onToggle(cs.id)}
                style={{ flexShrink: 0 }}
              />
              <span style={{ flex: 1, fontSize: 13 }}>{cs.name}</span>
              <button className="btn btn-icon" onClick={() => onRemove(cs.id)} title="Remove">
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
            <div className="dialog-field">
              <label className="dialog-label">Component 1</label>
              <select className="dialog-input" value={sel1} onChange={(e) => setSel1(e.target.value)}>
                <option value="">— select —</option>
                {components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="dialog-field">
              <label className="dialog-label">Component 2</label>
              <select className="dialog-input" value={sel2} onChange={(e) => setSel2(e.target.value)}>
                <option value="">— select —</option>
                {components.filter((c) => c.id !== sel1).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 4 }}
              disabled={!sel1 || !sel2 || sel1 === sel2}
              onClick={handleAdd}
            >
              <Plus size={13} style={{ marginRight: 4 }} />
              Add Contact Set
            </button>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
