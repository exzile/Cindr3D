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

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel">
        <div className="dialog-header">
          <span className="dialog-title">Contact Sets</span>
          <button className="dialog-close" onClick={onClose} aria-label="Close contact sets dialog"><X size={14} /></button>
        </div>
        <div className="dialog-body">
          {/* A25: bulk enable / disable */}
          <div className="contact-sets-bulk-row">
            <button className="btn btn-secondary contact-sets-bulk-btn" onClick={onEnableAll}>
              Enable All
            </button>
            <button className="btn btn-secondary contact-sets-bulk-btn" onClick={onDisableAll}>
              Disable All
            </button>
          </div>

          {contactSets.length === 0 && (
            <p className="contact-sets-empty">
              No contact sets defined.
            </p>
          )}
          {contactSets.map((cs) => (
            <div key={cs.id} className="dialog-field contact-sets-item">
              <input
                type="checkbox"
                checked={cs.enabled}
                onChange={() => onToggle(cs.id)}
                aria-label={`${cs.enabled ? 'Disable' : 'Enable'} contact set ${cs.name}`}
                className="contact-sets-item__checkbox"
              />
              <span className="contact-sets-item__name">{cs.name}</span>
              <button className="btn btn-icon" onClick={() => onRemove(cs.id)} title="Remove" aria-label={`Remove contact set ${cs.name}`}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          <div className="contact-sets-divider">
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
              className="btn btn-primary contact-sets-add-btn"
              disabled={!sel1 || !sel2 || sel1 === sel2}
              onClick={handleAdd}
            >
              <Plus size={13} className="contact-sets-add-icon" />
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
