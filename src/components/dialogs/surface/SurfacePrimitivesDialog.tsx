import { useState } from 'react';
import { X, Check } from 'lucide-react';

export interface SurfacePrimitiveParams {
  type: 'plane' | 'box' | 'sphere' | 'cylinder' | 'torus' | 'cone';
  width?: number;
  height?: number;
  depth?: number;
  radius?: number;
  height2?: number;
  tube?: number;
}

interface SurfacePrimitivesDialogProps {
  open: boolean;
  onOk: (params: SurfacePrimitiveParams) => void;
  onClose: () => void;
}

export function SurfacePrimitivesDialog({ open, onOk, onClose }: SurfacePrimitivesDialogProps) {
  const [type, setType] = useState<SurfacePrimitiveParams['type']>('plane');
  const [width, setWidth] = useState(10);
  const [height, setHeight] = useState(10);
  const [depth, setDepth] = useState(10);
  const [radius, setRadius] = useState(5);
  const [height2, setHeight2] = useState(10);
  const [tube, setTube] = useState(2);

  if (!open) return null;

  const handleOK = () => {
    const params: SurfacePrimitiveParams = { type };
    if (type === 'plane') { params.width = width; params.height = height; }
    else if (type === 'box') { params.width = width; params.height = height; params.depth = depth; }
    else if (type === 'sphere') { params.radius = radius; }
    else if (type === 'cylinder') { params.radius = radius; params.height2 = height2; }
    else if (type === 'torus') { params.radius = radius; params.tube = tube; }
    else if (type === 'cone') { params.radius = radius; params.height2 = height2; }
    onOk(params);
  };

  return (
    <div className="tool-panel">
      <div className="tp-header">
        <div className="tp-header-icon" style={{ background: '#1aa04a' }} />
        <span className="tp-header-title">Surface Primitives</span>
        <button className="tp-close" onClick={onClose} title="Cancel (Esc)"><X size={14} /></button>
      </div>

      <div className="tp-body">
        <div className="tp-section">
          <div className="tp-section-title">Shape</div>
          <div className="tp-row">
            <span className="tp-label">Type</span>
            <select className="tp-select" value={type}
              onChange={(e) => setType(e.target.value as SurfacePrimitiveParams['type'])}>
              <option value="plane">Plane</option>
              <option value="box">Box (Open)</option>
              <option value="sphere">Sphere</option>
              <option value="cylinder">Cylinder (Open)</option>
              <option value="torus">Torus</option>
              <option value="cone">Cone (Open)</option>
            </select>
          </div>
        </div>

        <div className="tp-divider" />

        <div className="tp-section">
          <div className="tp-section-title">Dimensions</div>
          {(type === 'plane' || type === 'box') && (<>
            <div className="tp-row">
              <span className="tp-label">Width (mm)</span>
              <input className="tp-input" type="number" value={width} min={0.01} step={1}
                onChange={(e) => setWidth(Math.max(0.01, parseFloat(e.target.value) || 10))} />
            </div>
            <div className="tp-row">
              <span className="tp-label">Height (mm)</span>
              <input className="tp-input" type="number" value={height} min={0.01} step={1}
                onChange={(e) => setHeight(Math.max(0.01, parseFloat(e.target.value) || 10))} />
            </div>
          </>)}
          {type === 'box' && (
            <div className="tp-row">
              <span className="tp-label">Depth (mm)</span>
              <input className="tp-input" type="number" value={depth} min={0.01} step={1}
                onChange={(e) => setDepth(Math.max(0.01, parseFloat(e.target.value) || 10))} />
            </div>
          )}
          {(type === 'sphere' || type === 'cylinder' || type === 'torus' || type === 'cone') && (
            <div className="tp-row">
              <span className="tp-label">Radius (mm)</span>
              <input className="tp-input" type="number" value={radius} min={0.01} step={0.5}
                onChange={(e) => setRadius(Math.max(0.01, parseFloat(e.target.value) || 5))} />
            </div>
          )}
          {(type === 'cylinder' || type === 'cone') && (
            <div className="tp-row">
              <span className="tp-label">Height (mm)</span>
              <input className="tp-input" type="number" value={height2} min={0.01} step={1}
                onChange={(e) => setHeight2(Math.max(0.01, parseFloat(e.target.value) || 10))} />
            </div>
          )}
          {type === 'torus' && (
            <div className="tp-row">
              <span className="tp-label">Tube Radius (mm)</span>
              <input className="tp-input" type="number" value={tube} min={0.01} step={0.5}
                onChange={(e) => setTube(Math.max(0.01, parseFloat(e.target.value) || 2))} />
            </div>
          )}
          <div className="tp-row" style={{ fontSize: '11px', color: 'var(--text-muted, #888)', gridColumn: '1/-1' }}>
            Creates an open surface body (quilt) with no solid interior.
          </div>
        </div>
      </div>

      <div className="tp-actions">
        <button className="tp-btn tp-btn-cancel" onClick={onClose}><X size={13} /> Cancel</button>
        <button className="tp-btn tp-btn-ok" onClick={handleOK}><Check size={13} /> OK</button>
      </div>
    </div>
  );
}
