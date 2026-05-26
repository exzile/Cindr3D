import type { Sketch } from "../../../../../types/cad";
import { applyDimensionResize } from "../../../../../engine/dimensionResizeUtils";
import { wouldOverConstrain } from "../../../../../engine/overConstraintCheck";
import { evaluateExpression } from "../../../../../utils/expressionEval";
import type { CADSliceContext } from "../../../sliceContext";
import type { CADState } from "../../../state";

export function createSketchDimensionEditActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    sketchDimEditId: null,
    sketchDimEditIsNew: false,
    sketchDimEditValue: "",
    sketchDimEditScreenX: 0,
    sketchDimEditScreenY: 0,
    sketchDimEditTypeahead: [],
    pendingOverConstraint: null,
    openSketchDimEdit: (id, value, isNew) => {
      const dim = !isNew ? (get().activeSketch?.dimensions ?? []).find((dimension) => dimension.id === id) : null;
      set({
        sketchDimEditId: id,
        sketchDimEditValue: value,
        sketchDimEditIsNew: isNew,
        sketchDimEditTypeahead: [],
        ...(dim ? { pendingDimensionEntityIds: dim.entityIds } : {}),
      });
    },
    updateSketchDimEditScreen: (x, y) => set({ sketchDimEditScreenX: x, sketchDimEditScreenY: y }),
    setSketchDimEditValue: (value) => set({ sketchDimEditValue: value }),
    setSketchDimEditTypeahead: (items) => set({ sketchDimEditTypeahead: items }),
    commitSketchDimEdit: (rawValue) => {
      const { sketchDimEditId, activeSketch, parameters } = get();
      if (!sketchDimEditId || !activeSketch) return;
      const trimmed = rawValue.trim();
      const asNum = Number.parseFloat(trimmed);
      const nextValue = Number.isFinite(asNum) && trimmed === String(asNum)
        ? asNum
        : (evaluateExpression(trimmed, parameters) ?? NaN);
      set({ sketchDimEditTypeahead: [] });
      if (!Number.isFinite(nextValue) || nextValue <= 0) {
        set({ statusMessage: "Enter a positive dimension value or parameter name" });
        return;
      }
      const dimension = (activeSketch.dimensions ?? []).find((item) => item.id === sketchDimEditId);
      if (!dimension) return;
      const updatedDimension = { ...dimension, value: nextValue };

      if (!updatedDimension.driven) {
        const sketchWithoutThisDim: Sketch = {
          ...activeSketch,
          dimensions: (activeSketch.dimensions ?? []).filter((item) => item.id !== sketchDimEditId),
        };
        if (wouldOverConstrain(sketchWithoutThisDim, updatedDimension)) {
          set({
            pendingOverConstraint: {
              dimension: updatedDimension,
              activeSketchId: activeSketch.id,
              mode: "edit",
              previousValue: dimension.value,
            },
            pendingNewDimensionId: null,
            pendingDimensionEntityIds: [],
            dimensionPreview: null,
            sketchDimEditId: null,
            sketchDimEditValue: "",
            sketchDimEditIsNew: false,
          });
          return;
        }
      }

      const applyToSketch = (sketch: Sketch): Sketch => {
        if (sketch.id !== activeSketch.id) return sketch;
        const withUpdatedDim = {
          ...sketch,
          dimensions: (sketch.dimensions ?? []).map((item) =>
            item.id === sketchDimEditId ? updatedDimension : item,
          ),
        };
        if (updatedDimension.driven) return withUpdatedDim;
        return { ...withUpdatedDim, entities: applyDimensionResize(withUpdatedDim, updatedDimension, nextValue) };
      };
      get().pushUndo?.();
      const nextActiveSketch = applyToSketch(get().activeSketch ?? activeSketch);
      set({
        activeSketch: nextActiveSketch,
        sketches: get().sketches.map(applyToSketch),
        statusMessage: `Dimension updated: ${nextValue.toFixed(2)}`,
        pendingNewDimensionId: null,
        pendingDimensionEntityIds: [],
        dimensionPreview: null,
        sketchDimEditId: null,
        sketchDimEditValue: "",
        sketchDimEditIsNew: false,
      });
      if (!get().sketchComputeDeferred) get().solveSketch?.();
    },
    cancelSketchDimEdit: () => {
      const { sketchDimEditIsNew, pendingNewDimensionId } = get();
      const wasNew = sketchDimEditIsNew || !!pendingNewDimensionId;
      set({
        pendingNewDimensionId: null,
        pendingDimensionEntityIds: [],
        dimensionPreview: null,
        sketchDimEditId: null,
        sketchDimEditValue: "",
        sketchDimEditIsNew: false,
        sketchDimEditTypeahead: [],
      });
      if (wasNew) get().undo?.();
    },
    resolveOverConstraintAsDriven: () => {
      const pending = get().pendingOverConstraint;
      if (!pending) return;
      const { activeSketch } = get();
      if (!activeSketch || activeSketch.id !== pending.activeSketchId) {
        set({ pendingOverConstraint: null });
        return;
      }
      const drivenDim = { ...pending.dimension, driven: true };
      get().pushUndo?.();
      const applyToSketch = (sketch: Sketch): Sketch => {
        if (sketch.id !== pending.activeSketchId) return sketch;
        const dims = sketch.dimensions ?? [];
        const nextDims =
          pending.mode === "edit" && dims.some((item) => item.id === drivenDim.id)
            ? dims.map((item) => (item.id === drivenDim.id ? drivenDim : item))
            : [...dims, drivenDim];
        return { ...sketch, dimensions: nextDims };
      };
      set({
        activeSketch: applyToSketch(get().activeSketch ?? activeSketch),
        sketches: get().sketches.map(applyToSketch),
        pendingOverConstraint: null,
        statusMessage: `Driven (reference) dimension created: ${drivenDim.value.toFixed(2)}`,
      });
    },
    cancelOverConstraint: () => {
      const pending = get().pendingOverConstraint;
      if (!pending) {
        set({ pendingOverConstraint: null });
        return;
      }
      set({
        pendingOverConstraint: null,
        statusMessage:
          pending.mode === "edit"
            ? `Reverted to ${pending.previousValue?.toFixed(2) ?? "previous value"}`
            : "Over-constraining dimension discarded",
      });
    },
  };
}
