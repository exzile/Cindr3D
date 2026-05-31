import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { createGridSnapActions } from './sketchEditing/gridSnapActions';
import { createSketchPatternActions } from './sketchEditing/sketchPatternActions';
import { createSketchTransformActions } from './sketchEditing/sketchTransformActions';
import { createPolygonEditActions } from './sketchEditing/polygonEditActions';

export function createSketchEditingActions(context: CADSliceContext): Partial<CADState> {
  return {
    ...createGridSnapActions(context),
    ...createSketchPatternActions(context),
    ...createSketchTransformActions(context),
    ...createPolygonEditActions(context),
  };
}
