import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { createCombineCommitActions } from "./combineCommitActions";
import { createCombineRecommitActions } from "./combineRecommitActions";
import { createMeshCombineActions } from "./meshCombineActions";

export function createBooleanCombineActions(context: CADSliceContext): Partial<CADState> {
  return {
    ...createMeshCombineActions(context),
    ...createCombineCommitActions(context),
    ...createCombineRecommitActions(context),
  };
}
