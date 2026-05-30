import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { createDesignConfigurationActions } from './featureCore/designConfigurationActions';
import { createFeatureGroupActions } from './featureCore/featureGroupActions';
import { createFeatureLifecycleActions } from './featureCore/featureLifecycleActions';
import { createPrimitiveFeatureActions } from './featureCore/primitiveFeatureActions';

export function createFeatureCoreActions(context: CADSliceContext): Partial<CADState> {
  return {
    ...createFeatureLifecycleActions(context),
    ...createPrimitiveFeatureActions(context),
    ...createDesignConfigurationActions(context),
    ...createFeatureGroupActions(context),
  };
}