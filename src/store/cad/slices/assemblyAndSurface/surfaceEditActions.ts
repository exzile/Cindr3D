import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { createDeleteFaceActions } from './surfaceEdit/deleteFaceActions';
import { createStitchThickenActions } from './surfaceEdit/stitchThickenActions';
import { createSurfaceShapeActions } from './surfaceEdit/surfaceShapeActions';

export function createSurfaceEditActions(context: CADSliceContext): Partial<CADState> {
  return {
    ...createDeleteFaceActions(context),
    ...createSurfaceShapeActions(context),
    ...createStitchThickenActions(context),
  };
}
