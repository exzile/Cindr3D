/**
 * useCameraDashboardPersistence — centralises all the side effects that read
 * and write camera-dashboard preferences:
 *
 *   1. Re-hydrate every dashboard-prefs-backed state value when the active
 *      printer changes (with skipNextPrefsSaveRef set so the immediately-
 *      following save effect doesn't echo the hydrated values back to disk).
 *   2. Debounced printer-prefs save (one combined update via updatePrinterPrefs).
 *   3. Per-key localStorage mirrors used by other panels that load these
 *      preferences without the printer store (auto-record, timelapse, snapshot
 *      triggers, camera presets, calibration, view toggles, control section).
 *
 * All state lives in the host; this hook just owns the effects.
 */
import { useEffect, type MutableRefObject } from 'react';
import type { CameraDashboardPrefs, CameraHdBridgeQuality } from '../../../../utils/duetPrefs';
import {
  ANOMALY_CAPTURE_KEY,
  AUTO_RECORD_KEY,
  AUTO_SNAPSHOT_ERROR_KEY,
  AUTO_SNAPSHOT_FINISH_KEY,
  AUTO_SNAPSHOT_FIRST_LAYER_KEY,
  AUTO_SNAPSHOT_LAYER_KEY,
  AUTO_TIMELAPSE_KEY,
  CALIBRATION_OVERLAY_KEY,
  CAMERA_PRESETS_KEY,
  CONTROL_SECTION_KEY,
  EDITOR_COLLAPSED_KEY,
  HEALTH_OPEN_KEY,
  SCHEDULED_SNAPSHOT_INTERVAL_KEY,
  SCHEDULED_SNAPSHOT_KEY,
  TIMELAPSE_FPS_KEY,
  TIMELAPSE_INTERVAL_KEY,
  VIEW_CROSSHAIR_KEY,
  VIEW_FLIP_KEY,
  VIEW_GRID_KEY,
  VIEW_ROTATION_KEY,
} from './prefsStorage';
import type {
  CameraMeasurementCalibration,
  CameraPreset,
  ControlSection,
} from './types';

type SetState<T> = (value: T | ((prev: T) => T)) => void;

export interface UseCameraDashboardPersistenceDeps {
  activePrinterId: string;
  dashboardPrefs: CameraDashboardPrefs;
  updatePrinterPrefs: (printerId: string, patch: { cameraDashboard: CameraDashboardPrefs }) => void;

  // Refs shared with the host so the host's reset hooks and these effects
  // coordinate (skipNextPrefsSaveRef prevents an echo write on hydration).
  hydratedPrinterIdRef: MutableRefObject<string>;
  skipNextPrefsSaveRef: MutableRefObject<boolean>;

  // Current state values
  autoRecord: boolean;
  autoTimelapse: boolean;
  autoSnapshotFirstLayer: boolean;
  autoSnapshotLayer: boolean;
  autoSnapshotFinish: boolean;
  autoSnapshotError: boolean;
  scheduledSnapshots: boolean;
  scheduledSnapshotIntervalMin: number;
  anomalyCapture: boolean;
  timelapseIntervalSec: number;
  timelapseFps: number;
  showGrid: boolean;
  showCrosshair: boolean;
  flipImage: boolean;
  rotation: number;
  healthPanelOpen: boolean;
  activeControlSection: ControlSection;
  editorCollapsed: boolean;
  cameraPresets: CameraPreset[];
  calibration: CameraMeasurementCalibration;
  ptzEnabled: boolean;
  ptzSpeed: number;
  hdBridgeQuality: CameraHdBridgeQuality;

  // Setters used by the hydration effect to push values back from the printer's
  // stored prefs when the active printer changes.
  setAutoRecord: SetState<boolean>;
  setAutoTimelapse: SetState<boolean>;
  setAutoSnapshotFirstLayer: SetState<boolean>;
  setAutoSnapshotLayer: SetState<boolean>;
  setAutoSnapshotFinish: SetState<boolean>;
  setAutoSnapshotError: SetState<boolean>;
  setScheduledSnapshots: SetState<boolean>;
  setScheduledSnapshotIntervalMin: SetState<number>;
  setAnomalyCapture: SetState<boolean>;
  setTimelapseIntervalSec: SetState<number>;
  setTimelapseFps: SetState<number>;
  setShowGrid: SetState<boolean>;
  setShowCrosshair: SetState<boolean>;
  setFlipImage: SetState<boolean>;
  setRotation: SetState<number>;
  setHealthPanelOpen: SetState<boolean>;
  setActiveControlSection: SetState<ControlSection>;
  setEditorCollapsed: SetState<boolean>;
  setCameraPresets: SetState<CameraPreset[]>;
  setCalibration: SetState<CameraMeasurementCalibration>;
  setPtzEnabled: SetState<boolean>;
  setPtzSpeed: SetState<number>;
  setHdBridgeQuality: SetState<CameraHdBridgeQuality>;
  // Measurement-state resets fired during hydration so they don't survive a
  // printer switch.
  setMeasurementMode: SetState<'off' | 'bed' | 'ruler'>;
  setNextBedCornerIndex: SetState<number>;
  setPoseStillUrl: SetState<string>;
  setFinalComparisonUrl: SetState<string>;
}

export function useCameraDashboardPersistence(deps: UseCameraDashboardPersistenceDeps) {
  const {
    activePrinterId, dashboardPrefs, updatePrinterPrefs,
    hydratedPrinterIdRef, skipNextPrefsSaveRef,
    autoRecord, autoTimelapse, autoSnapshotFirstLayer, autoSnapshotLayer,
    autoSnapshotFinish, autoSnapshotError, scheduledSnapshots,
    scheduledSnapshotIntervalMin, anomalyCapture, timelapseIntervalSec, timelapseFps,
    showGrid, showCrosshair, flipImage, rotation,
    healthPanelOpen, activeControlSection, editorCollapsed,
    cameraPresets, calibration, ptzEnabled, ptzSpeed, hdBridgeQuality,
    setAutoRecord, setAutoTimelapse, setAutoSnapshotFirstLayer, setAutoSnapshotLayer,
    setAutoSnapshotFinish, setAutoSnapshotError, setScheduledSnapshots,
    setScheduledSnapshotIntervalMin, setAnomalyCapture, setTimelapseIntervalSec, setTimelapseFps,
    setShowGrid, setShowCrosshair, setFlipImage, setRotation,
    setHealthPanelOpen, setActiveControlSection, setEditorCollapsed,
    setCameraPresets, setCalibration, setPtzEnabled, setPtzSpeed, setHdBridgeQuality,
    setMeasurementMode, setNextBedCornerIndex, setPoseStillUrl, setFinalComparisonUrl,
  } = deps;

  // 1) Hydrate from the new printer's stored prefs when activePrinterId changes.
  useEffect(() => {
    if (hydratedPrinterIdRef.current === activePrinterId) return;
    hydratedPrinterIdRef.current = activePrinterId;
    skipNextPrefsSaveRef.current = true;
    setAutoRecord(dashboardPrefs.autoRecord);
    setAutoTimelapse(dashboardPrefs.autoTimelapse);
    setAutoSnapshotFirstLayer(dashboardPrefs.autoSnapshotFirstLayer);
    setAutoSnapshotLayer(dashboardPrefs.autoSnapshotLayer);
    setAutoSnapshotFinish(dashboardPrefs.autoSnapshotFinish);
    setAutoSnapshotError(dashboardPrefs.autoSnapshotError);
    setScheduledSnapshots(dashboardPrefs.scheduledSnapshots);
    setScheduledSnapshotIntervalMin(dashboardPrefs.scheduledSnapshotIntervalMin);
    setAnomalyCapture(dashboardPrefs.anomalyCapture);
    setTimelapseIntervalSec(dashboardPrefs.timelapseIntervalSec);
    setTimelapseFps(dashboardPrefs.timelapseFps);
    setShowGrid(dashboardPrefs.showGrid);
    setShowCrosshair(dashboardPrefs.showCrosshair);
    setFlipImage(dashboardPrefs.flipImage);
    setRotation(dashboardPrefs.rotation % 360);
    setHealthPanelOpen(dashboardPrefs.healthPanelOpen);
    setActiveControlSection(dashboardPrefs.activeControlSection);
    setEditorCollapsed(dashboardPrefs.editorCollapsed);
    setCameraPresets(dashboardPrefs.cameraPresets);
    setCalibration(dashboardPrefs.calibration as CameraMeasurementCalibration);
    setMeasurementMode('off');
    setNextBedCornerIndex(0);
    setPoseStillUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return '';
    });
    setFinalComparisonUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return '';
    });
    setPtzEnabled(dashboardPrefs.ptzEnabled);
    setPtzSpeed(dashboardPrefs.ptzSpeed);
    setHdBridgeQuality(dashboardPrefs.hdBridgeQuality);
    // setters are stable; only re-run when the active printer or its stored prefs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePrinterId, dashboardPrefs]);

  // 2) Debounced printer-prefs save — one combined update.
  useEffect(() => {
    if (skipNextPrefsSaveRef.current) {
      skipNextPrefsSaveRef.current = false;
      return undefined;
    }

    const nextCameraPrefs: CameraDashboardPrefs = {
      autoRecord,
      autoTimelapse,
      autoSnapshotFirstLayer,
      autoSnapshotLayer,
      autoSnapshotFinish,
      autoSnapshotError,
      scheduledSnapshots,
      scheduledSnapshotIntervalMin,
      anomalyCapture,
      timelapseIntervalSec,
      timelapseFps,
      showGrid,
      showCrosshair,
      flipImage,
      rotation,
      healthPanelOpen,
      activeControlSection,
      editorCollapsed,
      cameraPresets,
      calibration,
      ptzEnabled,
      ptzSpeed,
      hdBridgeQuality,
    };

    const timeout = window.setTimeout(() => {
      updatePrinterPrefs(activePrinterId, { cameraDashboard: nextCameraPrefs });
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [
    activeControlSection, activePrinterId, anomalyCapture, autoRecord,
    autoSnapshotError, autoSnapshotFinish, autoSnapshotFirstLayer, autoSnapshotLayer,
    autoTimelapse, calibration, cameraPresets, editorCollapsed, flipImage,
    hdBridgeQuality, healthPanelOpen, ptzEnabled, ptzSpeed, rotation,
    scheduledSnapshotIntervalMin, scheduledSnapshots, showCrosshair, showGrid,
    timelapseFps, timelapseIntervalSec, updatePrinterPrefs, skipNextPrefsSaveRef,
  ]);

  // 3) Per-key localStorage mirrors.
  useEffect(() => {
    try {
      localStorage.setItem(AUTO_RECORD_KEY, String(autoRecord));
    } catch { /* storage unavailable */ }
  }, [autoRecord]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_TIMELAPSE_KEY, String(autoTimelapse));
      localStorage.setItem(TIMELAPSE_INTERVAL_KEY, String(timelapseIntervalSec));
      localStorage.setItem(TIMELAPSE_FPS_KEY, String(timelapseFps));
    } catch { /* storage unavailable */ }
  }, [autoTimelapse, timelapseFps, timelapseIntervalSec]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_SNAPSHOT_FIRST_LAYER_KEY, String(autoSnapshotFirstLayer));
      localStorage.setItem(AUTO_SNAPSHOT_LAYER_KEY, String(autoSnapshotLayer));
      localStorage.setItem(AUTO_SNAPSHOT_FINISH_KEY, String(autoSnapshotFinish));
      localStorage.setItem(AUTO_SNAPSHOT_ERROR_KEY, String(autoSnapshotError));
      localStorage.setItem(SCHEDULED_SNAPSHOT_KEY, String(scheduledSnapshots));
      localStorage.setItem(SCHEDULED_SNAPSHOT_INTERVAL_KEY, String(scheduledSnapshotIntervalMin));
      localStorage.setItem(ANOMALY_CAPTURE_KEY, String(anomalyCapture));
    } catch { /* storage unavailable */ }
  }, [anomalyCapture, autoSnapshotError, autoSnapshotFinish, autoSnapshotFirstLayer, autoSnapshotLayer, scheduledSnapshotIntervalMin, scheduledSnapshots]);

  useEffect(() => {
    try {
      localStorage.setItem(CAMERA_PRESETS_KEY, JSON.stringify(cameraPresets));
    } catch { /* storage unavailable */ }
  }, [cameraPresets]);

  useEffect(() => {
    try {
      localStorage.setItem(CALIBRATION_OVERLAY_KEY, JSON.stringify(calibration));
    } catch { /* storage unavailable */ }
  }, [calibration]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_GRID_KEY, String(showGrid));
      localStorage.setItem(VIEW_CROSSHAIR_KEY, String(showCrosshair));
      localStorage.setItem(VIEW_FLIP_KEY, String(flipImage));
      localStorage.setItem(VIEW_ROTATION_KEY, String(rotation));
      localStorage.setItem(HEALTH_OPEN_KEY, String(healthPanelOpen));
      localStorage.setItem(CONTROL_SECTION_KEY, activeControlSection);
      localStorage.setItem(EDITOR_COLLAPSED_KEY, String(editorCollapsed));
    } catch { /* storage unavailable */ }
  }, [activeControlSection, editorCollapsed, flipImage, healthPanelOpen, rotation, showCrosshair, showGrid]);
}
