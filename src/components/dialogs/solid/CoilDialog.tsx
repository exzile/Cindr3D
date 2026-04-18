/**
 * SOL-M5: Coil / Helix generator dialog.
 * Generates a swept tube along a parametric helix curve using THREE.TubeGeometry.
 * Supports three coil types (pitch+height, pitch+revolutions, height+revolutions)
 * and three cross-section shapes (circle, square, triangle).
 */
import { useState, useMemo } from 'react';
import { X, Check } from 'lucide-react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';
import '../common/ToolPanel.css';

const COIL_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.5, metalness: 0.3 });

type CoilType = 'pitch-height' | 'pitch-revolutions' | 'height-revolutions';
type CoilSection = 'circle' | 'square' | 'triangle';
type CoilDirection = 'cw' | 'ccw';

/** Parametric helix curve (Y-up, right-handed by default). */
class HelixCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly radius: number,
    private readonly height: number,
    private readonly revolutions: number,
    private readonly ccw: boolean,
  ) { super(); }

  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const angle = t * this.revolutions * 2 * Math.PI * (this.ccw ? -1 : 1);
    return target.set(
      this.radius * Math.cos(angle),
      t * this.height,
      this.radius * Math.sin(angle),
    );
  }
}

/** Build a THREE.BufferGeometry for the coil. Returns null if params are degenerate. */
function buildCoilGeometry(
  coilDiameter: number,
  pitch: number,
  height: number,
  revolutions: number,
  sectionDiameter: number,
  section: CoilSection,
  direction: CoilDirection,
): THREE.BufferGeometry | null {
  const radius = Math.max(0.01, coilDiameter / 2);
  const sectionR = Math.max(0.001, sectionDiameter / 2);
  if (height < 0.001 || revolutions < 0.01) return null;

  const segments = Math.max(32, Math.round(revolutions * 48));
  const curve = new HelixCurve(radius, height, revolutions, direction === 'ccw');

  if (section === 'circle') {
    return new THREE.TubeGeometry(curve, segments, sectionR, 10, false);
  }

  // For square / triangle: use ExtrudeGeometry with a 2D shape
  // Build path from discrete curve points
  const pts = curve.getPoints(segments);
  const path = new THREE.CatmullRomCurve3(pts, false, 'chordal', 0.5);

  const shape = new THREE.Shape();
  if (section === 'square') {
    const s = sectionR;
    shape.moveTo(-s, -s);
    shape.lineTo( s, -s);
    shape.lineTo( s,  s);
    shape.lineTo(-s,  s);
    shape.closePath();
  } else {
    // Equilateral triangle inscribed in sectionR circle
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 - Math.PI / 2;
      if (i === 0) shape.moveTo(sectionR * Math.cos(angle), sectionR * Math.sin(angle));
      else shape.lineTo(sectionR * Math.cos(angle), sectionR * Math.sin(angle));
    }
    shape.closePath();
  }

  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    steps: segments,
    extrudePath: path,
    bevelEnabled: false,
  };

  try {
    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  } catch {
    // ExtrudeGeometry can fail on very tight curves — fall back to TubeGeometry
    return new THREE.TubeGeometry(curve, segments, sectionR, 10, false);
  }
}

export function CoilDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [coilType, setCoilType] = useState<CoilType>((p.coilType as CoilType) ?? 'pitch-height');
  const [section, setSection] = useState<CoilSection>((p.section as CoilSection) ?? 'circle');
  const [direction, setDirection] = useState<CoilDirection>((p.direction as CoilDirection) ?? 'ccw');
  const [coilDiameter, setCoilDiameter] = useState(Number(p.coilDiameter ?? 20));
  const [pitch, setPitch] = useState(Number(p.pitch ?? 5));
  const [height, setHeight] = useState(Number(p.height ?? 25));
  const [revolutions, setRevolutions] = useState(Number(p.revolutions ?? 5));
  const [sectionDiameter, setSectionDiameter] = useState(Number(p.sectionDiameter ?? 3));

  /** Derived third parameter based on coilType */
  const derived = useMemo(() => {
    switch (coilType) {
      case 'pitch-height':
        return { label: 'Revolutions', value: pitch > 0 ? (height / pitch).toFixed(2) : '—' };
      case 'pitch-revolutions':
        return { label: 'Height', value: (pitch * revolutions).toFixed(2) + ' mm' };
      case 'height-revolutions':
        return { label: 'Pitch', value: revolutions > 0 ? (height / revolutions).toFixed(2) + ' mm' : '—' };
    }
  }, [coilType, pitch, height, revolutions]);

  const effectiveRevolutions = useMemo(() => {
    switch (coilType) {
      case 'pitch-height': return pitch > 0 ? height / pitch : 0;
      case 'pitch-revolutions': return revolutions;
      case 'height-revolutions': return revolutions;
    }
  }, [coilType, pitch, height, revolutions]);

  const effectiveHeight = useMemo(() => {
    switch (coilType) {
      case 'pitch-height': return height;
      case 'pitch-revolutions': return pitch * revolutions;
      case 'height-revolutions': return height;
    }
  }, [coilType, pitch, height, revolutions]);

  const canApply = effectiveRevolutions > 0.01 && effectiveHeight > 0.001 && coilDiameter > 0 && sectionDiameter > 0;

  const handleApply = () => {
    const geo = buildCoilGeometry(coilDiameter, pitch, effectiveHeight, effectiveRevolutions, sectionDiameter, section, direction);
    const mesh = geo ? new THREE.Mesh(geo, COIL_MATERIAL) : undefined;

    const params: Record<string, number | string | boolean> = {
      coilType, section, direction,
      coilDiameter, pitch, height, revolutions, sectionDiameter,
    };

    if (editing) {
      updateFeatureParams(editing.id, params);
      setStatusMessage(`Updated coil (⌀${coilDiameter}mm, ${effectiveRevolutions.toFixed(1)} revolutions)`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Coil (⌀${coilDiameter}mm × ${effectiveRevolutions.toFixed(1)}rev)`,
        type: 'coil',
        params,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: mesh ?? undefined,
        bodyKind: 'solid',
      };
      addFeature(feature);
      setStatusMessage(`Created coil: ⌀${coilDiameter}mm, pitch ${pitch}mm, ${effectiveRevolutions.toFixed(1)} revolutions`);
    }
    onClose();
  };

  return (
    <div className="tool-panel-overlay">
      <div className="tool-panel" style={{ width: 280 }}>
        <div className="tp-header">
          <div className="tp-header-icon" style={{ background: '#4455aa' }} />
          <span className="tp-header-title">{editing ? 'EDIT COIL' : 'COIL'}</span>
          <button className="tp-close" onClick={onClose} title="Cancel"><X size={14} /></button>
        </div>

        <div className="tp-body">
          {/* Coil Type */}
          <div className="tp-row">
            <span className="tp-label">Type</span>
            <select className="tp-select" value={coilType} onChange={(e) => setCoilType(e.target.value as CoilType)}>
              <option value="pitch-height">Pitch + Height</option>
              <option value="pitch-revolutions">Pitch + Revolutions</option>
              <option value="height-revolutions">Height + Revolutions</option>
            </select>
          </div>

          {/* Section shape */}
          <div className="tp-row">
            <span className="tp-label">Section</span>
            <select className="tp-select" value={section} onChange={(e) => setSection(e.target.value as CoilSection)}>
              <option value="circle">Circle</option>
              <option value="square">Square</option>
              <option value="triangle">Triangle</option>
            </select>
          </div>

          {/* Direction */}
          <div className="tp-row">
            <span className="tp-label">Direction</span>
            <select className="tp-select" value={direction} onChange={(e) => setDirection(e.target.value as CoilDirection)}>
              <option value="ccw">Counter-clockwise</option>
              <option value="cw">Clockwise</option>
            </select>
          </div>

          <div className="tp-divider" />

          {/* Coil diameter */}
          <div className="tp-row">
            <span className="tp-label">Coil Ø</span>
            <div className="tp-input-group">
              <input
                type="number" value={coilDiameter} step={1} min={0.1}
                onChange={(e) => setCoilDiameter(Math.max(0.1, parseFloat(e.target.value) || 20))}
              />
              <span className="tp-unit">mm</span>
            </div>
          </div>

          {/* Pitch — shown for pitch-height and pitch-revolutions */}
          {(coilType === 'pitch-height' || coilType === 'pitch-revolutions') && (
            <div className="tp-row">
              <span className="tp-label">Pitch</span>
              <div className="tp-input-group">
                <input
                  type="number" value={pitch} step={0.5} min={0.01}
                  onChange={(e) => setPitch(Math.max(0.01, parseFloat(e.target.value) || 5))}
                />
                <span className="tp-unit">mm/rev</span>
              </div>
            </div>
          )}

          {/* Height — shown for pitch-height and height-revolutions */}
          {(coilType === 'pitch-height' || coilType === 'height-revolutions') && (
            <div className="tp-row">
              <span className="tp-label">Height</span>
              <div className="tp-input-group">
                <input
                  type="number" value={height} step={1} min={0.01}
                  onChange={(e) => setHeight(Math.max(0.01, parseFloat(e.target.value) || 25))}
                />
                <span className="tp-unit">mm</span>
              </div>
            </div>
          )}

          {/* Revolutions — shown for pitch-revolutions and height-revolutions */}
          {(coilType === 'pitch-revolutions' || coilType === 'height-revolutions') && (
            <div className="tp-row">
              <span className="tp-label">Revolutions</span>
              <div className="tp-input-group">
                <input
                  type="number" value={revolutions} step={0.5} min={0.1}
                  onChange={(e) => setRevolutions(Math.max(0.1, parseFloat(e.target.value) || 5))}
                />
                <span className="tp-unit">rev</span>
              </div>
            </div>
          )}

          {/* Section diameter */}
          <div className="tp-row">
            <span className="tp-label">Section Ø</span>
            <div className="tp-input-group">
              <input
                type="number" value={sectionDiameter} step={0.1} min={0.01}
                onChange={(e) => setSectionDiameter(Math.max(0.01, parseFloat(e.target.value) || 3))}
              />
              <span className="tp-unit">mm</span>
            </div>
          </div>

          {/* Derived read-only value */}
          <div className="tp-row" style={{ opacity: 0.7 }}>
            <span className="tp-label">{derived.label}</span>
            <span style={{ fontSize: 11, color: '#aaaacc', paddingRight: 4 }}>{derived.value}</span>
          </div>
        </div>

        <div className="tp-actions">
          <button className="tp-btn tp-btn-cancel" onClick={onClose}>
            <X size={13} /> Cancel
          </button>
          <button className="tp-btn tp-btn-ok" onClick={handleApply} disabled={!canApply}>
            <Check size={13} /> {editing ? 'Update' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
