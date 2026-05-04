import type { DuetConfig, SavedPrinter } from '../../types/duet';
import {
  clearLegacyDuetPrefs,
  DEFAULT_PREFS,
  readLegacyDuetPrefs,
} from '../../utils/duetPrefs';
import type { PrintHistoryEntry } from '../../types/printer.types';
import type { LoadedPrinterState } from '../../types/printer-persistence.types';

export type { LoadedPrinterState } from '../../types/printer-persistence.types';

const LEGACY_CONFIG_KEY = 'cindr3d-duet-config';
const PRINTERS_KEY = 'cindr3d-printers';
const ACTIVE_PRINTER_KEY = 'cindr3d-active-printer';
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(.*)$/;
const DURATION_RE = /(\d+):(\d{2}):(\d{2})/;

export function genPrinterId(): string {
  return `printer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultPrinter(): SavedPrinter {
  return {
    id: genPrinterId(),
    name: 'Printer 1',
    config: {
      hostname: '',
      password: '',
      mode: 'standalone',
      transport: 'network',
      serialBaudRate: 115200,
    },
    prefs: { ...DEFAULT_PREFS },
  };
}

export function savePrintersList(printers: SavedPrinter[], activeId: string): void {
  try {
    localStorage.setItem(PRINTERS_KEY, JSON.stringify(printers));
    localStorage.setItem(ACTIVE_PRINTER_KEY, activeId);
  } catch {
    // Storage unavailable.
  }
}

export function getActivePrinter(printers: SavedPrinter[], id: string): SavedPrinter {
  return printers.find((printer) => printer.id === id) ?? printers[0];
}

export function loadPrinters(): LoadedPrinterState {
  try {
    const raw = localStorage.getItem(PRINTERS_KEY);
    if (raw) {
      const printers = JSON.parse(raw) as SavedPrinter[];
      if (Array.isArray(printers) && printers.length > 0) {
        const storedActive = localStorage.getItem(ACTIVE_PRINTER_KEY) ?? '';
        const activePrinterId = printers.some((printer) => printer.id === storedActive)
          ? storedActive
          : printers[0].id;
        return { printers, activePrinterId };
      }
    }
  } catch {
    // Fall through to migration or fresh install.
  }

  let legacyConfig: DuetConfig | null = null;
  try {
    const saved = localStorage.getItem(LEGACY_CONFIG_KEY);
    if (saved) legacyConfig = JSON.parse(saved) as DuetConfig;
  } catch {
    // Ignore malformed legacy config.
  }

  const legacyPrefs = readLegacyDuetPrefs();
  if (legacyConfig || legacyPrefs) {
    const printer: SavedPrinter = {
      id: genPrinterId(),
      name: 'Printer 1',
      config: legacyConfig ?? { hostname: '', password: '', mode: 'standalone' },
      prefs: legacyPrefs ?? { ...DEFAULT_PREFS },
    };
    savePrintersList([printer], printer.id);
    try {
      localStorage.removeItem(LEGACY_CONFIG_KEY);
    } catch {
      // Ignore storage issues.
    }
    clearLegacyDuetPrefs();
    return { printers: [printer], activePrinterId: printer.id };
  }

  const printer = defaultPrinter();
  savePrintersList([printer], printer.id);
  return { printers: [printer], activePrinterId: printer.id };
}

function extractFilename(message: string): string | null {
  const quoted = message.match(/"([^"]+\.(?:gcode|g|gco))"/i);
  if (quoted) return quoted[1];
  const bare = message.match(/([A-Za-z0-9_./-]+\.(?:gcode|g|gco))/i);
  return bare ? bare[1] : null;
}

function classifyLine(message: string): PrintHistoryEntry['kind'] {
  const lower = message.toLowerCase();
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

export function parseEventLog(text: string): PrintHistoryEntry[] {
  const entries: PrintHistoryEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(TIMESTAMP_RE);
    if (!match) continue;

    const [, timestamp, message] = match;
    const kind = classifyLine(message);
    if (kind === 'event') continue;

    let durationSec: number | undefined;
    const duration = message.match(DURATION_RE);
    if (duration) {
      durationSec = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
    }
    entries.push({
      timestamp,
      file: extractFilename(message),
      kind,
      message,
      durationSec,
    });
  }
  return entries.reverse();
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}
