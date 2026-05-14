/**
 * useSnapshotCapture — owns the per-frame canvas grab + the four "save this
 * frame" entry points used by the camera dashboard:
 *
 *   • captureSnapshot(label?)        — full save into the clip library
 *   • capturePoseStill()             — freeze a frame as the bed-corner
 *                                      calibration reference
 *   • captureFinalComparisonFrame()  — freeze a frame for the AR comparison
 *                                      overlay (requires a saved pose)
 *   • captureAnomaly(reason)         — triggered by detectors; routed through
 *                                      captureSnapshot when anomaly capture
 *                                      is enabled
 *
 * Also owns the two automation effects:
 *   • scheduled snapshot interval (every N minutes while a print is active)
 *   • "stale frame" anomaly trigger
 *
 * The component owns the refs (video/img/canvas) + the surrounding state +
 * the clip-list refresh; this hook just composes them.
 */
import { useCallback, useEffect, type MutableRefObject, type RefObject } from 'react';
import { saveClip } from './clipStore';
import type { CameraMeasurementCalibration } from './types';
import type { CameraOverlayMode } from '../CameraOverlayPanel';

export interface UseSnapshotCaptureDeps {
  // Refs to the live media + the off-screen drawing canvas
  imgRef: RefObject<HTMLImageElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  scheduledSnapshotTimerRef: MutableRefObject<number | null>;
  staleAnomalyCapturedRef: MutableRefObject<boolean>;
  // Stream / camera state
  isVideoStream: boolean;
  hasCamera: boolean;
  // Identifying info baked into saved clips
  printerId: string;
  printerName: string;
  jobFileName: string | undefined;
  // Measurement & overlay setters (capture stills feed back into the AR loop)
  calibrationPose: CameraMeasurementCalibration['pose'];
  setPoseStillUrl: (updater: (currentUrl: string) => string) => void;
  setMeasurementMode: (mode: 'off' | 'bed' | 'ruler') => void;
  setNextBedCornerIndex: (index: number) => void;
  setFinalComparisonUrl: (updater: (currentUrl: string) => string) => void;
  setCameraOverlayMode: (mode: CameraOverlayMode) => void;
  // UI state plumbing
  setLastFrameAt: (timestamp: number | null) => void;
  setBusy: (busy: boolean) => void;
  setMessage: (msg: string) => void;
  refreshClips: () => Promise<void>;
  // Automation toggles + triggers
  anomalyCapture: boolean;
  scheduledSnapshots: boolean;
  scheduledSnapshotIntervalMin: number;
  isPrintActive: boolean;
  droppedFrameWarning: boolean;
}

export function useSnapshotCapture(deps: UseSnapshotCaptureDeps) {
  const {
    imgRef, videoRef, canvasRef, scheduledSnapshotTimerRef, staleAnomalyCapturedRef,
    isVideoStream, hasCamera,
    printerId, printerName, jobFileName,
    calibrationPose, setPoseStillUrl, setMeasurementMode, setNextBedCornerIndex,
    setFinalComparisonUrl, setCameraOverlayMode,
    setLastFrameAt, setBusy, setMessage, refreshClips,
    anomalyCapture, scheduledSnapshots, scheduledSnapshotIntervalMin,
    isPrintActive, droppedFrameWarning,
  } = deps;

  const drawFrame = useCallback(() => {
    const image = isVideoStream ? videoRef.current : imgRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) throw new Error('Camera preview is not ready yet.');
    const width = image instanceof HTMLVideoElement
      ? image.videoWidth || image.clientWidth || 1280
      : image.naturalWidth || image.clientWidth || 1280;
    const height = image instanceof HTMLVideoElement
      ? image.videoHeight || image.clientHeight || 720
      : image.naturalHeight || image.clientHeight || 720;
    if (width <= 0 || height <= 0) throw new Error('Camera stream has not produced a frame yet.');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas recording is not available in this browser.');
    context.drawImage(image, 0, 0, width, height);
    setLastFrameAt(Date.now());
  }, [canvasRef, imgRef, isVideoStream, setLastFrameAt, videoRef]);

  const canvasBlob = useCallback(async (type: string, quality?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error('Camera frame is not ready.');
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Unable to encode camera frame.'));
      }, type, quality);
    });
  }, [canvasRef]);

  const captureSnapshot = useCallback(async (label?: string) => {
    if (!hasCamera) return;
    try {
      drawFrame();
      const blob = await canvasBlob('image/png');
      const now = Date.now();
      setBusy(true);
      await saveClip({
        id: `${printerId}-snapshot-${now}`,
        printerId,
        printerName,
        name: label,
        kind: 'snapshot',
        jobName: jobFileName,
        album: jobFileName ? 'Print events' : undefined,
        tags: label ? ['auto-capture'] : undefined,
        createdAt: now,
        durationMs: 0,
        mimeType: blob.type || 'image/png',
        size: blob.size,
        blob,
      });
      setMessage(label ? `Saved ${label}.` : 'Saved camera snapshot.');
      await refreshClips();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save camera snapshot.');
    } finally {
      setBusy(false);
    }
  }, [canvasBlob, drawFrame, hasCamera, jobFileName, printerId, printerName, refreshClips, setBusy, setMessage]);

  const capturePoseStill = useCallback(async () => {
    if (!hasCamera) return;
    try {
      drawFrame();
      const blob = await canvasBlob('image/png');
      const nextUrl = URL.createObjectURL(blob);
      setPoseStillUrl((currentUrl) => {
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        return nextUrl;
      });
      setMeasurementMode('bed');
      setNextBedCornerIndex(0);
      setMessage('Frozen camera frame. Pick the four bed corners to calibrate AR pose.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to freeze camera frame.');
    }
  }, [canvasBlob, drawFrame, hasCamera, setMeasurementMode, setMessage, setNextBedCornerIndex, setPoseStillUrl]);

  const captureFinalComparisonFrame = useCallback(async () => {
    if (!hasCamera || !calibrationPose) return;
    try {
      drawFrame();
      const blob = await canvasBlob('image/png');
      const nextUrl = URL.createObjectURL(blob);
      setFinalComparisonUrl((currentUrl) => {
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        return nextUrl;
      });
      setCameraOverlayMode('both');
      setMessage('Frozen final frame for AR print comparison.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to freeze final comparison frame.');
    }
  }, [calibrationPose, canvasBlob, drawFrame, hasCamera, setCameraOverlayMode, setFinalComparisonUrl, setMessage]);

  const captureAnomaly = useCallback((reason: string) => {
    if (!anomalyCapture || !hasCamera) return;
    void captureSnapshot(`Anomaly: ${reason}`);
  }, [anomalyCapture, captureSnapshot, hasCamera]);

  // Scheduled snapshot interval — every N minutes while a print is active.
  useEffect(() => {
    if (scheduledSnapshotTimerRef.current !== null) {
      window.clearInterval(scheduledSnapshotTimerRef.current);
      scheduledSnapshotTimerRef.current = null;
    }
    if (!scheduledSnapshots || !hasCamera || !isPrintActive) return undefined;

    scheduledSnapshotTimerRef.current = window.setInterval(() => {
      void captureSnapshot('Scheduled snapshot');
    }, Math.max(1, scheduledSnapshotIntervalMin) * 60 * 1000);

    return () => {
      if (scheduledSnapshotTimerRef.current !== null) {
        window.clearInterval(scheduledSnapshotTimerRef.current);
        scheduledSnapshotTimerRef.current = null;
      }
    };
  }, [captureSnapshot, hasCamera, isPrintActive, scheduledSnapshotIntervalMin, scheduledSnapshots, scheduledSnapshotTimerRef]);

  // Stale-frame anomaly trigger — captures one snapshot per stale-frame event,
  // resets the latch as soon as the warning clears.
  useEffect(() => {
    if (!anomalyCapture || !droppedFrameWarning) {
      if (!droppedFrameWarning) staleAnomalyCapturedRef.current = false;
      return;
    }
    if (staleAnomalyCapturedRef.current) return;
    staleAnomalyCapturedRef.current = true;
    captureAnomaly('stale frame');
  }, [anomalyCapture, captureAnomaly, droppedFrameWarning, staleAnomalyCapturedRef]);

  return { drawFrame, canvasBlob, captureSnapshot, capturePoseStill, captureFinalComparisonFrame, captureAnomaly };
}
