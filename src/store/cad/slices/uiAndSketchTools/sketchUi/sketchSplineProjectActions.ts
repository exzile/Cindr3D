import type { CADSliceContext } from "../../../sliceContext";
import type { CADState } from "../../../state";

export function createSketchSplineProjectActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    editingSplineEntityId: null,
    hoveredSplinePointIndex: null,
    draggingSplinePointIndex: null,
    setEditingSplineEntityId: (id) => set({ editingSplineEntityId: id }),
    setHoveredSplinePointIndex: (index) => set({ hoveredSplinePointIndex: index }),
    setDraggingSplinePointIndex: (index) => set({ draggingSplinePointIndex: index }),
    updateSplineControlPoint: (entityId, pointIndex, x, y, z) => {
      const { activeSketch } = get();
      if (!activeSketch) return;
      const updatedEntities = activeSketch.entities.map((entity) => {
        if (entity.id !== entityId) return entity;
        const updatedPoints = entity.points.map((point, index) => {
          if (index !== pointIndex) return point;
          return { ...point, x, y, z };
        });
        return { ...entity, points: updatedPoints };
      });
      const nextSketch = { ...activeSketch, entities: updatedEntities };
      set({
        activeSketch: nextSketch,
        sketches: get().sketches.map((sketch) => (sketch.id === nextSketch.id ? nextSketch : sketch)),
      });
    },
    projectLiveLink: true,
    setProjectLiveLink: (value) => set({ projectLiveLink: value }),
    cancelSketchProjectTool: () => set({ activeTool: "select", statusMessage: "Project cancelled" }),
    startSketchIntersectTool: () => set({
      activeTool: "sketch-intersect",
      statusMessage: "Click a solid face to create intersection curve with sketch plane",
    }),
    cancelSketchIntersectTool: () => set({
      activeTool: "select",
      statusMessage: "Intersection curve cancelled",
    }),
    startSketchProjectSurfaceTool: () => set({
      activeTool: "sketch-project-surface",
      statusMessage: "Click a body face to project all sketch curves onto it",
    }),
    cancelSketchProjectSurfaceTool: () => set({
      activeTool: "select",
      statusMessage: "Project to surface cancelled",
    }),
  };
}
