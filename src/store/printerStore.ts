import { create } from 'zustand';
import { DuetService } from '../services/DuetService';
import {
  type DuetPrefs,
} from '../utils/duetPrefs';
import type {
  DuetConfig,
  DuetObjectModel,
  TemperatureSample,
  ConsoleEntry,
  DuetFileInfo,
  DuetGCodeFileInfo,
  DuetHeightMap,
  DuetPluginInfo,
  SavedPrinter,
} from '../types/duet';
import type { PrintHistoryEntry } from '../types/printer.types';
import { createRegistryActions } from './printer/actions/registry';
import { createUiActions } from './printer/actions/ui';
import { createLifecycleActions } from './printer/actions/lifecycle';
import { createControlActions } from './printer/actions/controls';
import { createFileActions } from './printer/actions/files';
import { bindActivePrinterPrefs, connectInitialPrinter } from './printer/prefsBinding';
import { getActivePrinter, loadPrinters } from './printer/persistence';


export type { PrintHistoryEntry } from '../types/printer.types';

export interface PrinterStore {
  printers: SavedPrinter[];
  activePrinterId: string;

  // Connection — config is a derived view of the active printer's config
  connected: boolean;
  connecting: boolean;
  reconnecting: boolean;
  firmwareUpdatePending: boolean;
  config: DuetConfig;
  service: DuetService | null;

  model: Partial<DuetObjectModel>;

  // Timestamp of last model update (epoch ms) — survives non-user disconnects
  lastModelUpdate: number | null;

  temperatureHistory: TemperatureSample[];

  consoleHistory: ConsoleEntry[];

  currentDirectory: string;
  files: DuetFileInfo[];
  selectedFile: DuetGCodeFileInfo | null;
  uploading: boolean;
  uploadProgress: number;

  macros: DuetFileInfo[];
  macroPath: string;

  // Filaments — names of sub-directories under 0:/filaments
  filaments: string[];

  // Print history — parsed from 0:/sys/eventlog.txt
  printHistory: PrintHistoryEntry[];
  printHistoryLoading: boolean;

  heightMap: DuetHeightMap | null;

  showPrinter: boolean;
  showSettings: boolean;
  activeTab: 'printers' | 'dashboard' | 'camera' | 'all-cameras' | 'layer-gallery' | 'status' | 'console' | 'job' | 'history' | 'files' | 'queue' | 'comparison' | 'filaments' | 'macros' | 'settings' | 'heightmap' | 'model' | 'config' | 'analytics' | 'network' | 'plugins' | 'exclude-object' | 'updates' | 'power' | 'input-shaper' | 'pressure-advance' | 'spool-manager' | 'timelapse';

  // Plugins (DSF) — list + install/start/stop
  plugins: DuetPluginInfo[];
  pluginsLoading: boolean;
  error: string | null;
  jogDistance: number;
  extrudeAmount: number;
  extrudeFeedrate: number;

  // Multi-printer actions
  addPrinter: (name?: string) => string; // returns new id
  removePrinter: (id: string) => void;
  renamePrinter: (id: string, name: string) => void;
  selectPrinter: (id: string) => Promise<void>;
  updatePrinterPrefs: (id: string, patch: Partial<DuetPrefs>) => void;

  // Actions
  setConfig: (config: Partial<DuetConfig>) => void;
  connect: () => Promise<void>;
  disconnect: (userInitiated?: boolean) => Promise<void>;
  testConnection: () => Promise<{ success: boolean; firmwareVersion?: string; error?: string }>;

  // G-code
  sendGCode: (code: string) => Promise<void>;

  // Temperature
  setToolTemp: (tool: number, heater: number, temp: number) => Promise<void>;
  setBedTemp: (temp: number) => Promise<void>;
  setChamberTemp: (temp: number) => Promise<void>;

  // Movement
  homeAxes: (axes?: string[]) => Promise<void>;
  moveAxis: (axis: string, distance: number) => Promise<void>;
  extrude: (amount: number, feedrate: number) => Promise<void>;
  setBabyStep: (offset: number) => Promise<void>;

  // Speed/extrusion overrides
  setSpeedFactor: (percent: number) => Promise<void>;
  setExtrusionFactor: (extruder: number, percent: number) => Promise<void>;
  setGlobalFlowFactor: (percent: number) => Promise<void>;

  // Fan
  setFanSpeed: (fan: number, speed: number) => Promise<void>;

  // Print control
  startPrint: (filename: string) => Promise<void>;
  pausePrint: () => Promise<void>;
  resumePrint: () => Promise<void>;
  cancelPrint: () => Promise<void>;
  cancelObject: (index: number) => Promise<void>;
  emergencyStop: () => Promise<void>;

  // Files
  navigateToDirectory: (dir: string) => Promise<void>;
  refreshFiles: () => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  selectFile: (path: string) => Promise<void>;

  refreshMacros: () => Promise<void>;
  navigateMacros: (path: string) => Promise<void>;
  runMacro: (filename: string) => Promise<void>;
  createMacro: (filename: string, contents: string) => Promise<void>;
  deleteMacro: (filename: string) => Promise<void>;

  refreshFilaments: () => Promise<void>;
  loadFilament: (toolNumber: number, name: string) => Promise<void>;
  unloadFilament: (toolNumber: number) => Promise<void>;
  changeFilament: (toolNumber: number, name: string) => Promise<void>;

  // Firmware
  uploadFirmware: (file: File) => Promise<void>;
  installFirmware: () => Promise<void>;

  refreshPrintHistory: () => Promise<void>;

  refreshPlugins: () => Promise<void>;
  installPlugin: (file: File) => Promise<void>;
  startPlugin: (id: string) => Promise<void>;
  stopPlugin: (id: string) => Promise<void>;
  uninstallPlugin: (id: string) => Promise<void>;

  loadHeightMap: (path?: string) => Promise<void>;
  probeGrid: () => Promise<void>;

  startAutoReconnect: () => void;
  stopAutoReconnect: () => void;

  setShowPrinter: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setActiveTab: (tab: PrinterStore['activeTab']) => void;
  setJogDistance: (distance: number) => void;
  setError: (error: string | null) => void;
}

const INITIAL = loadPrinters();
const INITIAL_ACTIVE_PRINTER = getActivePrinter(INITIAL.printers, INITIAL.activePrinterId);

export const usePrinterStore = create<PrinterStore>((set, get) => ({
  printers: INITIAL.printers,
  activePrinterId: INITIAL.activePrinterId,

  connected: false,
  connecting: false,
  reconnecting: Boolean(INITIAL_ACTIVE_PRINTER.config.hostname),
  firmwareUpdatePending: false,
  config: INITIAL_ACTIVE_PRINTER.config,
  service: null,

  model: {},

  lastModelUpdate: null,

  temperatureHistory: [],

  consoleHistory: [],

  currentDirectory: '0:/gcodes',
  files: [],
  selectedFile: null,
  uploading: false,
  uploadProgress: 0,

  macros: [],
  macroPath: '0:/macros',

  filaments: [],

  printHistory: [],
  printHistoryLoading: false,

  heightMap: null,

  plugins: [],
  pluginsLoading: false,

  showPrinter: false,
  showSettings: false,
  activeTab: 'printers',
  error: null,
  jogDistance: 10,
  extrudeAmount: 50,
  extrudeFeedrate: 300,

  ...createRegistryActions({ set, get }),
  ...createLifecycleActions({ set, get }),
  ...createControlActions({ set, get }),
  ...createFileActions({ set, get }),
  ...createUiActions({ set, get }),
}));


bindActivePrinterPrefs(usePrinterStore);
connectInitialPrinter(usePrinterStore);
