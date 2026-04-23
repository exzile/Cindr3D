import './ExtrudePanel.css';
import { useMemo } from 'react';
import { ArrowUpFromLine, Scissors, X } from 'lucide-react';
import {
  useCADStore,
  type ExtrudeDirection,
  type ExtrudeOperation,
} from '../../../store/cadStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { useComponentStore } from '../../../store/componentStore';
import { ProfileSection } from './extrudePanel/ProfileSection';
import { GeometrySection } from './extrudePanel/GeometrySection';
import { OptionsSection } from './extrudePanel/OptionsSection';
import { ActionRow } from './extrudePanel/ActionRow';

export default function ExtrudePanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);
  const features = useCADStore((s) => s.features);
  const selectedIds = useCADStore((s) => s.extrudeSelectedSketchIds);
  const setSelectedIds = useCADStore((s) => s.setExtrudeSelectedSketchIds);
  const distance = useCADStore((s) => s.extrudeDistance);
  const setDistance = useCADStore((s) => s.setExtrudeDistance);
  const distance2 = useCADStore((s) => s.extrudeDistance2);
  const setDistance2 = useCADStore((s) => s.setExtrudeDistance2);
  const direction = useCADStore((s) => s.extrudeDirection);
  const setDirection = useCADStore((s) => s.setExtrudeDirection);
  const operation = useCADStore((s) => s.extrudeOperation);
  const setOperation = useCADStore((s) => s.setExtrudeOperation);
  const commitExtrude = useCADStore((s) => s.commitExtrude);
  const cancelExtrudeTool = useCADStore((s) => s.cancelExtrudeTool);
  const thinEnabled = useCADStore((s) => s.extrudeThinEnabled);
  const setThinEnabled = useCADStore((s) => s.setExtrudeThinEnabled);
  const thinThickness = useCADStore((s) => s.extrudeThinThickness);
  const setThinThickness = useCADStore((s) => s.setExtrudeThinThickness);
  const thinSide = useCADStore((s) => s.extrudeThinSide);
  const setThinSide = useCADStore((s) => s.setExtrudeThinSide);
  const thinSide2 = useCADStore((s) => s.extrudeThinSide2);
  const setThinSide2 = useCADStore((s) => s.setExtrudeThinSide2);
  const thinThickness2 = useCADStore((s) => s.extrudeThinThickness2);
  const setThinThickness2 = useCADStore((s) => s.setExtrudeThinThickness2);
  const startType = useCADStore((s) => s.extrudeStartType);
  const setStartType = useCADStore((s) => s.setExtrudeStartType);
  const startOffset = useCADStore((s) => s.extrudeStartOffset);
  const setStartOffset = useCADStore((s) => s.setExtrudeStartOffset);
  const participantBodyIds = useCADStore((s) => s.extrudeParticipantBodyIds);
  const setParticipantBodyIds = useCADStore((s) => s.setExtrudeParticipantBodyIds);
  const confinedFaceIds = useCADStore((s) => s.extrudeConfinedFaceIds);
  const setConfinedFaceIds = useCADStore((s) => s.setExtrudeConfinedFaceIds);
  const creationOccurrence = useCADStore((s) => s.extrudeCreationOccurrence);
  const setCreationOccurrence = useCADStore((s) => s.setExtrudeCreationOccurrence);
  const targetBaseFeature = useCADStore((s) => s.extrudeTargetBaseFeature);
  const setTargetBaseFeature = useCADStore((s) => s.setExtrudeTargetBaseFeature);
  const extentType = useCADStore((s) => s.extrudeExtentType);
  const setExtentType = useCADStore((s) => s.setExtrudeExtentType);
  const extentType2 = useCADStore((s) => s.extrudeExtentType2);
  const setExtentType2 = useCADStore((s) => s.setExtrudeExtentType2);
  const toEntityFaceId = useCADStore((s) => s.extrudeToEntityFaceId);
  const clearToEntityFace = useCADStore((s) => s.clearExtrudeToEntityFace);
  const toObjectFlip = useCADStore((s) => s.extrudeToObjectFlipDirection);
  const setToObjectFlip = useCADStore((s) => s.setExtrudeToObjectFlipDirection);
  const startFaceCentroid = useCADStore((s) => s.extrudeStartFaceCentroid);
  const clearStartFace = useCADStore((s) => s.clearExtrudeStartFace);
  const taperAngle = useCADStore((s) => s.extrudeTaperAngle);
  const setTaperAngle = useCADStore((s) => s.setExtrudeTaperAngle);
  const taperAngle2 = useCADStore((s) => s.extrudeTaperAngle2);
  const setTaperAngle2 = useCADStore((s) => s.setExtrudeTaperAngle2);
  const extrudeSymmetricFullLength = useCADStore((s) => s.extrudeSymmetricFullLength);
  const setExtrudeSymmetricFullLength = useCADStore((s) => s.setExtrudeSymmetricFullLength);
  const bodyKind = useCADStore((s) => s.extrudeBodyKind);
  const setBodyKind = useCADStore((s) => s.setExtrudeBodyKind);
  const units = useCADStore((s) => s.units);
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);

  const occurrences = useComponentStore((s) => s.occurrences);
  const occurrenceList = Object.values(occurrences);

  const usedSketchIds = new Set(
    features.filter((f) => f.type === 'extrude' && f.id !== editingFeatureId).map((f) => f.sketchId),
  );
  const extrudable = sketches.filter(
    (sketch) => sketch.entities.length > 0 && !usedSketchIds.has(sketch.id) && !sketch.name.startsWith('Press Pull Profile'),
  );
  const activeSketchIds = new Set(selectedIds.map((id) => id.split('::')[0]));
  const allRelevant = [
    ...extrudable,
    ...sketches.filter((sketch) => activeSketchIds.has(sketch.id) && !extrudable.includes(sketch)),
  ];

  const profileOptions = useMemo(() => {
    const options = allRelevant.flatMap((sketch) => {
      const count = GeometryEngine.sketchToShapes(sketch).length;
      return Array.from({ length: count }, (_, index) => ({
        id: `${sketch.id}::${index}`,
        label: `${sketch.name} • Profile ${index + 1}`,
        sketchId: sketch.id,
      })).filter(({ sketchId, id }) => {
        const source = allRelevant.find((item) => item.id === sketchId);
        if (!source) return false;
        const profileIndex = Number(id.split('::')[1]);
        return Number.isFinite(profileIndex) && GeometryEngine.createProfileSketch(source, profileIndex) !== null;
      });
    });

    for (const id of selectedIds) {
      if (id.includes('::')) continue;
      if (options.some((option) => option.id === id)) continue;
      const sketch = sketches.find((item) => item.id === id);
      if (sketch) options.push({ id, label: sketch.name, sketchId: id });
    }

    return options;
  }, [allRelevant, selectedIds, sketches]);

  const selectedSketches = selectedIds
    .map((id) => sketches.find((sketch) => sketch.id === id.split('::')[0]))
    .filter(Boolean) as typeof extrudable;

  const baseFeatureContainers = features.filter((feature) => feature.isBaseFeatureContainer);
  const allClosedProfiles = selectedSketches.length > 0 && selectedSketches.every((sketch) => GeometryEngine.isSketchClosedProfile(sketch));
  const effectiveBodyKind: 'solid' | 'surface' = allClosedProfiles ? bodyKind : 'surface';
  const isCutMode = operation === 'cut';
  const side2ok = direction !== 'two-sides' || extentType2 === 'all' || extentType2 === 'to-object' || Math.abs(distance2) > 0.01;
  const extent1ok = extentType === 'all' || extentType === 'to-object' || Math.abs(distance) > 0.01;
  const toObjectOk = extentType !== 'to-object' || toEntityFaceId !== null;
  const canCommit = selectedIds.length > 0 && extent1ok && side2ok && toObjectOk;

  if (activeTool !== 'extrude') return null;
  if (selectedIds.length === 0 && !editingFeatureId) return null;

  return (
    <div className="tool-panel">
      <div className="tp-header">
        <div className={`tp-header-icon ${isCutMode ? 'cut' : 'extrude'}`}>
          {isCutMode ? <Scissors size={12} /> : <ArrowUpFromLine size={12} />}
        </div>
        <span className="tp-header-title">
          {editingFeatureId ? `Edit ${isCutMode ? 'Cut' : 'Extrude'}` : isCutMode ? 'Press-Pull Cut' : 'Extrude'}
        </span>
        <button className="tp-close" onClick={cancelExtrudeTool} title="Cancel (Esc)">
          <X size={14} />
        </button>
      </div>

      <div className="tp-body">
        <ProfileSection
          profileOptions={profileOptions}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
        />

        <div className="tp-divider" />

        <GeometrySection
          clearStartFace={clearStartFace}
          clearToEntityFace={clearToEntityFace}
          direction={direction as ExtrudeDirection}
          distance={distance}
          distance2={distance2}
          effectiveBodyKind={effectiveBodyKind}
          extentType={extentType}
          extentType2={extentType2}
          extrudeSymmetricFullLength={extrudeSymmetricFullLength}
          setDirection={setDirection}
          setDistance={setDistance}
          setDistance2={setDistance2}
          setExtentType={setExtentType}
          setExtentType2={setExtentType2}
          setExtrudeSymmetricFullLength={setExtrudeSymmetricFullLength}
          setStartOffset={setStartOffset}
          setStartType={setStartType}
          setTaperAngle={setTaperAngle}
          setTaperAngle2={setTaperAngle2}
          setToObjectFlip={setToObjectFlip}
          startFaceCentroid={startFaceCentroid}
          startOffset={startOffset}
          startType={startType}
          taperAngle={taperAngle}
          taperAngle2={taperAngle2}
          toEntityFaceId={toEntityFaceId}
          toObjectFlip={toObjectFlip}
          units={units}
        />

        <div className="tp-divider" />

        <OptionsSection
          allClosedProfiles={allClosedProfiles}
          baseFeatureContainers={baseFeatureContainers}
          confinedFaceIds={confinedFaceIds}
          creationOccurrence={creationOccurrence}
          direction={direction}
          effectiveBodyKind={effectiveBodyKind}
          occurrenceList={occurrenceList}
          operation={operation as ExtrudeOperation}
          participantBodyIds={participantBodyIds}
          setBodyKind={setBodyKind}
          setConfinedFaceIds={setConfinedFaceIds}
          setCreationOccurrence={setCreationOccurrence}
          setOperation={setOperation}
          setParticipantBodyIds={setParticipantBodyIds}
          setTargetBaseFeature={setTargetBaseFeature}
          setThinEnabled={setThinEnabled}
          setThinSide={setThinSide}
          setThinSide2={setThinSide2}
          setThinThickness={setThinThickness}
          setThinThickness2={setThinThickness2}
          targetBaseFeature={targetBaseFeature}
          thinEnabled={thinEnabled}
          thinSide={thinSide}
          thinSide2={thinSide2}
          thinThickness={thinThickness}
          thinThickness2={thinThickness2}
          units={units}
        />

        <ActionRow
          canCommit={canCommit}
          cancelExtrudeTool={cancelExtrudeTool}
          commitExtrude={commitExtrude}
          editingFeatureId={editingFeatureId}
        />
      </div>
    </div>
  );
}
