import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { createComponentPatternActions } from "./generalUi/componentPatternActions";
import { createDialogSelectionActions } from "./generalUi/dialogSelectionActions";
import { createParameterActions } from "./generalUi/parameterActions";
import { createViewportActions } from "./generalUi/viewportActions";

export function createGeneralUiActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    ...createDialogSelectionActions({ set, get }),
    ...createViewportActions({ set, get }),
    ...createParameterActions({ set, get }),
    ...createComponentPatternActions({ set, get }),
  };
}
