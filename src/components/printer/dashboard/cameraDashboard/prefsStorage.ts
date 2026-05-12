/**
 * localStorage-backed prefs loaders for the CameraDashboardPanel. All
 * read-only on init — writes still happen inline in the panel via
 * `localStorage.setItem`, so these helpers just centralise the per-key
 * decoding + defaulting logic.
 */
import {
  DEFAULT_CAMERA_DASHBOARD_PREFS,
  type CameraDashboardCalibration,
  type CameraDashboardPrefs,
  type CameraDashboardPreset,
} from '../../../../utils/duetPrefs';

type ControlSection = CameraDashboardPrefs['activeControlSection'];

export const AUTO_RECORD_KEY = 'cindr3d-camera-auto-record';
export const AUTO_TIMELAPSE_KEY = 'cindr3d-camera-auto-timelapse';
export const TIMELAPSE_INTERVAL_KEY = 'cindr3d-camera-timelapse-interval';
export const TIMELAPSE_FPS_KEY = 'cindr3d-camera-timelapse-fps';
export const AUTO_SNAPSHOT_FIRST_LAYER_KEY = 'cindr3d-camera-auto-snapshot-first-layer';
export const AUTO_SNAPSHOT_LAYER_KEY = 'cindr3d-camera-auto-snapshot-layer';
export const AUTO_SNAPSHOT_FINISH_KEY = 'cindr3d-camera-auto-snapshot-finish';
export const AUTO_SNAPSHOT_ERROR_KEY = 'cindr3d-camera-auto-snapshot-error';
export const VIEW_GRID_KEY = 'cindr3d-camera-view-grid';
export const VIEW_CROSSHAIR_KEY = 'cindr3d-camera-view-crosshair';
export const VIEW_FLIP_KEY = 'cindr3d-camera-view-flip';
export const VIEW_ROTATION_KEY = 'cindr3d-camera-view-rotation';
export const HEALTH_OPEN_KEY = 'cindr3d-camera-health-open';
export const CONTROL_SECTION_KEY = 'cindr3d-camera-control-section';
export const EDITOR_COLLAPSED_KEY = 'cindr3d-camera-editor-collapsed';
export const CAMERA_PRESETS_KEY = 'cindr3d-camera-presets';
export const SCHEDULED_SNAPSHOT_KEY = 'cindr3d-camera-scheduled-snapshot';
export const SCHEDULED_SNAPSHOT_INTERVAL_KEY = 'cindr3d-camera-scheduled-snapshot-interval';
export const ANOMALY_CAPTURE_KEY = 'cindr3d-camera-anomaly-capture';
export const CALIBRATION_OVERLAY_KEY = 'cindr3d-camera-calibration-overlay';
export const BACKEND_RECORDING_KEY_PREFIX = 'cindr3d-camera-backend-recording';

export function backendRecordingStorageKey(printerId: string): string {
  return `${BACKEND_RECORDING_KEY_PREFIX}:${printerId}`;
}

export function loadBooleanSetting(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function loadNumberSetting(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export function loadControlSectionSetting(): ControlSection {
  try {
    const value = localStorage.getItem(CONTROL_SECTION_KEY);
    return value === 'settings' || value === 'library' || value === 'timeline' || value === 'health' || value === 'record' || value === 'view'
      ? value
      : 'record';
  } catch {
    return 'record';
  }
}

export function loadCameraPresets(): CameraDashboardPreset[] {
  try {
    const value = localStorage.getItem(CAMERA_PRESETS_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as CameraDashboardPreset[];
    return Array.isArray(parsed) ? parsed.filter((preset) => preset.id && preset.name) : [];
  } catch {
    return [];
  }
}

export function loadCalibrationOverlay(): CameraDashboardCalibration {
  try {
    const value = localStorage.getItem(CALIBRATION_OVERLAY_KEY);
    if (!value) return { enabled: false, x: 12, y: 12, width: 76, height: 76 };
    const parsed = JSON.parse(value) as CameraDashboardCalibration & { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
    return {
      ...parsed,
      enabled: Boolean(parsed.enabled),
      x: Number.isFinite(parsed.x) ? Number(parsed.x) : 12,
      y: Number.isFinite(parsed.y) ? Number(parsed.y) : 12,
      width: Number.isFinite(parsed.width) ? Number(parsed.width) : 76,
      height: Number.isFinite(parsed.height) ? Number(parsed.height) : 76,
    };
  } catch {
    return { enabled: false, x: 12, y: 12, width: 76, height: 76 };
  }
}

export function loadCameraDashboardPrefs(): CameraDashboardPrefs {
  return {
    ...DEFAULT_CAMERA_DASHBOARD_PREFS,
    autoRecord: loadBooleanSetting(AUTO_RECORD_KEY),
    autoTimelapse: loadBooleanSetting(AUTO_TIMELAPSE_KEY),
    autoSnapshotFirstLayer: loadBooleanSetting(AUTO_SNAPSHOT_FIRST_LAYER_KEY),
    autoSnapshotLayer: loadBooleanSetting(AUTO_SNAPSHOT_LAYER_KEY),
    autoSnapshotFinish: loadBooleanSetting(AUTO_SNAPSHOT_FINISH_KEY),
    autoSnapshotError: loadBooleanSetting(AUTO_SNAPSHOT_ERROR_KEY),
    scheduledSnapshots: loadBooleanSetting(SCHEDULED_SNAPSHOT_KEY),
    scheduledSnapshotIntervalMin: loadNumberSetting(SCHEDULED_SNAPSHOT_INTERVAL_KEY, DEFAULT_CAMERA_DASHBOARD_PREFS.scheduledSnapshotIntervalMin),
    anomalyCapture: loadBooleanSetting(ANOMALY_CAPTURE_KEY),
    timelapseIntervalSec: loadNumberSetting(TIMELAPSE_INTERVAL_KEY, DEFAULT_CAMERA_DASHBOARD_PREFS.timelapseIntervalSec),
    timelapseFps: loadNumberSetting(TIMELAPSE_FPS_KEY, DEFAULT_CAMERA_DASHBOARD_PREFS.timelapseFps),
    showGrid: loadBooleanSetting(VIEW_GRID_KEY),
    showCrosshair: loadBooleanSetting(VIEW_CROSSHAIR_KEY),
    flipImage: loadBooleanSetting(VIEW_FLIP_KEY),
    rotation: loadNumberSetting(VIEW_ROTATION_KEY, 360) % 360,
    healthPanelOpen: (() => {
      try {
        const value = localStorage.getItem(HEALTH_OPEN_KEY);
        return value === null ? true : value === 'true';
      } catch {
        return true;
      }
    })(),
    activeControlSection: loadControlSectionSetting(),
    editorCollapsed: loadBooleanSetting(EDITOR_COLLAPSED_KEY),
    cameraPresets: loadCameraPresets(),
    calibration: loadCalibrationOverlay(),
  };
}
