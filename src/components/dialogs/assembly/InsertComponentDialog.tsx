/**
 * InsertComponentDialog (A13) — insert an external design file as a reference component.
 */
import { useState } from 'react';
import { DialogShell } from '../common/DialogShell';

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
    <DialogShell title="Insert Component" onClose={onClose} onConfirm={handleOk}>
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
    </DialogShell>
  );
}
