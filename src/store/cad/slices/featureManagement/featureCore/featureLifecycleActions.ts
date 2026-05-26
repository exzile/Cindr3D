import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { createFeatureLifecycleCreationActions } from './featureLifecycleCreationActions';
import { createFeatureLifecycleRemovalActions } from './featureLifecycleRemovalActions';
import { createFeatureLifecycleTimelineActions } from './featureLifecycleTimelineActions';

export function createFeatureLifecycleActions(context: CADSliceContext): Partial<CADState> {
  return {
    ...createFeatureLifecycleCreationActions(context),
    ...createFeatureLifecycleRemovalActions(context),
    ...createFeatureLifecycleTimelineActions(context),
  };
}
