import { DuetService } from '../../../services/DuetService';
import type { ConsoleEntry, DuetFileInfo, DuetObjectModel, TemperatureSample } from '../../../types/duet';
import type { PrinterAlert } from '../../../types/printer.types';
import { testDuetConnection } from '../connection';
import { errorMessage, savePrintersList } from '../persistence';
import type { PrinterStoreApi } from '../storeApi';
import type { PrinterStore } from '../../printerStore';
import { addToast } from '../../toastStore';
import { MAX_CONSOLE_HISTORY } from '../../../constants/printerConsole';
import { consoleEntryTypeFromPrinterMessage, dateFromPrinterTimestamp, mergeConsoleEntries } from '../../../utils/printerConsole';
import { generateId } from '../../../utils/generateId';

const MAX_TEMPERATURE_HISTORY = 200;
const TRANSIENT_CONNECTION_ERROR_PREFIXES = [
  'Printer connection issue:',
  'Connection lost',
  'Reconnecting...',
];

function isTransientConnectionError(error: string | null): boolean {
  return Boolean(error && TRANSIENT_CONNECTION_ERROR_PREFIXES.some((prefix) => error.startsWith(prefix)));
}

export function createLifecycleActions(
  { get, set }: PrinterStoreApi,
): Pick<PrinterStore, 'connect' | 'disconnect' | 'testConnection' | 'sendGCode' | 'resetHalt' | 'clearConsoleHistory' | 'importConsoleEntries'> {
  return {
    connect: async () => {
      const { config, service: existingService, connecting } = get();
      const isUsb = config.transport === 'usb';
      if (!isUsb && !config.hostname) {
        set({ error: 'No hostname configured' });
        return;
      }
      if (connecting) return;

      if (existingService) {
        try { await existingService.disconnect(); } catch {
          // Replacing the service should proceed even if the stale connection is already gone.
        }
      }

      set({ connecting: true, error: null });
      const service = new DuetService(config);

      try {
        const connected = await service.connect();
        if (!connected) throw new Error('Connection refused');

        service.on('error', (err) => {
          const state = get();
          if (state.service !== null && state.service !== service) return;
          set({ error: `Printer connection issue: ${errorMessage(err, 'Unknown transport error')}` });
        });

        service.on('disconnected', () => {
          const state = get();
          if (state.connected && state.service === service) {
            get().disconnect(false);
          }
        });

        service.on('firmwareMessage', (rawMsg) => {
          const currentService = get().service;
          if (currentService !== service) return;

          const msgPayload = rawMsg && typeof rawMsg === 'object'
            ? rawMsg as { content?: unknown; time?: unknown; type?: unknown }
            : null;
          const msg = String(msgPayload?.content ?? rawMsg).trim();
          if (!msg) return;

          // Add to console history as an async firmware response.
          const state = get();
          const entryType = consoleEntryTypeFromPrinterMessage(msgPayload?.type, msg);
          const entry: ConsoleEntry = {
            timestamp: dateFromPrinterTimestamp(msgPayload?.time),
            type: entryType,
            content: msg,
          };
          set({ consoleHistory: [...state.consoleHistory, entry].slice(-MAX_CONSOLE_HISTORY) });

          // Create a persistent alert for error / warning lines.
          const isError = entryType === 'error';
          const isWarning = entryType === 'warning';
          if (isError || isWarning) {
            const now = Date.now();
            const alert: PrinterAlert = {
              id: generateId(),
              level: isError ? 'error' : 'warning',
              message: msg,
              timestamp: now,
            };
            // Deduplicate: suppress if the exact same message arrived within the last 30 s.
            // RRF sometimes fires the same warning twice in quick succession (e.g. the
            // G29 Z-datum warning). Without this guard both copies appear in the alert bar.
            const DEDUP_MS = 30_000;
            set((s) => {
              if (s.printerAlerts.some((a) => a.message === msg && now - a.timestamp < DEDUP_MS)) {
                return s; // identical recent alert already present — skip
              }
              return { printerAlerts: [...s.printerAlerts, alert] };
            });
          }
        });

        service.onModelUpdate((model: Partial<DuetObjectModel>) => {
          const currentService = get().service;
          if (currentService !== service) return;
          const state = get();
          const now = Date.now();

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

          set({
            model,
            temperatureHistory: history,
            lastModelUpdate: now,
            ...(isTransientConnectionError(state.error) ? { error: null } : {}),
          });
        });

        const files = await service.listFiles('0:/gcodes').catch(() => [] as DuetFileInfo[]);
        const macros = await service.listFiles('0:/macros').catch(() => [] as DuetFileInfo[]);
        const filamentEntries = await service.listFiles('0:/filaments').catch(() => [] as DuetFileInfo[]);
        const filaments = filamentEntries.filter((entry) => entry.type === 'd').map((entry) => entry.name).sort();

        if (!get().connecting) {
          try { await service.disconnect(); } catch {
            // Connection was cancelled; cleanup is best-effort.
          }
          return;
        }

        savePrintersList(get().printers, get().activePrinterId);

        set({
          connected: true,
          connecting: false,
          firmwareUpdatePending: false,
          service,
          files,
          macros,
          filaments,
          error: null,
        });
      } catch (err) {
        set({
          connecting: false,
          error: `Connection failed: ${errorMessage(err, 'Unknown connection error')}`,
        });
      }
    },

    disconnect: async (userInitiated = true) => {
      if (userInitiated) {
        get().stopAutoReconnect();
      }

      const { service } = get();
      if (service) {
        try { await service.disconnect(); } catch {
          // Disconnect should leave local state clean even if the transport is already closed.
        }
      }

      if (userInitiated) {
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
          printerAlerts: [],
        });
      } else {
        set({
          connected: false,
          connecting: false,
          service: null,
          error: 'Connection lost',
        });
      }

      if (!userInitiated) {
        get().startAutoReconnect();
      }
    },

    testConnection: async () => testDuetConnection(get().config),

    sendGCode: async (code) => {
      const { service } = get();
      if (!service) return;

      const commandEntry: ConsoleEntry = { timestamp: new Date(), type: 'command', content: code };
      set((s) => ({ consoleHistory: [...s.consoleHistory, commandEntry].slice(-MAX_CONSOLE_HISTORY) }));

      // Show a brief toast so the user can see the command was dispatched
      const label = code.length > 60 ? `${code.slice(0, 57)}…` : code;
      addToast('gcode', label);

      try {
        const response = await service.sendGCode(code);
        const responseEntry: ConsoleEntry = {
          timestamp: new Date(),
          type: 'response',
          content: response || 'ok',
        };
        set({ consoleHistory: [...get().consoleHistory, responseEntry].slice(-MAX_CONSOLE_HISTORY) });
      } catch (err) {
        const msg = errorMessage(err, 'Unknown error');
        const errorEntry: ConsoleEntry = {
          timestamp: new Date(),
          type: 'error',
          content: msg,
        };
        set({
          consoleHistory: [...get().consoleHistory, errorEntry].slice(-MAX_CONSOLE_HISTORY),
          error: `G-code error: ${msg}`,
        });
      }
    },

    clearConsoleHistory: () => set({ consoleHistory: [] }),

    importConsoleEntries: (entries) =>
      set((s) => ({ consoleHistory: mergeConsoleEntries(s.consoleHistory, entries) })),

    resetHalt: async () => {
      const { service, connected, config } = get();

      // Path 1 — service alive and connected (normal halted state):
      // send M999 directly via the service to clear the halt.
      if (service && connected) {
        try {
          await service.sendGCode('M999');
          return;
        } catch {
          // Fall through — board may have rebooted after M112.
        }
      }

      // Path 2 — service is gone or send failed: try a raw HTTP fetch to
      // the board so we bypass any stale-session or null-service issues.
      // In dev mode requests are proxied; in prod we hit the board directly.
      const hostname = config?.hostname?.replace(/\/+$/, '').replace(/^https?:\/\//, '');
      if (hostname) {
        const base = import.meta.env.DEV
          ? `/duet-proxy/${hostname}`
          : `http://${hostname}`;
        try {
          await fetch(`${base}/rr_gcode?gcode=M999`);
          // Also attempt reconnect to re-establish the poll session.
          await get().connect();
          return;
        } catch {
          // Fall through to reconnect-only.
        }
      }

      // Path 3 — raw fetch failed or USB transport: reconnect.
      // After reconnect the poll will update the model; if the board
      // recovered on its own it will show "idle", otherwise still "halted".
      await get().connect();
    },
  };
}
