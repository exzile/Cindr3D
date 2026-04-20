import { create } from 'zustand';
import { DuetService } from '../services/DuetService';
import {
  getDuetPrefs,
  bindDuetPrefs,
  readLegacyDuetPrefs,
  clearLegacyDuetPrefs,
  DEFAULT_PREFS,
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
  SavedPrinter,
} from '../types/duet';

const MAX_TEMPERATURE_HISTORY = 200;
const MAX_CONSOLE_HISTORY = 500;
// Legacy single-printer key; migrated on first boot into PRINTERS_KEY.
const LEGACY_CONFIG_KEY = 'dzign3d-duet-config';
const PRINTERS_KEY = 'dzign3d-printers';
const ACTIVE_PRINTER_KEY = 'dzign3d-active-printer';

function genPrinterId(): string {
  return `printer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultPrinter(): SavedPrinter {
  return {
    id: genPrinterId(),
    name: 'Printer 1',
    config: { hostname: '', password: '', mode: 'standalone' },
    prefs: { ...DEFAULT_PREFS },
  };
}

// Auto-reconnect state (kept outside the store to avoid re-renders)
let autoReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let autoReconnectAttempts = 0;

export interface PrintHistoryEntry {
  timestamp: string;       // ISO-ish "YYYY-MM-DD HH:MM:SS" from eventlog
  file: string | null;     // extracted filename if the line references one
  kind: 'start' | 'finish' | 'cancel' | 'event';
  message: string;         // raw line after the timestamp
  durationSec?: number;    // parsed from "duration HH:MM:SS" phrases
}

// RepRapFirmware eventlog.txt format is loose, but lines generally look like:
//   YYYY-MM-DD HH:MM:SS <message>
// We extract the leading timestamp, then pattern-match for print lifecycle
// events so the UI can filter or highlight them.
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(.*)$/;
const DURATION_RE = /(\d+):(\d{2}):(\d{2})/;

function extractFilename(msg: string): string | null {
  // Matches `"something.gcode"` or `something.gcode` references
  const quoted = msg.match(/"([^"]+\.(?:gcode|g|gco))"/i);
  if (quoted) return quoted[1];
  const bare = msg.match(/([A-Za-z0-9_./-]+\.(?:gcode|g|gco))/i);
  return bare ? bare[1] : null;
}

function classifyLine(msg: string): PrintHistoryEntry['kind'] {
  const lower = msg.toLowerCase();
  if (lower.includes('finished print') || lower.includes('print complete') || lower.includes('print finished')) {
    return 'finish';
  }
  if (lower.includes('cancel') && lower.includes('print')) {
    return 'cancel';
  }
  if (lower.startsWith('m32 ') || lower.includes('starting print') || lower.includes('started printing')) {
    return 'start';
  }
  return 'event';
}

function parseEventLog(text: string): PrintHistoryEntry[] {
  const out: PrintHistoryEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(TIMESTAMP_RE);
    if (!m) continue;
    const [, timestamp, message] = m;
    const kind = classifyLine(message);
    // Only keep print-related lines; everything else is noise
    if (kind === 'event') continue;
    const file = extractFilename(message);
    let durationSec: number | undefined;
    const d = message.match(DURATION_RE);
    if (d) {
      durationSec = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
    }
    out.push({ timestamp, file, kind, message, durationSec });
  }
  // Newest first
  return out.reverse();
}

interface PrinterStore {
  // Multi-printer registry
  printers: SavedPrinter[];
  activePrinterId: string;

  // Connection — config is a derived view of the active printer's config
  // and is kept in sync by setActivePrinter/setConfig.
  connected: boolean;
  connecting: boolean;
  reconnecting: boolean;
  firmwareUpdatePending: boolean;
  config: DuetConfig;
  service: DuetService | null;

  // Object model (from Duet)
  model: Partial<DuetObjectModel>;

  // Timestamp of last model update (epoch ms) — survives non-user disconnects
  lastModelUpdate: number | null;

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

  // Filaments — names of sub-directories under 0:/filaments
  filaments: string[];

  // Print history — parsed from 0:/sys/eventlog.txt
  printHistory: PrintHistoryEntry[];
  printHistoryLoading: boolean;

  // Height map
  heightMap: DuetHeightMap | null;

  // UI state
  showPrinter: boolean;
  showSettings: boolean;
  activeTab: 'dashboard' | 'status' | 'console' | 'job' | 'history' | 'files' | 'filaments' | 'macros' | 'settings' | 'heightmap' | 'model' | 'config';
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

  // Macros
  refreshMacros: () => Promise<void>;
  navigateMacros: (path: string) => Promise<void>;
  runMacro: (filename: string) => Promise<void>;
  createMacro: (filename: string, contents: string) => Promise<void>;
  deleteMacro: (filename: string) => Promise<void>;

  // Filaments
  refreshFilaments: () => Promise<void>;
  loadFilament: (toolNumber: number, name: string) => Promise<void>;
  unloadFilament: (toolNumber: number) => Promise<void>;
  changeFilament: (toolNumber: number, name: string) => Promise<void>;

  // Firmware
  uploadFirmware: (file: File) => Promise<void>;
  installFirmware: () => Promise<void>;

  // Print history
  refreshPrintHistory: () => Promise<void>;

  // Height map
  loadHeightMap: (path?: string) => Promise<void>;
  probeGrid: () => Promise<void>;

  // Auto-reconnect
  startAutoReconnect: () => void;
  stopAutoReconnect: () => void;

  // UI
  setShowPrinter: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setActiveTab: (tab: PrinterStore['activeTab']) => void;
  setJogDistance: (distance: number) => void;
  setError: (error: string | null) => void;
}

interface LoadedState {
  printers: SavedPrinter[];
  activePrinterId: string;
}

function loadPrinters(): LoadedState {
  // Primary path: migrated multi-printer list.
  try {
    const raw = localStorage.getItem(PRINTERS_KEY);
    if (raw) {
      const printers = JSON.parse(raw) as SavedPrinter[];
      if (Array.isArray(printers) && printers.length > 0) {
        const storedActive = localStorage.getItem(ACTIVE_PRINTER_KEY) ?? '';
        const active = printers.some((p) => p.id === storedActive) ? storedActive : printers[0].id;
        return { printers, activePrinterId: active };
      }
    }
  } catch {
    /* fall through to migration */
  }

  // Migration: older builds saved a single DuetConfig + DuetPrefs under
  // separate keys. Roll them into one printer record so the user keeps
  // their hostname, password, webcam URL, custom buttons, etc.
  let legacyConfig: DuetConfig | null = null;
  try {
    const saved = localStorage.getItem(LEGACY_CONFIG_KEY);
    if (saved) legacyConfig = JSON.parse(saved) as DuetConfig;
  } catch {
    /* ignore */
  }
  const legacyPrefs = readLegacyDuetPrefs();

  if (legacyConfig || legacyPrefs) {
    const first: SavedPrinter = {
      id: genPrinterId(),
      name: 'Printer 1',
      config: legacyConfig ?? { hostname: '', password: '', mode: 'standalone' },
      prefs: legacyPrefs ?? { ...DEFAULT_PREFS },
    };
    savePrintersList([first], first.id);
    try { localStorage.removeItem(LEGACY_CONFIG_KEY); } catch { /* ignore */ }
    clearLegacyDuetPrefs();
    return { printers: [first], activePrinterId: first.id };
  }

  // Fresh install.
  const first = defaultPrinter();
  savePrintersList([first], first.id);
  return { printers: [first], activePrinterId: first.id };
}

function savePrintersList(printers: SavedPrinter[], activeId: string): void {
  try {
    localStorage.setItem(PRINTERS_KEY, JSON.stringify(printers));
    localStorage.setItem(ACTIVE_PRINTER_KEY, activeId);
  } catch {
    /* storage unavailable */
  }
}

function getActivePrinter(printers: SavedPrinter[], id: string): SavedPrinter {
  return printers.find((p) => p.id === id) ?? printers[0];
}

const INITIAL = loadPrinters();

export const usePrinterStore = create<PrinterStore>((set, get) => ({
  // Multi-printer
  printers: INITIAL.printers,
  activePrinterId: INITIAL.activePrinterId,

  // Connection
  connected: false,
  connecting: false,
  reconnecting: false,
  firmwareUpdatePending: false,
  config: getActivePrinter(INITIAL.printers, INITIAL.activePrinterId).config,
  service: null,

  // Object model
  model: {},

  // Last model update timestamp
  lastModelUpdate: null,

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

  // Filaments
  filaments: [],

  // Print history
  printHistory: [],
  printHistoryLoading: false,

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
    const { printers, activePrinterId } = get();
    const updated = printers.map((p) =>
      p.id === activePrinterId ? { ...p, config: { ...p.config, ...partial } } : p,
    );
    const active = getActivePrinter(updated, activePrinterId);
    savePrintersList(updated, activePrinterId);
    set({ printers: updated, config: active.config });
  },

  // --- Multi-printer management ---

  addPrinter: (name) => {
    const { printers } = get();
    const id = genPrinterId();
    const nextName = name && name.trim().length > 0
      ? name.trim()
      : `Printer ${printers.length + 1}`;
    const fresh: SavedPrinter = {
      id,
      name: nextName,
      config: { hostname: '', password: '', mode: 'standalone' },
      prefs: { ...DEFAULT_PREFS },
    };
    const next = [...printers, fresh];
    savePrintersList(next, get().activePrinterId);
    set({ printers: next });
    return id;
  },

  removePrinter: (id) => {
    const state = get();
    if (state.printers.length <= 1) return; // keep at least one
    const next = state.printers.filter((p) => p.id !== id);
    let activeId = state.activePrinterId;
    if (activeId === id) {
      // If removing the active printer, disconnect first then switch.
      if (state.connected || state.service) {
        state.disconnect(true).catch(() => {});
      }
      activeId = next[0].id;
    }
    const active = getActivePrinter(next, activeId);
    savePrintersList(next, activeId);
    set({ printers: next, activePrinterId: activeId, config: active.config });
  },

  renamePrinter: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = get().printers.map((p) => (p.id === id ? { ...p, name: trimmed } : p));
    savePrintersList(next, get().activePrinterId);
    set({ printers: next });
  },

  selectPrinter: async (id) => {
    const state = get();
    if (id === state.activePrinterId) return;
    const target = state.printers.find((p) => p.id === id);
    if (!target) return;
    // Disconnect from current printer before switching so model/files/temps
    // don't bleed across unrelated machines.
    if (state.connected || state.service) {
      try { await state.disconnect(true); } catch { /* ignore */ }
    }
    savePrintersList(state.printers, id);
    set({ activePrinterId: id, config: target.config });
  },

  updatePrinterPrefs: (id, patch) => {
    const next = get().printers.map((p) => {
      if (p.id !== id) return p;
      const cur = (p.prefs as DuetPrefs | undefined) ?? { ...DEFAULT_PREFS };
      return { ...p, prefs: { ...cur, ...patch } };
    });
    savePrintersList(next, get().activePrinterId);
    set({ printers: next });
  },

  connect: async () => {
    const { config, service: existingService, connecting } = get();
    if (!config.hostname) {
      set({ error: 'No hostname configured' });
      return;
    }

    // Re-entrancy guard — second click while a connection is in flight would
    // otherwise spawn a parallel DuetService whose model-update callback keeps
    // firing alongside the first. Drop subsequent calls until the first either
    // resolves or fails.
    if (connecting) return;

    // Clean up existing service if any
    if (existingService) {
      try { await existingService.disconnect(); } catch { /* ignore */ }
    }

    set({ connecting: true, error: null });

    const service = new DuetService(config);

    try {
      const connected = await service.connect();
      if (!connected) {
        throw new Error('Connection refused');
      }

      // Set up disconnection detection for auto-reconnect
      service.on('disconnected', () => {
        // Only trigger if the store still thinks it's connected (i.e., not
        // a user-initiated disconnect which already cleared the state).
        const state = get();
        if (state.connected && state.service === service) {
          get().disconnect(false);
        }
      });

      // Set up model update listener that records temperature samples
      service.onModelUpdate((model: Partial<DuetObjectModel>) => {
        // Drop callbacks from a stale service that was replaced/disconnected
        // mid-flight (e.g. user clicked disconnect before initial fetch landed).
        const currentService = get().service;
        if (currentService !== null && currentService !== service) return;
        const state = get();
        const now = Date.now();

        // Build temperature sample from the model
        const sample: TemperatureSample = {
          timestamp: now,
          heaters: (model.heat?.heaters ?? []).map((heater, index) => ({
            index,
            current: heater.current,
            active: heater.active,
            standby: heater.standby,
          })),
          sensors: (model.sensors?.analog ?? []).map((sensor, index) => ({
            index,
            value: sensor.lastReading,
          })),
        };

        const history = [...state.temperatureHistory, sample];
        if (history.length > MAX_TEMPERATURE_HISTORY) {
          history.splice(0, history.length - MAX_TEMPERATURE_HISTORY);
        }

        set({ model, temperatureHistory: history, lastModelUpdate: now });
      });

      // Load initial file list
      const files = await service.listFiles('0:/gcodes').catch(() => [] as DuetFileInfo[]);
      const macros = await service.listFiles('0:/macros').catch(() => [] as DuetFileInfo[]);
      const filamentEntries = await service.listFiles('0:/filaments').catch(() => [] as DuetFileInfo[]);
      const filaments = filamentEntries.filter((e) => e.type === 'd').map((e) => e.name).sort();

      // If user disconnected while we were awaiting, don't clobber the cleared
      // state with `connected: true` and a service they thought was dropped.
      if (!get().connecting) {
        try { await service.disconnect(); } catch { /* ignore */ }
        return;
      }

      // Persist the active printer's config (hostname/password may have
      // just been edited on the Connection tab).
      savePrintersList(get().printers, get().activePrinterId);

      set({
        connected: true,
        connecting: false,
        firmwareUpdatePending: false,
        service,
        files,
        macros,
        filaments,
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

  /**
   * Disconnect from the printer.
   * @param userInitiated - When true (default), auto-reconnect is stopped.
   *   Pass false when the disconnect is due to a detected connection loss
   *   so that auto-reconnect can kick in.
   */
  disconnect: async (userInitiated = true) => {
    if (userInitiated) {
      get().stopAutoReconnect();
    }

    const { service } = get();
    if (service) {
      try { await service.disconnect(); } catch { /* ignore */ }
    }

    if (userInitiated) {
      // User explicitly disconnected — clear everything
      set({
        connected: false,
        connecting: false,
        reconnecting: false,
        service: null,
        model: {},
        lastModelUpdate: null,
        temperatureHistory: [],
        files: [],
        selectedFile: null,
        macros: [],
        filaments: [],
        heightMap: null,
        error: null,
      });
    } else {
      // Connection lost — preserve model / files for graceful degradation
      set({
        connected: false,
        connecting: false,
        service: null,
        error: 'Connection lost',
      });
    }

    // If the disconnect was not user-initiated, try to auto-reconnect
    if (!userInitiated) {
      get().startAutoReconnect();
    }
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
      timestamp: new Date(),
      type: 'command',
      content: code,
    };

    const updatedHistory = [...consoleHistory, commandEntry];
    set({ consoleHistory: updatedHistory.slice(-MAX_CONSOLE_HISTORY) });

    try {
      const response = await service.sendGCode(code);
      const responseEntry: ConsoleEntry = {
        timestamp: new Date(),
        type: 'response',
        content: response || 'ok',
      };

      const history = [...get().consoleHistory, responseEntry];
      set({ consoleHistory: history.slice(-MAX_CONSOLE_HISTORY) });
    } catch (err) {
      const errorEntry: ConsoleEntry = {
        timestamp: new Date(),
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

  setToolTemp: async (tool, _heater, temp) => {
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

  setGlobalFlowFactor: async (percent) => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode(`M221 D-1 S${percent}`);
    } catch (err) {
      set({ error: `Failed to set global flow factor: ${(err as Error).message}` });
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
        `${currentDirectory}/${file.name}`,
        file,
        (progress) => set({ uploadProgress: progress }),
      );
      set({ uploading: false, uploadProgress: 100 });

      // Refresh file list after upload — but only if the user is still
      // viewing the directory we uploaded into. Otherwise the listing for
      // the OLD directory would clobber the listing of wherever they
      // navigated to during the upload.
      const files = await service.listFiles(currentDirectory);
      if (get().currentDirectory === currentDirectory) set({ files });
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
      // Refresh file list after deletion — bail if user navigated away.
      const files = await service.listFiles(currentDirectory);
      if (get().currentDirectory === currentDirectory) set({ files });
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

  createMacro: async (filename, contents) => {
    const { service, macroPath } = get();
    if (!service) return;
    const name = /\.g$/i.test(filename) ? filename : `${filename}.g`;
    try {
      const blob = new Blob([contents], { type: 'text/plain' });
      await service.uploadFile(`${macroPath}/${name}`, blob);
      const macros = await service.listFiles(macroPath);
      if (get().macroPath === macroPath) set({ macros });
    } catch (err) {
      set({ error: `Failed to create macro: ${(err as Error).message}` });
    }
  },

  deleteMacro: async (filename) => {
    const { service, macroPath } = get();
    if (!service) return;
    try {
      await service.deleteFile(`${macroPath}/${filename}`);
      const macros = await service.listFiles(macroPath);
      if (get().macroPath === macroPath) set({ macros });
    } catch (err) {
      set({ error: `Failed to delete macro: ${(err as Error).message}` });
    }
  },

  // --- Filaments ---

  refreshFilaments: async () => {
    const { service } = get();
    if (!service) return;
    try {
      const entries = await service.listFiles('0:/filaments');
      const names = entries.filter((e) => e.type === 'd').map((e) => e.name).sort();
      set({ filaments: names });
    } catch (err) {
      set({ error: `Failed to list filaments: ${(err as Error).message}` });
    }
  },

  loadFilament: async (toolNumber, name) => {
    const { service } = get();
    if (!service) return;
    try {
      // Select the tool first so M701 targets the correct extruder
      await service.sendGCode(`T${toolNumber}`);
      await service.sendGCode(`M701 S"${name}"`);
    } catch (err) {
      set({ error: `Failed to load filament: ${(err as Error).message}` });
    }
  },

  unloadFilament: async (toolNumber) => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode(`T${toolNumber}`);
      await service.sendGCode('M702');
    } catch (err) {
      set({ error: `Failed to unload filament: ${(err as Error).message}` });
    }
  },

  changeFilament: async (toolNumber, name) => {
    const { service } = get();
    if (!service) return;
    try {
      // Duet's documented filament-change flow is unload + load with the
      // new name. M703 prints the loaded configuration; it doesn't swap.
      await service.sendGCode(`T${toolNumber}`);
      await service.sendGCode('M702');
      await service.sendGCode(`M701 S"${name}"`);
    } catch (err) {
      set({ error: `Failed to change filament: ${(err as Error).message}` });
    }
  },

  // --- Firmware ---

  uploadFirmware: async (file) => {
    const { service } = get();
    if (!service) return;

    set({ uploading: true, uploadProgress: 0, error: null });
    try {
      await service.uploadFile(
        `0:/firmware/${file.name}`,
        file,
        (progress) => set({ uploadProgress: progress }),
      );
      set({ uploading: false, uploadProgress: 100 });
    } catch (err) {
      set({
        uploading: false,
        uploadProgress: 0,
        error: `Firmware upload failed: ${(err as Error).message}`,
      });
      throw err;
    }
  },

  installFirmware: async () => {
    const { service } = get();
    if (!service) return;
    try {
      await service.sendGCode('M997');
      set({ firmwareUpdatePending: true });
    } catch (err) {
      set({ error: `Failed to trigger firmware install: ${(err as Error).message}` });
    }
  },

  // --- Print history ---

  refreshPrintHistory: async () => {
    const { service } = get();
    if (!service) return;
    set({ printHistoryLoading: true });
    try {
      const blob = await service.downloadFile('0:/sys/eventlog.txt');
      const text = await blob.text();
      const entries = parseEventLog(text);
      set({ printHistory: entries, printHistoryLoading: false });
    } catch (err) {
      set({
        printHistory: [],
        printHistoryLoading: false,
        error: `Failed to load print history: ${(err as Error).message}`,
      });
    }
  },

  // --- Height map ---

  loadHeightMap: async (path?: string) => {
    const { service } = get();
    if (!service) return;
    try {
      const heightMap = await service.getHeightMap(path);
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

  // --- Auto-reconnect ---

  startAutoReconnect: () => {
    const prefs = getDuetPrefs();
    if (!prefs.autoReconnect) return;
    if (autoReconnectTimer) return; // already running

    const { config } = get();
    if (!config.hostname) return;

    autoReconnectAttempts = 0;
    set({ reconnecting: true });
    const interval = prefs.reconnectInterval || 5000;
    const maxRetries = prefs.maxRetries || 10;

    const attempt = () => {
      const state = get();
      // Stop if already connected or user cleared hostname
      if (state.connected || !state.config.hostname) {
        autoReconnectTimer = null;
        autoReconnectAttempts = 0;
        set({ reconnecting: false });
        return;
      }

      autoReconnectAttempts++;
      if (autoReconnectAttempts > maxRetries) {
        set({ error: `Auto-reconnect failed after ${maxRetries} attempts`, reconnecting: false });
        autoReconnectTimer = null;
        autoReconnectAttempts = 0;
        return;
      }

      set({ error: `Reconnecting... attempt ${autoReconnectAttempts}/${maxRetries}` });

      state.connect().then(() => {
        if (get().connected) {
          autoReconnectTimer = null;
          autoReconnectAttempts = 0;
          set({ error: null, reconnecting: false });
        } else {
          // Schedule next attempt
          autoReconnectTimer = setTimeout(attempt, interval);
        }
      }).catch(() => {
        autoReconnectTimer = setTimeout(attempt, interval);
      });
    };

    // Start with a delay
    autoReconnectTimer = setTimeout(attempt, interval);
  },

  stopAutoReconnect: () => {
    if (autoReconnectTimer) {
      clearTimeout(autoReconnectTimer);
      autoReconnectTimer = null;
    }
    autoReconnectAttempts = 0;
    set({ reconnecting: false });
  },

  // --- UI ---

  setShowPrinter: (show) => set({ showPrinter: show }),
  setShowSettings: (show) => set({ showSettings: show }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setJogDistance: (distance) => set({ jogDistance: distance }),
  setError: (error) => set({ error }),
}));

// Bind the duetPrefs utility to the active printer's prefs so all existing
// getDuetPrefs()/setDuetPrefs() call sites keep working — they just read and
// write through the active printer now.
bindDuetPrefs({
  get: (): DuetPrefs => {
    const state = usePrinterStore.getState();
    const active = getActivePrinter(state.printers, state.activePrinterId);
    const p = active.prefs as DuetPrefs | undefined;
    return p ? { ...DEFAULT_PREFS, ...p } : { ...DEFAULT_PREFS };
  },
  set: (prefs: DuetPrefs): void => {
    const state = usePrinterStore.getState();
    state.updatePrinterPrefs(state.activePrinterId, prefs);
  },
});

// Auto-reconnect from the active printer's saved config on load.
{
  const initial = usePrinterStore.getState();
  if (initial.config.hostname) {
    initial.connect().catch(() => {});
  }
}
