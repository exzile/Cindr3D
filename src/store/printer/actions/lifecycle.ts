import { DuetService } from '../../../services/DuetService';
import type { ConsoleEntry, DuetFileInfo, DuetObjectModel, TemperatureSample } from '../../../types/duet';
import { testDuetConnection } from '../connection';
import { errorMessage, savePrintersList } from '../persistence';
import type { PrinterStoreApi } from '../storeApi';
import type { PrinterStore } from '../../printerStore';

const MAX_TEMPERATURE_HISTORY = 200;
const MAX_CONSOLE_HISTORY = 500;

export function createLifecycleActions(
  { get, set }: PrinterStoreApi,
): Pick<PrinterStore, 'connect' | 'disconnect' | 'testConnection' | 'sendGCode'> {
  return {
    connect: async () => {
      const { config, service: existingService, connecting } = get();
      if (!config.hostname) {
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

          set({ model, temperatureHistory: history, lastModelUpdate: now });
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
          showPrinter: true,
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
      const { service, consoleHistory } = get();
      if (!service) return;

      const commandEntry: ConsoleEntry = { timestamp: new Date(), type: 'command', content: code };
      set({ consoleHistory: [...consoleHistory, commandEntry].slice(-MAX_CONSOLE_HISTORY) });

      try {
        const response = await service.sendGCode(code);
        const responseEntry: ConsoleEntry = {
          timestamp: new Date(),
          type: 'response',
          content: response || 'ok',
        };
        set({ consoleHistory: [...get().consoleHistory, responseEntry].slice(-MAX_CONSOLE_HISTORY) });
      } catch (err) {
        const errorEntry: ConsoleEntry = {
          timestamp: new Date(),
          type: 'error',
          content: (err as Error).message,
        };
        set({
          consoleHistory: [...get().consoleHistory, errorEntry].slice(-MAX_CONSOLE_HISTORY),
          error: `G-code error: ${(err as Error).message}`,
        });
      }
    },
  };
}
