import type { CADSliceContext } from "../../../sliceContext";
import type { CADState } from "../../../state";

export function createViewportActions({ set }: CADSliceContext): Partial<CADState> {
  return {
    cameraHomeCounter: 0,
    triggerCameraHome: () =>
      set((state) => ({ cameraHomeCounter: state.cameraHomeCounter + 1 })),
    cameraNavMode: null,
    setCameraNavMode: (mode) => set({ cameraNavMode: mode }),
    viewportLayout: "1",
    setViewportLayout: (layout) => set({ viewportLayout: layout }),
    zoomToFitCounter: 0,
    triggerZoomToFit: () =>
      set((state) => ({ zoomToFitCounter: state.zoomToFitCounter + 1 })),
    zoomWindowTrigger: null,
    triggerZoomWindow: (rect) => set({ zoomWindowTrigger: rect }),
    clearZoomWindow: () => set({ zoomWindowTrigger: null }),
  };
}
