/**
 * InsertComponentDialog (A13) — insert an external design file as a reference component.
 */
import { useState } from 'react';
import { X } from 'lucide-react';

export interface InsertComponentParams {
  name: string;
  sourceUrl: string;
  scale: number;
  position: [number, number, number];
}

interface Props {
  open: boolean;
  onOk: (params: InsertComponentParams) => void;
  onClose: () => void;
}

export function InsertComponentDialog({ open, onOk, onClose }: Props) {
  const [name, setName] = useState('Inserted Component');
  const [sourceUrl, setSourceUrl] = useState('');
  const [scale, setScale] = useState(1.0);
  const [px, setPx] = useState(0);
  const [py, setPy] = useState(0);
  const [pz, setPz] = useState(0);

  if (!open) return null;

  const handleOk = () => {
    onOk({ name: name.trim() || 'Inserted Component', sourceUrl: sourceUrl.trim(), scale, position: [px, py, pz] });
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel">
        <div className="dialog-header">
          <span className="dialog-title">Insert Component</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="dialog-field">
            <label className="dialog-label">Component Name</label>
            <input className="dialog-input" type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Source URL</label>
            <input
              className="dialog-input"
              type="text"
              value={sourceUrl}
              placeholder="https://example.com/model.obj"
              onChange={(e) => setSourceUrl(e.target.value)}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Supports OBJ and glTF URLs
            </span>
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Scale</label>
            <input
              className="dialog-input"
              type="number"
              min={0.001}
              step={0.1}
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value) || 1)}
            />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Position X / Y / Z</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="dialog-input" type="number" step={1} value={px} onChange={(e) => setPx(parseFloat(e.target.value) || 0)} />
              <input className="dialog-input" type="number" step={1} value={py} onChange={(e) => setPy(parseFloat(e.target.value) || 0)} />
              <input className="dialog-input" type="number" step={1} value={pz} onChange={(e) => setPz(parseFloat(e.target.value) || 0)} />
            </div>
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
