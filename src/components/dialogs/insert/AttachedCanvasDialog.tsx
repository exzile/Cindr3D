/**
 * AttachedCanvasDialog — D193
 * Re-select or re-configure an existing canvas placed on a plane.
 * Fusion 360's "Attach Canvas" edits an already-placed canvas.
 */

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

export interface CanvasRecord {
  id: string;
  dataUrl: string;
  plane: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  opacity: number;
}

export interface AttachedCanvasChanges {
  opacity?: number;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
}

interface Props {
  open: boolean;
  canvases: CanvasRecord[];
  selectedId: string | null;
  onOk: (id: string, changes: AttachedCanvasChanges) => void;
  onClose: () => void;
  onSelectCanvas: (id: string) => void;
}

export function AttachedCanvasDialog({ open, canvases, selectedId, onOk, onClose, onSelectCanvas }: Props) {
  const selected = canvases.find((c) => c.id === selectedId) ?? null;

  const [opacity, setOpacity] = useState(selected?.opacity ?? 0.5);
  const [scale, setScale] = useState(selected?.scale ?? 1);
  const [offsetX, setOffsetX] = useState(selected?.offsetX ?? 0);
  const [offsetY, setOffsetY] = useState(selected?.offsetY ?? 0);

  // Sync local state when selected canvas changes
  useEffect(() => {
    if (selected) {
      setOpacity(selected.opacity);
      setScale(selected.scale);
      setOffsetX(selected.offsetX);
      setOffsetY(selected.offsetY);
    }
  }, [selected]);

  if (!open) return null;

  const handleOk = () => {
    if (!selectedId) return;
    onOk(selectedId, { opacity, scale, offsetX, offsetY });
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Attached Canvas</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">

          {canvases.length === 0 ? (
            <p className="dialog-hint">No canvas references found. Use Insert Canvas to add one first.</p>
          ) : (
            <>
              <div className="form-group">
                <label>Canvas</label>
                <select
                  value={selectedId ?? ''}
                  onChange={(e) => onSelectCanvas(e.target.value)}
                >
                  <option value="" disabled>Select a canvas…</option>
                  {canvases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.plane} — {c.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>

              {selected && (
                <>
                  <div className="form-group">
                    <label>Preview</label>
                    <img
                      src={selected.dataUrl}
                      alt="canvas preview"
                      style={{ maxWidth: '100%', maxHeight: 80, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 4 }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Opacity</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="range"
                        min={0} max={1} step={0.01}
                        value={opacity}
                        onChange={(e) => setOpacity(parseFloat(e.target.value))}
                        style={{ flex: 1 }}
                      />
                      <span style={{ width: 36, fontSize: 12 }}>{opacity.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Scale</label>
                    <input
                      type="number"
                      value={scale}
                      min={0.001}
                      step={0.1}
                      onChange={(e) => setScale(parseFloat(e.target.value) || 1)}
                    />
                  </div>

                  <div className="form-group" style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label>Offset X</label>
                      <input
                        type="number"
                        value={offsetX}
                        step={1}
                        onChange={(e) => setOffsetX(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label>Offset Y</label>
                      <input
                        type="number"
                        value={offsetY}
                        step={1}
                        onChange={(e) => setOffsetY(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Calibration (width in model units)</label>
                    <input
                      type="number"
                      value={scale}
                      min={0.001}
                      step={0.1}
                      onChange={(e) => setScale(parseFloat(e.target.value) || 1)}
                      title="Sets the display scale / calibration width"
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleOk}
            disabled={!selectedId}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
