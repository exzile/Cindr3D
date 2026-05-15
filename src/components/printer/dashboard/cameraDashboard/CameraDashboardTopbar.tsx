import { Camera, Maximize2, RefreshCcw, Settings } from 'lucide-react';

interface EnabledCamera {
  id: string;
  label: string;
  resolution: string;
}

/**
 * Top strip above the live viewer: status dot + printer name + free-form
 * status message on the left, reconnect / fullscreen / camera-settings on
 * the right, and (when multiple cameras are enabled for this printer) a
 * row of camera tabs that swap the active stream.
 *
 * In compact mode the action set collapses to "Open Camera" instead of
 * fullscreen + settings.
 */
export function CameraDashboardTopbar(props: {
  hasCamera: boolean;
  imageFailed: boolean;
  printerName: string;
  message: string;
  compact: boolean;
  reconnectCamera: () => void;
  setFullscreen: (next: boolean) => void;
  setActiveTab: (tab: 'camera' | 'settings') => void;

  // Camera tabs
  cameras: EnabledCamera[];
  activeCameraId: string;
  activePrinterId: string;
  updatePrinterPrefs: (printerId: string, patch: { activeCameraId: string }) => void;
  setStreamRevision: (updater: (value: number) => number) => void;
  setImageFailed: (next: boolean) => void;
  setWebRtcFailed: (next: boolean) => void;
  setMessage: (next: string) => void;
}) {
  const {
    hasCamera, imageFailed, printerName, message, compact,
    reconnectCamera, setFullscreen, setActiveTab,
    cameras, activeCameraId, activePrinterId, updatePrinterPrefs,
    setStreamRevision, setImageFailed, setWebRtcFailed, setMessage,
  } = props;
  return (
    <>
      <div className="cam-panel__topbar">
        <div className="cam-panel__status-block">
          <span className={`cam-panel__status-dot${hasCamera && !imageFailed ? ' is-online' : ''}`} />
          <div>
            <strong>{hasCamera ? printerName : 'Camera not configured'}</strong>
            <span>{message || (hasCamera ? 'MJPEG dashboard stream ready.' : 'Add a camera stream in settings to enable capture.')}</span>
          </div>
        </div>
        <div className="cam-panel__top-actions">
          <button className="cam-panel__button" type="button" disabled={!hasCamera} onClick={reconnectCamera}>
            <RefreshCcw size={13} /> Reconnect
          </button>
          {compact ? (
            <button className="cam-panel__button" type="button" onClick={() => setActiveTab('camera')}>
              <Camera size={13} /> Open Camera
            </button>
          ) : (
            <>
              <button className="cam-panel__button" type="button" disabled={!hasCamera} onClick={() => setFullscreen(true)}>
                <Maximize2 size={13} /> Fullscreen
              </button>
              <button className="cam-panel__button" type="button" onClick={() => setActiveTab('settings')}>
                <Settings size={13} /> Camera Settings
              </button>
            </>
          )}
        </div>
      </div>

      {cameras.length > 1 && (
        <div className="cam-panel__camera-tabs" aria-label="Camera streams">
          {cameras.map((camera) => (
            <button
              key={camera.id}
              className={`cam-panel__button${camera.id === activeCameraId ? ' is-active' : ''}`}
              type="button"
              onClick={() => {
                updatePrinterPrefs(activePrinterId, { activeCameraId: camera.id });
                setStreamRevision((value) => value + 1);
                setImageFailed(false);
                setWebRtcFailed(false);
                setMessage(`Switched to ${camera.label}.`);
              }}
            >
              <Camera size={13} /> {camera.label}
              <small>{camera.resolution}</small>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
