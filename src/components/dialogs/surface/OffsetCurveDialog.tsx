import { useState } from 'react';
import { X } from 'lucide-react';
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
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Offset Curve to Surface</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Curve (Sketch)</label>
            <select
              value={sketchId ?? ''}
              onChange={(e) => setSketchId(e.target.value || null)}
            >
              <option value="">— select sketch —</option>
              {sketches.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Distance (mm)</label>
            <input
              type="number"
              value={distance}
              onChange={(e) => setDistance(Math.max(0.001, parseFloat(e.target.value) || 1))}
              step={0.5}
              min={0.001}
            />
          </div>
          <div className="form-group">
            <label>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'normal' | 'flip')}>
              <option value="normal">Normal</option>
              <option value="flip">Flip</option>
            </select>
          </div>
          <p className="dialog-hint">Creates a surface strip by offsetting the selected curve along its plane normal.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!sketchId} onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}
