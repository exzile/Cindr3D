import { useEffect, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import {
  type HoleStandard,
  type HoleSizeEntry,
  STANDARD_SIZES,
} from './HoleSizePresets';
import type { Feature } from '../../../types/cad';
import { CollapsibleSection } from '../common/CollapsibleSection';
import '../common/ToolPanel.css';
import { ParticipantBodyPicker } from '../../ui/ParticipantBodyPicker';
import { PlacementSection } from './holeDialog/PlacementSection';
import { ShapeSettingsSection } from './holeDialog/ShapeSettingsSection';
import {
  type DrillPoint,
  type HoleTermination,
  type HoleType,
  type Placement,
  type TapType,
} from './holeDialog/types';
import './HoleDialog.css';

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

  // SOL-I4: Standard library
  const [standard, setStandard] = useState<HoleStandard>('custom');
  const [selectedPreset, setSelectedPreset] = useState<HoleSizeEntry | null>(null);

  const handleApplyPreset = (label: string) => {
    const entries = STANDARD_SIZES[standard];
    const entry = entries.find((e) => e.label === label) ?? null;
    setSelectedPreset(entry);
    if (entry) {
      // For tapped holes use tap drill; for clearance/simple use clearance diameter
      const isTapped = tapType === 'tapped' || tapType === 'taper-tapped';
      setDraftDiameter(isTapped ? entry.tapDiameter : entry.clearanceDiameter);
      if (!through) setDraftDepth(entry.recommendedDepth);
    }
  };

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
  // SDK-1: plane-offsets placement
  const [offsetDist1, setOffsetDist1] = useState(Number(p.offsetDist1 ?? 10));
  const [offsetDist2, setOffsetDist2] = useState(Number(p.offsetDist2 ?? 10));
  // SDK-1: on-edge placement
  const [edgeParam, setEdgeParam] = useState(Number(p.edgeParam ?? 0.5));

  // CORR-14: participant bodies (empty = cut all)
  const [participantBodyIds, setParticipantBodyIds] = useState<string[]>(
    (p.participantBodyIds as string[] | undefined) ?? []
  );

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

  const through = termination === 'through-all' || termination === 'to-object' || termination === 'to-face';
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
      // SDK-1: plane-offsets / on-edge placement params
      ...(placement === 'plane-offsets' ? { offsetDist1, offsetDist2 } : {}),
      ...(placement === 'on-edge' ? { edgeParam } : {}),
      // CORR-14: participant bodies
      ...(participantBodyIds.length > 0 ? { participantBodyIds } : {}),
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
          <PlacementSection
            placement={placement}
            setPlacement={setPlacement}
            holeFaceId={holeFaceId}
            clearHoleFace={clearHoleFace}
            offsetDist1={offsetDist1}
            setOffsetDist1={setOffsetDist1}
            offsetDist2={offsetDist2}
            setOffsetDist2={setOffsetDist2}
            edgeParam={edgeParam}
            setEdgeParam={setEdgeParam}
          />

          <div className="tp-divider" />

          <ShapeSettingsSection
            termination={termination}
            setTermination={setTermination}
            holeType={holeType}
            setHoleType={setHoleType}
            tapType={tapType}
            setTapType={setTapType}
            drillPoint={drillPoint}
            setDrillPoint={setDrillPoint}
            standard={standard}
            setStandard={(value) => {
              setStandard(value);
              setSelectedPreset(null);
            }}
            selectedPreset={selectedPreset}
            handleApplyPreset={handleApplyPreset}
            headDepth={headDepth}
            setHeadDepth={setHeadDepth}
            drillAngle={drillAngle}
            setDrillAngle={setDrillAngle}
            draftDiameter={draftDiameter}
            setDraftDiameter={setDraftDiameter}
            through={through}
            draftDepth={draftDepth}
            setDraftDepth={setDraftDepth}
            showCB={showCB}
            cbDiameter={cbDiameter}
            setCbDiameter={setCbDiameter}
            cbDepth={cbDepth}
            setCbDepth={setCbDepth}
            showCS={showCS}
            csDiameter={csDiameter}
            setCsDiameter={setCsDiameter}
            csAngle={csAngle}
            setCsAngle={setCsAngle}
          />

          <div className="tp-divider" />
          {/* ── Objects To Cut (CORR-14) ───────────────────────────────── */}
          <CollapsibleSection title="Objects To Cut" defaultOpen={false}>
            <ParticipantBodyPicker
              selectedIds={participantBodyIds}
              onChange={setParticipantBodyIds}
              label="Select bodies to cut (empty = all)"
            />
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
