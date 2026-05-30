import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { createMiscToolActions } from './toolFeatures/miscToolActions';
import { createPrimitiveToolActions } from './toolFeatures/primitiveToolActions';
import { createRibWebToolActions } from './toolFeatures/ribWebToolActions';
import { createHoleActions } from './toolFeatures/holeActions';

export function createToolFeatureActions(context: CADSliceContext): Partial<CADState> {
  return {
    ...createRibWebToolActions(context),
    ...createPrimitiveToolActions(context),
    ...createMiscToolActions(context),
    ...createHoleActions(context),
  };
}