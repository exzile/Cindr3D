import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { createBoundaryFillActions } from './solidEdit/boundaryFillActions';
import { createShellDraftOffsetActions } from './solidEdit/shellDraftOffsetActions';
import { createSplitBodyActions } from './solidEdit/splitBodyActions';

export function createSolidEditActions(context: CADSliceContext): Partial<CADState> {
  return {
    ...createShellDraftOffsetActions(context),
    ...createBoundaryFillActions(context),
    ...createSplitBodyActions(context),
  };
}
