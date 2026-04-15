/**
 * BoundingSolidDialog — D183
 * Creates a parametric bounding box or cylinder that fits around all visible bodies.
 */

import { useState } from 'react';
import { X } from 'lucide-react';

export interface BoundingSolidParams {
  shape: 'box' | 'cylinder';
  padding: number;
  bodyIds: string[];
}

interface Props {
  open: boolean;
  onOk: (params: BoundingSolidParams) => void;
  onClose: () => void;
}

export function BoundingSolidDialog({ open, onOk, onClose }: Props) {
  const [shape, setShape] = useState<'box' | 'cylinder'>('box');
  const [padding, setPadding] = useState(0);

  if (!open) return null;

  const handleOk = () => {
    onOk({ shape, padding, bodyIds: [] });
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Bounding Solid</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">

          <div className="form-group">
            <label>Shape</label>
            <select
              value={shape}
              onChange={(e) => setShape(e.target.value as 'box' | 'cylinder')}
            >
              <option value="box">Box</option>
              <option value="cylinder">Cylinder</option>
            </select>
          </div>

          <div className="form-group">
            <label>Padding</label>
            <input
              type="number"
              value={padding}
              min={0}
              step={0.5}
              onChange={(e) => setPadding(Math.max(0, parseFloat(e.target.value) || 0))}
            />
          </div>

          <p className="dialog-hint">
            Bounds all visible bodies. Creates a {shape === 'box' ? 'box' : 'cylinder'} that encloses their combined bounding volume{padding > 0 ? ` with ${padding} units of padding` : ''}.
          </p>

        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOk}>OK</button>
        </div>
      </div>
    </div>
  );
}
