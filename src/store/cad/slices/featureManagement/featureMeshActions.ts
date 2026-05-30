import { createEdgeModActions } from './edgeModActions';
import { createMeshTransformActions } from './meshTransformActions';
import { createBooleanCombineActions } from './booleanCombineActions';
import { createMeshBaseActions } from './meshBaseActions';
import type { CADSliceContext } from '../../sliceContext';

export function createFeatureMeshActions(context: CADSliceContext) {
  return {
    ...createMeshBaseActions(context),
    ...createEdgeModActions(context),
    ...createMeshTransformActions(context),
    ...createBooleanCombineActions(context),
  };
}
