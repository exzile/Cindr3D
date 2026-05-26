import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { createAssemblyDialogActions } from './assembly/assemblyDialogActions';
import { createInterferenceActions } from './assembly/interferenceActions';
import { createJointOriginActions } from './assembly/jointOriginActions';
import { createSelectionSetActions } from './assembly/selectionSetActions';

export function createAssemblyActions(context: CADSliceContext): Partial<CADState> {
  return {
    ...createJointOriginActions(context),
    ...createInterferenceActions(context),
    ...createAssemblyDialogActions(context),
    ...createSelectionSetActions(context),
  };
}
