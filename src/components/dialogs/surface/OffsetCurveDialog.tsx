import { useState } from 'react';
import { X, Check } from 'lucide-react';
import type { Sketch } from '../../../types/cad';

export interface OffsetCurveParams {
  sketchId: string | null;
  distance: number;
  direction: 'normal' | 'flip';
  operation: 'new-body';
}

interface OffsetCurveDialogProps {
  open: boolean;
  sketches: Sketch[];
  onOk: (params: OffsetCurveParams) => void;
  onClose: () => void;
}

export function OffsetCurveDialog({ open, sketches, onOk, onClose }: OffsetCurveDialogProps) {
  const [sketchId, setSketchId] = useState<string | null>(sketches[0]?.id ?? null);
  const [distance, setDistance] = useState(1);
  const [direction, setDirection] = useState<'normal' | 'flip'>('normal');

  if (!open) return null;

  const handleOK = () => {
    onOk({ sketchId, distance, direction, operation: 'new-body' });
  };

  return (
    <div className="tool-panel">
      <div className="tp-header">
        <div className="tp-header-icon" style={{ background: '#1aa04a' }} />
        <span className="tp-header-title">Offset Curve</span>
        <button className="tp-close" onClick={onClose} title="Cancel (Esc)"><X size={14} /></button>
      </div>

      <div className="tp-body">
        <div className="tp-section">
          <div className="tp-section-title">Curve</div>
          <div className="tp-row">
            <span className="tp-label">Sketch</span>
            <select className="tp-select" value={sketchId ?? ''}
              onChange={(e) => setSketchId(e.target.value || null)}>
              <option value="">— select sketch —</option>
              {sketches.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="tp-divider" />

        <div className="tp-section">
          <div className="tp-section-title">Options</div>
          <div className="tp-row">
            <span className="tp-label">Distance (mm)</span>
            <input className="tp-input" type="number" value={distance} step={0.5} min={0.001}
              onChange={(e) => setDistance(Math.max(0.001, parseFloat(e.target.value) || 1))} />
          </div>
          <div className="tp-row">
            <span className="tp-label">Direction</span>
            <select className="tp-select" value={direction}
              onChange={(e) => setDirection(e.target.value as 'normal' | 'flip')}>
              <option value="normal">Normal</option>
              <option value="flip">Flip</option>
            </select>
          </div>
          <div className="tp-row" style={{ fontSize: '11px', color: 'var(--text-muted, #888)', gridColumn: '1/-1' }}>
            Creates a surface strip by offsetting the selected curve along its plane normal.
          </div>
        </div>
      </div>

      <div className="tp-actions">
        <button className="tp-btn tp-btn-cancel" onClick={onClose}><X size={13} /> Cancel</button>
        <button className="tp-btn tp-btn-ok" onClick={handleOK} disabled={!sketchId}><Check size={13} /> OK</button>
      </div>
    </div>
  );
}
