export type Units = 'metric' | 'imperial';
export type NotifSeverity = 'info' | 'warning' | 'error';
export type TemperatureUnit = 'C' | 'F';
export type DateFormat = 'relative' | 'absolute';
export type CameraStreamPreference = 'sub' | 'main';
export type CameraSourceType = 'network' | 'browser-usb' | 'server-usb';
export type CameraMainStreamProtocol = 'rtsp' | 'http' | 'hls';
export type CameraRtspTransport = 'tcp' | 'udp';
export type CameraPathPreset = 'generic' | 'amcrest' | 'reolink' | 'tapo' | 'hikvision' | 'onvif';
export type CameraStreamRole = 'top' | 'side' | 'nozzle' | 'custom';
export type CameraDashboardControlSection = 'record' | 'view' | 'settings' | 'library' | 'timeline' | 'health';
export type CameraHdBridgeQuality = 'native' | '1080p' | '720p' | '480p';
export type CameraPtzProvider = 'off' | 'generic-http' | 'amcrest' | 'reolink' | 'tapo' | 'hikvision' | 'onvif';

export interface CameraDashboardPreset {
  id: string;
  name: string;
  showGrid: boolean;
  showCrosshair: boolean;
  flipImage: boolean;
  rotation: number;
  timelapseIntervalSec: number;
  timelapseFps: number;
}

export interface CameraDashboardCalibration {
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraPtzPreset {
  id: string;
  name: string;
  token: string;
  createdAt: number;
}

export interface CameraDashboardPrefs {
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
  activeControlSection: CameraDashboardControlSection;
  editorCollapsed: boolean;
  cameraPresets: CameraDashboardPreset[];
  calibration: CameraDashboardCalibration;
  ptzEnabled: boolean;
  ptzSpeed: number;
  hdBridgeQuality: CameraHdBridgeQuality;
}

export interface CameraStreamConfig {
  id: string;
  label: string;
  role: CameraStreamRole;
  enabled: boolean;
  resolution: string;
  sourceType: CameraSourceType;
  host: string;
  url: string;
  mainStreamUrl: string;
  usbDeviceId: string;
  usbDeviceLabel: string;
  serverUsbDevice: string;
  streamPreference: 'sub' | 'main';
  mainStreamProtocol: CameraMainStreamProtocol;
  rtspTransport: CameraRtspTransport;
  pathPreset: CameraPathPreset;
  username: string;
  password: string;
  ptzEnabled: boolean;
  ptzProvider: CameraPtzProvider;
  ptzMoveUrlTemplate: string;
  ptzPresetUrlTemplate: string;
  ptzPresets: CameraPtzPreset[];
  ptzStartPresetId: string;
  webRtcEnabled: boolean;
  webRtcUrl: string;
  webRtcIceServers: string;
}

export interface CustomButton {
  id: string;
  label: string;
  gcode: string;
}

export type KinematicsType = 'cartesian' | 'corexy' | 'delta' | 'other';

export interface MachineConfig {
  buildVolumeX: number;
  buildVolumeY: number;
  buildVolumeZ: number;
  nozzleDiameter: number;
  extruderCount: number;
  hasHeatedBed: boolean;
  hasHeatedChamber: boolean;
  maxFeedRateX: number;
  maxFeedRateY: number;
  maxFeedRateZ: number;
  maxAccelX: number;
  maxAccelY: number;
  maxAccelZ: number;
  kinematics: KinematicsType;
}

// ---------------------------------------------------------------------------
// Filament profiles (app-side; distinct from the Duet 0:/filaments directory)
// ---------------------------------------------------------------------------
export type FilamentMaterial = 'PLA' | 'PETG' | 'ABS' | 'TPU' | 'PC' | 'Nylon' | 'ASA' | 'Other';

export interface FilamentProfile {
  id: string;
  name: string;
  material: FilamentMaterial;
  color: string;                 // hex (#rrggbb)
  nozzleTemp: number;            // degC
  bedTemp: number;               // degC
  chamberTemp: number;           // degC, 0 = unset
  fanSpeedPercent: number;       // 0-100
  retractionMm: number;
  retractionSpeedMmPerSec: number;
  flowPercent: number;           // 100 = nominal
  notes: string;
}

// ---------------------------------------------------------------------------
// Safety / temperature guard rails. The UI uses these to block or warn
// before pushing dangerous setpoints to the firmware.
// ---------------------------------------------------------------------------
export interface SafetyLimits {
  maxNozzleTemp: number;         // hard cap
  maxBedTemp: number;
  maxChamberTemp: number;
  highTempWarnThreshold: number; // soft warn before sending
  warnOnHighTemp: boolean;
  thermalRunawayPrompt: boolean; // surface a prompt if firmware reports runaway
  confirmEmergencyStop: boolean; // require a confirm on M112 / E-stop
}

export interface DuetPrefs {
  // General
  units: Units;
  webcamSourceType: CameraSourceType;
  webcamHost: string;
  webcamUrl: string;
  webcamMainStreamUrl: string;
  webcamUsbDeviceId: string;
  webcamUsbDeviceLabel: string;
  webcamServerUsbDevice: string;
  webcamStreamPreference: CameraStreamPreference;
  webcamMainStreamProtocol: CameraMainStreamProtocol;
  webcamRtspTransport: CameraRtspTransport;
  webcamPathPreset: CameraPathPreset;
  webcamUsername: string;
  webcamPassword: string;
  cameras: CameraStreamConfig[];
  activeCameraId: string;
  dashboardCameraId: string;
  cameraDashboard: CameraDashboardPrefs;
  // Behaviour
  confirmToolChange: boolean;
  silentPrompts: boolean;
  autoReconnect: boolean;
  reconnectInterval: number;
  maxRetries: number;
  // Notifications
  toastDurationMs: number;
  notificationsSound: boolean;
  notifMinSeverity: NotifSeverity;
  // Sound alerts
  soundAlertOnComplete: boolean;
  // Temperature display
  temperatureUnit: TemperatureUnit;
  // Date display
  dateFormat: DateFormat;
  // Custom dashboard buttons
  customButtons: CustomButton[];
  // Manual machine configuration (used when not connected or for non-auto boards)
  machineConfig: MachineConfig;
  // Filament profiles
  filamentProfiles: FilamentProfile[];
  defaultFilamentProfileId: string;
  // Safety limits
  safetyLimits: SafetyLimits;
}
