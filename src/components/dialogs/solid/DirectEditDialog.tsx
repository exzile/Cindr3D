import { useState } from 'react';
import { DialogShell } from '../common/DialogShell';

export interface DirectEditParams {
  mode: 'offset-face' | 'extrude' | 'taper';
  distance: number;
  tapAngle?: number;
  faceId?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (params: DirectEditParams) => void;
  selectedFaceInfo?: string;
}

export default function DirectEditDialog({ open, onClose, onConfirm, selectedFaceInfo }: Props) {
  const [mode, setMode] = useState<'offset-face' | 'extrude' | 'taper'>('offset-face');
  const [distance, setDistance] = useState(10);
  const [tapAngle, setTapAngle] = useState(0);

  if (!open) return null;

  const handleOK = () => {
    const params: DirectEditParams = { mode, distance };
    if (mode === 'taper') params.tapAngle = tapAngle;
    onConfirm(params);
  };

  return (
    <DialogShell title="Direct Edit" onClose={onClose} size="sm" onConfirm={handleOK}>
      {selectedFaceInfo && (
        <p className="dialog-hint" style={{ marginBottom: 12 }}>
          Editing: {selectedFaceInfo}
        </p>
      )}

      <div className="form-group">
        <label>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'offset-face' | 'extrude' | 'taper')}>
          <option value="offset-face">Offset Face</option>
          <option value="extrude">Extrude</option>
          <option value="taper">Taper</option>
        </select>
      </div>

      <div className="form-group">
        <label>Distance (mm)</label>
        <input
          type="number"
          value={distance}
          onChange={(e) => setDistance(Math.max(-500, Math.min(500, parseFloat(e.target.value) || 10)))}
          min={-500}
          max={500}
          step={0.5}
        />
      </div>

      {mode === 'taper' && (
        <div className="form-group">
          <label>Taper Angle (°)</label>
          <input
            type="number"
            value={tapAngle}
            onChange={(e) => setTapAngle(Math.max(-45, Math.min(45, parseFloat(e.target.value) || 0)))}
            min={-45}
            max={45}
            step={1}
          />
        </div>
      )}

      <p className="dialog-hint">Changes are applied live. Click OK to commit.</p>
    </DialogShell>
  );
}
