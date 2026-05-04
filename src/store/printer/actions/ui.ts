import { getDuetPrefs } from '../../../utils/duetPrefs';
import type { PrinterStore } from '../../printerStore';
import type { PrinterStoreApi } from '../storeApi';

let autoReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let autoReconnectAttempts = 0;

export function createUiActions(api: PrinterStoreApi): Pick<
  PrinterStore,
  | 'startAutoReconnect'
  | 'stopAutoReconnect'
  | 'setShowPrinter'
  | 'setShowSettings'
  | 'setActiveTab'
  | 'setJogDistance'
  | 'setError'
> {
  const { get, set } = api;

  return {
    startAutoReconnect: () => {
      const prefs = getDuetPrefs();
      if (!prefs.autoReconnect || autoReconnectTimer) return;

      const { config } = get();
      if (!config.hostname) return;

      autoReconnectAttempts = 0;
      set({ reconnecting: true });
      const interval = prefs.reconnectInterval ?? 5000;
      const maxRetries = prefs.maxRetries ?? 10;
      const unlimitedRetries = maxRetries === 0;

      const attempt = () => {
        const state = get();
        if (state.connected || !state.config.hostname) {
          autoReconnectTimer = null;
          autoReconnectAttempts = 0;
          set({ error: null, reconnecting: false });
          return;
        }

        autoReconnectAttempts++;
        if (!unlimitedRetries && autoReconnectAttempts > maxRetries) {
          set({ error: `Auto-reconnect failed after ${maxRetries} attempts`, reconnecting: false });
          autoReconnectTimer = null;
          autoReconnectAttempts = 0;
          return;
        }

        set({ error: `Reconnecting... attempt ${autoReconnectAttempts}/${unlimitedRetries ? 'unlimited' : maxRetries}` });
        state.connect()
          .then(() => {
            if (get().connected) {
              autoReconnectTimer = null;
              autoReconnectAttempts = 0;
              set({ error: null, reconnecting: false });
            } else {
              autoReconnectTimer = setTimeout(attempt, interval);
            }
          })
          .catch(() => {
            autoReconnectTimer = setTimeout(attempt, interval);
          });
      };

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

    setShowPrinter: (show) => set({ showPrinter: show }),
    setShowSettings: (show) => set({ showSettings: show }),
    setActiveTab: (tab) => set({ activeTab: tab }),
    setJogDistance: (distance) => set({ jogDistance: distance }),
    setError: (error) => set({ error }),
  };
}
