/**
 * SplitFaceDialog — D185
 * Divides one face of a solid body using a sketch, plane, or surface.
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import type { Sketch, ConstructionPlane } from '../../../types/cad';

export interface SplitFaceParams {
  faceId: string | null;
  splittingTool: 'sketch' | 'plane' | 'surface';
  sketchId?: string;
  planeId?: string;
}

interface Props {
  open: boolean;
  faceId: string | null;
  sketches: Sketch[];
  constructionPlanes: ConstructionPlane[];
  onOk: (params: SplitFaceParams) => void;
  onClose: () => void;
}

export function SplitFaceDialog({ open, faceId, sketches, constructionPlanes, onOk, onClose }: Props) {
  const [splittingTool, setSplittingTool] = useState<'sketch' | 'plane' | 'surface'>('sketch');
  const [sketchId, setSketchId] = useState<string>('');
  const [planeId, setPlaneId] = useState<string>('');

  if (!open) return null;

  const canOk = faceId !== null && (
    splittingTool === 'surface' ||
    (splittingTool === 'sketch' && sketchId !== '') ||
    (splittingTool === 'plane' && planeId !== '')
  );

  const handleOk = () => {
    if (!canOk) return;
    onOk({
      faceId,
      splittingTool,
      sketchId: splittingTool === 'sketch' ? sketchId : undefined,
      planeId: splittingTool === 'plane' ? planeId : undefined,
    });
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Split Face</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">

          <div className="form-group">
            <label>Face to Split</label>
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              {faceId ? 'Face selected' : 'Click a face in the viewport'}
            </span>
          </div>

          <div className="form-group">
            <label>Splitting Tool</label>
            <select
              value={splittingTool}
              onChange={(e) => setSplittingTool(e.target.value as 'sketch' | 'plane' | 'surface')}
            >
              <option value="sketch">Sketch</option>
              <option value="plane">Plane</option>
              <option value="surface">Surface</option>
            </select>
          </div>

          {splittingTool === 'sketch' && (
            <div className="form-group">
              <label>Sketch</label>
              <select value={sketchId} onChange={(e) => setSketchId(e.target.value)}>
                <option value="" disabled>Select a sketch…</option>
                {sketches.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {sketches.length === 0 && (
                <span style={{ fontSize: 11, opacity: 0.6 }}>No sketches available</span>
              )}
            </div>
          )}

          {splittingTool === 'plane' && (
            <div className="form-group">
              <label>Construction Plane</label>
              <select value={planeId} onChange={(e) => setPlaneId(e.target.value)}>
                <option value="" disabled>Select a plane…</option>
                {constructionPlanes.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {constructionPlanes.length === 0 && (
                <span style={{ fontSize: 11, opacity: 0.6 }}>No construction planes available</span>
              )}
            </div>
          )}

          {splittingTool === 'surface' && (
            <p className="dialog-hint">
              Surface splitting uses the nearest surface body. Ensure a surface body exists in the model.
            </p>
          )}

        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOk} disabled={!canOk}>OK</button>
        </div>
      </div>
    </div>
  );
}
