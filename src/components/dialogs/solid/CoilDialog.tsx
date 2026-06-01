/**
 * SOL-M5: Coil / Helix generator dialog.
 * Generates a swept tube along a parametric helix curve using THREE.TubeGeometry.
 * Supports four coil types (pitch+height, pitch+revolutions, height+revolutions, spiral)
 * and five cross-section shapes (circle, square, triangle, triangle-external, triangle-internal).
 */
import { useState, useMemo, useCallback } from 'react';
import { X, Check } from 'lucide-react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';
import { getOccSync } from '../../../engine/occ/loader';
import { occCoilWithInstance } from '../../../engine/occ/ops/helix';
import { createRegisteredOccMesh } from '../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../viewport/scene/bodyMaterial';
import { errorMessage } from '../../../utils/errorHandling';
import {
  buildCoilGeometry,
  COIL_MESH_MATERIAL,
  type CoilDirection,
  type CoilSection,
} from './coilGeometry';
import '../common/ToolPanel.css';

type CoilType = 'pitch-height' | 'pitch-revolutions' | 'height-revolutions' | 'spiral';

export function CoilDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const addFeature = useCADStore((s) => s.addFeature);
  const updateCoilFeatureMesh = useCADStore((s) => s.updateCoilFeatureMesh);
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
      case 'spiral':
        return { label: 'Outer Ø', value: ((coilDiameter / 2 + pitch * revolutions) * 2).toFixed(2) + ' mm' };
    }
  }, [coilType, pitch, height, revolutions, coilDiameter]);

  const effectiveRevolutions = useMemo(() => {
    switch (coilType) {
      case 'pitch-height': return pitch > 0 ? height / pitch : 0;
      case 'pitch-revolutions': return revolutions;
      case 'height-revolutions': return revolutions;
      case 'spiral': return revolutions;
    }
  }, [coilType, pitch, height, revolutions]);

  const effectiveHeight = useMemo(() => {
    switch (coilType) {
      case 'pitch-height': return height;
      case 'pitch-revolutions': return pitch * revolutions;
      case 'height-revolutions': return height;
      case 'spiral': return 0; // flat spiral — no axial rise
    }
  }, [coilType, pitch, height, revolutions]);

  /**
   * Build the coil mesh.  Circle section: OCC helical sweep first, THREE TubeGeometry
   * fallback.  Square / triangle: always THREE ExtrudeGeometry (no OCC equivalent).
   * featureId is forwarded as sourceFeatureId so the resulting BRepBody is tracked.
   * Uses COIL_MESH_MATERIAL (module-level singleton) for the THREE path — no per-call leak.
   */
  const buildCoilMesh = useCallback((featureId: string): THREE.Mesh | null => {
    // ── OCC-first for circle section ────────────────────────────────────────
    if (section === 'circle') {
      const occ = getOccSync();
      if (occ) {
        try {
          const effectivePitch = effectiveRevolutions > 0
            ? effectiveHeight / effectiveRevolutions
            : 1;
          const body = occCoilWithInstance(
            occ.oc,
            coilDiameter / 2,
            sectionDiameter / 2,
            effectivePitch,
            effectiveRevolutions,
            { sourceFeatureId: featureId, rightHand: direction !== 'cw' },
          );
          const m = createRegisteredOccMesh(occ.oc, body, BODY_MATERIAL, featureId);
          m.castShadow = true;
          m.receiveShadow = true;
          return m;
        } catch (err) {
          console.warn(
            `[CoilDialog] OCC path failed (${errorMessage(err, 'unknown')}), falling back to THREE`,
          );
        }
      }
    }

    // ── THREE fallback (square / triangle / spiral, or OCC unavailable / failed) ─────
    const isSpiral = coilType === 'spiral';
    const geo = buildCoilGeometry(coilDiameter, pitch, effectiveHeight, effectiveRevolutions, sectionDiameter, section, direction, isSpiral);
    if (!geo) return null;
    return new THREE.Mesh(geo, COIL_MESH_MATERIAL);
  }, [section, direction, coilType, coilDiameter, sectionDiameter, pitch, effectiveRevolutions, effectiveHeight]);

  const canApply = effectiveRevolutions > 0.01 && (coilType === 'spiral' || effectiveHeight > 0.001) && coilDiameter > 0 && sectionDiameter > 0;

  const handleApply = () => {
    const params: Record<string, number | string | boolean> = {
      coilType, section, direction,
      coilDiameter, pitch, height, revolutions, sectionDiameter,
    };

    if (editing) {
      const mesh = buildCoilMesh(editing.id);
      if (!mesh) { setStatusMessage('Coil: invalid parameters'); return; }
      updateCoilFeatureMesh(editing.id, mesh, params);
    } else {
      // Generate the ID before building the mesh so the OCC body can be
      // registered under the correct sourceFeatureId straight away.
      const featureId = crypto.randomUUID();
      const mesh = buildCoilMesh(featureId) ?? undefined;
      const feature: Feature = {
        id: featureId,
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
              <option value="spiral">Spiral</option>
            </select>
          </div>

          {/* Section shape */}
          <div className="tp-row">
            <span className="tp-label">Section</span>
            <select className="tp-select" value={section} onChange={(e) => setSection(e.target.value as CoilSection)}>
              <option value="circle">Circular</option>
              <option value="square">Square</option>
              <option value="triangle">Triangular</option>
              <option value="triangle-external">Triangular (External)</option>
              <option value="triangle-internal">Triangular (Internal)</option>
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

          {/* Pitch — shown for pitch-height, pitch-revolutions, and spiral (radial pitch) */}
          {(coilType === 'pitch-height' || coilType === 'pitch-revolutions' || coilType === 'spiral') && (
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

          {/* Height — shown for pitch-height and height-revolutions (not spiral) */}
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

          {/* Revolutions — shown for pitch-revolutions, height-revolutions, and spiral */}
          {(coilType === 'pitch-revolutions' || coilType === 'height-revolutions' || coilType === 'spiral') && (
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
