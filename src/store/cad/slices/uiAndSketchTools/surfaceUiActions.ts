import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { createBoundingSolidActions } from './surfaceUi/boundingSolidActions';
import { createConstructionActions } from './surfaceUi/constructionActions';
import { createFaceFeatureDialogActions } from './surfaceUi/faceFeatureDialogActions';
import { createFacePickerActions } from './surfaceUi/facePickerActions';

export function createSurfaceUiActions(context: CADSliceContext): Partial<CADState> {
  return {
    ...createConstructionActions(context),
    ...createFaceFeatureDialogActions(context),
    ...createFacePickerActions(context),
    ...createBoundingSolidActions(context),
  };
}
