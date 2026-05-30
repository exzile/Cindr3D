import type { CADSliceContext } from '../sliceContext';
import type { CADState } from '../state';
import { createLoftActions } from './featureCreation/loftActions';
import { createRibActions } from './featureCreation/ribActions';
import { createSurfaceFeatureActions } from './featureCreation/surfaceFeatureActions';
import { createSweepActions } from './featureCreation/sweepActions';

export function createFeatureCreationSlice(context: CADSliceContext) {
  const slice: Partial<CADState> = {
    ...createSweepActions(context),
    ...createLoftActions(context),
    ...createSurfaceFeatureActions(context),
    ...createRibActions(context),
  };

  return slice;
}
