import { createHistoryActions } from './historyAndDocument/historyActions';
import { createPatternActions } from './historyAndDocument/patternActions';
import { createMeshEditActions } from './historyAndDocument/meshEditActions';
import { createDocumentActions } from './historyAndDocument/documentActions';
import type { CADSliceContext } from '../sliceContext';

export function createHistoryAndDocumentSlice(context: CADSliceContext) {
  return {
    ...createHistoryActions(context),
    ...createPatternActions(context),
    ...createMeshEditActions(context),
    ...createDocumentActions(context),
  };
}
