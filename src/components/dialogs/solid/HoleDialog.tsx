import { useEffect, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';
import { CollapsibleSection } from '../common/CollapsibleSection';
import { SegmentedIconGroup } from '../common/SegmentedIconGroup';
import { FaceSelector } from '../common/FaceSelector';
import {
  SimpleHoleIcon,
  CounterboreIcon,
  CountersinkIcon,
  TapSimpleIcon,
  TapClearanceIcon,
  TapTappedIcon,
  TapTaperTappedIcon,
  DrillFlatIcon,
  DrillAngledIcon,
} from './HoleIcons';
import '../common/ToolPanel.css';
import './HoleDialog.css';

type HoleType = 'simple' | 'counterbore' | 'countersink';
type TapType = 'simple' | 'clearance' | 'tapped' | 'taper-tapped';
type DrillPoint = 'flat' | 'angled';
type HoleTermination = 'blind' | 'through-all' | 'to-object';
type Placement = 'single' | 'multiple';

const HOLE_TYPE_OPTIONS = [
  { value: 'simple' as const, icon: <SimpleHoleIcon />, title: 'Simple' },
  { value: 'counterbore' as const, icon: <CounterboreIcon />, title: 'Counterbore' },
  { value: 'countersink' as const, icon: <CountersinkIcon />, title: 'Countersink' },
];

const TAP_TYPE_OPTIONS = [
  { value: 'simple' as const, icon: <TapSimpleIcon />, title: 'Simple' },
  { value: 'clearance' as const, icon: <TapClearanceIcon />, title: 'Clearance' },
  { value: 'tapped' as const, icon: <TapTappedIcon />, title: 'Tapped' },
  { value: 'taper-tapped' as const, icon: <TapTaperTappedIcon />, title: 'Taper Tapped' },
];

const DRILL_POINT_OPTIONS = [
  { value: 'flat' as const, icon: <DrillFlatIcon />, title: 'Flat' },
  { value: 'angled' as const, icon: <DrillAngledIcon />, title: 'Angled' },
];

const PLACEMENT_OPTIONS = [
  {
    value: 'single' as const,
    title: 'Single Hole',
    icon: (
      <svg width={14} height={14} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.2}>
        <rect x={2} y={2} width={14} height={14} />
        <circle cx={9} cy={9} r={2.5} />
      </svg>
    ),
  },
  {
    value: 'multiple' as const,
    title: 'Multiple Holes',
    icon: (
      <svg width={14} height={14} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.2}>
        <rect x={2} y={2} width={14} height={14} />
        <circle cx={6} cy={6} r={1.5} />
        <circle cx={12} cy={6} r={1.5} />
        <circle cx={6} cy={12} r={1.5} />
        <circle cx={12} cy={12} r={1.5} />
      </svg>
    ),
  },
];

export function HoleDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const holeFaceId = useCADStore((s) => s.holeFaceId);
  const holeFaceCentroid = useCADStore((s) => s.holeFaceCentroid);
  const holeFaceNormal = useCADStore((s) => s.holeFaceNormal);
  const clearHoleFace = useCADStore((s) => s.clearHoleFace);

  const draftDiameter = useCADStore((s) => s.holeDraftDiameter);
  const setDraftDiameter = useCADStore((s) => s.setHoleDraftDiameter);
  const draftDepth = useCADStore((s) => s.holeDraftDepth);
  const setDraftDepth = useCADStore((s) => s.setHoleDraftDepth);

  const [placement, setPlacement] = useState<Placement>((p.placement as Placement) ?? 'single');
  const [holeType, setHoleType] = useState<HoleType>((p.holeType as HoleType) ?? 'simple');
  const [tapType, setTapType] = useState<TapType>((p.tapType as TapType) ?? 'simple');
  const [drillPoint, setDrillPoint] = useState<DrillPoint>((p.drillPoint as DrillPoint) ?? 'angled');
  const [drillAngle, setDrillAngle] = useState(Number(p.drillAngle ?? 118));
  const [termination, setTermination] = useState<HoleTermination>((p.termination as HoleTermination) ?? 'blind');
  const [cbDiameter, setCbDiameter] = useState(Number(p.cbDiameter ?? 10));
  const [cbDepth, setCbDepth] = useState(Number(p.cbDepth ?? 3));
  const [csAngle, setCsAngle] = useState(Number(p.csAngle ?? 90));
  const [csDiameter, setCsDiameter] = useState(Number(p.csDiameter ?? 9));
  const [headDepth, setHeadDepth] = useState(Number(p.headDepth ?? 17));

  // Hydrate persistent draft values from the edited feature once on open.
  useEffect(() => {
    if (editing) {
      if (typeof p.diameter === 'number') setDraftDiameter(p.diameter);
      if (typeof p.depth === 'number') setDraftDepth(p.depth);
    }

  }, [editing?.id]);

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const through = termination === 'through-all' || termination === 'to-object';
  const showCB = holeType === 'counterbore';
  const showCS = holeType === 'countersink';

  const handleApply = () => {
    const params = {
      placement,
      holeType,
      tapType,
      drillPoint,
      drillAngle,
      termination,
      diameter: draftDiameter,
      depth: draftDepth,
      cbDiameter,
      cbDepth,
      csAngle,
      csDiameter,
      headDepth,
      faceId: holeFaceId ?? p.faceId ?? null,
      faceNormal: holeFaceNormal ?? p.faceNormal ?? null,
      faceCentroid: holeFaceCentroid ?? p.faceCentroid ?? null,
    };
    if (editing) {
      updateFeatureParams(editing.id, params);
      setStatusMessage(`Updated ${holeType} hole: ${draftDiameter}mm ${tapType}`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Hole (${draftDiameter}mm Ø, ${holeType})`,
        type: 'hole',
        params,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Created ${holeType} hole: ${draftDiameter}mm ${tapType}`);
    }
    onClose();
  };

  return (
    <div className="hole-overlay">
      <div className="tool-panel hole-panel">
        <div className="tp-header">
          <div className="tp-header-icon hole" />
          <span className="tp-header-title">{editing ? 'EDIT HOLE' : 'HOLE'}</span>
          <button className="tp-close" onClick={onClose} title="Cancel"><X size={14} /></button>
        </div>

        <div className="tp-body">
          {/* ── Placement ─────────────────────────────────────────────── */}
          <CollapsibleSection title="Placement">
            <div className="tp-row">
              <span className="tp-label">Placement</span>
              <SegmentedIconGroup
                value={placement}
                onChange={setPlacement}
                options={PLACEMENT_OPTIONS}
                ariaLabel="Placement"
              />
            </div>
            <div className="tp-row">
              <span className="tp-label">Face</span>
              <FaceSelector
                selected={!!holeFaceId}
                pickActive={!holeFaceId}
                onClear={clearHoleFace}
                selectedLabel="1 selected"
                emptyLabel="Select"
              />
            </div>
            <div className="tp-row">
              <span className="tp-label">Reference</span>
              <FaceSelector selected={false} pickActive={false} onClear={() => {}} emptyLabel="Select" />
            </div>
            <div className="tp-row">
              <span className="tp-label">Reference</span>
              <FaceSelector selected={false} pickActive={false} onClear={() => {}} emptyLabel="Select" />
            </div>
          </CollapsibleSection>

          <div className="tp-divider" />

          {/* ── Shape Settings ────────────────────────────────────────── */}
          <CollapsibleSection title="Shape Settings">
            <div className="tp-row">
              <span className="tp-label">Extents</span>
              <div className="tp-units-row">
                <select
                  className="tp-select"
                  value={termination}
                  onChange={(e) => setTermination(e.target.value as HoleTermination)}
                >
                  <option value="blind">↔ Distance</option>
                  <option value="through-all">Through All</option>
                  <option value="to-object">To Object</option>
                </select>
                <button type="button" className="tp-icon-btn" title="Flip direction" aria-label="Flip direction">
                  <svg width={11} height={11} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4}>
                    <path d="M2 6 L10 6 M7 3 L10 6 L7 9" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="tp-row">
              <span className="tp-label">Hole Type</span>
              <SegmentedIconGroup
                value={holeType}
                onChange={setHoleType}
                options={HOLE_TYPE_OPTIONS}
                ariaLabel="Hole Type"
              />
            </div>
            <div className="tp-row">
              <span className="tp-label">Tap Type</span>
              <SegmentedIconGroup
                value={tapType}
                onChange={setTapType}
                options={TAP_TYPE_OPTIONS}
                ariaLabel="Hole Tap Type"
              />
            </div>
            <div className="tp-row">
              <span className="tp-label">Drill Point</span>
              <SegmentedIconGroup
                value={drillPoint}
                onChange={setDrillPoint}
                options={DRILL_POINT_OPTIONS}
                ariaLabel="Drill Point"
              />
            </div>

            {/* Schematic readout — head depth, drill angle, diameter */}
            <div className="hole-diagram">
              <svg
                className="hole-diagram__svg"
                width={56}
                height={92}
                viewBox="0 0 64 110"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.1}
              >
                <line x1={20} y1={6} x2={44} y2={6} />
                <line x1={20} y1={6} x2={20} y2={84} />
                <line x1={44} y1={6} x2={44} y2={84} />
                {drillPoint === 'angled' ? (
                  <polyline points="20,84 32,98 44,84" />
                ) : (
                  <line x1={20} y1={84} x2={44} y2={84} />
                )}
                <line x1={6} y1={6} x2={6} y2={84} strokeDasharray="2,2" />
              </svg>
              <div className="hole-diagram__fields">
                <div className="tp-input-group hole-diagram__field">
                  <input
                    type="number"
                    value={headDepth}
                    step={0.5}
                    min={0}
                    onChange={(e) => setHeadDepth(parseFloat(e.target.value) || 0)}
                    aria-label="Head depth (mm)"
                  />
                  <span className="tp-unit">mm</span>
                </div>
                {drillPoint === 'angled' && (
                  <div className="tp-input-group hole-diagram__field">
                    <input
                      type="number"
                      value={drillAngle}
                      min={60}
                      max={150}
                      step={1}
                      onChange={(e) => setDrillAngle(parseFloat(e.target.value) || 118)}
                      aria-label="Drill angle (deg)"
                    />
                    <span className="tp-unit">°</span>
                  </div>
                )}
                <div className="tp-input-group hole-diagram__field">
                  <input
                    type="number"
                    value={draftDiameter}
                    step={0.5}
                    min={0.1}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (Number.isFinite(n) && n > 0) setDraftDiameter(n);
                    }}
                    aria-label="Diameter (mm)"
                  />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
            </div>

            {!through && (
              <div className="tp-row">
                <span className="tp-label">Depth</span>
                <div className="tp-input-group">
                  <input
                    type="number"
                    value={draftDepth}
                    step={0.5}
                    min={0.1}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (Number.isFinite(n) && n > 0) setDraftDepth(n);
                    }}
                  />
                  <span className="tp-unit">mm</span>
                </div>
              </div>
            )}
            {showCB && (
              <>
                <div className="tp-row">
                  <span className="tp-label">CB Ø</span>
                  <div className="tp-input-group">
                    <input
                      type="number"
                      value={cbDiameter}
                      step={0.5}
                      min={0.1}
                      onChange={(e) => setCbDiameter(parseFloat(e.target.value) || 10)}
                    />
                    <span className="tp-unit">mm</span>
                  </div>
                </div>
                <div className="tp-row">
                  <span className="tp-label">CB Depth</span>
                  <div className="tp-input-group">
                    <input
                      type="number"
                      value={cbDepth}
                      step={0.5}
                      min={0.1}
                      onChange={(e) => setCbDepth(parseFloat(e.target.value) || 3)}
                    />
                    <span className="tp-unit">mm</span>
                  </div>
                </div>
              </>
            )}
            {showCS && (
              <>
                <div className="tp-row">
                  <span className="tp-label">CS Ø</span>
                  <div className="tp-input-group">
                    <input
                      type="number"
                      value={csDiameter}
                      step={0.5}
                      min={0.1}
                      onChange={(e) => setCsDiameter(parseFloat(e.target.value) || 9)}
                    />
                    <span className="tp-unit">mm</span>
                  </div>
                </div>
                <div className="tp-row">
                  <span className="tp-label">CS Angle</span>
                  <div className="tp-input-group">
                    <input
                      type="number"
                      value={csAngle}
                      min={60}
                      max={120}
                      step={5}
                      onChange={(e) => setCsAngle(parseFloat(e.target.value) || 90)}
                    />
                    <span className="tp-unit">°</span>
                  </div>
                </div>
              </>
            )}
          </CollapsibleSection>

          <div className="tp-divider" />

          {/* ── Objects To Cut ───────────────────────────────────────── */}
          <CollapsibleSection title="Objects To Cut" defaultOpen={false}>
            <div className="tp-row">
              <span className="tp-label tp-label--full">All visible bodies will be cut.</span>
            </div>
          </CollapsibleSection>
        </div>

        <div className="tp-actions">
          <button className="tp-btn tp-btn-cancel" onClick={onClose}>
            <X size={13} /> Cancel
          </button>
          <button className="tp-btn tp-btn-ok" onClick={handleApply}>
            <Check size={13} /> OK
          </button>
        </div>
      </div>
    </div>
  );
}
