import type { Feature, Tool } from '../../../types/cad';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { CADSliceContext } from '../sliceContext';
import type { CADState } from '../state';

export function createFeatureCreationSlice({ set, get }: CADSliceContext) {
  const slice: Partial<CADState> = {
  sweepProfileSketchId: null,
  setSweepProfileSketchId: (id) => set({ sweepProfileSketchId: id }),
  sweepPathSketchId: null,
  setSweepPathSketchId: (id) => set({ sweepPathSketchId: id }),
  sweepBodyKind: 'solid',
  setSweepBodyKind: (k) => set({ sweepBodyKind: k }),
  // D71 sweep upgrades
  sweepOrientation: 'perpendicular' as 'perpendicular' | 'parallel' | 'default',
  sweepProfileScaling: 'none' as 'none' | 'scale-to-path' | 'scale-to-rail',
  sweepTwistAngle: 0,
  sweepTaperAngle: 0,
  sweepGuideRailId: null,
  sweepOperation: 'new-body' as 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component',
  sweepDistance: 'entire' as 'entire' | 'distance',
  // SDK-5: path parametric start/end (0–1 fraction)
  sweepDistanceOne: 0,
  sweepDistanceTwo: 1,
  setSweepOrientation: (v) => set({ sweepOrientation: v }),
  setSweepProfileScaling: (v) => set({ sweepProfileScaling: v }),
  setSweepTwistAngle: (v) => set({ sweepTwistAngle: v }),
  setSweepTaperAngle: (v) => set({ sweepTaperAngle: v }),
  setSweepGuideRailId: (v) => set({ sweepGuideRailId: v }),
  setSweepOperation: (v: 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component') => set({ sweepOperation: v }),
  setSweepDistance: (v) => set({ sweepDistance: v }),
  setSweepDistanceOne: (v) => set({ sweepDistanceOne: Math.max(0, Math.min(1, v)) }),
  setSweepDistanceTwo: (v) => set({ sweepDistanceTwo: Math.max(0, Math.min(1, v)) }),
  startSweepTool: () => {
    const extrudable = get().sketches.filter((s) => s.entities.length > 0);
    if (extrudable.length < 2) {
      set({ statusMessage: 'Sweep requires at least 2 sketches — a profile and a path' });
      return;
    }
    set({ activeTool: 'sweep', sweepProfileSketchId: null, sweepPathSketchId: null, statusMessage: 'Sweep — pick a profile sketch, then a path sketch in the panel' });
  },
  cancelSweepTool: () => set({ activeTool: 'select', sweepProfileSketchId: null, sweepPathSketchId: null, sweepOrientation: 'perpendicular', sweepTwistAngle: 0, sweepTaperAngle: 0, sweepGuideRailId: null, sweepDistance: 'entire', sweepDistanceOne: 0, sweepDistanceTwo: 1, statusMessage: 'Sweep cancelled' }),
  commitSweep: () => {
    const { sweepProfileSketchId, sweepPathSketchId, sweepBodyKind, sweepDistance, sweepDistanceOne, sweepDistanceTwo, sweepOrientation, sweepProfileScaling, sweepTwistAngle, sweepTaperAngle, sweepGuideRailId, sweepOperation, sketches, features, units } = get();
    if (!sweepProfileSketchId || !sweepPathSketchId) {
      set({ statusMessage: 'Select both a profile sketch and a path sketch' });
      return;
    }
    const profileSketch = sketches.find((s) => s.id === sweepProfileSketchId);
    const pathSketch = sketches.find((s) => s.id === sweepPathSketchId);
    if (!profileSketch || !pathSketch) {
      set({ statusMessage: 'Selected sketch(es) not found' });
      return;
    }
    get().pushUndo();
    const mesh = GeometryEngine.sweepSketchInternal(profileSketch, pathSketch, sweepBodyKind === 'surface');
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `${sweepBodyKind === 'surface' ? 'Surface ' : ''}Sweep ${features.filter((f) => f.type === 'sweep').length + 1}`,
      type: 'sweep',
      sketchId: sweepProfileSketchId,
      params: {
        pathSketchId: sweepPathSketchId,
        orientation: sweepOrientation,
        profileScaling: sweepProfileScaling,
        twistAngle: sweepTwistAngle,
        taperAngle: sweepTaperAngle,
        guideRailId: sweepGuideRailId,
        operation: sweepOperation,
        distance: sweepDistance,
        ...(sweepDistance === 'distance' ? { distanceOne: sweepDistanceOne, distanceTwo: sweepDistanceTwo } : {}),
      },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: mesh ?? undefined,
      bodyKind: sweepBodyKind === 'surface' ? 'surface' : 'solid',
    };
    set({
      features: [...features, feature],
      activeTool: 'select',
      sweepProfileSketchId: null,
      sweepPathSketchId: null,
      sweepBodyKind: 'solid',
      statusMessage: `${sweepBodyKind === 'surface' ? 'Surface ' : ''}Sweep created (${units})`,
    });
  },

  // ─── Loft tool (D31 / D105) ───────────────────────────────────────────
  loftProfileSketchIds: [],
  setLoftProfileSketchIds: (ids) => set({ loftProfileSketchIds: ids }),
  loftBodyKind: 'solid',
  setLoftBodyKind: (k) => set({ loftBodyKind: k }),
  // D72 loft upgrades
  loftClosed: false,
  loftTangentEdgesMerged: false,
  loftStartCondition: 'free' as const,
  loftEndCondition: 'free' as const,
  loftRailSketchId: null,
  loftOperation: 'new-body' as 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component',
  setLoftClosed: (v) => set({ loftClosed: v }),
  setLoftTangentEdgesMerged: (v) => set({ loftTangentEdgesMerged: v }),
  setLoftStartCondition: (v) => set({ loftStartCondition: v }),
  setLoftEndCondition: (v) => set({ loftEndCondition: v }),
  setLoftRailSketchId: (v) => set({ loftRailSketchId: v }),
  setLoftOperation: (v: 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component') => set({ loftOperation: v }),
  startLoftTool: () => {
    const extrudable = get().sketches.filter((s) => s.entities.length > 0);
    if (extrudable.length < 2) {
      set({ statusMessage: 'Loft requires at least 2 profile sketches' });
      return;
    }
    set({ activeTool: 'loft', loftProfileSketchIds: ['', ''], statusMessage: 'Loft — select 2+ profile sketches in the panel, then OK' });
  },
  cancelLoftTool: () => set({ activeTool: 'select', loftProfileSketchIds: [], loftClosed: false, loftTangentEdgesMerged: false, loftStartCondition: 'free', loftEndCondition: 'free', loftRailSketchId: null, loftOperation: 'new-body', statusMessage: 'Loft cancelled' }),
  commitLoft: () => {
    const { loftProfileSketchIds, loftBodyKind, loftOperation, sketches, features, units } = get();
    const validIds = loftProfileSketchIds.filter(Boolean);
    if (validIds.length < 2) {
      set({ statusMessage: 'Select at least 2 profile sketches' });
      return;
    }
    const profileSketches = validIds.map((id) => sketches.find((s) => s.id === id)).filter(Boolean) as typeof sketches;
    if (profileSketches.length < 2) {
      set({ statusMessage: 'One or more selected profiles not found' });
      return;
    }
    get().pushUndo();
    const mesh = GeometryEngine.loftSketches(profileSketches, loftBodyKind === 'surface');
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `${loftBodyKind === 'surface' ? 'Surface ' : ''}Loft ${features.filter((f) => f.type === 'loft').length + 1}`,
      type: 'loft',
      sketchId: validIds[0],
      params: { loftProfileIds: validIds.join(','), operation: loftOperation },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: mesh ?? undefined,
      bodyKind: loftBodyKind === 'surface' ? 'surface' : 'solid',
    };
    set({
      features: [...features, feature],
      activeTool: 'select',
      loftProfileSketchIds: [],
      statusMessage: `${loftBodyKind === 'surface' ? 'Surface ' : ''}Loft created across ${profileSketches.length} profiles (${units})`,
    });
  },

  // ─── Patch tool (D106) ────────────────────────────────────────────────
  patchSelectedSketchId: null,
  setPatchSelectedSketchId: (id) => set({ patchSelectedSketchId: id }),
  startPatchTool: () => {
    const sketches = get().sketches.filter((s) => s.entities.length > 0);
    if (sketches.length === 0) {
      set({ statusMessage: 'Create a sketch first before using Patch' });
      return;
    }
    set({ activeTool: 'patch' as Tool, patchSelectedSketchId: null, statusMessage: 'Patch — select a closed profile sketch in the panel' });
  },
  cancelPatchTool: () => set({ activeTool: 'select', patchSelectedSketchId: null, statusMessage: 'Patch cancelled' }),
  commitPatch: () => {
    const { patchSelectedSketchId, sketches, features, units } = get();
    if (!patchSelectedSketchId) {
      set({ statusMessage: 'No profile selected for Patch' });
      return;
    }
    const sketch = sketches.find((s) => s.id === patchSelectedSketchId);
    if (!sketch) {
      set({ statusMessage: 'Selected sketch not found' });
      return;
    }
    const mesh = GeometryEngine.patchSketch(sketch);
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Patch ${features.filter((f) => f.type === 'extrude' && f.bodyKind === 'surface' && f.params.patchSketchId !== undefined).length + 1}`,
      type: 'extrude',
      sketchId: patchSelectedSketchId,
      params: { patchSketchId: patchSelectedSketchId },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: mesh ?? undefined,
      bodyKind: 'surface',
    };
    set({
      features: [...features, feature],
      activeTool: 'select',
      patchSelectedSketchId: null,
      statusMessage: `Patch surface created (${units})`,
    });
  },

  // ─── Ruled Surface tool (D107) ────────────────────────────────────────
  ruledSketchAId: null,
  setRuledSketchAId: (id) => set({ ruledSketchAId: id }),
  ruledSketchBId: null,
  setRuledSketchBId: (id) => set({ ruledSketchBId: id }),
  startRuledSurfaceTool: () => {
    const sketches = get().sketches.filter((s) => s.entities.length > 0);
    if (sketches.length < 2) {
      set({ statusMessage: 'Ruled Surface requires at least 2 sketches' });
      return;
    }
    set({ activeTool: 'ruled-surface' as Tool, ruledSketchAId: null, ruledSketchBId: null, statusMessage: 'Ruled Surface — select Curve A and Curve B sketches in the panel' });
  },
  cancelRuledSurfaceTool: () => set({ activeTool: 'select', ruledSketchAId: null, ruledSketchBId: null, statusMessage: 'Ruled Surface cancelled' }),
  commitRuledSurface: () => {
    const { ruledSketchAId, ruledSketchBId, sketches, features, units } = get();
    if (!ruledSketchAId || !ruledSketchBId) {
      set({ statusMessage: 'Select two curve sketches for Ruled Surface' });
      return;
    }
    const sketchA = sketches.find((s) => s.id === ruledSketchAId);
    const sketchB = sketches.find((s) => s.id === ruledSketchBId);
    if (!sketchA || !sketchB) {
      set({ statusMessage: 'One or more selected sketches not found' });
      return;
    }
    const mesh = GeometryEngine.ruledSurface(sketchA, sketchB);
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Ruled Surface ${features.filter((f) => f.type === 'loft' && f.bodyKind === 'surface').length + 1}`,
      type: 'loft',
      sketchId: ruledSketchAId,
      params: { ruledSketchAId, ruledSketchBId },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: mesh ?? undefined,
      bodyKind: 'surface',
    };
    set({
      features: [...features, feature],
      activeTool: 'select',
      ruledSketchAId: null,
      ruledSketchBId: null,
      statusMessage: `Ruled Surface created (${units})`,
    });
  },

  // ─── Rib tool (D73) ───────────────────────────────────────────────────
  ribSelectedSketchId: null,
  setRibSelectedSketchId: (id) => set({ ribSelectedSketchId: id }),
  ribThickness: 2,
  setRibThickness: (t) => set({ ribThickness: Math.max(0.01, t) }),
  ribHeight: 10,
  setRibHeight: (h) => set({ ribHeight: Math.max(0.01, h) }),
  ribDirection: 'normal',
  setRibDirection: (d) => set({ ribDirection: d }),
  startRibTool: () => {
    const sketches = get().sketches.filter((s) => s.entities.length > 0);
    if (sketches.length === 0) {
      set({ statusMessage: 'Create a sketch first before adding a rib' });
      return;
    }
    set({ activeTool: 'rib' as Tool, ribSelectedSketchId: null, statusMessage: 'Rib — pick a profile sketch in the panel' });
  },
  cancelRibTool: () => set({ activeTool: 'select', ribSelectedSketchId: null, statusMessage: 'Rib cancelled' }),
  commitRib: () => {
    const { ribSelectedSketchId, ribThickness, ribHeight, ribDirection, sketches, features, units } = get();
    if (!ribSelectedSketchId) {
      set({ statusMessage: 'No profile selected for rib' });
      return;
    }
    const sketch = sketches.find((s) => s.id === ribSelectedSketchId);
    if (!sketch) {
      set({ statusMessage: 'Selected sketch not found' });
      return;
    }
    get().pushUndo();
    // Rib = thin extrude of open profile in center mode, height along sketch normal.
    // For 'flip', pass height as negative (mirrors direction).
    const signedHeight = ribDirection === 'flip' ? -ribHeight : ribHeight;
    const ribMesh = GeometryEngine.extrudeThinSketch(sketch, Math.abs(signedHeight), ribThickness, 'center') ?? undefined;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Rib ${features.filter((f) => f.type === 'rib').length + 1}`,
      type: 'rib',
      sketchId: ribSelectedSketchId,
      params: { thickness: ribThickness, height: ribHeight, direction: ribDirection },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: ribMesh,
    };
    set({
      features: [...features, feature],
      activeTool: 'select',
      ribSelectedSketchId: null,
      statusMessage: `Rib created: ${ribThickness}mm thick, ${ribHeight}${units} tall`,
    });
  },
  };

  return slice;
}
