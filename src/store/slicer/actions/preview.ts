import { usePrinterStore } from '../../printerStore';
import type { SlicerStore } from '../../slicerStore';
import type { SlicerStoreApi } from '../storeApi';
import { withEmbeddedGCodeThumbnails } from '../../../utils/gcodeThumbnails';

export function createPreviewActions(api: SlicerStoreApi): Pick<
  SlicerStore,
  | 'setPreviewMode'
  | 'setPreviewLayer'
  | 'setPreviewLayerStart'
  | 'setPreviewLayerRange'
  | 'setPreviewShowTravel'
  | 'setPreviewShowRetractions'
  | 'setPreviewSectionEnabled'
  | 'setPreviewSectionZ'
  | 'setPreviewColorMode'
  | 'setPreviewRenderMode'
  | 'togglePreviewType'
  | 'setPreviewColorSchemeOpen'
  | 'setPreviewGCodeOpen'
  | 'setPreviewSimEnabled'
  | 'setPreviewSimPlaying'
  | 'setPreviewSimSpeed'
  | 'setPreviewSimTime'
  | 'advancePreviewSimTime'
  | 'resetPreviewSim'
  | 'runPrintabilityCheck'
  | 'clearPrintabilityReport'
  | 'setPrintabilityHighlight'
  | 'downloadGCode'
  | 'sendToPrinter'
  | 'setSettingsPanel'
  | 'setTransformMode'
  | 'setViewportPickMode'
  | 'pushMeasurePoint'
  | 'clearMeasurePoints'
> {
  const { get, set } = api;

  return {
    setPreviewMode: (mode) => set({ previewMode: mode }),
    setPreviewLayer: (layer) => set((state) => ({
      previewLayer: Math.max(state.previewLayerStart, Math.min(layer, state.previewLayerMax)),
    })),
    setPreviewLayerStart: (layer) => set((state) => ({
      previewLayerStart: Math.max(0, Math.min(layer, state.previewLayer)),
    })),
    setPreviewLayerRange: (start, end) => set((state) => {
      const clampedStart = Math.max(0, Math.min(start, state.previewLayerMax));
      const clampedEnd = Math.max(clampedStart, Math.min(end, state.previewLayerMax));
      return { previewLayerStart: clampedStart, previewLayer: clampedEnd };
    }),
    setPreviewShowTravel: (show) => set({ previewShowTravel: show }),
    setPreviewShowRetractions: (show) => set({ previewShowRetractions: show }),
    setPreviewSectionEnabled: (on) => set({ previewSectionEnabled: on }),
    setPreviewSectionZ: (z) => set({ previewSectionZ: z }),
    setPreviewColorMode: (mode) => set({ previewColorMode: mode }),
    setPreviewRenderMode: (mode) => set({ previewRenderMode: mode }),
    togglePreviewType: (type) => set((state) => ({
      previewHiddenTypes: state.previewHiddenTypes.includes(type)
        ? state.previewHiddenTypes.filter((entry) => entry !== type)
        : [...state.previewHiddenTypes, type],
    })),
    setPreviewColorSchemeOpen: (open) => set({ previewColorSchemeOpen: open }),
    setPreviewGCodeOpen: (open) => set({ previewGCodeOpen: open }),

    setPreviewSimEnabled: (enabled) => set((state) => ({
      previewSimEnabled: enabled,
      previewSimPlaying: enabled ? state.previewSimPlaying : false,
    })),
    setPreviewSimPlaying: (playing) => set({ previewSimPlaying: playing }),
    setPreviewSimSpeed: (speed) => set({ previewSimSpeed: Math.max(0.1, speed) }),
    setPreviewSimTime: (time) => set((state) => {
      const total = state.sliceResult?.printTime ?? 0;
      return { previewSimTime: Math.max(0, total > 0 ? Math.min(time, total) : time) };
    }),
    advancePreviewSimTime: (deltaSeconds) => set((state) => {
      const total = state.sliceResult?.printTime ?? 0;
      let nextTime = state.previewSimTime + deltaSeconds;
      let playing = state.previewSimPlaying;
      if (total > 0 && nextTime >= total) {
        nextTime = total;
        playing = false;
      }
      return { previewSimTime: nextTime, previewSimPlaying: playing };
    }),
    resetPreviewSim: () => set({ previewSimTime: 0, previewSimPlaying: false }),

    runPrintabilityCheck: async () => {
      const { checkPrintability } = await import('../../../engine/PrintabilityCheck');
      const state = get();
      const printer = state.getActivePrinterProfile();
      const print = state.getActivePrintProfile();
      if (!printer || !print) return;
      set({ printabilityReport: checkPrintability(state.plateObjects, printer, print) });
    },
    clearPrintabilityReport: () => set({ printabilityReport: null }),
    setPrintabilityHighlight: (on) => set({ printabilityHighlight: on }),

    downloadGCode: () => {
      void (async () => {
        const state = get();
        const result = state.sliceResult;
        if (!result) return;
        const print = state.getActivePrintProfile();
        const gcode = await withEmbeddedGCodeThumbnails(
          result.gcode,
          result,
          print.embedGCodeThumbnails ?? true,
        );
        const blob = new Blob([gcode], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'output.gcode';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      })();
    },

    sendToPrinter: async () => {
      const state = get();
      const result = state.sliceResult;
      if (!result) return;
      const print = state.getActivePrintProfile();
      const gcode = await withEmbeddedGCodeThumbnails(
        result.gcode,
        result,
        print.embedGCodeThumbnails ?? true,
      );
      const printerStore = usePrinterStore.getState();
      if (!printerStore.connected || !printerStore.service) {
        throw new Error('Printer not connected');
      }

      const file = new File(
        [new Blob([gcode], { type: 'text/plain' })],
        'output.gcode',
        { type: 'text/plain' },
      );
      await printerStore.uploadFile(file);
    },

    setSettingsPanel: (panel) => set({ settingsPanel: panel }),
    setTransformMode: (mode) => set({ transformMode: mode }),
    setViewportPickMode: (mode) => set((state) => ({
      viewportPickMode: mode,
      // Reset measurement accumulator when leaving measurement mode.
      measurePoints: mode === 'measure' ? state.measurePoints : [],
    })),
    pushMeasurePoint: (point) => set((state) => {
      // Keep only the last two so the line just shows the most recent pair.
      const next = [...state.measurePoints, point].slice(-2);
      return { measurePoints: next };
    }),
    clearMeasurePoints: () => set({ measurePoints: [] }),
  };
}
