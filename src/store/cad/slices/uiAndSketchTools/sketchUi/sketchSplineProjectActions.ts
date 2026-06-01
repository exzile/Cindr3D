import type { CADSliceContext } from "../../../sliceContext";
import type { CADState } from "../../../state";

export function createSketchSplineProjectActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    editingSplineEntityId: null,
    hoveredSplinePointIndex: null,
    draggingSplinePointIndex: null,
    sketchEditingArcId: null,
    setSketchEditingArcId: (id) => set({ sketchEditingArcId: id }),
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
    dragSketchPoint: (entityId, pointIndex, x, y, z) => {
      // Move the point first (synchronous set), then solve with it pinned so
      // constraints drive the rest of the geometry. For an unconstrained entity
      // the solve is a no-op and the point simply stays where it was dropped.
      get().updateSplineControlPoint(entityId, pointIndex, x, y, z);
      if (!get().sketchComputeDeferred) {
        get().solveSketch({ fixedPoint: { entityId, pointIndex } });
      }
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

    startSketchIntersectionCurveTool: () => set({
      activeTool: "sketch-intersection-curve",
      statusMessage: "Intersection Curve: click the first surface",
    }),
    cancelSketchIntersectionCurveTool: () => set({
      activeTool: "select",
      statusMessage: "Intersection Curve cancelled",
    }),

    startSketchSpunProfileTool: () => set({
      activeTool: "sketch-spun-profile",
      statusMessage: "Spun Profile: click a cylindrical or revolved face",
    }),
    cancelSketchSpunProfileTool: () => set({
      activeTool: "select",
      statusMessage: "Spun Profile cancelled",
    }),
  };
}
