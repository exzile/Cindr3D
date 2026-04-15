/**
 * LipGrooveDialog (D182) — raised lip / matching groove on touching solid bodies.
 */
import { useState } from 'react';
import { X } from 'lucide-react';

export interface LipGrooveParams {
  edgeId: string | null;
  mode: 'lip' | 'groove' | 'lip-and-groove';
  width: number;
  height: number;
  angle: number;
  offset: number;
}

interface Props {
  open: boolean;
  edgeId: string | null;
  onOk: (params: LipGrooveParams) => void;
  onClose: () => void;
}

export function LipGrooveDialog({ open, edgeId, onOk, onClose }: Props) {
  const [mode, setMode] = useState<LipGrooveParams['mode']>('lip-and-groove');
  const [width, setWidth] = useState(2);
  const [height, setHeight] = useState(1);
  const [angle, setAngle] = useState(5);
  const [offset, setOffset] = useState(0);

  if (!open) return null;

  const handleOk = () => {
    onOk({ edgeId, mode, width, height, angle, offset });
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel">
        <div className="dialog-header">
          <span className="dialog-title">Lip / Groove</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="dialog-field">
            <label className="dialog-label">Edge</label>
            <span style={{ fontSize: 12, color: edgeId ? 'var(--text-success, #4caf50)' : 'var(--text-muted)' }}>
              {edgeId ? 'Edge selected' : 'Click an edge in the viewport'}
            </span>
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Mode</label>
            <select className="dialog-input" value={mode} onChange={(e) => setMode(e.target.value as LipGrooveParams['mode'])}>
              <option value="lip">Lip</option>
              <option value="groove">Groove</option>
              <option value="lip-and-groove">Lip and Groove</option>
            </select>
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Width</label>
            <input className="dialog-input" type="number" min={0.1} step={0.5} value={width} onChange={(e) => setWidth(parseFloat(e.target.value) || 2)} />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Height</label>
            <input className="dialog-input" type="number" min={0.1} step={0.1} value={height} onChange={(e) => setHeight(parseFloat(e.target.value) || 1)} />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Draft Angle (°)</label>
            <input className="dialog-input" type="number" min={0} max={45} step={0.5} value={angle} onChange={(e) => setAngle(parseFloat(e.target.value) || 5)} />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Offset from Edge</label>
            <input className="dialog-input" type="number" step={0.1} value={offset} onChange={(e) => setOffset(parseFloat(e.target.value) || 0)} />
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!edgeId} onClick={handleOk}>OK</button>
        </div>
      </div>
    </div>
  );
}
