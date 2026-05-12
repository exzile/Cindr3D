import { useState } from 'react';
import type { Sketch } from '../../../types/cad';
import { DialogShell } from '../common/DialogShell';

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
    <DialogShell title="Offset Curve to Surface" onClose={onClose} size="sm" onConfirm={handleOK} confirmDisabled={!sketchId}>
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
    </DialogShell>
  );
}
