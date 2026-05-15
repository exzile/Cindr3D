/**
 * useDashboardPrefsState — owns every camera-dashboard preference state
 * that lives in `dashboardPrefs` and runs the persistence loop internally.
 *
 * Replaces ~24 inline useState declarations + a 50-line
 * useCameraDashboardPersistence prop bag in the host with a single hook
 * call that returns { state, setters }. The persistence side effects
 * (hydrate on printer switch, debounced save, localStorage mirrors) are
 * still in `useCameraDashboardPersistence` — this hook just owns the
 * state and threads it through.
 */
import { useRef, useState } from 'react';
import type { CameraDashboardPrefs, CameraHdBridgeQuality } from '../../../../utils/duetPrefs';
import { useCameraDashboardPersistence } from './useCameraDashboardPersistence';
import type {
  CameraMeasurementCalibration,
  CameraPreset,
  ControlSection,
  MeasurementMode,
} from './types';

type ViewModeValues = {
  showGrid: boolean;
  setShowGrid: (next: boolean | ((v: boolean) => boolean)) => void;
  showCrosshair: boolean;
  setShowCrosshair: (next: boolean | ((v: boolean) => boolean)) => void;
  flipImage: boolean;
  setFlipImage: (next: boolean | ((v: boolean) => boolean)) => void;
  rotation: number;
  setRotation: (next: number | ((v: number) => number)) => void;
};

export interface UseDashboardPrefsStateDeps {
  activePrinterId: string;
  dashboardPrefs: CameraDashboardPrefs;
  updatePrinterPrefs: (printerId: string, patch: { cameraDashboard: CameraDashboardPrefs }) => void;
  // View-mode state is declared by the host (useCameraMeasurement needs
  // rotation + flipImage at declaration time, so we can't own it here);
  // we just thread it through to the persistence loop.
  viewMode: ViewModeValues;
  // Measurement-state setters fired during printer-switch hydration so
  // a half-finished pick from one printer doesn't bleed into another.
  setCalibration: (next: CameraMeasurementCalibration | ((v: CameraMeasurementCalibration) => CameraMeasurementCalibration)) => void;
  setMeasurementMode: (mode: MeasurementMode | ((v: MeasurementMode) => MeasurementMode)) => void;
  setNextBedCornerIndex: (next: number | ((v: number) => number)) => void;
  setPoseStillUrl: (next: string | ((v: string) => string)) => void;
  setFinalComparisonUrl: (next: string | ((v: string) => string)) => void;
  // The current calibration is part of the persisted prefs payload.
  calibration: CameraMeasurementCalibration;
}

export function useDashboardPrefsState(deps: UseDashboardPrefsStateDeps) {
  const {
    activePrinterId, dashboardPrefs, updatePrinterPrefs,
    viewMode,
    setCalibration, setMeasurementMode, setNextBedCornerIndex,
    setPoseStillUrl, setFinalComparisonUrl, calibration,
  } = deps;

  // Internal — coordinate hydration so the immediately-following save
  // doesn't echo the just-loaded prefs back to disk.
  const hydratedPrinterIdRef = useRef(activePrinterId);
  const skipNextPrefsSaveRef = useRef(false);
  const { showGrid, setShowGrid, showCrosshair, setShowCrosshair, flipImage, setFlipImage, rotation, setRotation } = viewMode;

  // Auto-trigger toggles + intervals
  const [autoRecord, setAutoRecord] = useState(() => dashboardPrefs.autoRecord);
  const [autoTimelapse, setAutoTimelapse] = useState(() => dashboardPrefs.autoTimelapse);
  const [autoSnapshotFirstLayer, setAutoSnapshotFirstLayer] = useState(() => dashboardPrefs.autoSnapshotFirstLayer);
  const [autoSnapshotLayer, setAutoSnapshotLayer] = useState(() => dashboardPrefs.autoSnapshotLayer);
  const [autoSnapshotFinish, setAutoSnapshotFinish] = useState(() => dashboardPrefs.autoSnapshotFinish);
  const [autoSnapshotError, setAutoSnapshotError] = useState(() => dashboardPrefs.autoSnapshotError);
  const [scheduledSnapshots, setScheduledSnapshots] = useState(() => dashboardPrefs.scheduledSnapshots);
  const [scheduledSnapshotIntervalMin, setScheduledSnapshotIntervalMin] = useState(() => dashboardPrefs.scheduledSnapshotIntervalMin);
  const [anomalyCapture, setAnomalyCapture] = useState(() => dashboardPrefs.anomalyCapture);
  const [timelapseIntervalSec, setTimelapseIntervalSec] = useState(() => dashboardPrefs.timelapseIntervalSec);
  const [timelapseFps, setTimelapseFps] = useState(() => dashboardPrefs.timelapseFps);

  // (View toggles — showGrid / showCrosshair / flipImage / rotation —
  //  live in the host so useCameraMeasurement can read rotation +
  //  flipImage at declaration time; we just thread them through.)

  // Sidebar / collapse state
  const [healthPanelOpen, setHealthPanelOpen] = useState(() => dashboardPrefs.healthPanelOpen);
  const [activeControlSection, setActiveControlSection] = useState<ControlSection>(() => dashboardPrefs.activeControlSection);
  const [editorCollapsed, setEditorCollapsed] = useState(() => dashboardPrefs.editorCollapsed);

  // Saved view presets + PTZ knobs
  const [cameraPresets, setCameraPresets] = useState<CameraPreset[]>(() => dashboardPrefs.cameraPresets);
  const [ptzEnabled, setPtzEnabled] = useState(() => dashboardPrefs.ptzEnabled);
  const [ptzSpeed, setPtzSpeed] = useState(() => dashboardPrefs.ptzSpeed);
  const [hdBridgeQuality, setHdBridgeQuality] = useState<CameraHdBridgeQuality>(() => dashboardPrefs.hdBridgeQuality);

  useCameraDashboardPersistence({
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
  });

  return {
    autoRecord, setAutoRecord,
    autoTimelapse, setAutoTimelapse,
    autoSnapshotFirstLayer, setAutoSnapshotFirstLayer,
    autoSnapshotLayer, setAutoSnapshotLayer,
    autoSnapshotFinish, setAutoSnapshotFinish,
    autoSnapshotError, setAutoSnapshotError,
    scheduledSnapshots, setScheduledSnapshots,
    scheduledSnapshotIntervalMin, setScheduledSnapshotIntervalMin,
    anomalyCapture, setAnomalyCapture,
    timelapseIntervalSec, setTimelapseIntervalSec,
    timelapseFps, setTimelapseFps,
    healthPanelOpen, setHealthPanelOpen,
    activeControlSection, setActiveControlSection,
    editorCollapsed, setEditorCollapsed,
    cameraPresets, setCameraPresets,
    ptzEnabled, setPtzEnabled,
    ptzSpeed, setPtzSpeed,
    hdBridgeQuality, setHdBridgeQuality,
  };
}
