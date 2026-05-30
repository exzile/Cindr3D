import type { CADSliceContext } from "../../../sliceContext";
import type { CADState } from "../../../state";

export function createSketchDimensionToolActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    activeDimensionType: "auto",
    dimensionOffset: 10,
    dimensionDrivenMode: false,
    dimensionOrientation: "auto",
    dimensionToleranceMode: "none",
    dimensionToleranceUpper: 0.1,
    dimensionToleranceLower: 0.1,
    pendingDimensionEntityIds: [],
    dimensionHoverEntityId: null,
    dimensionPreview: null,
    pendingNewDimensionId: null,
    setActiveDimensionType: (value) => set({ activeDimensionType: value }),
    setDimensionOffset: (value) => set({ dimensionOffset: value }),
    setDimensionDrivenMode: (value) => set({ dimensionDrivenMode: value }),
    setDimensionOrientation: (value) => set({ dimensionOrientation: value }),
    setDimensionToleranceMode: (value) => set({ dimensionToleranceMode: value }),
    setDimensionToleranceUpper: (value) => set({ dimensionToleranceUpper: value }),
    setDimensionToleranceLower: (value) => set({ dimensionToleranceLower: value }),
    startDimensionTool: () => {
      const { activeSketch } = get();
      if (!activeSketch) {
        set({ statusMessage: "Open a sketch first before using the Dimension tool" });
        return;
      }
      set({
        activeTool: "dimension",
        pendingDimensionEntityIds: [],
        dimensionHoverEntityId: null,
        dimensionPreview: null,
        statusMessage: "Dimension - click entities to measure",
      });
    },
    cancelDimensionTool: () => set({
      activeTool: "select",
      pendingDimensionEntityIds: [],
      dimensionHoverEntityId: null,
      dimensionPreview: null,
      statusMessage: "Dimension tool cancelled",
    }),
    addPendingDimensionEntity: (id) => set((state) => ({
      pendingDimensionEntityIds: state.pendingDimensionEntityIds.includes(id)
        ? state.pendingDimensionEntityIds
        : [...state.pendingDimensionEntityIds, id],
    })),
    addSketchDimension: (dimension) => {
      const { activeSketch } = get();
      if (!activeSketch) return;
      if ((activeSketch.dimensions ?? []).some((item) => item.id === dimension.id)) return;
      get().pushUndo();
      const nextActiveSketch = { ...activeSketch, dimensions: [...(activeSketch.dimensions ?? []), dimension] };
      set({
        activeSketch: nextActiveSketch,
        sketches: get().sketches.map((sketch) =>
          sketch.id === activeSketch.id ? nextActiveSketch : sketch,
        ),
      });
      if (!get().sketchComputeDeferred) get().solveSketch();
    },
    removeDimension: (dimId) => {
      const { activeSketch } = get();
      if (!activeSketch) return;
      const nextSketch = {
        ...activeSketch,
        dimensions: (activeSketch.dimensions ?? []).filter((dimension) => dimension.id !== dimId),
      };
      set({
        activeSketch: nextSketch,
        sketches: get().sketches.map((sketch) =>
          sketch.id === activeSketch.id ? nextSketch : sketch,
        ),
      });
    },
  };
}
