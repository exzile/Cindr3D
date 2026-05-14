/**
 * useCameraConnection — small bag of the two callbacks that drive the
 * connection-recovery flow for the camera dashboard:
 *
 *   • reconnectCamera()  — manual reconnect button: clears failed flags,
 *     bumps reconnect history (for the Health card), forces the stream
 *     URL to re-fetch via streamRevision, and captures an anomaly snapshot
 *     so the user has a frame of "before" state if the reconnect helps.
 *
 *   • handleCameraError() — invoked from <video onError> / HLS fatal
 *     callbacks. If HD ('main') was active, falls back to SD ('sub')
 *     transparently; otherwise sets the imageFailed flag so the empty
 *     state renders.
 */
import { useCallback, type MutableRefObject } from 'react';
import type { DuetPrefs } from '../../../../utils/duetPrefs';

export interface UseCameraConnectionDeps {
  activePrinterId: string;
  webcamStreamPreference: DuetPrefs['webcamStreamPreference'];
  updatePrinterPrefs: (printerId: string, patch: { webcamStreamPreference: DuetPrefs['webcamStreamPreference'] }) => void;
  reconnectHistoryRef: MutableRefObject<number[]>;
  captureAnomaly: (reason: string) => void;
  setImageFailed: (next: boolean) => void;
  setWebRtcFailed: (next: boolean) => void;
  setLastFrameAt: (next: number | null) => void;
  setReconnectCount: (updater: (value: number) => number) => void;
  setStreamRevision: (updater: (value: number) => number) => void;
  setMessage: (msg: string) => void;
}

export function useCameraConnection(deps: UseCameraConnectionDeps) {
  const {
    activePrinterId, webcamStreamPreference, updatePrinterPrefs,
    reconnectHistoryRef, captureAnomaly,
    setImageFailed, setWebRtcFailed, setLastFrameAt,
    setReconnectCount, setStreamRevision, setMessage,
  } = deps;

  const reconnectCamera = useCallback(() => {
    setImageFailed(false);
    setWebRtcFailed(false);
    setLastFrameAt(null);
    reconnectHistoryRef.current = [...reconnectHistoryRef.current, Date.now()].slice(-10);
    setReconnectCount((value) => value + 1);
    setStreamRevision((value) => value + 1);
    setMessage('Reconnecting camera stream...');
    captureAnomaly('camera reconnect');
  }, [
    captureAnomaly, reconnectHistoryRef, setImageFailed, setLastFrameAt,
    setMessage, setReconnectCount, setStreamRevision, setWebRtcFailed,
  ]);

  const handleCameraError = useCallback(() => {
    if (webcamStreamPreference === 'main') {
      updatePrinterPrefs(activePrinterId, { webcamStreamPreference: 'sub' });
      setStreamRevision((value) => value + 1);
      setMessage('HD stream unavailable, falling back to SD.');
      return;
    }
    setImageFailed(true);
  }, [activePrinterId, setImageFailed, setMessage, setStreamRevision, updatePrinterPrefs, webcamStreamPreference]);

  return { reconnectCamera, handleCameraError };
}
