import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

export function createSketchUiActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  // â”€â”€â”€ D12: Sketch Text â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  sketchTextContent: 'Text',
  sketchTextHeight: 5,
  sketchTextFont: 'default',
  sketchTextBold: false,
  sketchTextItalic: false,
  setSketchTextContent: (v) => set({ sketchTextContent: v }),
  setSketchTextHeight: (v) => set({ sketchTextHeight: v }),
  setSketchTextFont: (v) => set({ sketchTextFont: v }),
  setSketchTextBold: (v) => set({ sketchTextBold: v }),
  setSketchTextItalic: (v) => set({ sketchTextItalic: v }),
  startSketchTextTool: () => {
    const { activeSketch } = get();
    if (!activeSketch) {
      set({ statusMessage: 'Open a sketch first before using Sketch Text' });
      return;
    }
    set({ activeTool: 'sketch-text', statusMessage: 'Sketch Text â€” click on the sketch to place text' });
  },
  commitSketchTextEntities: (segments) => {
    const { activeSketch } = get();
    if (!activeSketch) return;
    const newEntities = segments.map((seg) => ({
      id: crypto.randomUUID(),
      type: 'line' as const,
      points: [
        { id: crypto.randomUUID(), x: seg.x1, y: seg.y1, z: seg.z1 },
        { id: crypto.randomUUID(), x: seg.x2, y: seg.y2, z: seg.z2 },
      ],
    }));
    set({
      activeSketch: {
        ...activeSketch,
        entities: [...activeSketch.entities, ...newEntities],
      },
      activeTool: 'select',
      statusMessage: 'Text placed',
    });
  },
  cancelSketchTextTool: () => set({ activeTool: 'select', statusMessage: 'Sketch Text cancelled' }),

  // â”€â”€â”€ D28: Dimension tool â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  activeDimensionType: 'linear',
  dimensionOffset: 10,
  dimensionDrivenMode: false,
  dimensionOrientation: 'auto',
  dimensionToleranceMode: 'none',
  dimensionToleranceUpper: 0.1,
  dimensionToleranceLower: 0.1,
  pendingDimensionEntityIds: [],
  setActiveDimensionType: (t) => set({ activeDimensionType: t }),
  setDimensionOffset: (v) => set({ dimensionOffset: v }),
  setDimensionDrivenMode: (v) => set({ dimensionDrivenMode: v }),
  setDimensionOrientation: (v) => set({ dimensionOrientation: v }),
  setDimensionToleranceMode: (v) => set({ dimensionToleranceMode: v }),
  setDimensionToleranceUpper: (v) => set({ dimensionToleranceUpper: v }),
  setDimensionToleranceLower: (v) => set({ dimensionToleranceLower: v }),
  startDimensionTool: () => {
    const { activeSketch } = get();
    if (!activeSketch) {
      set({ statusMessage: 'Open a sketch first before using the Dimension tool' });
      return;
    }
    set({ activeTool: 'dimension', pendingDimensionEntityIds: [], statusMessage: 'Dimension â€” click entities to measure' });
  },
  cancelDimensionTool: () => set({ activeTool: 'select', pendingDimensionEntityIds: [], statusMessage: 'Dimension tool cancelled' }),
  addPendingDimensionEntity: (id) => set((state) => ({
    pendingDimensionEntityIds: state.pendingDimensionEntityIds.includes(id)
      ? state.pendingDimensionEntityIds
      : [...state.pendingDimensionEntityIds, id],
  })),
  addSketchDimension: (dim) => {
    const { activeSketch } = get();
    if (!activeSketch) return;
    if ((activeSketch.dimensions ?? []).some((d) => d.id === dim.id)) return;
    get().pushUndo();
    const nextActiveSketch = { ...activeSketch, dimensions: [...(activeSketch.dimensions ?? []), dim] };
    set({
      activeSketch: nextActiveSketch,
      sketches: get().sketches.map((s) =>
        s.id === activeSketch.id
          ? nextActiveSketch
          : s
      ),
    });
    // CORR-7: skip auto-solve when compute is deferred
    if (!get().sketchComputeDeferred) get().solveSketch();
  },
  removeDimension: (dimId) => {
    const { activeSketch } = get();
    if (!activeSketch) return;
    set({
      sketches: get().sketches.map((s) =>
        s.id === activeSketch.id
          ? { ...s, dimensions: (s.dimensions ?? []).filter((d) => d.id !== dimId) }
          : s
      ),
    });
  },

  // â”€â”€â”€ S10: Spline post-commit handle editing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  editingSplineEntityId: null,
  hoveredSplinePointIndex: null,
  draggingSplinePointIndex: null,
  setEditingSplineEntityId: (id) => set({ editingSplineEntityId: id }),
  setHoveredSplinePointIndex: (i) => set({ hoveredSplinePointIndex: i }),
  setDraggingSplinePointIndex: (i) => set({ draggingSplinePointIndex: i }),
  updateSplineControlPoint: (entityId, pointIndex, x, y, z) => {
    const { activeSketch } = get();
    if (!activeSketch) return;
    const updatedEntities = activeSketch.entities.map((e) => {
      if (e.id !== entityId) return e;
      const updatedPoints = e.points.map((pt, i) => {
        if (i !== pointIndex) return pt;
        return { ...pt, x, y, z };
      });
      return { ...e, points: updatedPoints };
    });
    set({ activeSketch: { ...activeSketch, entities: updatedEntities } });
  },

  // â”€â”€â”€ D45: Project / Include live-link toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  projectLiveLink: true,
  setProjectLiveLink: (v) => set({ projectLiveLink: v }),
  cancelSketchProjectTool: () => set({ activeTool: 'select', statusMessage: 'Project cancelled' }),

  // S3 â€” Intersection Curve
  startSketchIntersectTool: () => set({
    activeTool: 'sketch-intersect',
    statusMessage: 'Click a solid face to create intersection curve with sketch plane',
  }),
  cancelSketchIntersectTool: () => set({
    activeTool: 'select',
    statusMessage: 'Intersection curve cancelled',
  }),

  // D46 â€” Project to Surface
  startSketchProjectSurfaceTool: () => set({
    activeTool: 'sketch-project-surface',
    statusMessage: 'Click a body face to project all sketch curves onto it',
  }),
  cancelSketchProjectSurfaceTool: () => set({
    activeTool: 'select',
    statusMessage: 'Project to surface cancelled',
  }),

  };
}
