/**
 * useCameraRecording — owns the camera-clip recording lifecycle:
 *
 *   • startRecording(kind, jobName?)
 *       — `canUseBackendRecording` → POST /camera-rtsp-record?action=start
 *         (server-side RTSP capture, ideal for HD streams the browser can't
 *         tee). Persists the session to sessionStorage so a page refresh
 *         doesn't strand a running recording.
 *       — otherwise → MediaRecorder on a CanvasCaptureStream of the live
 *         `<img>` / `<video>` element, sampled by an interval timer at
 *         RECORDING_FPS (or timelapseFps when kind === 'timelapse').
 *   • stopRecording()       — branches to backend stop or MediaRecorder.stop
 *   • stopBackendRecording  — internal; not returned (only stopRecording
 *                             needs to dispatch it).
 *
 * Also owns the auto-record effect: when a print becomes active, start an
 * auto / timelapse capture; stop it when the print returns to idle.
 *
 * The host owns every ref + state value the hook needs and passes them
 * through. Returns `{ startRecording, stopRecording }`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatClipDuration,
  pickRecordingMimeType,
  saveClip,
  savedRecordingMessage,
  type BackendRecordingSession,
  type CameraClipKind,
  type CameraMarker,
} from './clipStore';
import {
  clearBackendSession,
  fetchBackendRecordingStatus,
  loadStoredBackendSession,
  persistBackendSession,
  startBackendRecording,
  stopBackendRecording as stopBackendRecordingFetch,
} from './backendRecording';
import { RECORDING_FPS } from './types';

export interface UseCameraRecordingDeps {
  /** The off-screen drawing canvas the host renders. */
  canvasRef: { current: HTMLCanvasElement | null };

  // Stream + capture deps supplied by useSnapshotCapture / streamState
  drawFrame: () => void;
  canvasBlob: (type: string, quality?: number) => Promise<Blob>;
  hasCamera: boolean;
  canUseBackendRecording: boolean;
  isServerUsbCamera: boolean;
  backendRecordingUrl: string;

  // Preferences that influence framerate / interval / quality
  hdBridgeQuality: string;
  timelapseFps: number;
  timelapseIntervalSec: number;

  // Print-status driven auto-record / stop
  autoRecord: boolean;
  autoTimelapse: boolean;
  isPrintActive: boolean;
  jobFileName: string | undefined;

  // Identifiers baked into saved clips
  printerId: string;
  printerName: string;

  // UI feedback channels
  setBusy: (busy: boolean) => void;
  setMessage: (msg: string) => void;
  refreshClips: () => Promise<void>;

  /** From useSnapshotCapture — manual markers also trigger an anomaly snap. */
  captureAnomaly: (reason: string) => void;
}

export function useCameraRecording(deps: UseCameraRecordingDeps) {
  const {
    canvasRef,
    drawFrame, canvasBlob, hasCamera, canUseBackendRecording,
    isServerUsbCamera, backendRecordingUrl,
    hdBridgeQuality, timelapseFps, timelapseIntervalSec,
    autoRecord, autoTimelapse, isPrintActive, jobFileName,
    printerId, printerName,
    setBusy, setMessage, refreshClips,
    captureAnomaly,
  } = deps;

  // Internal refs — every one is private to the recording state machine.
  // The host doesn't read them; previously they were declared here and
  // passed in just so the same instances survived re-mounts of consumers.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const recordingKindRef = useRef<CameraClipKind | null>(null);
  const recordingJobRef = useRef<string | undefined>(undefined);
  const recordingMarkersRef = useRef<CameraMarker[]>([]);
  const recordingThumbnailRef = useRef<Blob | undefined>(undefined);
  const backendRecordingRef = useRef<BackendRecordingSession | null>(null);
  const frameTimerRef = useRef<number | null>(null);

  const [recordingKind, setRecordingKind] = useState<CameraClipKind | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const recording = recordingKind !== null;
  const isTimelapseRecording = recordingKind === 'timelapse';
  const isAutoRecording = recordingKind === 'auto';
  const recordingStatusLabel = recording
    ? `${isTimelapseRecording ? 'Timelapse' : isAutoRecording ? 'Auto recording' : 'Recording'} ${formatClipDuration(elapsedMs)}`
    : isPrintActive
      ? 'Print active'
      : 'Ready';
  const recordingMarkerCount = recordingMarkersRef.current.length;

  const stopBackend = useCallback(async () => {
    const session = backendRecordingRef.current;
    if (!session) return false;
    backendRecordingRef.current = null;
    clearBackendSession(printerId);
    recordingKindRef.current = null;
    recordingJobRef.current = undefined;
    recordingMarkersRef.current = [];
    recordingThumbnailRef.current = undefined;
    setRecordingKind(null);
    setElapsedMs(0);
    setBusy(true);
    try {
      const { blob, durationHeader } = await stopBackendRecordingFetch(session.id);
      const durationMs = durationHeader ?? (Date.now() - session.startedAt);
      if (blob.size <= 0) {
        setMessage('No video frames were captured.');
        return true;
      }
      await saveClip({
        id: `${printerId}-${Date.now()}`,
        printerId,
        printerName,
        kind: session.kind,
        jobName: session.jobName,
        markers: session.markers,
        thumbnailBlob: session.thumbnailBlob,
        createdAt: Date.now(),
        durationMs,
        mimeType: blob.type || 'video/mp4',
        size: blob.size,
        blob,
      });
      setMessage(savedRecordingMessage(session.kind, durationMs));
      await refreshClips();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save backend camera recording.');
    } finally {
      setBusy(false);
    }
    return true;
  }, [printerId, printerName, refreshClips, setBusy, setMessage]);

  const stopRecording = useCallback(() => {
    if (frameTimerRef.current !== null) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (backendRecordingRef.current) {
      void stopBackend();
      return;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }, [stopBackend]);

  const startRecording = useCallback(async (
    kind: Exclude<CameraClipKind, 'snapshot'> = 'clip',
    jobName?: string,
  ) => {
    if (!hasCamera || recording) return;
    if (canUseBackendRecording) {
      try {
        let thumbnailBlob: Blob | undefined;
        try {
          drawFrame();
          thumbnailBlob = await canvasBlob('image/jpeg', 0.75);
        } catch {
          thumbnailBlob = undefined;
        }
        const { id, createdAt: startedAt } = await startBackendRecording({
          kind, quality: hdBridgeQuality, isServerUsbCamera, backendRecordingUrl,
        });
        backendRecordingRef.current = { id, kind, jobName, markers: [], startedAt, thumbnailBlob };
        persistBackendSession(printerId, { id, kind, jobName, markers: [], startedAt });
        startedAtRef.current = startedAt;
        recordingKindRef.current = kind;
        recordingJobRef.current = jobName;
        recordingMarkersRef.current = [];
        recordingThumbnailRef.current = thumbnailBlob;
        setRecordingKind(kind);
        setElapsedMs(0);
        setMessage(kind === 'timelapse' ? 'Backend timelapse recording started...' : kind === 'auto' ? 'Backend auto-recording active print...' : 'Backend camera recording started...');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to start backend camera recording.');
      }
      return;
    }

    if (!('MediaRecorder' in window)) {
      setMessage('This browser does not support camera clip recording.');
      return;
    }

    try {
      drawFrame();
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Recording canvas is not ready.');
      recordingThumbnailRef.current = await canvasBlob('image/jpeg', 0.75);
      const stream = canvas.captureStream(kind === 'timelapse' ? timelapseFps : RECORDING_FPS);
      const mimeType = pickRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recordingKindRef.current = kind;
      recordingJobRef.current = jobName;
      recordingMarkersRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        const type = recorder.mimeType || mimeType || 'video/webm';
        const blob = new Blob(chunksRef.current, { type });
        const stoppedKind = recordingKindRef.current ?? kind;
        const stoppedJob = recordingJobRef.current;
        const stoppedMarkers = recordingMarkersRef.current;
        const stoppedThumbnail = recordingThumbnailRef.current;
        recorderRef.current = null;
        recordingKindRef.current = null;
        recordingJobRef.current = undefined;
        recordingMarkersRef.current = [];
        recordingThumbnailRef.current = undefined;
        setRecordingKind(null);
        setElapsedMs(0);
        void (async () => {
          if (blob.size <= 0) {
            setMessage('No video frames were captured.');
            return;
          }
          setBusy(true);
          try {
            await saveClip({
              id: `${printerId}-${Date.now()}`,
              printerId,
              printerName,
              kind: stoppedKind,
              jobName: stoppedJob,
              markers: stoppedMarkers,
              thumbnailBlob: stoppedThumbnail,
              createdAt: Date.now(),
              durationMs,
              mimeType: type,
              size: blob.size,
              blob,
            });
            setMessage(savedRecordingMessage(stoppedKind, durationMs));
            await refreshClips();
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Unable to save camera clip.');
          } finally {
            setBusy(false);
          }
        })();
      };

      recorder.onerror = () => {
        setMessage('Recording stopped because the camera stream could not be captured.');
        stopRecording();
      };

      recorderRef.current = recorder;
      frameTimerRef.current = window.setInterval(() => {
        try {
          drawFrame();
        } catch {
          stopRecording();
          setMessage('Recording stopped because the camera frame could not be read.');
        }
      }, kind === 'timelapse' ? Math.max(1, timelapseIntervalSec) * 1000 : Math.round(1000 / RECORDING_FPS));

      recorder.start(1000);
      setRecordingKind(kind);
      setElapsedMs(0);
      setMessage(kind === 'timelapse' ? 'Recording timelapse...' : kind === 'auto' ? 'Auto-recording active print...' : 'Recording camera clip...');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start recording.');
    }
  }, [
    backendRecordingRef, backendRecordingUrl, canUseBackendRecording, canvasBlob, canvasRef,
    chunksRef, drawFrame, frameTimerRef, hasCamera, hdBridgeQuality, isServerUsbCamera,
    printerId, printerName, recorderRef, recording, recordingJobRef, recordingKindRef,
    recordingMarkersRef, recordingThumbnailRef, refreshClips, setBusy, setElapsedMs,
    setMessage, setRecordingKind, startedAtRef, stopRecording, timelapseFps, timelapseIntervalSec,
  ]);

  // Restore a backend-recording session from sessionStorage. The session
  // survives a panel re-mount or page refresh; we re-hydrate the refs +
  // elapsed timer, then ask the backend to confirm the session is still
  // running. If not, scrub the stale storage entry so the UI is honest.
  useEffect(() => {
    const stored = loadStoredBackendSession(printerId);
    if (!stored) {
      if (backendRecordingRef.current) {
        backendRecordingRef.current = null;
        setRecordingKind(null);
        setElapsedMs(0);
      }
      return;
    }
    backendRecordingRef.current = stored;
    startedAtRef.current = stored.startedAt;
    recordingKindRef.current = stored.kind;
    recordingJobRef.current = stored.jobName;
    recordingMarkersRef.current = stored.markers;
    setRecordingKind(stored.kind);
    setElapsedMs(Date.now() - stored.startedAt);

    void fetchBackendRecordingStatus().then((status) => {
      if (status.recordings.some((rec) => rec.id === stored.id)) return;
      clearBackendSession(printerId);
      if (backendRecordingRef.current?.id === stored.id) {
        backendRecordingRef.current = null;
        recordingKindRef.current = null;
        recordingJobRef.current = undefined;
        recordingMarkersRef.current = [];
        setRecordingKind(null);
        setElapsedMs(0);
      }
    }).catch(() => {});
  }, [printerId]);

  // Auto-record on print transitions: kick off when a print becomes active,
  // stop when an auto-/timelapse-recorded job returns to idle.
  useEffect(() => {
    if ((!autoRecord && !autoTimelapse) || !hasCamera) return;
    if (isPrintActive && !recordingKindRef.current) {
      void startRecording(autoTimelapse ? 'timelapse' : 'auto', jobFileName);
      return;
    }
    if (!isPrintActive && (recordingKindRef.current === 'auto' || (autoTimelapse && recordingKindRef.current === 'timelapse'))) {
      stopRecording();
    }
  }, [autoRecord, autoTimelapse, hasCamera, isPrintActive, jobFileName, recordingKindRef, startRecording, stopRecording]);

  // Elapsed-time ticker: refresh `elapsedMs` twice per second while a
  // recording is in flight. Uses the existing `startedAtRef` so the timer
  // survives a re-mount mid-recording.
  useEffect(() => {
    if (!recording) return undefined;
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 500);
    return () => window.clearInterval(interval);
  }, [recording, setElapsedMs, startedAtRef]);

  // Clear the per-frame sampling interval on unmount — MediaRecorder
  // itself releases its stream tracks, but the timer that re-draws into
  // the canvas would tick forever if not cleared.
  useEffect(() => () => {
    if (frameTimerRef.current !== null) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
  }, [frameTimerRef]);

  // Manual marker — fired from the record-strip button while a recording
  // is in flight. Mirrors to the backend-session sessionStorage so a
  // panel re-mount still picks up the marker on restore. Also captures an
  // anomaly snapshot so there's a frame of context next to the marker.
  const addMarker = useCallback(() => {
    if (!recording) return;
    const atMs = Date.now() - startedAtRef.current;
    const marker: CameraMarker = {
      id: `${Date.now()}`,
      atMs,
      label: `Marker ${recordingMarkersRef.current.length + 1}`,
    };
    recordingMarkersRef.current = [...recordingMarkersRef.current, marker];
    if (backendRecordingRef.current) {
      backendRecordingRef.current = {
        ...backendRecordingRef.current,
        markers: recordingMarkersRef.current,
      };
      const session = backendRecordingRef.current;
      persistBackendSession(printerId, {
        id: session.id, kind: session.kind, jobName: session.jobName,
        markers: session.markers, startedAt: session.startedAt,
      });
    }
    setMessage(`Added marker at ${formatClipDuration(atMs)}.`);
    captureAnomaly(`manual marker ${formatClipDuration(atMs)}`);
  }, [
    backendRecordingRef, captureAnomaly, printerId, recording,
    recordingMarkersRef, setMessage, startedAtRef,
  ]);

  return {
    startRecording, stopRecording, addMarker,
    recordingKind, elapsedMs,
    recording, isTimelapseRecording, isAutoRecording,
    recordingStatusLabel, recordingMarkerCount,
  };
}
