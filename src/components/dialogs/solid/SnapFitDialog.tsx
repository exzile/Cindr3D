/**
 * SnapFitDialog (D181) — cantilever snap-fit feature parameters.
 */
import { useState } from 'react';
import { X } from 'lucide-react';

export interface SnapFitParams {
  faceId: string | null;
  type: 'cantilever' | 'annular' | 'torsional';
  length: number;
  width: number;
  thickness: number;
  snapHeight: number;
  angle: number;
  material: 'standard' | 'flexible';
}

interface Props {
  open: boolean;
  faceId: string | null;
  onOk: (params: SnapFitParams) => void;
  onClose: () => void;
}

export function SnapFitDialog({ open, faceId, onOk, onClose }: Props) {
  const [type, setType] = useState<SnapFitParams['type']>('cantilever');
  const [length, setLength] = useState(10);
  const [width, setWidth] = useState(5);
  const [thickness, setThickness] = useState(1);
  const [snapHeight, setSnapHeight] = useState(0.5);
  const [angle, setAngle] = useState(30);
  const [material, setMaterial] = useState<SnapFitParams['material']>('standard');

  if (!open) return null;

  const handleOk = () => {
    onOk({ faceId, type, length, width, thickness, snapHeight, angle, material });
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel">
        <div className="dialog-header">
          <span className="dialog-title">Snap Fit</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="dialog-field">
            <label className="dialog-label">Face</label>
            <span style={{ fontSize: 12, color: faceId ? 'var(--text-success, #4caf50)' : 'var(--text-muted)' }}>
              {faceId ? 'Face selected' : 'Click a face in the viewport'}
            </span>
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Type</label>
            <select className="dialog-input" value={type} onChange={(e) => setType(e.target.value as SnapFitParams['type'])}>
              <option value="cantilever">Cantilever</option>
              <option value="annular">Annular</option>
              <option value="torsional">Torsional</option>
            </select>
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Length</label>
            <input className="dialog-input" type="number" min={0.1} step={0.5} value={length} onChange={(e) => setLength(parseFloat(e.target.value) || 10)} />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Width</label>
            <input className="dialog-input" type="number" min={0.1} step={0.5} value={width} onChange={(e) => setWidth(parseFloat(e.target.value) || 5)} />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Thickness</label>
            <input className="dialog-input" type="number" min={0.1} step={0.1} value={thickness} onChange={(e) => setThickness(parseFloat(e.target.value) || 1)} />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Snap Height</label>
            <input className="dialog-input" type="number" min={0.01} step={0.1} value={snapHeight} onChange={(e) => setSnapHeight(parseFloat(e.target.value) || 0.5)} />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Lead-in Angle (°)</label>
            <input className="dialog-input" type="number" min={1} max={89} step={1} value={angle} onChange={(e) => setAngle(parseFloat(e.target.value) || 30)} />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Material</label>
            <select className="dialog-input" value={material} onChange={(e) => setMaterial(e.target.value as SnapFitParams['material'])}>
              <option value="standard">Standard</option>
              <option value="flexible">Flexible</option>
            </select>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!faceId} onClick={handleOk}>OK</button>
        </div>
      </div>
    </div>
  );
}
