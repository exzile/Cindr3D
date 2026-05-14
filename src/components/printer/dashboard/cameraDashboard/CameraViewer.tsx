import { Camera } from 'lucide-react';
import { type CSSProperties, type RefObject } from 'react';
import { formatClipDuration } from './clipStore';
import { formatLastFrame } from './snapshotEdit';
import { MeasurementLayer } from './MeasurementLayer';
import type { BedCornerKey, CameraMeasurementCalibration, MeasurementMode, RulerEndpointKey } from './types';
import CameraOverlayPanel, { type CameraOverlayMode } from '../CameraOverlayPanel';

interface CompleteBedCorners {
  frontLeft: { x: number; y: number };
  frontRight: { x: number; y: number };
  backRight: { x: number; y: number };
  backLeft: { x: number; y: number };
}

interface OverlayModeOption {
  mode: CameraOverlayMode;
  label: string;
  hint: string;
}

/**
 * Live camera viewer — the headline area above the record strip:
 *
 *   • Switches between an `<img>` MJPEG element and a `<video>` element
 *     (the host's `useVideoStream` writes into the `<video>` for WebRTC/HLS)
 *   • Renders frozen pose / final-comparison stills in place of the live
 *     element when the user is in AR calibration / post-print review
 *   • Overlays: live recording chip, frame-age health badge, AR overlay,
 *     measurement layer, calibration rectangle, pose-freeze label
 *   • Empty state when no camera is configured
 *   • Compact-mode AR/Camera/Preview switcher beneath the frame
 *   • Hidden capture canvas (the host's drawFrame writes into it)
 */
export function CameraViewer(props: {
  // Layout / class state
  compact: boolean;
  frameClassName: string;
  imageStyle: CSSProperties;
  calibrationStyle: CSSProperties;
  mediaViewportStyle: CSSProperties;

  // Stream + element refs
  frameRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  imgRef: RefObject<HTMLImageElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  isVideoStream: boolean;
  isBrowserUsbCamera: boolean;
  streamSrc: string;
  displayUrl: string;
  hasCamera: boolean;
  printerName: string;

  // Frame-load + error
  handleFrameLoad: () => void;
  handleCameraError: () => void;

  // Pose / comparison stills
  poseStillUrl: string;
  finalComparisonUrl: string;

  // Recording chip
  recording: boolean;
  isTimelapseRecording: boolean;
  isAutoRecording: boolean;
  elapsedMs: number;

  // Health overlay
  lastFrameAt: number | null;
  nowTick: number;

  // Calibration + AR overlay
  calibration: CameraMeasurementCalibration;
  cameraOverlayMode: CameraOverlayMode;
  setCameraOverlayMode: (mode: CameraOverlayMode) => void;
  frameCount: number;
  overlayModeOptions: OverlayModeOption[];

  // Measurement layer
  measurementMode: MeasurementMode;
  measurementStatus: string;
  bedCornersComplete: boolean;
  completeBedCorners: CompleteBedCorners | null;
  measuredDistanceMm: number | null;
  draggingBedCorner: BedCornerKey | null;
  draggingRulerEndpoint: RulerEndpointKey | null;
  handleMeasurementPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  handleCornerPointerDown: (event: React.PointerEvent<HTMLButtonElement>, corner: BedCornerKey) => void;
  handleCornerPointerMove: (event: React.PointerEvent<HTMLButtonElement>, corner: BedCornerKey) => void;
  handleCornerPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  handleRulerPointerDown: (event: React.PointerEvent<HTMLButtonElement>, endpoint: RulerEndpointKey) => void;
  handleRulerPointerMove: (event: React.PointerEvent<HTMLButtonElement>, endpoint: RulerEndpointKey) => void;
  handleRulerPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const {
    compact, frameClassName, imageStyle, calibrationStyle, mediaViewportStyle,
    frameRef, videoRef, imgRef, canvasRef,
    isVideoStream, isBrowserUsbCamera, streamSrc, displayUrl, hasCamera, printerName,
    handleFrameLoad, handleCameraError,
    poseStillUrl, finalComparisonUrl,
    recording, isTimelapseRecording, isAutoRecording, elapsedMs,
    lastFrameAt, nowTick,
    calibration, cameraOverlayMode, setCameraOverlayMode, frameCount, overlayModeOptions,
    measurementMode, measurementStatus, bedCornersComplete, completeBedCorners,
    measuredDistanceMm, draggingBedCorner, draggingRulerEndpoint,
    handleMeasurementPointerDown,
    handleCornerPointerDown, handleCornerPointerMove, handleCornerPointerUp,
    handleRulerPointerDown, handleRulerPointerMove, handleRulerPointerUp,
  } = props;
  return (
    <div className="cam-panel__viewer">
      <div ref={frameRef} className={frameClassName}>
        {hasCamera ? (
          <>
            {poseStillUrl || finalComparisonUrl ? (
              <img src={poseStillUrl || finalComparisonUrl} alt={`${printerName} frozen camera frame`} style={imageStyle} />
            ) : isVideoStream ? (
              <video
                ref={videoRef}
                className="cam-panel__video"
                muted
                playsInline
                autoPlay
                controls={!isBrowserUsbCamera}
                style={imageStyle}
                onLoadedData={handleFrameLoad}
                onPlaying={handleFrameLoad}
                onError={handleCameraError}
              />
            ) : (
              <img
                ref={imgRef}
                src={streamSrc}
                alt={`${printerName} camera stream`}
                style={imageStyle}
                onLoad={handleFrameLoad}
                onError={handleCameraError}
              />
            )}
            {recording && (
              <div className="cam-panel__recording">
                <span className="cam-panel__recording-dot" />
                {isTimelapseRecording ? 'TIMELAPSE' : isAutoRecording ? 'AUTO REC' : 'REC'} {formatClipDuration(elapsedMs)}
              </div>
            )}
            <div className="cam-panel__health">{formatLastFrame(lastFrameAt, nowTick)}</div>
            <div className="cam-panel__media-viewport" style={mediaViewportStyle}>
              {!compact && calibration.enabled && <div className="cam-panel__calibration" style={calibrationStyle} />}
              <CameraOverlayPanel pose={calibration.pose} mode={cameraOverlayMode} frameTick={frameCount} comparison={Boolean(finalComparisonUrl)} />
              <MeasurementLayer
                measurementMode={measurementMode}
                measurementStatus={measurementStatus}
                calibration={calibration}
                bedCornersComplete={bedCornersComplete}
                completeBedCorners={completeBedCorners}
                measuredDistanceMm={measuredDistanceMm}
                draggingBedCorner={draggingBedCorner}
                draggingRulerEndpoint={draggingRulerEndpoint}
                onMeasurementPointerDown={handleMeasurementPointerDown}
                handleCornerPointerDown={handleCornerPointerDown}
                handleCornerPointerMove={handleCornerPointerMove}
                handleCornerPointerUp={handleCornerPointerUp}
                handleRulerPointerDown={handleRulerPointerDown}
                handleRulerPointerMove={handleRulerPointerMove}
                handleRulerPointerUp={handleRulerPointerUp}
              />
              {poseStillUrl && (
                <span className="cam-panel__pose-freeze">Frozen pose frame</span>
              )}
              {finalComparisonUrl && (
                <span className="cam-panel__pose-freeze">Post-print comparison</span>
              )}
            </div>
          </>
        ) : (
          <div className="cam-panel__empty">
            <Camera size={28} />
            <strong>{displayUrl ? 'Camera stream unavailable' : 'No camera stream configured'}</strong>
            <span>Open camera settings to add an MJPEG sub stream for live dashboard preview and recording.</span>
          </div>
        )}
      </div>

      {compact && (
        <section className="cam-panel__view-tools cam-panel__view-tools--compact" aria-label="Camera view mode">
          <div className="cam-panel__view-mode" role="group" aria-label="Camera overlay mode">
            {overlayModeOptions.map(({ mode, label, hint }) => (
              <button
                key={mode}
                className={`cam-panel__button ${cameraOverlayMode === mode ? 'is-active' : ''}`}
                type="button"
                onClick={() => setCameraOverlayMode(mode)}
                title={hint}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      <canvas ref={canvasRef} className="cam-panel__hidden-canvas" />
    </div>
  );
}
