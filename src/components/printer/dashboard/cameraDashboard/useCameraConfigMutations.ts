/**
 * useCameraConfigMutations — two callbacks that mutate the active camera's
 * persisted prefs:
 *
 *   • updateActiveCamera(patch) — generic merge into the active camera entry
 *     in prefs.cameras (used by PTZ + camera-detail editors).
 *
 *   • setCameraQuality(quality) — flips webcamStreamPreference, mirrors it
 *     on the active camera, bumps streamRevision so the URL re-resolves,
 *     and posts the appropriate status message (HD bridge / HD / SD).
 *
 * Both wrap updatePrinterPrefs so the printerStore drives persistence.
 */
import { useCallback } from 'react';
import type { DuetPrefs } from '../../../../utils/duetPrefs';

export interface UseCameraConfigMutationsDeps {
  activePrinterId: string;
  activeCamera: DuetPrefs['cameras'][number] | undefined;
  cameras: DuetPrefs['cameras'];
  hdMainIsRtsp: boolean;
  updatePrinterPrefs: (
    printerId: string,
    patch: Partial<DuetPrefs>,
  ) => void;
  setStreamRevision: (updater: (value: number) => number) => void;
  setMessage: (msg: string) => void;
}

export function useCameraConfigMutations(deps: UseCameraConfigMutationsDeps) {
  const {
    activePrinterId, activeCamera, cameras, hdMainIsRtsp,
    updatePrinterPrefs, setStreamRevision, setMessage,
  } = deps;

  const updateActiveCamera = useCallback((patch: Partial<NonNullable<typeof activeCamera>>) => {
    if (!activeCamera) return;
    const nextCamera = { ...activeCamera, ...patch };
    updatePrinterPrefs(activePrinterId, {
      cameras: cameras.map((camera) => (camera.id === activeCamera.id ? nextCamera : camera)),
    });
  }, [activeCamera, activePrinterId, cameras, updatePrinterPrefs]);

  const setCameraQuality = useCallback((quality: DuetPrefs['webcamStreamPreference']) => {
    const nextCameras = activeCamera
      ? cameras.map((camera) => (
        camera.id === activeCamera.id
          ? { ...camera, streamPreference: quality }
          : camera
      ))
      : cameras;
    updatePrinterPrefs(activePrinterId, {
      webcamStreamPreference: quality,
      cameras: nextCameras,
    });
    setStreamRevision((value) => value + 1);
    setMessage(
      quality === 'main' && hdMainIsRtsp
        ? 'Starting automatic HD bridge...'
        : quality === 'main'
          ? 'Switched camera quality to HD.'
          : 'Switched camera quality to SD.'
    );
  }, [activeCamera, activePrinterId, cameras, hdMainIsRtsp, setMessage, setStreamRevision, updatePrinterPrefs]);

  return { updateActiveCamera, setCameraQuality };
}
