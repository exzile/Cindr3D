import type { Sketch, SketchEntity, SketchPoint } from '../../../../types/cad';
import { EXTRUDE_DEFAULTS } from '../../defaults';
import type { ExtrudeDirection, ExtrudeOperation } from '../../../../types/cad-extrude.types';
import { useComponentStore } from '../../../componentStore';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

function getActiveComponentId(): string | undefined {
  const componentStore = useComponentStore.getState();
  return componentStore.activeComponentId ?? componentStore.rootComponentId;
}

export function createExtrudeSetupActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  setExtrudeSelectedSketchId: (id) => set({
    extrudeSelectedSketchId: id,
    extrudeSelectedSketchIds: id ? [id] : [],
  }),
  setExtrudeSelectedSketchIds: (ids) => set({
    extrudeSelectedSketchIds: ids,
    extrudeSelectedSketchId: ids[0] ?? null,
  }),
  setExtrudeDistance: (distance) => set({ extrudeDistance: distance }),
  setExtrudeDistance2: (distance) => set({ extrudeDistance2: distance }),
  setExtrudeDirection: (d) => set({ extrudeDirection: d }),
  setExtrudeOperation: (o) => set({ extrudeOperation: o }),
  // Thin extrude (D66)
  setExtrudeThinEnabled: (v) => set({ extrudeThinEnabled: v }),
  setExtrudeThinThickness: (t) => set({ extrudeThinThickness: Math.max(0.01, t) }),
  setExtrudeThinSide: (s) => set({ extrudeThinSide: s }),
  // EX-7/EX-8 per-side
  setExtrudeThinSide2: (s) => set({ extrudeThinSide2: s }),
  setExtrudeThinThickness2: (t) => set({ extrudeThinThickness2: Math.max(0.01, t) }),
  // D67 / CORR-8 start options
  setExtrudeStartType: (t) => set({ extrudeStartType: t }),
  setExtrudeStartOffset: (v) => set({ extrudeStartOffset: v }),
  setExtrudeStartEntityId: (id) => set({ extrudeStartEntityId: id }),
  // EX-4: From-Entity face data
  setExtrudeStartFace: (normal, centroid) => set({
    extrudeStartEntityId: centroid.join(','),
    extrudeStartFaceNormal: normal,
    extrudeStartFaceCentroid: centroid,
    statusMessage: 'Start face selected â€” set extent distance, then OK',
  }),
  clearExtrudeStartFace: () => set({
    extrudeStartEntityId: null,
    extrudeStartFaceNormal: null,
    extrudeStartFaceCentroid: null,
  }),
  // D68 extent types (EX-3: to-object added)
  setExtrudeExtentType: (t) => set({ extrudeExtentType: t }),
  setExtrudeExtentType2: (t) => set({ extrudeExtentType2: t }),
  // EX-3: To-Object face data
  setExtrudeToEntityFace: (id, normal, centroid) => set({
    extrudeToEntityFaceId: id,
    extrudeToEntityFaceNormal: normal,
    extrudeToEntityFaceCentroid: centroid,
    statusMessage: 'To-object face selected â€” OK to commit',
  }),
  clearExtrudeToEntityFace: () => set({
    extrudeToEntityFaceId: null,
    extrudeToEntityFaceNormal: null,
    extrudeToEntityFaceCentroid: null,
    extrudeToObjectFlipDirection: false,
  }),
  // EX-12
  setExtrudeToObjectFlipDirection: (v) => set({ extrudeToObjectFlipDirection: v }),
  // D69 taper angle
  setExtrudeTaperAngle: (a) => set({ extrudeTaperAngle: a }),
  // EX-6 taper angle side 2
  setExtrudeTaperAngle2: (a) => set({ extrudeTaperAngle2: a }),
  // EX-5 symmetric full-length
  setExtrudeSymmetricFullLength: (v) => set({ extrudeSymmetricFullLength: v }),
  // D102 body kind
  setExtrudeBodyKind: (k) => set({ extrudeBodyKind: k }),
  // EX-9 / CORR-14
  setExtrudeParticipantBodyIds: (ids) => set({ extrudeParticipantBodyIds: ids }),
  setExtrudeConfinedFaceIds: (ids) => set({ extrudeConfinedFaceIds: ids }),
  setExtrudeCreationOccurrence: (id) => set({ extrudeCreationOccurrence: id }),
  setExtrudeTargetBaseFeature: (id) => set({ extrudeTargetBaseFeature: id }),
  startExtrudeTool: () => {
    if (get().activeSketch) get().finishSketch();

    // Clean up orphaned Press Pull profiles from previous sessions
    const { sketches, features } = get();
    const usedSketchIds = new Set(features.map((f) => f.sketchId).filter(Boolean));
    const cleanedSketches = sketches.filter(
      (s) => !s.name.startsWith('Press Pull Profile') || usedSketchIds.has(s.id),
    );
    set({
      activeTool: 'extrude',
      ...EXTRUDE_DEFAULTS,
      sketches: cleanedSketches,
      extrudeSelectedSketchId: null,
      statusMessage: 'Click a profile or face to extrude',
    });
  },
  startExtrudeFromFace: (boundary, normal, centroid) => {
    if (boundary.length < 3) {
      set({ statusMessage: 'Cannot extrude â€” face boundary too small' });
      return;
    }
    // Build a synthetic Sketch in the 'custom' face plane. Each consecutive
    // pair of boundary points becomes a 'line' SketchEntity. The loop is
    // closed by the final segment from boundary[n-1] back to boundary[0].
    const points: SketchPoint[] = boundary.map((p) => ({
      id: crypto.randomUUID(),
      x: p.x, y: p.y, z: p.z,
    }));
    const entities: SketchEntity[] = [];
    for (let i = 0; i < points.length; i++) {
      const next = (i + 1) % points.length;
      entities.push({
        id: crypto.randomUUID(),
        type: 'line',
        points: [points[i], points[next]],
      });
    }
    const { sketches } = get();
    const componentId = getActiveComponentId();
    const pressPullCount = sketches.filter((s) => s.name.startsWith('Press Pull Profile')).length;
    const sketch: Sketch = {
      id: crypto.randomUUID(),
      name: `Press Pull Profile ${pressPullCount + 1}`,
      plane: 'custom',
      planeNormal: normal.clone().normalize(),
      planeOrigin: centroid.clone(),
      componentId,
      entities,
      constraints: [],
      dimensions: [],
      fullyConstrained: false,
    };
    const selectionId = `${sketch.id}::0`;
    // Press-pull defaults to Join (adding material to the existing body).
    // The user can switch to Cut or New Body in the panel dropdown.
    set({
      sketches: [...sketches, sketch],
      extrudeSelectedSketchId: selectionId,
      extrudeSelectedSketchIds: [selectionId],
      extrudeDirection: 'positive',
      extrudeOperation: 'join',
      statusMessage: 'Press-pull profile selected â€” drag arrow or set distance, then OK',
    });
  },
  // EX-11: add a planar face as an additional profile while sketch(es) already selected.
  // Creates a Press Pull Profile sketch from the face boundary and appends it to the
  // current selection â€” does NOT reset EXTRUDE_DEFAULTS (unlike startExtrudeFromFace).
  addFaceToExtrude: (boundary, normal, centroid) => {
    if (boundary.length < 3) {
      set({ statusMessage: 'Cannot add face â€” boundary too small' });
      return;
    }
    const points: SketchPoint[] = boundary.map((p) => ({
      id: crypto.randomUUID(),
      x: p.x, y: p.y, z: p.z,
    }));
    const entities: SketchEntity[] = [];
    for (let i = 0; i < points.length; i++) {
      const next = (i + 1) % points.length;
      entities.push({
        id: crypto.randomUUID(),
        type: 'line',
        points: [points[i], points[next]],
      });
    }
    const { sketches, extrudeSelectedSketchIds } = get();
    const componentId = getActiveComponentId();
    const pressPullCount = sketches.filter((s) => s.name.startsWith('Press Pull Profile')).length;
    const sketch: Sketch = {
      id: crypto.randomUUID(),
      name: `Press Pull Profile ${pressPullCount + 1}`,
      plane: 'custom',
      planeNormal: normal.clone().normalize(),
      planeOrigin: centroid.clone(),
      componentId,
      entities,
      constraints: [],
      dimensions: [],
      fullyConstrained: false,
    };
    const selectionId = `${sketch.id}::0`;
    const newIds = [...extrudeSelectedSketchIds, selectionId];
    set({
      sketches: [...sketches, sketch],
      extrudeSelectedSketchId: selectionId,
      extrudeSelectedSketchIds: newIds,
      statusMessage: `${newIds.length} profiles selected â€” drag arrow or set distance, then OK`,
    });
  },
  loadExtrudeForEdit: (featureId) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature || feature.type !== 'extrude') return;
    const p = feature.params;
    const sketchId = feature.sketchId ?? null;
    const profileIndices = Array.isArray(p.profileIndices) ? (p.profileIndices as number[]) : null;
    const selectedSketchIds = sketchId
      ? profileIndices?.length
        ? profileIndices.map((index) => `${sketchId}::${index}`)
        : [sketchId]
      : [];
    set({
      activeTool: 'extrude',
      editingFeatureId: featureId,
      extrudeSelectedSketchId: sketchId,
      extrudeSelectedSketchIds: selectedSketchIds,
      extrudeDistance: typeof p.distance === 'number' ? p.distance : 10,
      extrudeDistance2: typeof p.distance2 === 'number' ? p.distance2 : 10,
      extrudeDirection: (p.direction as ExtrudeDirection) ?? 'positive',
      extrudeOperation: (p.operation as ExtrudeOperation) ?? 'new-body',
      extrudeThinEnabled: !!p.thin,
      extrudeThinThickness: typeof p.thinThickness === 'number' ? p.thinThickness : 2,
      extrudeThinSide: (p.thinSide as 'side1' | 'side2' | 'center') ?? 'side1',
      extrudeThinSide2: (p.thinSide2 as 'side1' | 'side2' | 'center') ?? 'side1',
      extrudeThinThickness2: typeof p.thinThickness2 === 'number' ? p.thinThickness2 : 2,
      extrudeStartType: (p.startType as 'profile' | 'offset' | 'entity') ?? 'profile',
      extrudeStartOffset: typeof p.startOffset === 'number' ? p.startOffset : 0,
      extrudeStartEntityId: (p.startEntityId as string | null) ?? null,
      extrudeExtentType: (p.extentType as 'distance' | 'all' | 'to-object') ?? 'distance',
      extrudeExtentType2: (p.extentType2 as 'distance' | 'all' | 'to-object') ?? 'distance',
      extrudeToEntityFaceId: (p.toEntityFaceId as string | null) ?? null,
      extrudeToEntityFaceNormal: (p.toEntityFaceNormal as [number, number, number] | null) ?? null,
      extrudeToEntityFaceCentroid: (p.toEntityFaceCentroid as [number, number, number] | null) ?? null,
      extrudeToObjectFlipDirection: !!(p.toObjectFlipDirection),
      extrudeStartFaceNormal: (p.startFaceNormal as [number, number, number] | null) ?? null,
      extrudeStartFaceCentroid: (p.startFaceCentroid as [number, number, number] | null) ?? null,
      extrudeTaperAngle: typeof p.taperAngle === 'number' ? p.taperAngle : 0,
      extrudeTaperAngle2: typeof p.taperAngle2 === 'number' ? p.taperAngle2 : 0,
      extrudeSymmetricFullLength: false,
      extrudeBodyKind: (feature.bodyKind === 'surface' ? 'surface' : 'solid') as 'solid' | 'surface',
      extrudeParticipantBodyIds: Array.isArray(p.participantBodyIds) ? (p.participantBodyIds as unknown as string[]) : [],
      extrudeConfinedFaceIds: Array.isArray(p.confinedFaceIds) ? (p.confinedFaceIds as unknown as string[]) : [],
      extrudeCreationOccurrence: typeof p.creationOccurrence === 'string' ? p.creationOccurrence : null,
      extrudeTargetBaseFeature: typeof p.targetBaseFeature === 'string' ? p.targetBaseFeature : null,
      statusMessage: `Edit extrude: "${feature.name}"`,
    });
  },
  cancelExtrudeTool: () => {
    // Discard any auto-generated press-pull profiles that were never committed
    const { sketches, features } = get();
    const usedSketchIds = new Set(features.map((f) => f.sketchId).filter(Boolean));
    const cleanedSketches = sketches.filter(
      (s) => !s.name.startsWith('Press Pull Profile') || usedSketchIds.has(s.id),
    );
    set({
      activeTool: 'select',
      ...EXTRUDE_DEFAULTS,
      sketches: cleanedSketches,
      statusMessage: 'Extrude cancelled',
    });
  },
  };
}
