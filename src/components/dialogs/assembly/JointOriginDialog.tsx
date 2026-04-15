import { useState } from 'react';
import { X } from 'lucide-react';
import type { Component } from '../../../types/cad';

export interface JointOriginParams {
  name: string;
  componentId: string | null;
  alignmentType: 'default' | 'between-two-faces' | 'on-face';
}

interface Props {
  open: boolean;
  components: Component[];
  onOk: (params: JointOriginParams) => void;
  onClose: () => void;
}

export function JointOriginDialog({ open, components, onOk, onClose }: Props) {
  const n = components.length + 1;
  const [name, setName] = useState(`Joint Origin ${n}`);
  const [componentId, setComponentId] = useState<string | null>(null);
  const [alignmentType, setAlignmentType] = useState<JointOriginParams['alignmentType']>('default');

  if (!open) return null;

  const handleOk = () => {
    onOk({ name: name.trim() || `Joint Origin ${n}`, componentId, alignmentType });
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel">
        <div className="dialog-header">
          <span className="dialog-title">Joint Origin</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="dialog-field">
            <label className="dialog-label">Name</label>
            <input
              className="dialog-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Component</label>
            <select
              className="dialog-input"
              value={componentId ?? ''}
              onChange={(e) => setComponentId(e.target.value || null)}
            >
              <option value="">Root</option>
              {components.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Alignment Type</label>
            <select
              className="dialog-input"
              value={alignmentType}
              onChange={(e) => setAlignmentType(e.target.value as JointOriginParams['alignmentType'])}
            >
              <option value="default">Default</option>
              <option value="between-two-faces">Between Two Faces</option>
              <option value="on-face">On Face</option>
            </select>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOk}>OK</button>
        </div>
      </div>
    </div>
  );
}
