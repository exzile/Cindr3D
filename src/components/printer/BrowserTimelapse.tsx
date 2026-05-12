/**
 * BrowserTimelapse — in-app timelapse capture for non-Klipper printers.
 * Uses the browser Camera API (getUserMedia) + canvas frame grabs.
 * Frames are captured manually or on layer-change G-code event.
 * Final output is assembled via MediaRecorder into a WebM video and downloaded.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, Play, Square, Image, Download, Trash2, Film, Info } from 'lucide-react';
import { errorMessage } from '../../utils/errorHandling';
import './KlipperTabs.css';

interface CapturedFrame {
  dataUrl: string;
  capturedAt: number;
}

const FPS_OPTIONS = [5, 10, 15, 24, 30];

export default function BrowserTimelapse() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [frames, setFrames] = useState<CapturedFrame[]>([]);
  const [fps, setFps] = useState(10);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Start camera stream
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (e) {
      setCameraError(errorMessage(e, 'Camera access denied'));
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) { videoRef.current.srcObject = null; }
    setCameraActive(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  // Capture a single frame from the video feed
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !cameraActive) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    setFrames((prev) => [...prev, { dataUrl, capturedAt: Date.now() }]);
  }, [cameraActive]);

  const clearFrames = useCallback(() => {
    if (frames.length > 0 && !confirm(`Discard all ${frames.length} captured frames?`)) return;
    setFrames([]);
  }, [frames.length]);

  // Assemble frames into a WebM video using MediaRecorder + canvas
  const renderVideo = useCallback(async () => {
    if (frames.length < 2) { setRenderError('Need at least 2 frames to render a video.'); return; }
    setRendering(true); setRenderError(null);

    try {
      const canvas = document.createElement('canvas');
      const img0 = new window.Image();
      await new Promise<void>((res, rej) => {
        img0.onload = () => res();
        img0.onerror = rej;
        img0.src = frames[0].dataUrl;
      });
      canvas.width = img0.naturalWidth;
      canvas.height = img0.naturalHeight;
      const ctx = canvas.getContext('2d')!;

      const chunks: Blob[] = [];
      const stream = canvas.captureStream(fps);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const done = new Promise<void>((res) => { recorder.onstop = () => res(); });
      recorder.start();

      const msPerFrame = 1000 / fps;
      for (const frame of frames) {
        const imgEl = new window.Image();
        await new Promise<void>((res, rej) => {
          imgEl.onload = () => res();
          imgEl.onerror = rej;
          imgEl.src = frame.dataUrl;
        });
        ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
        await new Promise<void>((res) => setTimeout(res, msPerFrame));
      }
      recorder.stop();
      await done;

      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `timelapse-${Date.now()}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setRenderError(errorMessage(e, 'Render failed'));
    } finally {
      setRendering(false);
    }
  }, [frames, fps]);

  return (
    <div className="klipper-tab">
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <div className="klipper-tab-bar">
        <Camera size={15} />
        <h3>Timelapse</h3>
        <div className="spacer" />
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>FPS</label>
        <select
          value={fps}
          onChange={(e) => setFps(parseInt(e.target.value))}
          style={{ width: 60, padding: '3px 6px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
        >
          {FPS_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        {!cameraActive ? (
          <button className="klipper-btn klipper-btn-primary" onClick={startCamera}>
            <Play size={13} /> Start Camera
          </button>
        ) : (
          <button className="klipper-btn klipper-btn-danger" onClick={stopCamera}>
            <Square size={13} /> Stop Camera
          </button>
        )}
      </div>

      <div className="klipper-tab-body">
        {cameraError && (
          <div className="klipper-card" style={{ borderColor: '#ef4444' }}>
            <div className="klipper-card-body" style={{ flexDirection: 'row', gap: 8, color: '#ef4444', fontSize: 12 }}>
              <Camera size={14} /> {cameraError}
            </div>
          </div>
        )}
        {renderError && (
          <div className="klipper-card" style={{ borderColor: '#ef4444' }}>
            <div className="klipper-card-body" style={{ flexDirection: 'row', gap: 8, color: '#ef4444', fontSize: 12 }}>
              <Film size={14} /> {renderError}
            </div>
          </div>
        )}

        {/* Camera preview */}
        <div className="klipper-card">
          <div className="klipper-card-header">Camera Preview</div>
          <div className="klipper-card-body" style={{ alignItems: 'center', gap: 10 }}>
            <video
              ref={videoRef}
              muted
              playsInline
              style={{
                width: '100%', maxWidth: 480, aspectRatio: '16/9',
                background: '#000', borderRadius: 6,
                display: cameraActive ? 'block' : 'none',
              }}
            />
            {!cameraActive && (
              <div style={{ padding: '24px 0', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
                Camera is not active. Click <strong>Start Camera</strong> to begin.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="klipper-btn klipper-btn-primary"
                onClick={captureFrame}
                disabled={!cameraActive}
              >
                <Image size={13} /> Capture Frame
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                {frames.length} frame{frames.length !== 1 ? 's' : ''} captured
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="klipper-card">
          <div className="klipper-card-header">Render &amp; Export</div>
          <div className="klipper-card-body" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="klipper-btn klipper-btn-primary"
              onClick={renderVideo}
              disabled={frames.length < 2 || rendering}
            >
              <Download size={13} /> {rendering ? 'Rendering…' : `Export WebM (${frames.length} frames @ ${fps} fps)`}
            </button>
            {frames.length > 0 && (
              <button className="klipper-btn klipper-btn-danger" onClick={clearFrames} disabled={rendering}>
                <Trash2 size={13} /> Clear Frames
              </button>
            )}
          </div>
        </div>

        {/* Thumbnail strip */}
        {frames.length > 0 && (
          <div className="klipper-card">
            <div className="klipper-card-header">Captured Frames</div>
            <div className="klipper-card-body" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {frames.slice(-30).map((f, i) => (
                <img
                  key={i}
                  src={f.dataUrl}
                  alt={`Frame ${i + 1}`}
                  style={{ width: 80, height: 52, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }}
                />
              ))}
              {frames.length > 30 && (
                <div style={{ width: 80, height: 52, borderRadius: 4, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                  +{frames.length - 30} more
                </div>
              )}
            </div>
          </div>
        )}

        {/* Info */}
        <div className="klipper-card">
          <div className="klipper-card-header"><Info size={13} style={{ display: 'inline', marginRight: 4 }} />How it works</div>
          <div className="klipper-card-body">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              Point your camera at the printer. Click <strong>Capture Frame</strong> at each layer change (or automate it
              with a macro that calls back to your host). When done, click <strong>Export WebM</strong> to download the
              assembled video. For fully automatic layer-change capture on Klipper, connect a Klipper printer and
              install the Moonraker Timelapse plugin.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
