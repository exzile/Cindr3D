import type { CADSliceContext } from '../sliceContext';
import type { CADState } from '../state';
import { createSketchBrowserActions } from './sketchLifecycle/sketchBrowserActions';
import { createSketchEntityActions } from './sketchLifecycle/sketchEntityActions';
import { createSketchSessionActions } from './sketchLifecycle/sketchSessionActions';
import { createSliceSketchAction } from './sketchLifecycle/sliceSketchAction';
import { createToolWorkspaceActions } from './sketchLifecycle/toolWorkspaceActions';

export function createSketchLifecycleSlice(context: CADSliceContext) {
  const slice: Partial<CADState> = {
    ...createToolWorkspaceActions(context),
    ...createSketchSessionActions(context),
    ...createSketchEntityActions(context),
    ...createSketchBrowserActions(context),
    ...createSliceSketchAction(context),
  };

  return slice;
}
