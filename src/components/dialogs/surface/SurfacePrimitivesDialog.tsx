import { useState } from 'react';
import { X } from 'lucide-react';

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
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Surface Primitives</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as SurfacePrimitiveParams['type'])}>
              <option value="plane">Plane</option>
              <option value="box">Box (Open)</option>
              <option value="sphere">Sphere</option>
              <option value="cylinder">Cylinder (Open)</option>
              <option value="torus">Torus</option>
              <option value="cone">Cone (Open)</option>
            </select>
          </div>

          {(type === 'plane' || type === 'box') && (
            <>
              <div className="form-group">
                <label>Width (mm)</label>
                <input type="number" value={width} min={0.01} step={1}
                  onChange={(e) => setWidth(Math.max(0.01, parseFloat(e.target.value) || 10))} />
              </div>
              <div className="form-group">
                <label>Height (mm)</label>
                <input type="number" value={height} min={0.01} step={1}
                  onChange={(e) => setHeight(Math.max(0.01, parseFloat(e.target.value) || 10))} />
              </div>
            </>
          )}

          {type === 'box' && (
            <div className="form-group">
              <label>Depth (mm)</label>
              <input type="number" value={depth} min={0.01} step={1}
                onChange={(e) => setDepth(Math.max(0.01, parseFloat(e.target.value) || 10))} />
            </div>
          )}

          {(type === 'sphere' || type === 'cylinder' || type === 'torus' || type === 'cone') && (
            <div className="form-group">
              <label>Radius (mm)</label>
              <input type="number" value={radius} min={0.01} step={0.5}
                onChange={(e) => setRadius(Math.max(0.01, parseFloat(e.target.value) || 5))} />
            </div>
          )}

          {(type === 'cylinder' || type === 'cone') && (
            <div className="form-group">
              <label>Height (mm)</label>
              <input type="number" value={height2} min={0.01} step={1}
                onChange={(e) => setHeight2(Math.max(0.01, parseFloat(e.target.value) || 10))} />
            </div>
          )}

          {type === 'torus' && (
            <div className="form-group">
              <label>Tube Radius (mm)</label>
              <input type="number" value={tube} min={0.01} step={0.5}
                onChange={(e) => setTube(Math.max(0.01, parseFloat(e.target.value) || 2))} />
            </div>
          )}

          <p className="dialog-hint">Creates an open surface body (quilt) with no solid interior.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}
