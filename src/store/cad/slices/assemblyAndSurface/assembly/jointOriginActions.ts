import type { JointOriginRecord } from '../../../../../types/cad';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createJointOriginActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    jointOrigins: [],
    showJointOriginDialog: false,
    jointOriginPickedPoint: null,
    jointDialogPickedOrigin: null,
    jointDialogPickMode: false,
    setJointDialogPickedOrigin: (p) => set({ jointDialogPickedOrigin: p }),
    setJointDialogPickMode: (v) => set({ jointDialogPickMode: v }),
    openJointOriginDialog: () =>
      set({ activeDialog: 'joint-origin', showJointOriginDialog: true, jointOriginPickedPoint: null }),
    closeJointOriginDialog: () =>
      set({ activeDialog: null, showJointOriginDialog: false, jointOriginPickedPoint: null }),
    setJointOriginPoint: (p) => set({ jointOriginPickedPoint: p }),
    commitJointOrigin: (params) => {
      const { jointOrigins, jointOriginPickedPoint } = get();
      const n = jointOrigins.length + 1;
      const record: JointOriginRecord = {
        id: crypto.randomUUID(),
        name: params.name || `Joint Origin ${n}`,
        componentId: params.componentId,
        position: jointOriginPickedPoint ?? [0, 0, 0],
        normal: [0, 1, 0],
      };
      set({
        jointOrigins: [...jointOrigins, record],
        activeDialog: null,
        showJointOriginDialog: false,
        jointOriginPickedPoint: null,
      });
    },
  };
}
