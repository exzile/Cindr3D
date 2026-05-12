import { useState } from 'react';
import { DialogShell } from '../common/DialogShell';

export interface TextureExtrudeParams {
  imageUrl: string;
  strength: number;
  channel: 'r' | 'g' | 'b' | 'luminance';
  subdivisions: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (params: TextureExtrudeParams) => void;
}

export default function TextureExtrudeDialog({ open, onClose, onConfirm }: Props) {
  const [imageUrl, setImageUrl] = useState('');
  const [strength, setStrength] = useState(5);
  const [channel, setChannel] = useState<'r' | 'g' | 'b' | 'luminance'>('luminance');
  const [subdivisions, setSubdivisions] = useState(1);

  if (!open) return null;

  const hasUrl = imageUrl.trim().length > 0;

  const handleApply = () => {
    if (!hasUrl) return;
    onConfirm({ imageUrl: imageUrl.trim(), strength, channel, subdivisions });
  };

  return (
    <DialogShell title="Texture Extrude" onClose={onClose} size="sm" onConfirm={handleApply} confirmLabel="Apply" confirmDisabled={!hasUrl}>
      <div className="form-group">
            <label>Image URL</label>
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://... or /public/heightmap.png"
            />
            <p className="dialog-hint" style={{ marginTop: 4 }}>
              Enter a URL or /public path to a height map image
            </p>
          </div>

          {hasUrl && (
            <div className="form-group">
              <label>Preview</label>
              <img
                src={imageUrl}
                alt="Height map preview"
                style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4, display: 'block' }}
              />
            </div>
          )}

          <div className="settings-grid">
            <div className="form-group">
              <label>Displacement Strength (mm)</label>
              <input
                type="number"
                value={strength}
                onChange={(e) => setStrength(Math.max(0.1, Math.min(100, parseFloat(e.target.value) || 5)))}
                min={0.1}
                max={100}
                step={0.5}
              />
            </div>
            <div className="form-group">
              <label>Height Channel</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value as 'r' | 'g' | 'b' | 'luminance')}>
                <option value="r">Red</option>
                <option value="g">Green</option>
                <option value="b">Blue</option>
                <option value="luminance">Luminance</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label title="Higher = smoother displacement, slower">
              Mesh Subdivisions
            </label>
            <input
              type="number"
              value={subdivisions}
              onChange={(e) => setSubdivisions(Math.max(0, Math.min(3, parseInt(e.target.value, 10) || 1)))}
              min={0}
              max={3}
              step={1}
              title="Higher = smoother displacement, slower"
            />
          </div>
    </DialogShell>
  );
}
