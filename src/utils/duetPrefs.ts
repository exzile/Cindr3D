// =============================================================================
// Duet UI preferences — per-printer, stored inside each SavedPrinter in the
// printers list (see store/printerStore.ts).
//
// The DuetSettings dialog is the primary editor; other Duet panels may read
// values lazily via getDuetPrefs() when they want to change behaviour.
//
// Legacy path: the previous single-printer build persisted prefs under
// 'cindr3d-duet-prefs'. The printerStore migrates that into printer #1 on
// first boot. If migration hasn't run yet, we still fall back to the legacy
// key so early callers don't see defaults during the brief startup window.
// =============================================================================

const LEGACY_PREFS_KEY = 'cindr3d-duet-prefs';
const LEGACY_AUTO_RECONNECT_KEY = 'cindr3d-duet-autoreconnect';

export type {
  CameraDashboardCalibration,
  CameraDashboardControlSection,
  CameraDashboardPrefs,
  CameraDashboardPreset,
  CameraHdBridgeQuality,
  CameraMainStreamProtocol,
  CameraPathPreset,
  CameraPtzPreset,
  CameraPtzProvider,
  CameraRtspTransport,
  CameraStreamConfig,
  CameraSourceType,
  CameraStreamRole,
  CameraStreamPreference,
  CustomButton,
  DateFormat,
  DuetPrefs,
  FilamentMaterial,
  FilamentProfile,
  NotifSeverity,
  SafetyLimits,
  TemperatureUnit,
  Units,
} from '../types/duet-prefs.types';
import type { CameraDashboardPrefs, CameraPtzPreset, CameraPtzProvider, CameraStreamConfig, CameraStreamRole, DuetPrefs } from '../types/duet-prefs.types';

export const DEFAULT_CAMERA_DASHBOARD_PREFS: CameraDashboardPrefs = {
  autoRecord: false,
  autoTimelapse: false,
  autoSnapshotFirstLayer: false,
  autoSnapshotLayer: false,
  autoSnapshotFinish: false,
  autoSnapshotError: false,
  scheduledSnapshots: false,
  scheduledSnapshotIntervalMin: 5,
  anomalyCapture: false,
  timelapseIntervalSec: 3,
  timelapseFps: 4,
  showGrid: false,
  showCrosshair: false,
  flipImage: false,
  rotation: 0,
  healthPanelOpen: true,
  activeControlSection: 'record',
  editorCollapsed: false,
  cameraPresets: [],
  calibration: { enabled: false, x: 12, y: 12, width: 76, height: 76 },
  ptzEnabled: false,
  ptzSpeed: 4,
  hdBridgeQuality: '1080p',
};

export const DEFAULT_CAMERA_STREAM_ID = 'primary';

function defaultPtzProviderForPreset(pathPreset: string | undefined): CameraPtzProvider {
  if (pathPreset === 'amcrest' || pathPreset === 'reolink' || pathPreset === 'tapo' || pathPreset === 'hikvision' || pathPreset === 'onvif') {
    return pathPreset;
  }
  return 'off';
}

export function legacyCameraFromPrefs(prefs: Partial<DuetPrefs>, id = DEFAULT_CAMERA_STREAM_ID): CameraStreamConfig {
  return {
    id,
    label: id === DEFAULT_CAMERA_STREAM_ID ? 'Main' : 'Camera',
    role: 'top',
    enabled: true,
    resolution: '1080p',
    sourceType: prefs.webcamSourceType ?? 'network',
    host: prefs.webcamHost ?? '',
    url: prefs.webcamUrl ?? '',
    mainStreamUrl: prefs.webcamMainStreamUrl ?? '',
    usbDeviceId: prefs.webcamUsbDeviceId ?? '',
    usbDeviceLabel: prefs.webcamUsbDeviceLabel ?? '',
    serverUsbDevice: prefs.webcamServerUsbDevice ?? '',
    streamPreference: prefs.webcamStreamPreference ?? 'sub',
    mainStreamProtocol: prefs.webcamMainStreamProtocol ?? 'rtsp',
    rtspTransport: prefs.webcamRtspTransport ?? 'tcp',
    pathPreset: prefs.webcamPathPreset ?? 'generic',
    username: prefs.webcamUsername ?? '',
    password: prefs.webcamPassword ?? '',
    ptzEnabled: false,
    ptzProvider: defaultPtzProviderForPreset(prefs.webcamPathPreset),
    ptzMoveUrlTemplate: '',
    ptzPresetUrlTemplate: '',
    ptzPresets: [],
    ptzStartPresetId: '',
    webRtcEnabled: false,
    webRtcUrl: '',
    webRtcIceServers: '',
  };
}

export function cameraToLegacyPrefs(camera: CameraStreamConfig) {
  return {
    webcamSourceType: camera.sourceType,
    webcamHost: camera.host,
    webcamUrl: camera.url,
    webcamMainStreamUrl: camera.mainStreamUrl,
    webcamUsbDeviceId: camera.usbDeviceId,
    webcamUsbDeviceLabel: camera.usbDeviceLabel,
    webcamServerUsbDevice: camera.serverUsbDevice,
    webcamStreamPreference: camera.streamPreference,
    webcamMainStreamProtocol: camera.mainStreamProtocol,
    webcamRtspTransport: camera.rtspTransport,
    webcamPathPreset: camera.pathPreset,
    webcamUsername: camera.username,
    webcamPassword: camera.password,
  };
}

export function normalizeCameraStreams(prefs: Partial<DuetPrefs>): CameraStreamConfig[] {
  const legacy = legacyCameraFromPrefs(prefs);
  const streams = Array.isArray(prefs.cameras) && prefs.cameras.length > 0 ? prefs.cameras : [legacy];
  return streams.map((camera, index) => ({
    ...legacyCameraFromPrefs(prefs, camera.id || `camera-${index + 1}`),
    ...camera,
    id: camera.id || `camera-${index + 1}`,
    label: camera.label || (index === 0 ? 'Main' : `Camera ${index + 1}`),
    role: (camera.role || (index === 0 ? 'top' : 'custom')) as CameraStreamRole,
    enabled: camera.enabled !== false,
    resolution: camera.resolution || '1080p',
    ptzEnabled: camera.ptzEnabled === true,
    ptzProvider: camera.ptzProvider || defaultPtzProviderForPreset(camera.pathPreset),
    ptzMoveUrlTemplate: camera.ptzMoveUrlTemplate || '',
    ptzPresetUrlTemplate: camera.ptzPresetUrlTemplate || '',
    ptzPresets: Array.isArray(camera.ptzPresets)
      ? camera.ptzPresets.filter((preset) => preset.id && preset.name && preset.token) as CameraPtzPreset[]
      : [],
    ptzStartPresetId: camera.ptzStartPresetId || '',
    webRtcEnabled: camera.webRtcEnabled === true,
    webRtcUrl: camera.webRtcUrl || '',
    webRtcIceServers: camera.webRtcIceServers || '',
  }));
}

export function normalizeDuetPrefs(prefs: Partial<DuetPrefs>): DuetPrefs {
  const merged = { ...DEFAULT_PREFS, ...prefs };
  const cameras = normalizeCameraStreams(merged);
  const activeCameraId = cameras.some((camera) => camera.id === merged.activeCameraId)
    ? merged.activeCameraId
    : cameras[0]?.id ?? DEFAULT_CAMERA_STREAM_ID;
  const dashboardCameraId = cameras.some((camera) => camera.id === merged.dashboardCameraId)
    ? merged.dashboardCameraId
    : activeCameraId;
  const activeCamera = cameras.find((camera) => camera.id === activeCameraId) ?? cameras[0] ?? legacyCameraFromPrefs(merged);
  return {
    ...merged,
    ...cameraToLegacyPrefs(activeCamera),
    cameras,
    activeCameraId,
    dashboardCameraId,
    cameraDashboard: {
      ...DEFAULT_CAMERA_DASHBOARD_PREFS,
      ...(merged.cameraDashboard ?? {}),
      calibration: {
        ...DEFAULT_CAMERA_DASHBOARD_PREFS.calibration,
        ...(merged.cameraDashboard?.calibration ?? {}),
      },
    },
  };
}

export const DEFAULT_PREFS: DuetPrefs = {
  units: 'metric',
  webcamSourceType: 'network',
  webcamHost: '',
  webcamUrl: '',
  webcamMainStreamUrl: '',
  webcamUsbDeviceId: '',
  webcamUsbDeviceLabel: '',
  webcamServerUsbDevice: '',
  webcamStreamPreference: 'sub',
  webcamMainStreamProtocol: 'rtsp',
  webcamRtspTransport: 'tcp',
  webcamPathPreset: 'generic',
  webcamUsername: '',
  webcamPassword: '',
  cameras: [],
  activeCameraId: DEFAULT_CAMERA_STREAM_ID,
  dashboardCameraId: DEFAULT_CAMERA_STREAM_ID,
  cameraDashboard: DEFAULT_CAMERA_DASHBOARD_PREFS,
  confirmToolChange: true,
  silentPrompts: false,
  autoReconnect: false,
  reconnectInterval: 5000,
  maxRetries: 10,
  toastDurationMs: 5000,
  notificationsSound: true,
  notifMinSeverity: 'info',
  soundAlertOnComplete: true,
  temperatureUnit: 'C',
  dateFormat: 'relative',
  customButtons: [],
  machineConfig: {
    buildVolumeX: 200,
    buildVolumeY: 200,
    buildVolumeZ: 200,
    nozzleDiameter: 0.4,
    extruderCount: 1,
    hasHeatedBed: true,
    hasHeatedChamber: false,
    maxFeedRateX: 300,
    maxFeedRateY: 300,
    maxFeedRateZ: 5,
    maxAccelX: 3000,
    maxAccelY: 3000,
    maxAccelZ: 100,
    kinematics: 'cartesian',
  },
  filamentProfiles: [
    {
      id: 'pla-default',
      name: 'Generic PLA',
      material: 'PLA',
      color: '#00aa88',
      nozzleTemp: 210,
      bedTemp: 60,
      chamberTemp: 0,
      fanSpeedPercent: 100,
      retractionMm: 0.8,
      retractionSpeedMmPerSec: 35,
      flowPercent: 100,
      notes: '',
    },
    {
      id: 'petg-default',
      name: 'Generic PETG',
      material: 'PETG',
      color: '#3388dd',
      nozzleTemp: 235,
      bedTemp: 75,
      chamberTemp: 0,
      fanSpeedPercent: 50,
      retractionMm: 1.2,
      retractionSpeedMmPerSec: 30,
      flowPercent: 100,
      notes: '',
    },
  ],
  defaultFilamentProfileId: 'pla-default',
  safetyLimits: {
    maxNozzleTemp: 280,
    maxBedTemp: 120,
    maxChamberTemp: 60,
    highTempWarnThreshold: 250,
    warnOnHighTemp: true,
    thermalRunawayPrompt: true,
    confirmEmergencyStop: false,
  },
};

// ---------------------------------------------------------------------------
// Printer-store binding
// The store is injected after it constructs itself (to break the circular
// import between printerStore.ts and this module).
// ---------------------------------------------------------------------------

type PrefsBinding = {
  get: () => DuetPrefs;
  set: (prefs: DuetPrefs) => void;
};

let binding: PrefsBinding | null = null;

export function bindDuetPrefs(b: PrefsBinding): void {
  binding = b;
}

// Legacy fallback — used once, at first boot, before the store has migrated
// the old keys into a printer record. Also keeps test environments working
// without spinning the whole store.
function readLegacyPrefs(): DuetPrefs {
  try {
    const raw = localStorage.getItem(LEGACY_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DuetPrefs>;
      return normalizeDuetPrefs(parsed);
    }
    const legacyAuto = localStorage.getItem(LEGACY_AUTO_RECONNECT_KEY);
    if (legacyAuto !== null) {
      return normalizeDuetPrefs({ autoReconnect: legacyAuto === 'true' });
    }
  } catch {
    /* storage unavailable */
  }
  return normalizeDuetPrefs(DEFAULT_PREFS);
}

export function getDuetPrefs(): DuetPrefs {
  if (binding) return normalizeDuetPrefs(binding.get());
  return readLegacyPrefs();
}

export function setDuetPrefs(prefs: DuetPrefs): void {
  const normalized = normalizeDuetPrefs(prefs);
  if (binding) {
    binding.set(normalized);
    return;
  }
  // Pre-bind writes fall through to legacy key so nothing is lost.
  try {
    localStorage.setItem(LEGACY_PREFS_KEY, JSON.stringify(normalized));
  } catch {
    /* storage unavailable */
  }
}

export function updateDuetPrefs(patch: Partial<DuetPrefs>): DuetPrefs {
  const next = normalizeDuetPrefs({ ...getDuetPrefs(), ...patch });
  setDuetPrefs(next);
  return next;
}

// Expose legacy reader for the store's one-time migration.
export function readLegacyDuetPrefs(): DuetPrefs | null {
  try {
    const raw = localStorage.getItem(LEGACY_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DuetPrefs>;
      return normalizeDuetPrefs(parsed);
    }
    const legacyAuto = localStorage.getItem(LEGACY_AUTO_RECONNECT_KEY);
    if (legacyAuto !== null) {
      return normalizeDuetPrefs({ autoReconnect: legacyAuto === 'true' });
    }
  } catch {
    /* storage unavailable */
  }
  return null;
}

export function clearLegacyDuetPrefs(): void {
  try {
    localStorage.removeItem(LEGACY_PREFS_KEY);
    localStorage.removeItem(LEGACY_AUTO_RECONNECT_KEY);
  } catch {
    /* storage unavailable */
  }
}
