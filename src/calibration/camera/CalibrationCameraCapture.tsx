import { useEffect, useMemo, useRef, useState } from 'react';
import { useVisionStore } from '../../store/visionStore';
import type { VisionFrameSample } from '../../services/vision/failureDetector';
import { enabledCamerasFromPrefs, cameraDisplayUrl, normalizeCameraStreamUrl } from '../../utils/cameraStreamUrl';
import { getDuetPrefs } from '../../utils/duetPrefs';
import { usePrinterStore } from '../../store/printerStore';
import type { CameraStreamConfig, DuetPrefs } from '../../types/duet-prefs.types';
import './CalibrationCameraCapture.css';

export interface CalibrationCameraCaptureProps {
  printerId: string;
  maxFrames?: number;
  onFramesCaptured: (frames: VisionFrameSample[]) => void;
}

function uid(): string {
  return `calib-frame-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function cameraUrl(camera: CameraStreamConfig, prefs: DuetPrefs): string {
  const rawUrl = camera.streamPreference === 'main'
    ? camera.mainStreamUrl || camera.url
    : camera.url || camera.mainStreamUrl;
  const normalized = normalizeCameraStreamUrl(rawUrl);
  return cameraDisplayUrl(normalized, camera.username || prefs.webcamUsername, camera.password || prefs.webcamPassword);
}

function isVideoCamera(camera: CameraStreamConfig): boolean {
  return camera.webRtcEnabled || /\.m3u8($|\?)/i.test(camera.url) || /^rtsp:\/\//i.test(camera.url);
}

function frameFromDataUrl(
  dataUrl: string,
  cameraId: string,
  cameraLabel: string,
  size = dataUrl.length,
): VisionFrameSample {
  const mimeType = /^data:([^;,]+)/i.exec(dataUrl)?.[1] ?? 'image/jpeg';
  return {
    cameraId,
    cameraLabel,
    capturedAt: Date.now(),
    mimeType,
    dataUrl,
    size,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Unable to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function CalibrationCameraCapture({
  printerId,
  maxFrames = 5,
  onFramesCaptured,
}: CalibrationCameraCaptureProps) {
  const [capturedFrames, setCapturedFrames] = useState<VisionFrameSample[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<DuetPrefs | null>(null);
  const [cameras, setCameras] = useState<CameraStreamConfig[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const printers = usePrinterStore((state) => state.printers);
  const printerName = printers.find((printer) => printer.id === printerId)?.name ?? 'Selected printer';

  useEffect(() => {
    try {
      const nextPrefs = getDuetPrefs();
      const nextCameras = enabledCamerasFromPrefs(nextPrefs);
      setPrefs(nextPrefs);
      setCameras(nextCameras);
      setSelectedCameraId(nextCameras[0]?.id ?? '');
      setStreaming(nextCameras.length > 0);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStreaming(false);
    }
  }, [printerId]);

  const selectedCamera = cameras.find((camera) => camera.id === selectedCameraId) ?? cameras[0] ?? null;
  const selectedCameraUrl = useMemo(() => (
    selectedCamera && prefs ? cameraUrl(selectedCamera, prefs) : ''
  ), [prefs, selectedCamera]);

  const recordFrames = (frames: VisionFrameSample[]) => {
    const bounded = frames.slice(-Math.max(1, maxFrames));
    setCapturedFrames(bounded);
    onFramesCaptured(bounded);
    const store = useVisionStore.getState();
    for (const frame of bounded.slice(-Math.max(0, bounded.length - capturedFrames.length))) {
      store.recordFrame({
        id: uid(),
        printerId,
        printerName,
        createdAt: frame.capturedAt,
        frame,
      });
    }
  };

  const appendFrames = (frames: VisionFrameSample[]) => {
    const nextFrames = [...capturedFrames, ...frames].slice(-Math.max(1, maxFrames));
    setCapturedFrames(nextFrames);
    onFramesCaptured(nextFrames);
    const store = useVisionStore.getState();
    for (const frame of frames) {
      store.recordFrame({
        id: uid(),
        printerId,
        printerName,
        createdAt: frame.capturedAt,
        frame,
      });
    }
  };

  const captureFrame = () => {
    const media = mediaRef.current;
    if (!media || !selectedCamera) return;
    const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
    const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
    if (width <= 0 || height <= 0) {
      setError('Camera frame is not ready yet.');
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Unable to create capture canvas.');
      ctx.drawImage(media, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const frame = frameFromDataUrl(
        dataUrl,
        selectedCamera.id,
        selectedCamera.label,
      );
      appendFrames([frame]);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files) return;
    try {
      const frames = await Promise.all(Array.from(files).map(async (file, index) => {
        const dataUrl = await readFileAsDataUrl(file);
        return frameFromDataUrl(
          dataUrl,
          'manual-upload',
          file.name || `Frame ${capturedFrames.length + index + 1}`,
          file.size,
        );
      }));
      appendFrames(frames);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const removeFrame = (capturedAt: number) => {
    const nextFrames = capturedFrames.filter((frame) => frame.capturedAt !== capturedAt);
    setCapturedFrames(nextFrames);
    onFramesCaptured(nextFrames);
  };

  const clearFrames = () => {
    recordFrames([]);
  };

  return (
    <div className="calib-camera">
      {selectedCamera && selectedCameraUrl ? (
        <div className="calib-camera__feed">
          {isVideoCamera(selectedCamera) ? (
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={selectedCameraUrl}
              controls
              muted
              playsInline
              onCanPlay={() => setStreaming(true)}
              onError={() => {
                setStreaming(false);
                setError('Unable to load camera stream.');
              }}
            />
          ) : (
            <img
              ref={mediaRef as React.RefObject<HTMLImageElement>}
              src={selectedCameraUrl}
              alt={selectedCamera.label}
              onLoad={() => setStreaming(true)}
              onError={() => {
                setStreaming(false);
                setError('Unable to load camera image.');
              }}
            />
          )}
        </div>
      ) : (
        <div className="calib-camera__feed-placeholder">
          No camera configured for this printer. Upload photos below instead.
        </div>
      )}

      <div className="calib-camera__controls">
        {cameras.length > 1 && (
          <select value={selectedCameraId} onChange={(event) => setSelectedCameraId(event.target.value)}>
            {cameras.map((camera) => (
              <option key={camera.id} value={camera.id}>{camera.label}</option>
            ))}
          </select>
        )}
        <button type="button" className="calib-camera__btn" disabled={!streaming || !selectedCamera} onClick={captureFrame}>
          Capture frame
        </button>
        <button type="button" className="calib-camera__btn" disabled={capturedFrames.length === 0} onClick={clearFrames}>
          Clear all
        </button>
      </div>

      <div className="calib-camera__upload">
        <label htmlFor="calib-camera-upload">Or upload photos</label>
        <input id="calib-camera-upload" type="file" accept="image/*" multiple onChange={(event) => void uploadFiles(event.target.files)} />
      </div>

      {capturedFrames.length > 0 && (
        <div className="calib-camera__thumbnails">
          {capturedFrames.map((frame) => (
            <div key={frame.capturedAt} className="calib-camera__thumb">
              <img src={frame.dataUrl} alt={frame.cameraLabel} />
              <button
                type="button"
                className="calib-camera__thumb-remove"
                onClick={() => removeFrame(frame.capturedAt)}
                aria-label="Remove captured frame"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="calib-camera__error">{error}</div>}
    </div>
  );
}
