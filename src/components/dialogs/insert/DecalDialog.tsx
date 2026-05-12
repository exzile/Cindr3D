/**
 * DecalDialog — D192
 * Places a raster image onto a selected face as a flat visual texture decal.
 * No mesh deformation — purely visual.
 */

import { useState } from 'react';
import { DialogShell } from '../common/DialogShell';

export interface DecalParams {
  imageUrl: string;
  faceId: string | null;
  opacity: number;
  scaleU: number;
  scaleV: number;
  rotation: number;
}

interface Props {
  open: boolean;
  onOk: (params: DecalParams) => void;
  onClose: () => void;
  /** Controlled from store — updated by face picker */
  faceId: string | null;
}

export function DecalDialog({ open, onOk, onClose, faceId }: Props) {
  const [imageUrl, setImageUrl] = useState('');
  const [opacity, setOpacity] = useState(1);
  const [scaleU, setScaleU] = useState(1);
  const [scaleV, setScaleV] = useState(1);
  const [rotation, setRotation] = useState(0);

  if (!open) return null;

  const isValidUrl = imageUrl.trim().length > 0;
  const canOk = faceId !== null && isValidUrl;

  const handleOk = () => {
    if (!canOk) return;
    onOk({ imageUrl: imageUrl.trim(), faceId, opacity, scaleU, scaleV, rotation });
  };

  return (
    <DialogShell title="Decal" onClose={onClose} size="sm" onConfirm={handleOk} confirmDisabled={!canOk}>

          <div className="form-group">
            <label>Image URL</label>
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          {isValidUrl && (
            <div className="form-group">
              <img
                src={imageUrl}
                alt="preview"
                className="dialog-media-preview"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          )}

          <div className="form-group">
            <label>Face</label>
              <span className="dialog-hint-text">
              {faceId ? 'Face selected' : 'Click a face in the viewport to place'}
            </span>
          </div>

          <div className="form-group">
            <label>Opacity</label>
            <div className="dialog-slider-row">
              <input
                type="range"
                min={0} max={1} step={0.01}
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="dialog-slider-row__input"
              />
              <span className="dialog-slider-row__value">{opacity.toFixed(2)}</span>
            </div>
          </div>

          <div className="form-group dialog-field-row">
            <div className="dialog-field-col">
              <label>Scale U</label>
              <input
                type="number"
                value={scaleU}
                min={0.001}
                step={0.1}
                onChange={(e) => setScaleU(parseFloat(e.target.value) || 1)}
              />
            </div>
            <div className="dialog-field-col">
              <label>Scale V</label>
              <input
                type="number"
                value={scaleV}
                min={0.001}
                step={0.1}
                onChange={(e) => setScaleV(parseFloat(e.target.value) || 1)}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Rotation (°)</label>
            <input
              type="number"
              value={rotation}
              step={1}
              onChange={(e) => setRotation(parseFloat(e.target.value) || 0)}
            />
          </div>

          <p className="dialog-hint">
            Decals are applied as a flat visual overlay on the selected face. No geometry is modified.
          </p>
    </DialogShell>
  );
}
