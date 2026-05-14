import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Flag, Home, Play,
  Save, Settings, Video, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { ptzProviderLabel, type PtzDirection } from '../../../../services/camera/ptzControl';
import type { CameraHdBridgeQuality, CameraPtzPreset, DuetPrefs } from '../../../../utils/duetPrefs';
import { HD_BRIDGE_QUALITIES, type CameraPreset } from './types';

type ActiveCameraLike = {
  id: string;
  ptzProvider?: string;
  ptzPresets: CameraPtzPreset[];
  ptzStartPresetId?: string;
} & Record<string, unknown>;

/**
 * "Settings" sidebar section — every automation knob the dashboard exposes:
 *   • Stream quality (SD/HD + HD bridge fallback note + bridge-quality select)
 *   • Timelapse interval + FPS
 *   • Camera preset save/apply/delete (view + timelapse settings bundle)
 *   • PTZ controls (enable toggle, speed, 8-way grid, slot/preset list)
 *   • Auto-trigger toggles (auto-record, timelapse, first-layer / per-layer /
 *     finish / error snapshots, scheduled snapshots, anomaly capture)
 *
 * Big prop surface because the host owns every state value; this is
 * pure layout + wiring.
 */
export function SettingsSection(props: {
  // Stream quality
  webcamStreamPreference: DuetPrefs['webcamStreamPreference'];
  setCameraQuality: (quality: DuetPrefs['webcamStreamPreference']) => void;
  hdLiveNeedsBridge: boolean;
  hdBridgeQuality: CameraHdBridgeQuality;
  setHdBridgeQuality: (quality: CameraHdBridgeQuality) => void;
  setStreamRevision: (updater: (value: number) => number) => void;
  setMessage: (msg: string) => void;

  // Timelapse
  timelapseIntervalSec: number;
  setTimelapseIntervalSec: (value: number) => void;
  timelapseFps: number;
  setTimelapseFps: (value: number) => void;

  // Camera presets
  presetName: string;
  setPresetName: (value: string) => void;
  saveCameraPreset: () => void;
  applyCameraPreset: (preset: CameraPreset) => void;
  deleteCameraPreset: (presetId: string) => void;
  cameraPresets: CameraPreset[];

  // PTZ
  ptzEnabled: boolean;
  setPtzEnabled: (value: boolean) => void;
  ptzSpeed: number;
  setPtzSpeed: (value: number) => void;
  canUsePtz: boolean;
  activeCamera: ActiveCameraLike | null | undefined;
  updateActiveCamera: (patch: Partial<ActiveCameraLike>) => void;
  ptzPresetName: string;
  setPtzPresetName: (value: string) => void;
  ptzPresetToken: string;
  setPtzPresetToken: (value: string) => void;
  runPtzCommand: (direction: PtzDirection) => void;
  runPtzPreset: (preset: CameraPtzPreset) => Promise<void> | void;
  savePtzPreset: () => void;
  deletePtzPreset: (presetId: string) => void;

  // Auto-trigger toggles
  autoRecord: boolean;
  setAutoRecord: (value: boolean) => void;
  autoTimelapse: boolean;
  setAutoTimelapse: (value: boolean) => void;
  autoSnapshotFirstLayer: boolean;
  setAutoSnapshotFirstLayer: (value: boolean) => void;
  autoSnapshotLayer: boolean;
  setAutoSnapshotLayer: (value: boolean) => void;
  autoSnapshotFinish: boolean;
  setAutoSnapshotFinish: (value: boolean) => void;
  autoSnapshotError: boolean;
  setAutoSnapshotError: (value: boolean) => void;
  scheduledSnapshots: boolean;
  setScheduledSnapshots: (value: boolean) => void;
  scheduledSnapshotIntervalMin: number;
  setScheduledSnapshotIntervalMin: (value: number) => void;
  anomalyCapture: boolean;
  setAnomalyCapture: (value: boolean) => void;
}) {
  const {
    webcamStreamPreference, setCameraQuality, hdLiveNeedsBridge,
    hdBridgeQuality, setHdBridgeQuality, setStreamRevision, setMessage,
    timelapseIntervalSec, setTimelapseIntervalSec, timelapseFps, setTimelapseFps,
    presetName, setPresetName, saveCameraPreset, applyCameraPreset, deleteCameraPreset, cameraPresets,
    ptzEnabled, setPtzEnabled, ptzSpeed, setPtzSpeed, canUsePtz, activeCamera, updateActiveCamera,
    ptzPresetName, setPtzPresetName, ptzPresetToken, setPtzPresetToken,
    runPtzCommand, runPtzPreset, savePtzPreset, deletePtzPreset,
    autoRecord, setAutoRecord, autoTimelapse, setAutoTimelapse,
    autoSnapshotFirstLayer, setAutoSnapshotFirstLayer, autoSnapshotLayer, setAutoSnapshotLayer,
    autoSnapshotFinish, setAutoSnapshotFinish, autoSnapshotError, setAutoSnapshotError,
    scheduledSnapshots, setScheduledSnapshots, scheduledSnapshotIntervalMin, setScheduledSnapshotIntervalMin,
    anomalyCapture, setAnomalyCapture,
  } = props;

  return (
    <section className="cam-panel__control-section" aria-label="Camera automation settings">
      <div className="cam-panel__section-head">
        <span><Settings size={14} /> Settings</span>
        <small>{webcamStreamPreference === 'main' ? 'HD' : 'SD'} stream</small>
      </div>
      <div className="cam-panel__quality-tools" aria-label="Camera quality">
        <button
          className={`cam-panel__button ${webcamStreamPreference === 'sub' ? 'is-active' : ''}`}
          type="button"
          onClick={() => setCameraQuality('sub')}
        >
          <Video size={13} /> SD
        </button>
        <button
          className={`cam-panel__button ${webcamStreamPreference === 'main' ? 'is-active' : ''}`}
          type="button"
          onClick={() => setCameraQuality('main')}
          title={hdLiveNeedsBridge ? 'HD uses the local automatic RTSP to HLS bridge.' : 'Use HD stream'}
        >
          <Video size={13} /> HD
        </button>
        {hdLiveNeedsBridge && (
          <span className="cam-panel__note">
            HD uses a local FFmpeg bridge automatically. First load can take a few seconds.
          </span>
        )}
        {hdLiveNeedsBridge && webcamStreamPreference === 'main' && (
          <label className="cam-panel__quality-select">
            Bridge quality
            <select
              className="cam-panel__input"
              value={hdBridgeQuality}
              onChange={(event) => {
                setHdBridgeQuality(event.target.value as CameraHdBridgeQuality);
                setStreamRevision((value) => value + 1);
                setMessage('Updating HD bridge quality...');
              }}
            >
              {HD_BRIDGE_QUALITIES.map((quality) => (
                <option key={quality.value} value={quality.value}>{quality.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="cam-panel__settings-row">
        <label>
          Interval
          <input
            className="cam-panel__input"
            type="number"
            min={1}
            max={60}
            value={timelapseIntervalSec}
            onChange={(event) => setTimelapseIntervalSec(Math.max(1, Number(event.target.value) || 1))}
          />
        </label>
        <label>
          FPS
          <input
            className="cam-panel__input"
            type="number"
            min={1}
            max={30}
            value={timelapseFps}
            onChange={(event) => setTimelapseFps(Math.max(1, Math.min(30, Number(event.target.value) || 1)))}
          />
        </label>
      </div>
      <div className="cam-panel__preset-tools">
        <input className="cam-panel__input" value={presetName} placeholder="Preset name" onChange={(event) => setPresetName(event.target.value)} />
        <button className="cam-panel__button" type="button" onClick={saveCameraPreset}>
          <Save size={13} /> Save Preset
        </button>
        {cameraPresets.length === 0 ? (
          <span className="cam-panel__note">Save view/recording settings as presets for repeat camera setups.</span>
        ) : cameraPresets.map((preset) => (
          <div className="cam-panel__preset-row" key={preset.id}>
            <button className="cam-panel__button" type="button" onClick={() => applyCameraPreset(preset)}>
              <Play size={13} /> {preset.name}
            </button>
            <button className="cam-panel__button cam-panel__button--danger" type="button" onClick={() => deleteCameraPreset(preset.id)}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="cam-panel__ptz-tools">
        <div className="cam-panel__section-head">
          <span><Camera size={14} /> PTZ</span>
          <small>{ptzEnabled && canUsePtz ? ptzProviderLabel(activeCamera?.ptzProvider ?? 'off') : 'Off'}</small>
        </div>
        <label className="cam-panel__toggle">
          <input
            type="checkbox"
            checked={ptzEnabled}
            onChange={(event) => setPtzEnabled(event.target.checked)}
          />
          <span>Enable move controls</span>
        </label>
        <span className="cam-panel__note">
          Uses the selected camera's PTZ provider, presets, and credentials from Camera Settings.
        </span>
        <div className="cam-panel__settings-row">
          <label>
            Speed
            <input
              className="cam-panel__input"
              type="number"
              min={1}
              max={8}
              value={ptzSpeed}
              onChange={(event) => setPtzSpeed(Math.max(1, Math.min(8, Number(event.target.value) || 1)))}
            />
          </label>
        </div>
        <div className="cam-panel__ptz-grid" aria-label="Camera movement controls">
          <span />
          <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('up')} title="Move up">
            <ArrowUp size={14} />
          </button>
          <span />
          <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('left')} title="Move left">
            <ArrowLeft size={14} />
          </button>
          <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('home')} title="Go to home preset">
            <Home size={14} />
          </button>
          <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('right')} title="Move right">
            <ArrowRight size={14} />
          </button>
          <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('zoomOut')} title="Zoom out">
            <ZoomOut size={14} />
          </button>
          <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('down')} title="Move down">
            <ArrowDown size={14} />
          </button>
          <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('zoomIn')} title="Zoom in">
            <ZoomIn size={14} />
          </button>
        </div>
        <div className="cam-panel__ptz-preset-form">
          <input className="cam-panel__input" value={ptzPresetName} placeholder="Preset name" onChange={(event) => setPtzPresetName(event.target.value)} />
          <input className="cam-panel__input" value={ptzPresetToken} placeholder="Slot" onChange={(event) => setPtzPresetToken(event.target.value)} />
          <button className="cam-panel__button" type="button" disabled={!activeCamera} onClick={savePtzPreset}>
            <Save size={13} /> Save PTZ
          </button>
        </div>
        {activeCamera?.ptzPresets.length ? (
          <div className="cam-panel__ptz-preset-list">
            {activeCamera.ptzPresets.map((preset) => (
              <div className="cam-panel__preset-row" key={preset.id}>
                <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzPreset(preset)}>
                  <Play size={13} /> {preset.name}
                </button>
                <button
                  className={`cam-panel__button${activeCamera.ptzStartPresetId === preset.id ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => updateActiveCamera({ ptzStartPresetId: activeCamera.ptzStartPresetId === preset.id ? '' : preset.id })}
                  title="Use on print start"
                >
                  <Flag size={13} />
                </button>
                <button className="cam-panel__button cam-panel__button--danger" type="button" onClick={() => deletePtzPreset(preset.id)}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <span className="cam-panel__note">Save PTZ slot numbers after positioning the camera, then mark one for print-start framing.</span>
        )}
      </div>
      <div className="cam-panel__toggle-grid">
        <label className="cam-panel__toggle">
          <input type="checkbox" checked={autoRecord} onChange={(event) => setAutoRecord(event.target.checked)} />
          <span>Auto-record print jobs</span>
        </label>
        <label className="cam-panel__toggle">
          <input type="checkbox" checked={autoTimelapse} onChange={(event) => setAutoTimelapse(event.target.checked)} />
          <span>Auto timelapse</span>
        </label>
        <label className="cam-panel__toggle">
          <input type="checkbox" checked={autoSnapshotFirstLayer} onChange={(event) => setAutoSnapshotFirstLayer(event.target.checked)} />
          <span>First-layer snapshot</span>
        </label>
        <label className="cam-panel__toggle">
          <input type="checkbox" checked={autoSnapshotLayer} onChange={(event) => setAutoSnapshotLayer(event.target.checked)} />
          <span>Every-layer snapshots</span>
        </label>
        <label className="cam-panel__toggle">
          <input type="checkbox" checked={autoSnapshotFinish} onChange={(event) => setAutoSnapshotFinish(event.target.checked)} />
          <span>Finish snapshot</span>
        </label>
        <label className="cam-panel__toggle">
          <input type="checkbox" checked={autoSnapshotError} onChange={(event) => setAutoSnapshotError(event.target.checked)} />
          <span>Error snapshot</span>
        </label>
        <label className="cam-panel__toggle">
          <input type="checkbox" checked={scheduledSnapshots} onChange={(event) => setScheduledSnapshots(event.target.checked)} />
          <span>Timed snapshots</span>
        </label>
        <label className="cam-panel__toggle">
          <input type="checkbox" checked={anomalyCapture} onChange={(event) => setAnomalyCapture(event.target.checked)} />
          <span>Anomaly capture</span>
        </label>
        <label>
          Every minutes
          <input
            className="cam-panel__input"
            type="number"
            min={1}
            max={240}
            value={scheduledSnapshotIntervalMin}
            onChange={(event) => setScheduledSnapshotIntervalMin(Math.max(1, Number(event.target.value) || 1))}
          />
        </label>
      </div>
    </section>
  );
}
