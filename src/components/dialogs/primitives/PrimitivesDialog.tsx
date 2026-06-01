import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import '../common/ToolPanel.css';

// PRIM-9: coil removed — route through CoilDialog (ActiveDialog 'coil' case)
type PrimitiveKind = 'box' | 'cylinder' | 'sphere' | 'torus';

type FeatureOperation = 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component';

const KIND_COLOR: Record<PrimitiveKind, string> = {
  box: '#4a7c59',
  cylinder: '#2563eb',
  sphere: '#d97706',
  torus: '#7c3aed',
};

const KIND_TITLE: Record<PrimitiveKind, string> = {
  box: 'BOX',
  cylinder: 'CYLINDER',
  sphere: 'SPHERE',
  torus: 'TORUS',
};

export function PrimitivesDialog({ kind, onClose }: { kind: PrimitiveKind; onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  // PRIM-5: Fusion field labels — stored internally as original keys for PrimitiveBodies compat
  // Box: stored as width/height/depth (mapped from Fusion Length/Width/Height)
  const [boxLength, setBoxLength] = useState((p.width as number) || 20);
  const [boxWidth, setBoxWidth] = useState((p.height as number) || 20);
  const [boxHeight, setBoxHeight] = useState((p.depth as number) || 20);

  // Cylinder: Fusion shows Diameter — stored as radius = diam/2
  const [cylDiam, setCylDiam] = useState(((p.radius as number) || 10) * 2);
  const [cylDiamTop, setCylDiamTop] = useState(((p.radiusTop as number) ?? (p.radius as number) ?? 10) * 2);
  const [cylHeight, setCylHeight] = useState((p.height as number) || 20);

  // Sphere: Fusion shows Diameter — stored as radius = diam/2
  const [sphDiam, setSphDiam] = useState(((p.radius as number) || 10) * 2);

  // Torus: Fusion shows Torus Diameter + Section Diameter — stored as radius/tubeRadius
  const [torDiam, setTorDiam] = useState(((p.radius as number) || 15) * 2);
  const [torSecDiam, setTorSecDiam] = useState(((p.tubeRadius as number) || 3) * 2);

  const [x, setX] = useState((p.x as number) || 0);
  const [y, setY] = useState((p.y as number) || 0);
  const [z, setZ] = useState((p.z as number) || 0);

  // PRIM-4: Operation field (Fusion FeatureOperations)
  const [operation, setOperation] = useState<FeatureOperation>(
    (p.operation as FeatureOperation) ?? 'new-body',
  );

  const addPrimitive = useCADStore((s) => s.addPrimitive);
  const updatePrimitiveParams = useCADStore((s) => s.updatePrimitiveParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const params: Record<string, number | string> =
      kind === 'box'
        ? { width: boxLength, height: boxWidth, depth: boxHeight, operation }
        : kind === 'cylinder'
          ? { radius: cylDiam / 2, radiusTop: cylDiamTop / 2, height: cylHeight, operation }
          : kind === 'sphere'
            ? { radius: sphDiam / 2, operation }
            : { radius: torDiam / 2, tubeRadius: torSecDiam / 2, operation };

    if (editing) {
      updatePrimitiveParams(editing.id, { ...params, x, y, z });
      setStatusMessage(`Updated ${kind}`);
    } else {
      addPrimitive(kind, { ...params, x, y, z });
      setStatusMessage(`Created ${kind}`);
    }
    onClose();
  };

  const cylTapered = kind === 'cylinder' && Math.abs(cylDiam - cylDiamTop) > 0.001;

  return (
    <div className="tool-panel-overlay">
      <div className="tool-panel" style={{ width: 272 }}>
        <div className="tp-header">
          <div className="tp-header-icon" style={{ background: KIND_COLOR[kind] }} />
          <span className="tp-header-title">{editing ? `EDIT ${KIND_TITLE[kind]}` : KIND_TITLE[kind]}</span>
          <button className="tp-close" onClick={onClose} title="Cancel"><X size={14} /></button>
        </div>

        <div className="tp-body">
          {kind === 'box' && (
            <div className="tp-section">
              <div className="tp-row">
                <span className="tp-label">Length</span>
                <div className="tp-input-group">
                  <input type="number" value={boxLength} step={1} min={0.1}
                    onChange={(e) => setBoxLength(Math.max(0.1, parseFloat(e.target.value) || 20))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
              <div className="tp-row">
                <span className="tp-label">Width</span>
                <div className="tp-input-group">
                  <input type="number" value={boxWidth} step={1} min={0.1}
                    onChange={(e) => setBoxWidth(Math.max(0.1, parseFloat(e.target.value) || 20))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
              <div className="tp-row">
                <span className="tp-label">Height</span>
                <div className="tp-input-group">
                  <input type="number" value={boxHeight} step={1} min={0.1}
                    onChange={(e) => setBoxHeight(Math.max(0.1, parseFloat(e.target.value) || 20))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
            </div>
          )}

          {kind === 'cylinder' && (
            <div className="tp-section">
              <div className="tp-row">
                <span className="tp-label">Diameter</span>
                <div className="tp-input-group">
                  <input type="number" value={cylDiam} step={1} min={0.1}
                    onChange={(e) => setCylDiam(Math.max(0.1, parseFloat(e.target.value) || 20))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
              <div className="tp-row">
                <span className="tp-label">Height</span>
                <div className="tp-input-group">
                  <input type="number" value={cylHeight} step={1} min={0.1}
                    onChange={(e) => setCylHeight(Math.max(0.1, parseFloat(e.target.value) || 20))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
              <div className="tp-divider" />
              <div className="tp-row">
                <span className="tp-label">Top Ø</span>
                <div className="tp-input-group">
                  <input type="number" value={cylDiamTop} step={1} min={0}
                    onChange={(e) => setCylDiamTop(Math.max(0, parseFloat(e.target.value) || 20))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
              {cylTapered && (
                <div className="tp-row" style={{ opacity: 0.55 }}>
                  <span className="tp-label" style={{ fontSize: 10 }}>Taper active (Cindr3D ext.)</span>
                </div>
              )}
            </div>
          )}

          {kind === 'sphere' && (
            <div className="tp-section">
              <div className="tp-row">
                <span className="tp-label">Diameter</span>
                <div className="tp-input-group">
                  <input type="number" value={sphDiam} step={1} min={0.1}
                    onChange={(e) => setSphDiam(Math.max(0.1, parseFloat(e.target.value) || 20))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
            </div>
          )}

          {kind === 'torus' && (
            <div className="tp-section">
              <div className="tp-row">
                <span className="tp-label">Torus Ø</span>
                <div className="tp-input-group">
                  <input type="number" value={torDiam} step={1} min={0.2}
                    onChange={(e) => setTorDiam(Math.max(0.2, parseFloat(e.target.value) || 30))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
              <div className="tp-row">
                <span className="tp-label">Section Ø</span>
                <div className="tp-input-group">
                  <input type="number" value={torSecDiam} step={0.5} min={0.1}
                    onChange={(e) =>
                      setTorSecDiam(Math.max(0.1, Math.min(torDiam - 0.1, parseFloat(e.target.value) || 6)))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
            </div>
          )}

          <div className="tp-divider" />

          {/* PRIM-4: Operation */}
          <div className="tp-section">
            <div className="tp-row">
              <span className="tp-label">Operation</span>
              <select className="tp-select" value={operation}
                onChange={(e) => setOperation(e.target.value as FeatureOperation)}>
                <option value="new-body">New Body</option>
                <option value="join">Join</option>
                <option value="cut">Cut</option>
                <option value="intersect">Intersect</option>
                <option value="new-component">New Component</option>
              </select>
            </div>
          </div>

          <div className="tp-divider" />

          <div className="tp-section">
            <div className="tp-section-title">Position</div>
            <div className="tp-row">
              <span className="tp-label">X</span>
              <div className="tp-input-group">
                <input type="number" value={x} step={1}
                  onChange={(e) => setX(parseFloat(e.target.value) || 0)} />
                <span className="tp-unit">mm</span>
              </div>
            </div>
            <div className="tp-row">
              <span className="tp-label">Y</span>
              <div className="tp-input-group">
                <input type="number" value={y} step={1}
                  onChange={(e) => setY(parseFloat(e.target.value) || 0)} />
                <span className="tp-unit">mm</span>
              </div>
            </div>
            <div className="tp-row">
              <span className="tp-label">Z</span>
              <div className="tp-input-group">
                <input type="number" value={z} step={1}
                  onChange={(e) => setZ(parseFloat(e.target.value) || 0)} />
                <span className="tp-unit">mm</span>
              </div>
            </div>
          </div>
        </div>

        <div className="tp-actions">
          <button className="tp-btn tp-btn-cancel" onClick={onClose}>
            <X size={13} /> Cancel
          </button>
          <button className="tp-btn tp-btn-ok" onClick={handleApply}>
            <Check size={13} /> {editing ? 'Update' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
