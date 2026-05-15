import {
  Crosshair, Eraser, FlipHorizontal, Grid2X2, Image, RotateCw, Ruler, Save, Trash2, X,
} from 'lucide-react';
import { formatMeasurementDistance } from './snapshotEdit';
import type { CameraOverlayMode } from '../CameraOverlayPanel';
import type { CameraMeasurementCalibration, MeasurementMode } from './types';

interface PoseStatus { label: string; state: string }

interface OverlayModeOption {
  mode: CameraOverlayMode;
  label: string;
  hint: string;
}

/**
 * "View" sidebar section: orientation toggles (grid/center/flip/rotate),
 * calibration overlay (rect + bed dimensions), AR pose calibration
 * (pick / freeze / save / clear bed corners), and the ruler tool.
 *
 * Presentational only — host owns every piece of state passed in.
 */
export function ViewControlsSection(props: {
  // Orientation
  showGrid: boolean;
  setShowGrid: (updater: (value: boolean) => boolean) => void;
  showCrosshair: boolean;
  setShowCrosshair: (updater: (value: boolean) => boolean) => void;
  flipImage: boolean;
  setFlipImage: (updater: (value: boolean) => boolean) => void;
  rotation: number;
  setRotation: (updater: (value: number) => number) => void;

  // Calibration overlay
  calibration: CameraMeasurementCalibration;
  setCalibration: (updater: (value: CameraMeasurementCalibration) => CameraMeasurementCalibration) => void;
  bedWidthMm: number;
  bedDepthMm: number;

  // AR pose / overlay mode
  poseStatus: PoseStatus;
  overlayModeOptions: OverlayModeOption[];
  cameraOverlayMode: CameraOverlayMode;
  setCameraOverlayMode: (mode: CameraOverlayMode) => void;
  measurementMode: MeasurementMode;
  setMeasurementMode: (updater: MeasurementMode | ((mode: MeasurementMode) => MeasurementMode)) => void;
  setNextBedCornerIndex: (index: number) => void;
  hasCamera: boolean;
  bedCornersComplete: boolean;
  homography: unknown;
  capturePoseStill: () => Promise<void> | void;
  savePoseCalibration: () => void;
  poseStillUrl: string;
  clearPoseStill: () => void;
  finalComparisonUrl: string;
  setFinalComparisonUrl: (updater: (url: string) => string) => void;

  // Ruler
  measuredDistanceMm: number | null;
  measurementStatus: string;
}) {
  const {
    showGrid, setShowGrid, showCrosshair, setShowCrosshair,
    flipImage, setFlipImage, rotation, setRotation,
    calibration, setCalibration, bedWidthMm, bedDepthMm,
    poseStatus, overlayModeOptions, cameraOverlayMode, setCameraOverlayMode,
    measurementMode, setMeasurementMode, setNextBedCornerIndex,
    hasCamera, bedCornersComplete, homography,
    capturePoseStill, savePoseCalibration,
    poseStillUrl, clearPoseStill,
    finalComparisonUrl, setFinalComparisonUrl,
    measuredDistanceMm, measurementStatus,
  } = props;

  return (
    <section className="cam-panel__control-section" aria-label="Camera view controls">
      <div className="cam-panel__section-head">
        <span><Crosshair size={14} /> View</span>
        <small>{rotation}deg</small>
      </div>
      <div className="cam-panel__view-section" aria-label="Camera orientation">
        <div className="cam-panel__view-section-head">
          <span>Orientation</span>
        </div>
        <div className="cam-panel__secondary-grid" aria-label="Camera view options">
          <button className={`cam-panel__button ${showGrid ? 'is-active' : ''}`} type="button" onClick={() => setShowGrid((value) => !value)}>
            <Grid2X2 size={13} /> Grid
          </button>
          <button className={`cam-panel__button ${showCrosshair ? 'is-active' : ''}`} type="button" onClick={() => setShowCrosshair((value) => !value)}>
            <Crosshair size={13} /> Center
          </button>
          <button className={`cam-panel__button ${flipImage ? 'is-active' : ''}`} type="button" onClick={() => setFlipImage((value) => !value)}>
            <FlipHorizontal size={13} /> Flip
          </button>
          <button className="cam-panel__button" type="button" onClick={() => setRotation((value) => (value + 90) % 360)}>
            <RotateCw size={13} /> Rotate
          </button>
        </div>
      </div>
      <div className="cam-panel__view-section" aria-label="Calibration overlay controls">
        <div className="cam-panel__view-section-head">
          <span>Calibration</span>
          <small>{calibration.enabled ? 'Overlay on' : 'Overlay off'}</small>
        </div>
        <label className="cam-panel__toggle">
          <input
            type="checkbox"
            checked={calibration.enabled}
            onChange={(event) => setCalibration((value) => ({ ...value, enabled: event.target.checked }))}
          />
          <span>Calibration overlay</span>
        </label>
        {calibration.enabled && (
          <div className="cam-panel__view-calibration">
            <label>X<input type="range" min={0} max={80} value={calibration.x} onChange={(event) => setCalibration((value) => ({ ...value, x: Number(event.target.value) }))} /></label>
            <label>Y<input type="range" min={0} max={80} value={calibration.y} onChange={(event) => setCalibration((value) => ({ ...value, y: Number(event.target.value) }))} /></label>
            <label>W<input type="range" min={10} max={100} value={calibration.width} onChange={(event) => setCalibration((value) => ({ ...value, width: Number(event.target.value) }))} /></label>
            <label>H<input type="range" min={10} max={100} value={calibration.height} onChange={(event) => setCalibration((value) => ({ ...value, height: Number(event.target.value) }))} /></label>
          </div>
        )}
        <label>
          Bed W
          <input
            className="cam-panel__input"
            type="number"
            min={1}
            value={bedWidthMm}
            onChange={(event) => setCalibration((value) => ({ ...value, bedWidthMm: Number(event.target.value) || 1 }))}
          />
        </label>
        <label>
          Bed D
          <input
            className="cam-panel__input"
            type="number"
            min={1}
            value={bedDepthMm}
            onChange={(event) => setCalibration((value) => ({ ...value, bedDepthMm: Number(event.target.value) || 1 }))}
          />
        </label>
      </div>
      <div className="cam-panel__view-section" aria-label="AR and preview corner setup">
        <div className="cam-panel__view-section-head">
          <span>AR / Preview</span>
          <small>{poseStatus.label}</small>
        </div>
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
        <button
          className={`cam-panel__button ${measurementMode === 'bed' ? 'is-active' : ''}`}
          type="button"
          disabled={!hasCamera}
          onClick={() => {
            setMeasurementMode((mode) => mode === 'bed' ? 'off' : 'bed');
            setNextBedCornerIndex(0);
          }}
        >
          <Crosshair size={13} /> Pick corners
        </button>
        <button className="cam-panel__button" type="button" disabled={!hasCamera} onClick={() => { void capturePoseStill(); }}>
          <Image size={13} /> Freeze pose
        </button>
        <button className="cam-panel__button" type="button" disabled={!bedCornersComplete || !homography} onClick={savePoseCalibration}>
          <Save size={13} /> Save pose
        </button>
        {poseStillUrl && (
          <button className="cam-panel__button" type="button" onClick={clearPoseStill}>
            <X size={13} /> Live view
          </button>
        )}
        {finalComparisonUrl && (
          <button
            className="cam-panel__button"
            type="button"
            onClick={() => {
              setFinalComparisonUrl((url) => {
                if (url) URL.revokeObjectURL(url);
                return '';
              });
            }}
          >
            <X size={13} /> Clear compare
          </button>
        )}
        <button
          className="cam-panel__button cam-panel__button--danger"
          type="button"
          onClick={() => {
            setCalibration((value) => ({ ...value, bedCorners: undefined, measureA: undefined, measureB: undefined, pose: undefined }));
            setMeasurementMode('off');
            setNextBedCornerIndex(0);
          }}
        >
          <Trash2 size={13} /> Clear bed
        </button>
        <span className={`cam-panel__pose-status cam-panel__pose-status--${poseStatus.state}`}>
          {poseStatus.label}
        </span>
      </div>
      <div className="cam-panel__view-section" aria-label="Ruler controls">
        <div className="cam-panel__view-section-head">
          <span>Ruler</span>
          <small>{calibration.measureA && calibration.measureB ? formatMeasurementDistance(measuredDistanceMm) : 'No measure'}</small>
        </div>
        <div className="cam-panel__view-status">
          <Ruler size={13} />
          <span>{calibration.measureA && calibration.measureB ? formatMeasurementDistance(measuredDistanceMm) : measurementMode === 'ruler' ? measurementStatus : 'Start the ruler, then place A and B on the video.'}</span>
        </div>
        <button
          className={`cam-panel__button ${measurementMode === 'ruler' ? 'is-active' : ''}`}
          type="button"
          disabled={!hasCamera || !bedCornersComplete}
          onClick={() => setMeasurementMode((mode) => mode === 'ruler' ? 'off' : 'ruler')}
        >
          <Ruler size={13} /> {measurementMode === 'ruler' ? 'Stop ruler' : 'Start ruler'}
        </button>
        <button
          className="cam-panel__button"
          type="button"
          onClick={() => {
            setCalibration((value) => ({ ...value, measureA: undefined, measureB: undefined }));
            setMeasurementMode('ruler');
          }}
          disabled={!hasCamera || !bedCornersComplete}
        >
          <Eraser size={13} /> Clear ruler
        </button>
        <span className="cam-panel__note">Drag markers A and B on the video to adjust the measurement.</span>
      </div>
    </section>
  );
}
