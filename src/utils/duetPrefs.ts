// =============================================================================
// Duet UI preferences — persisted to localStorage as a single JSON blob.
//
// The DuetSettings dialog is the primary editor; other Duet panels may read
// values lazily via getDuetPrefs() when they want to change behaviour.
// =============================================================================

const PREFS_KEY = 'dzign3d-duet-prefs';
const LEGACY_AUTO_RECONNECT_KEY = 'dzign3d-duet-autoreconnect';

export type Units = 'metric' | 'imperial';
export type NotifSeverity = 'info' | 'warning' | 'error';
export type TemperatureUnit = 'C' | 'F';
export type DateFormat = 'relative' | 'absolute';

export interface CustomButton {
  id: string;
  label: string;
  gcode: string;
}

export interface DuetPrefs {
  // General
  units: Units;
  webcamUrl: string;
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
}

export const DEFAULT_PREFS: DuetPrefs = {
  units: 'metric',
  webcamUrl: '',
  confirmToolChange: true,
  silentPrompts: false,
  autoReconnect: false,
  reconnectInterval: 5000,
  maxRetries: 10,
  toastDurationMs: 5000,
  notificationsSound: true,
  notifMinSeverity: 'info',
  soundAlertOnComplete: true,
  temperatureUnit: 'C',
  dateFormat: 'relative',
  customButtons: [],
};

export function getDuetPrefs(): DuetPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DuetPrefs>;
      return { ...DEFAULT_PREFS, ...parsed };
    }
    // Migrate legacy auto-reconnect flag so existing users keep their setting
    const legacy = localStorage.getItem(LEGACY_AUTO_RECONNECT_KEY);
    if (legacy !== null) {
      const migrated = { ...DEFAULT_PREFS, autoReconnect: legacy === 'true' };
      setDuetPrefs(migrated);
      localStorage.removeItem(LEGACY_AUTO_RECONNECT_KEY);
      return migrated;
    }
  } catch {
    // storage unavailable or corrupt
  }
  return { ...DEFAULT_PREFS };
}

export function setDuetPrefs(prefs: DuetPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable
  }
}

export function updateDuetPrefs(patch: Partial<DuetPrefs>): DuetPrefs {
  const next = { ...getDuetPrefs(), ...patch };
  setDuetPrefs(next);
  return next;
}
