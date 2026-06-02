import { useState, useEffect, useCallback } from 'react';
import { X, Check, MousePointer2 } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { useDraggablePanel } from '../../viewport/sketch/useDraggablePanel';
import {
  BOX_PRIMITIVE_DRAG_EVENT,
  CYLINDER_PRIMITIVE_DRAG_EVENT,
  type BoxPrimitiveDragDetail,
  type CylinderPrimitiveDragDetail,
} from '../../../utils/primitivePreviewEvents';
import '../common/ToolPanel.css';

// PRIM-9: coil routes through CoilDialog (ActiveDialog 'coil' case).
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

const OPERATION_LABEL: Record<FeatureOperation, string> = {
  'new-body': 'New Body',
  join: 'Join',
  cut: 'Cut',
  intersect: 'Intersect',
  'new-component': 'New Component',
};

function positiveNumber(value: string, fallback: number, min = 0.1): number {
  return Math.max(min, parseFloat(value) || fallback);
}

export function PrimitivesDialog({ kind, onClose }: { kind: PrimitiveKind; onClose: () => void }) {
  const {
    dragHandleProps,
    isDragging,
    panelEventProps,
    panelRef,
    panelStyle,
  } = useDraggablePanel();
  const features = useCADStore((s) => s.features);
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const [boxLength, setBoxLength] = useState((p.width as number) || 20);
  const [boxWidth, setBoxWidth] = useState((p.depth as number) || 20);
  const [boxHeight, setBoxHeight] = useState((p.height as number) || 20);

  // Fusion shows cylinder/sphere/torus fields as diameters; primitives store radii.
  const [cylDiam, setCylDiam] = useState(((p.radius as number) || 10) * 2);
  const [cylHeight, setCylHeight] = useState((p.height as number) || 20);
  const [sphDiam, setSphDiam] = useState(((p.radius as number) || 10) * 2);
  const [torDiam, setTorDiam] = useState(((p.radius as number) || 15) * 2);
  const [torSecDiam, setTorSecDiam] = useState(((p.tubeRadius as number) || 3) * 2);

  const [x, setX] = useState((p.x as number) || 0);
  const [y, setY] = useState((p.y as number) || 0);
  const [z, setZ] = useState((p.z as number) || 0);
  const initialOperation = kind === 'cylinder' && p.operation === 'new-component'
    ? 'new-body'
    : ((p.operation as FeatureOperation) ?? 'new-body');
  const [operation, setOperation] = useState<FeatureOperation>(
    initialOperation,
  );

  const addPrimitive = useCADStore((s) => s.addPrimitive);
  const updatePrimitiveParams = useCADStore((s) => s.updatePrimitiveParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const setPrimitivePreview = useCADStore((s) => s.setPrimitivePreview);
  const setActiveTool = useCADStore((s) => s.setActiveTool);

  const buildPreviewParams = useCallback((): Record<string, number> => {
    if (kind === 'box') return { width: boxLength, height: boxHeight, depth: boxWidth, x, y, z };
    if (kind === 'cylinder') return { radius: cylDiam / 2, radiusTop: cylDiam / 2, height: cylHeight, x, y, z };
    if (kind === 'sphere') return { radius: sphDiam / 2, x, y, z };
    return { radius: torDiam / 2, tubeRadius: torSecDiam / 2, x, y, z };
  }, [kind, boxLength, boxWidth, boxHeight, cylDiam, cylHeight, sphDiam, torDiam, torSecDiam, x, y, z]);

  useEffect(() => {
    setPrimitivePreview({ kind, params: buildPreviewParams() });
  }, [buildPreviewParams, kind, setPrimitivePreview]);

  useEffect(() => () => { setPrimitivePreview(null); }, [setPrimitivePreview]);

  useEffect(() => {
    if (kind === 'box') setStatusMessage('Box: set placement, length, width, height, and operation');
    if (kind === 'cylinder') setStatusMessage('Cylinder: set placement, diameter, height, and operation');
  }, [kind, setStatusMessage]);

  useEffect(() => {
    if (kind !== 'box') return;
    const handleDrag = (event: Event) => {
      const detail = (event as CustomEvent<BoxPrimitiveDragDetail>).detail;
      if (!detail) return;
      if (typeof detail.width === 'number') setBoxLength(Math.max(0.1, detail.width));
      if (typeof detail.depth === 'number') setBoxWidth(Math.max(0.1, detail.depth));
      if (typeof detail.height === 'number') setBoxHeight(Math.max(0.1, detail.height));
    };
    window.addEventListener(BOX_PRIMITIVE_DRAG_EVENT, handleDrag);
    return () => window.removeEventListener(BOX_PRIMITIVE_DRAG_EVENT, handleDrag);
  }, [kind]);

  useEffect(() => {
    if (kind !== 'cylinder') return;
    const handleDrag = (event: Event) => {
      const detail = (event as CustomEvent<CylinderPrimitiveDragDetail>).detail;
      if (!detail) return;
      if (typeof detail.radius === 'number') setCylDiam(Math.max(0.1, detail.radius * 2));
      if (typeof detail.height === 'number') setCylHeight(Math.max(0.1, detail.height));
    };
    window.addEventListener(CYLINDER_PRIMITIVE_DRAG_EVENT, handleDrag);
    return () => window.removeEventListener(CYLINDER_PRIMITIVE_DRAG_EVENT, handleDrag);
  }, [kind]);

  const handleApply = () => {
    const params: Record<string, number | string> =
      kind === 'box'
        ? { width: boxLength, height: boxHeight, depth: boxWidth, operation }
        : kind === 'cylinder'
          ? { radius: cylDiam / 2, radiusTop: cylDiam / 2, height: cylHeight, operation }
          : kind === 'sphere'
            ? { radius: sphDiam / 2, operation }
            : { radius: torDiam / 2, tubeRadius: torSecDiam / 2, operation };

    setPrimitivePreview(null);
    if (editing) {
      updatePrimitiveParams(editing.id, { ...params, x, y, z });
      setStatusMessage(`Updated ${kind}`);
    } else {
      addPrimitive(kind, { ...params, x, y, z });
      setStatusMessage(`Created ${kind}`);
    }
    onClose();
  };

  const operationOptions: FeatureOperation[] = kind === 'cylinder'
    ? ['join', 'cut', 'intersect', 'new-body']
    : ['new-body', 'join', 'cut', 'intersect', 'new-component'];

  return (
    <div className="tool-panel-overlay">
      <div
        ref={panelRef}
        className={`tool-panel${kind === 'box' || kind === 'cylinder' ? ' tool-panel--sidecar' : ''}${isDragging ? ' is-dragging' : ''}`}
        style={{ width: 272, ...panelStyle }}
        {...panelEventProps}
      >
        <div className="tp-header" {...dragHandleProps}>
          <div className="tp-header-icon" style={{ background: KIND_COLOR[kind] }} />
          <span className="tp-header-title">{editing ? `EDIT ${KIND_TITLE[kind]}` : KIND_TITLE[kind]}</span>
          <button className="tp-close" onClick={onClose} title="Cancel"><X size={14} /></button>
        </div>

        <div className="tp-body">
          {kind === 'box' && (
            <div className="tp-section">
              <div className="tp-row">
                <span className="tp-label">Placement</span>
                <button
                  className="tp-pick-btn active"
                  type="button"
                  title="Box is placed normal to the XY plane. Use center coordinates to reposition it."
                  onClick={() => {
                    setActiveTool('select');
                    setStatusMessage('Box placement uses the XY plane for now - adjust center coordinates below');
                  }}
                >
                  <MousePointer2 size={13} />
                  Plane
                </button>
              </div>
              <div className="tp-row">
                <span className="tp-label">Length</span>
                <div className="tp-input-group">
                  <input type="number" value={boxLength} step={1} min={0.1}
                    onChange={(e) => setBoxLength(positiveNumber(e.target.value, 20))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
              <div className="tp-row">
                <span className="tp-label">Width</span>
                <div className="tp-input-group">
                  <input type="number" value={boxWidth} step={1} min={0.1}
                    onChange={(e) => setBoxWidth(positiveNumber(e.target.value, 20))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
              <div className="tp-row">
                <span className="tp-label">Height</span>
                <div className="tp-input-group">
                  <input type="number" value={boxHeight} step={1} min={0.1}
                    onChange={(e) => setBoxHeight(positiveNumber(e.target.value, 20))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
              <div className="tp-row">
                <span className="tp-label">Center</span>
                <span className="tp-muted-value">{x.toFixed(1)}, {y.toFixed(1)}, {z.toFixed(1)}</span>
              </div>
            </div>
          )}

          {kind === 'cylinder' && (
            <div className="tp-section">
              <div className="tp-row">
                <span className="tp-label">Placement</span>
                <button
                  className="tp-pick-btn active"
                  type="button"
                  title="Cylinder is placed normal to the XY plane. Use center coordinates to reposition it."
                  onClick={() => {
                    setActiveTool('select');
                    setStatusMessage('Cylinder placement uses the XY plane for now - adjust center coordinates below');
                  }}
                >
                  <MousePointer2 size={13} />
                  Plane
                </button>
              </div>
              <div className="tp-row">
                <span className="tp-label">Diameter</span>
                <div className="tp-input-group">
                  <input type="number" value={cylDiam} step={1} min={0.1}
                    onChange={(e) => setCylDiam(positiveNumber(e.target.value, 20))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
              <div className="tp-row">
                <span className="tp-label">Height</span>
                <div className="tp-input-group">
                  <input type="number" value={cylHeight} step={1} min={0.1}
                    onChange={(e) => setCylHeight(positiveNumber(e.target.value, 20))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
              <div className="tp-row">
                <span className="tp-label">Center</span>
                <span className="tp-muted-value">{x.toFixed(1)}, {y.toFixed(1)}, {z.toFixed(1)}</span>
              </div>
            </div>
          )}

          {kind === 'sphere' && (
            <div className="tp-section">
              <div className="tp-row">
                <span className="tp-label">Diameter</span>
                <div className="tp-input-group">
                  <input type="number" value={sphDiam} step={1} min={0.1}
                    onChange={(e) => setSphDiam(positiveNumber(e.target.value, 20))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
            </div>
          )}

          {kind === 'torus' && (
            <div className="tp-section">
              <div className="tp-row">
                <span className="tp-label">Torus Diameter</span>
                <div className="tp-input-group">
                  <input type="number" value={torDiam} step={1} min={0.2}
                    onChange={(e) => setTorDiam(positiveNumber(e.target.value, 30, 0.2))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
              <div className="tp-row">
                <span className="tp-label">Section Diameter</span>
                <div className="tp-input-group">
                  <input type="number" value={torSecDiam} step={0.5} min={0.1}
                    onChange={(e) => setTorSecDiam(Math.max(0.1, Math.min(torDiam - 0.1, parseFloat(e.target.value) || 6)))} />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
            </div>
          )}

          <div className="tp-divider" />

          <div className="tp-section">
            <div className="tp-row">
              <span className="tp-label">Operation</span>
              <select className="tp-select" value={operation}
                onChange={(e) => setOperation(e.target.value as FeatureOperation)}>
                {operationOptions.map((value) => (
                  <option key={value} value={value}>{OPERATION_LABEL[value]}</option>
                ))}
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
