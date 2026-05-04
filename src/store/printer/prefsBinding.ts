import { bindDuetPrefs, DEFAULT_PREFS, type DuetPrefs } from '../../utils/duetPrefs';
import type { PrinterStore } from '../printerStore';
import { getActivePrinter } from './persistence';

export function bindActivePrinterPrefs(usePrinterStore: { getState: () => PrinterStore }): void {
  bindDuetPrefs({
    get: (): DuetPrefs => {
      const state = usePrinterStore.getState();
      const active = getActivePrinter(state.printers, state.activePrinterId);
      const prefs = active.prefs as DuetPrefs | undefined;
      return prefs ? { ...DEFAULT_PREFS, ...prefs } : { ...DEFAULT_PREFS };
    },
    set: (prefs: DuetPrefs): void => {
      const state = usePrinterStore.getState();
      state.updatePrinterPrefs(state.activePrinterId, prefs);
    },
  });
}

export function connectInitialPrinter(usePrinterStore: { getState: () => PrinterStore }): void {
  const initial = usePrinterStore.getState();
  if (initial.config.hostname) {
    const initialPrinterId = initial.activePrinterId;
    initial.connect()
      .catch(() => {})
      .finally(() => {
        const state = usePrinterStore.getState();
        if (state.reconnecting && state.activePrinterId === initialPrinterId) {
          state.stopAutoReconnect();
        }
      });
  }
}
