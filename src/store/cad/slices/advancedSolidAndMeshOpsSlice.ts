import type { CADSliceContext } from '../sliceContext';
import type { CADState } from '../state';
import { createToolFeatureActions } from './advancedSolidAndMeshOps/toolFeatureActions';
import { createSolidEditActions } from './advancedSolidAndMeshOps/solidEditActions';
import { createMeshOpsActions } from './advancedSolidAndMeshOps/meshOpsActions';

export function createAdvancedSolidAndMeshOpsSlice(context: CADSliceContext) {
  const slice: Partial<CADState> = {
    ...createToolFeatureActions(context),
    ...createSolidEditActions(context),
    ...createMeshOpsActions(context),
  };

  return slice;
}
