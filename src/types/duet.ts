// Duet3D Object Model types
// Reference: https://github.com/Duet3D/RepRapFirmware/wiki/Object-Model-Documentation

// Connection modes
export type DuetMode = 'standalone' | 'sbc';

// Machine state
export type MachineStatus =
  | 'disconnected'
  | 'starting'
  | 'updating'
  | 'off'
  | 'halted'
  | 'pausing'
  | 'paused'
  | 'resuming'
  | 'cancelling'
  | 'processing'
  | 'simulating'
  | 'busy'
  | 'changingTool'
  | 'idle';

// Axis definition
export interface DuetAxis {
  letter: string;
  drives: number[];
  homed: boolean;
  machinePosition: number;
  userPosition: number;
  min: number;
  max: number;
  speed: number;
  acceleration: number;
  jerk: number;
  visible: boolean;
  minEndstop?: number;
  maxEndstop?: number;
}

// Extruder
export interface DuetExtruder {
  driver: string;
  factor: number;
  position: number;
  pressure: number;
  rawPosition: number;
  speed: number;
  acceleration: number;
  jerk: number;
  filament: string;
  nonlinear?: { a: number; b: number; upperLimit: number };
}

// Heater
export interface DuetHeater {
  active: number;
  standby: number;
  current: number;
  state: 'off' | 'standby' | 'active' | 'fault' | 'tuning';
  min: number;
  max: number;
  avgPwm: number;
  sensor: number;
  model?: {
    enabled: boolean;
    pid: { p: number; i: number; d: number; used: boolean };
  };
}

// Tool
export interface DuetTool {
  number: number;
  name: string;
  heaters: number[];
  extruders: number[];
  fans: number[];
  active: number[];
  standby: number[];
  offsets: number[];
  state: 'off' | 'standby' | 'active';
  filamentExtruder: number;
  mix: number[];
}

// Fan
export interface DuetFan {
  actualValue: number;
  requestedValue: number;
  rpm: number;
  name: string;
  min: number;
  max: number;
  blip: number;
  thermostatic?: {
    control: boolean;
    heaters: number[];
    temperature: number;
  };
}

// Sensor (temperature, endstop, probe)
export interface DuetSensor {
  name: string;
  type: string;
  lastReading: number;
}

// Z Probe
export interface DuetProbe {
  type: number;
  value: number;
  threshold: number;
  speed: number;
  diveHeight: number;
  offsets: number[];
  triggerHeight: number;
  deployedByUser: boolean;
}

// Board info
export interface DuetBoard {
  firmwareName: string;
  firmwareVersion: string;
  firmwareDate: string;
  iapFileNameSBC?: string;
  iapFileNameSD?: string;
  maxHeaters: number;
  maxMotors: number;
  mcuTemp?: { current: number; min: number; max: number };
  name: string;
  shortName: string;
  vIn?: { current: number; min: number; max: number };
  v12?: { current: number; min: number; max: number };
}

// Network info
export interface DuetNetwork {
  name: string;
  hostname: string;
  interfaces: Array<{
    type: string;
    actualIP: string;
    subnet: string;
    gateway: string;
    firmwareVersion: string;
    mac: string;
    speed: number;
    state: string;
    activeProtocols: string[];
  }>;
}

// Job info
export interface DuetJob {
  build?: {
    currentObject: number;
    objects: Array<{
      name: string;
      cancelled: boolean;
      x: number[];
      y: number[];
    }>;
  };
  duration: number;
  file: DuetJobFile;
  filePosition: number;
  lastDuration: number;
  lastFileName: string;
  layer: number;
  layers: Array<{
    duration: number;
    height: number;
    filament: number[];
    fractionPrinted: number;
  }>;
  layerTime: number;
  timesLeft: {
    filament: number;
    file: number;
    slicer: number;
    layer: number;
  };
  warmUpDuration: number;
}

export interface DuetJobFile {
  fileName: string;
  size: number;
  height: number;
  firstLayerHeight: number;
  layerHeight: number;
  numLayers: number;
  filament: number[];
  generatedBy: string;
  printTime: number;
  simulatedTime: number;
  thumbnails?: Array<{
    width: number;
    height: number;
    format: string;
    offset: number;
    size: number;
  }>;
}

// Move system
export interface DuetMove {
  axes: DuetAxis[];
  extruders: DuetExtruder[];
  kinematics: { name: string };
  currentMove?: { requestedSpeed: number; topSpeed: number };
  speedFactor: number;
  compensation?: { type: string };
  idle?: { timeout: number; factor: number };
}

// Heat system
export interface DuetHeat {
  bedHeaters: number[];
  chamberHeaters: number[];
  heaters: DuetHeater[];
}

// State
export interface DuetState {
  status: MachineStatus;
  currentTool: number;
  displayMessage: string;
  atxPower: boolean;
  atxPowerPort: number | null;
  beep?: { duration: number; frequency: number };
  upTime: number;
  machineMode: string;
  logFile: string | null;
  messageBox?: {
    mode: number;
    title: string;
    message: string;
    axisControls: number;
    seq: number;
  };
}

// Full Object Model
export interface DuetObjectModel {
  boards: DuetBoard[];
  fans: DuetFan[];
  heat: DuetHeat;
  job: DuetJob;
  move: DuetMove;
  network: DuetNetwork;
  sensors: {
    analog: DuetSensor[];
    endstops: Array<{ triggered: boolean; type: string }>;
    probes: DuetProbe[];
  };
  state: DuetState;
  tools: DuetTool[];
  directories: {
    filaments: string;
    firmware: string;
    gCodes: string;
    macros: string;
    menu: string;
    system: string;
    web: string;
  };
  limits: {
    axes: number;
    axesPlusExtruders: number;
    bedHeaters: number;
    boards: number;
    chamberHeaters: number;
    drivers: number;
    driversPerAxis: number;
    extruders: number;
    extrudersPerTool: number;
    fans: number;
    gpInPorts: number;
    gpOutPorts: number;
    heaters: number;
    heatersPerTool: number;
    monitorsPerHeater: number;
    restorePoints: number;
    sensors: number;
    spindles: number;
    tools: number;
    trackedObjects: number;
    triggers: number;
    volumes: number;
    workplaces: number;
    zProbes: number;
    zProbePrograms: number;
  };
  global: Record<string, unknown>;
  volumes: Array<{
    freeSpace: number;
    totalSpace: number;
    mounted: boolean;
    name: string;
    path: string;
    speed: number;
  }>;
}

// File listing types
export interface DuetFileInfo {
  type: 'd' | 'f';
  name: string;
  size: number;
  date: string;
}

export interface DuetGCodeFileInfo {
  fileName: string;
  size: number;
  height: number;
  firstLayerHeight: number;
  layerHeight: number;
  numLayers: number;
  filament: number[];
  generatedBy: string;
  printTime: number;
  simulatedTime: number;
  lastModified: string;
  thumbnails?: Array<{
    width: number;
    height: number;
    format: string;
    offset: number;
    size: number;
  }>;
}

// Height map
export interface DuetHeightMap {
  xMin: number;
  xMax: number;
  xSpacing: number;
  yMin: number;
  yMax: number;
  ySpacing: number;
  radius: number;
  numX: number;
  numY: number;
  points: number[][];
}

// Temperature sample for charting
export interface TemperatureSample {
  timestamp: number;
  heaters: { index: number; current: number; active: number; standby: number }[];
  sensors: { index: number; value: number }[];
}

// Console entry
export interface ConsoleEntry {
  timestamp: Date;
  type: 'command' | 'response' | 'warning' | 'error';
  content: string;
}

// Duet connection config
export interface DuetConfig {
  hostname: string;
  password: string;
  mode: DuetMode;
}
