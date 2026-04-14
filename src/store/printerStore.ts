import { create } from 'zustand';
import { DuetService } from '../services/DuetService';
import type {
  DuetConfig,
  DuetObjectModel,
  TemperatureSample,
  ConsoleEntry,
  DuetFileInfo,
  DuetGCodeFileInfo,
  DuetHeightMap,
} from '../types/duet';

const MAX_TEMPERATURE_HISTORY = 200;
const MAX_CONSOLE_HISTORY = 500;
const STORAGE_KEY = 'dzign3d-duet-config';

interface PrinterStore {
  // Connection
  connected: boolean;
  connecting: boolean;
  config: DuetConfig;
  service: DuetService | null;

  // Object model (from Duet)
  model: Partial<DuetObjectModel>;

  // Temperature history for charts
  temperatureHistory: TemperatureSample[];

  // Console
  consoleHistory: ConsoleEntry[];

  // File browser
  currentDirectory: string;
  files: DuetFileInfo[];
  selectedFile: DuetGCodeFileInfo | null;
  uploading: boolean;
  uploadProgress: number;

  // Macros
  macros: DuetFileInfo[];
  macroPath: string;

  // Height map
  heightMap: DuetHeightMap | null;

  // UI state
  showPrinter: boolean;
  showSettings: boolean;
  activeTab: 'dashboard' | 'console' | 'job' | 'files' | 'macros' | 'settings' | 'heightmap';
  error: string | null;
  jogDistance: number;
  extrudeAmount: number;
  extrudeFeedrate: number;

  // Actions
  setConfig: (config: Partial<DuetConfig>) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
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

  // Macros
  refreshMacros: () => Promise<void>;
  navigateMacros: (path: string) => Promise<void>;
  runMacro: (filename: string) => Promise<void>;

  // Height map
  loadHeightMap: () => Promise<void>;
  probeGrid: () => Promise<void>;

  // UI
  setShowPrinter: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setActiveTab: (tab: PrinterStore['activeTab']) => void;
  setJogDistance: (distance: number) => void;
  setError: (error: string | null) => void;
}

function loadSavedConfig(): DuetConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Invalid saved config, use defaults
  }
  return { hostname: '', password: '' };
}

function saveConfig(config: DuetConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage unavailable
  }
}

export const usePrinterStore = create<PrinterStore>((set, get) => ({
  // Connection
  connected: false,
  connecting: false,
  config: loadSavedConfig(),
  service: null,

  // Object model
  model: {},

  // Temperature history
  temperatureHistory: [],

  // Console
  consoleHistory: [],

  // File browser
  currentDirectory: '0:/gcodes',
  files: [],
  selectedFile: null,
  uploading: false,
  uploadProgress: 0,

  // Macros
  macros: [],
  macroPath: '0:/macros',

  // Height map
  heightMap: null,

  // UI state
  showPrinter: false,
  showSettings: false,
  activeTab: 'dashboard',
  error: null,
  jogDistance: 10,
  extrudeAmount: 50,
  extrudeFeedrate: 300,

  // --- Actions ---

  setConfig: (partial) => {
    const current = get().config;
    const updated = { ...current, ...partial };
    saveConfig(updated);
    set({ config: updated });
  },

  connect: async () => {
    const { config, service: existingService } = get();
    if (!config.hostname) {
      set({ error: 'No hostname configured' });
      return;
    }

    // Clean up existing service if any
    if (existingService) {
      try { await existingService.disconnect(); } catch { /* ignore */ }
    }

    set({ connecting: true, error: null });

    const service = new DuetService(config);

    try {
      await service.connect();

      // Set up model update listener that records temperature samples
      service.onModelUpdate((model: Partial<DuetObjectModel>) => {
        const state = get();
        const now = Date.now();

        // Build temperature sample from the model
        const sample: TemperatureSample = {
          timestamp: now,
          bed: model.heat?.heaters?.[0]
            ? { current: model.heat.heaters[0].current, target: model.heat.heaters[0].active }
            : undefined,
          tools: model.heat?.heaters?.slice(1).map((h) => ({
            current: h.current,
            target: h.active,
          })) ?? [],
          chamber: model.heat?.heaters?.find((_, i) => {
            // Chamber heater is identified by the boards config; fallback: skip
            return model.heat?.bedHeaters !== undefined ? false : i > 0;
          })
            ? undefined
            : undefined,
        };

        const history = [...state.temperatureHistory, sample];
        if (history.length > MAX_TEMPERATURE_HISTORY) {
          history.splice(0, history.length - MAX_TEMPERATURE_HISTORY);
        }

        set({ model, temperatureHistory: history });
      });

      // Load initial file list
      const files = await service.listFiles('0:/gcodes').catch(() => [] as DuetFileInfo[]);
      const macros = await service.listFiles('0:/macros').catch(() => [] as DuetFileInfo[]);

      saveConfig(config);

      set({
        connected: true,
        connecting: false,
        service,
        files,
        macros,
        showPrinter: true,
        error: null,
      });
    } catch (err) {
      set({
        connecting: false,
        error: `Connection failed: ${(err as Error).message}`,
      });
    }
  },

  disconnect: async () => {
    const { service } = get();
    if (service) {
      try { await service.disconnect(); } catch { /* ignore */ }
    }

    set({
      connected: false,
      connecting: false,
      service: null,
      model: {},
      temperatureHistory: [],
      files: [],
      selectedFile: null,
      macros: [],
      heightMap: null,
      error: null,
    });
  },

  testConnection: async () => {
    const { config } = get();
    if (!config.hostname) {
      return { success: false, error: 'No hostname configured' };
    }

    const testService = new DuetService(config);
    try {
      const result = await testService.testConnection();
      await testService.disconnect().catch(() => {});
      return result;
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  // --- G-code ---

  sendGCode: async (code) => {
    const { service, consoleHistory } = get();
    if (!service) return;

    const commandEntry: ConsoleEntry = {
      timestamp: Date.now(),
      type: 'command',
      content: code,
    };

    const updatedHistory = [...consoleHistory, commandEntry];
    set({ consoleHistory: updatedHistory.slice(-MAX_CONSOLE_HISTORY) });

    try {
      const response = await service.sendGCode(code);
      const responseEntry: ConsoleEntry = {
        timestamp: Date.now(),
        type: 'response',
        content: response || 'ok',
      };

      const history = [...get().consoleHistory, responseEntry];
      set({ consoleHistory: history.slice(-MAX_CONSOLE_HISTORY) });
    } catch (err) {
      const errorEntry: ConsoleEntry = {
        timestamp: Date.now(),
        type: 'error',
        content: (err as Error).message,
      };

      const history = [...get().consoleHistory, errorEntry];
      set({
        consoleHistory: history.slice(-MAX_CONSOLE_HISTORY),
        error: `G-code error: ${(err as Error).message}`,
      });
    }
  },

  // --- Temperature ---

  setToolTemp: async (tool, heater, temp) => {
    const { service } = get();
    if (!service) return;
    try {
      // G10 P<tool> R<standby> S<active> — set active temp for the tool heater
      await service.sendGCode(`G10 P${tool} S${temp}`);
    } catch (err) {
      set({ error: `Failed to set tool temp: ${(err as Error).message}` });
    }
  },

  setBedTemp: async (temp) => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode(`M140 S${temp}`);
    } catch (err) {
      set({ error: `Failed to set bed temp: ${(err as Error).message}` });
    }
  },

  setChamberTemp: async (temp) => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode(`M141 S${temp}`);
    } catch (err) {
      set({ error: `Failed to set chamber temp: ${(err as Error).message}` });
    }
  },

  // --- Movement ---

  homeAxes: async (axes) => {
    const { service } = get();
    if (!service) return;
    try {
      if (!axes || axes.length === 0) {
        await service.sendGCode('G28');
      } else {
        await service.sendGCode(`G28 ${axes.join(' ')}`);
      }
    } catch (err) {
      set({ error: `Failed to home axes: ${(err as Error).message}` });
    }
  },

  moveAxis: async (axis, distance) => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode('G91'); // Relative positioning
      await service.sendGCode(`G1 ${axis.toUpperCase()}${distance} F6000`);
      await service.sendGCode('G90'); // Back to absolute
    } catch (err) {
      set({ error: `Failed to move axis: ${(err as Error).message}` });
    }
  },

  extrude: async (amount, feedrate) => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode('M83'); // Relative extrusion
      await service.sendGCode(`G1 E${amount} F${feedrate}`);
    } catch (err) {
      set({ error: `Failed to extrude: ${(err as Error).message}` });
    }
  },

  setBabyStep: async (offset) => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode(`M290 S${offset}`);
    } catch (err) {
      set({ error: `Failed to set baby step: ${(err as Error).message}` });
    }
  },

  // --- Speed/extrusion overrides ---

  setSpeedFactor: async (percent) => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode(`M220 S${percent}`);
    } catch (err) {
      set({ error: `Failed to set speed factor: ${(err as Error).message}` });
    }
  },

  setExtrusionFactor: async (extruder, percent) => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode(`M221 D${extruder} S${percent}`);
    } catch (err) {
      set({ error: `Failed to set extrusion factor: ${(err as Error).message}` });
    }
  },

  // --- Fan ---

  setFanSpeed: async (fan, speed) => {
    const { service } = get();
    if (!service) return;
    try {
      // Speed is 0-1 for Duet, but accept 0-100 for UX
      const duetSpeed = speed > 1 ? speed / 100 : speed;
      await service.sendGCode(`M106 P${fan} S${duetSpeed}`);
    } catch (err) {
      set({ error: `Failed to set fan speed: ${(err as Error).message}` });
    }
  },

  // --- Print control ---

  startPrint: async (filename) => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode(`M32 "${filename}"`);
    } catch (err) {
      set({ error: `Failed to start print: ${(err as Error).message}` });
    }
  },

  pausePrint: async () => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode('M25');
    } catch (err) {
      set({ error: `Failed to pause print: ${(err as Error).message}` });
    }
  },

  resumePrint: async () => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode('M24');
    } catch (err) {
      set({ error: `Failed to resume print: ${(err as Error).message}` });
    }
  },

  cancelPrint: async () => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode('M0');
    } catch (err) {
      set({ error: `Failed to cancel print: ${(err as Error).message}` });
    }
  },

  cancelObject: async (index) => {
    const { service } = get();
    if (!service) return;
    try {
      await service.cancelObject(index);
    } catch (err) {
      set({ error: `Failed to cancel object: ${(err as Error).message}` });
    }
  },

  emergencyStop: async () => {
    const { service } = get();
    if (!service) return;
    try {
      await service.emergencyStop();
    } catch (err) {
      set({ error: `Emergency stop failed: ${(err as Error).message}` });
    }
  },

  // --- Files ---

  navigateToDirectory: async (dir) => {
    const { service } = get();
    if (!service) return;
    try {
      const files = await service.listFiles(dir);
      set({ currentDirectory: dir, files, selectedFile: null });
    } catch (err) {
      set({ error: `Failed to navigate to ${dir}: ${(err as Error).message}` });
    }
  },

  refreshFiles: async () => {
    const { service, currentDirectory } = get();
    if (!service) return;
    try {
      const files = await service.listFiles(currentDirectory);
      set({ files });
    } catch (err) {
      set({ error: `Failed to refresh files: ${(err as Error).message}` });
    }
  },

  uploadFile: async (file) => {
    const { service, currentDirectory } = get();
    if (!service) return;

    set({ uploading: true, uploadProgress: 0 });
    try {
      await service.uploadFile(
        file,
        `${currentDirectory}/${file.name}`,
        (progress) => set({ uploadProgress: progress }),
      );
      set({ uploading: false, uploadProgress: 100 });

      // Refresh file list after upload
      const files = await service.listFiles(currentDirectory);
      set({ files });
    } catch (err) {
      set({
        uploading: false,
        uploadProgress: 0,
        error: `Upload failed: ${(err as Error).message}`,
      });
    }
  },

  deleteFile: async (path) => {
    const { service, currentDirectory } = get();
    if (!service) return;
    try {
      await service.deleteFile(path);
      // Refresh file list after deletion
      const files = await service.listFiles(currentDirectory);
      set({ files });
    } catch (err) {
      set({ error: `Failed to delete file: ${(err as Error).message}` });
    }
  },

  selectFile: async (path) => {
    const { service } = get();
    if (!service) return;
    try {
      const fileInfo = await service.getFileInfo(path);
      set({ selectedFile: fileInfo });
    } catch (err) {
      set({ error: `Failed to get file info: ${(err as Error).message}` });
    }
  },

  // --- Macros ---

  refreshMacros: async () => {
    const { service, macroPath } = get();
    if (!service) return;
    try {
      const macros = await service.listFiles(macroPath);
      set({ macros });
    } catch (err) {
      set({ error: `Failed to refresh macros: ${(err as Error).message}` });
    }
  },

  navigateMacros: async (path) => {
    const { service } = get();
    if (!service) return;
    try {
      const macros = await service.listFiles(path);
      set({ macroPath: path, macros });
    } catch (err) {
      set({ error: `Failed to navigate macros: ${(err as Error).message}` });
    }
  },

  runMacro: async (filename) => {
    const { service, macroPath } = get();
    if (!service) return;
    try {
      await service.sendGCode(`M98 P"${macroPath}/${filename}"`);
    } catch (err) {
      set({ error: `Failed to run macro: ${(err as Error).message}` });
    }
  },

  // --- Height map ---

  loadHeightMap: async () => {
    const { service } = get();
    if (!service) return;
    try {
      const heightMap = await service.getHeightMap();
      set({ heightMap });
    } catch (err) {
      set({ error: `Failed to load height map: ${(err as Error).message}` });
    }
  },

  probeGrid: async () => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode('G29');
      // Reload height map after probing completes
      const heightMap = await service.getHeightMap();
      set({ heightMap });
    } catch (err) {
      set({ error: `Failed to probe grid: ${(err as Error).message}` });
    }
  },

  // --- UI ---

  setShowPrinter: (show) => set({ showPrinter: show }),
  setShowSettings: (show) => set({ showSettings: show }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setJogDistance: (distance) => set({ jogDistance: distance }),
  setError: (error) => set({ error }),
}));

// Auto-reconnect from saved config on load
const savedConfig = loadSavedConfig();
if (savedConfig.hostname) {
  usePrinterStore.getState().connect().catch(() => {});
}
