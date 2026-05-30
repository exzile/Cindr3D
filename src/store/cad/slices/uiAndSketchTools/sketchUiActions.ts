import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { createSketchDimensionEditActions } from "./sketchUi/sketchDimensionEditActions";
import { createSketchDimensionToolActions } from "./sketchUi/sketchDimensionToolActions";
import { createSketchSplineProjectActions } from "./sketchUi/sketchSplineProjectActions";
import { createSketchTextActions } from "./sketchUi/sketchTextActions";

export function createSketchUiActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    ...createSketchTextActions({ set, get }),
    ...createSketchDimensionToolActions({ set, get }),
    ...createSketchDimensionEditActions({ set, get }),
    ...createSketchSplineProjectActions({ set, get }),
  };
}
