import React, { useState, useCallback, useMemo } from 'react';
import {
  X, Wifi, WifiOff, Loader2, CheckCircle, AlertCircle, Info,
  Plug, Settings as SettingsIcon, Palette, ToggleLeft, Bell, Cpu, BadgeInfo,
  Sun, Moon, UploadCloud, Zap,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { useThemeStore, type ThemeMode } from '../../store/themeStore';
import {
  getDuetPrefs, updateDuetPrefs,
  type DuetPrefs, type Units, type NotifSeverity,
} from '../../utils/duetPrefs';
import './DuetSettings.css';

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const TABS = [
  { key: 'connection'    as const, label: 'Connection',    Icon: Plug },
  { key: 'general'       as const, label: 'General',       Icon: SettingsIcon },
  { key: 'appearance'    as const, label: 'Appearance',    Icon: Palette },
  { key: 'behaviour'     as const, label: 'Behaviour',     Icon: ToggleLeft },
  { key: 'notifications' as const, label: 'Notifications', Icon: Bell },
  { key: 'machine'       as const, label: 'Machine',       Icon: Cpu },
  { key: 'firmware'      as const, label: 'Firmware',      Icon: Zap },
  { key: 'about'         as const, label: 'About',         Icon: BadgeInfo },
];
type TabKey = (typeof TABS)[number]['key'];

// ---------------------------------------------------------------------------
// Row-based setting helper
// ---------------------------------------------------------------------------
function SettingRow({
  label, hint, control,
}: { label: string; hint?: string; control: React.ReactNode }) {
  return (
    <div className="duet-settings__form-group">
      <label className="duet-settings__label">{label}</label>
      {control}
      {hint && <span className="duet-settings__hint">{hint}</span>}
    </div>
  );
}

function ToggleRow({
  id, checked, onChange, label, hint,
}: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="duet-settings__form-group">
      <div className="duet-settings__checkbox-row">
        <input
          type="checkbox"
          id={id}
          className="duet-settings__checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <label htmlFor={id} className="duet-settings__checkbox-label">{label}</label>
      </div>
      {hint && <span className="duet-settings__hint duet-settings__hint--indented">{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DuetSettings() {
  const showSettings = usePrinterStore((s) => s.showSettings);
  const setShowSettings = usePrinterStore((s) => s.setShowSettings);
  const connected = usePrinterStore((s) => s.connected);
  const connecting = usePrinterStore((s) => s.connecting);
  const config = usePrinterStore((s) => s.config);
  const setConfig = usePrinterStore((s) => s.setConfig);
  const connect = usePrinterStore((s) => s.connect);
  const disconnect = usePrinterStore((s) => s.disconnect);
  const testConnection = usePrinterStore((s) => s.testConnection);
  const error = usePrinterStore((s) => s.error);
  const model = usePrinterStore((s) => s.model);
  const uploading = usePrinterStore((s) => s.uploading);
  const uploadProgress = usePrinterStore((s) => s.uploadProgress);
  const uploadFirmware = usePrinterStore((s) => s.uploadFirmware);
  const installFirmware = usePrinterStore((s) => s.installFirmware);

  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  // Load persisted prefs once per open
  const [prefs, setPrefs] = useState<DuetPrefs>(() => getDuetPrefs());
  const patchPrefs = useCallback((patch: Partial<DuetPrefs>) => {
    setPrefs(updateDuetPrefs(patch));
  }, []);

  const [tab, setTab] = useState<TabKey>('connection');

  // Firmware form state
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null);
  const [firmwareStatus, setFirmwareStatus] = useState<
    { type: 'success' | 'error'; message: string } | null
  >(null);
  const firmwareInputRef = React.useRef<HTMLInputElement | null>(null);

  const handleFirmwareSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.bin') && !lower.endsWith('.uf2')) {
      setFirmwareStatus({ type: 'error', message: 'Firmware must be a .bin or .uf2 file.' });
      return;
    }
    setFirmwareStatus(null);
    setFirmwareFile(file);
  }, []);

  const handleFirmwareUpload = useCallback(async () => {
    if (!firmwareFile) return;
    setFirmwareStatus(null);
    try {
      await uploadFirmware(firmwareFile);
      setFirmwareStatus({
        type: 'success',
        message: `${firmwareFile.name} uploaded to 0:/firmware/`,
      });
    } catch (err) {
      setFirmwareStatus({
        type: 'error',
        message: (err as Error).message,
      });
    }
  }, [firmwareFile, uploadFirmware]);

  const handleFirmwareInstall = useCallback(async () => {
    const ok = confirm(
      'Send M997 to start the firmware update? The board will reboot during install — do not power off until it comes back online.',
    );
    if (!ok) return;
    await installFirmware();
  }, [installFirmware]);

  // Connection form state
  const [hostname, setHostname] = useState(config.hostname || '');
  const [password, setPassword] = useState(config.password || '');
  const [mode, setMode] = useState<'standalone' | 'sbc'>(
    (config as { mode?: 'standalone' | 'sbc' }).mode ?? 'standalone',
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    firmwareVersion?: string;
    error?: string;
  } | null>(null);

  const handleTest = useCallback(async () => {
    setConfig({ hostname: hostname.trim(), password });
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection();
      setTestResult({
        success: result.success,
        firmwareVersion: result.firmwareVersion,
        error: result.error,
      });
    } catch (err) {
      setTestResult({ success: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }, [hostname, password, setConfig, testConnection]);

  const handleConnect = useCallback(async () => {
    setConfig({ hostname: hostname.trim(), password });
    setTestResult(null);
    await connect();
  }, [hostname, password, setConfig, connect]);

  const handleDisconnect = useCallback(async () => {
    setTestResult(null);
    await disconnect();
  }, [disconnect]);

  const axes = model.move?.axes ?? [];
  const board = model.boards?.[0];
  const canConnect = hostname.trim().length > 0 && !connecting;

  const renderConnection = () => (
    <>
      <div className="duet-settings__page-title">Connection</div>
      {connected ? (
        <div className="duet-settings__banner duet-settings__banner--success">
          <Wifi size={16} /> Connected to Duet3D board at {config.hostname}
        </div>
      ) : (
        <div className="duet-settings__banner duet-settings__banner--info">
          <Info size={16} /> Connect to your Duet3D board via its REST API
        </div>
      )}

      <SettingRow
        label="Hostname / IP Address"
        hint="Enter the IP address or hostname of your Duet3D board (without http://)"
        control={
          <input
            className="duet-settings__input"
            type="text"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="192.168.1.100 or myprinter.local"
            disabled={connected}
          />
        }
      />

      <SettingRow
        label="Board Password (optional)"
        hint="Only required if your board has a password set in config.g (M551)"
        control={
          <input
            className="duet-settings__input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank if no password is set"
            disabled={connected}
          />
        }
      />

      <SettingRow
        label="Connection Mode"
        hint={
          mode === 'standalone'
            ? 'Connect directly to the Duet board via its built-in WiFi/Ethernet.'
            : 'Connect via a Single Board Computer running DuetSoftwareFramework.'
        }
        control={
          <div className="duet-settings__mode-selector">
            <button
              className={`duet-settings__mode-btn${mode === 'standalone' ? ' is-active' : ''}`}
              onClick={() => setMode('standalone')}
              disabled={connected}
            >
              Standalone
            </button>
            <button
              className={`duet-settings__mode-btn${mode === 'sbc' ? ' is-active' : ''}`}
              onClick={() => setMode('sbc')}
              disabled={connected}
            >
              SBC (Raspberry Pi)
            </button>
          </div>
        }
      />

      <div className="duet-settings__btn-row">
        <button
          className={`duet-settings__btn duet-settings__btn--secondary${testing || connected ? ' duet-settings__btn--disabled' : ''}`}
          onClick={handleTest}
          disabled={testing || connected || !hostname.trim()}
        >
          {testing ? (<><Loader2 size={14} className="spin" /> Testing...</>) : 'Test Connection'}
        </button>

        {connected ? (
          <button className="duet-settings__btn duet-settings__btn--danger" onClick={handleDisconnect}>
            <WifiOff size={14} /> Disconnect
          </button>
        ) : (
          <button
            className={`duet-settings__btn duet-settings__btn--primary${!canConnect ? ' duet-settings__btn--disabled' : ''}`}
            onClick={handleConnect}
            disabled={!canConnect}
          >
            {connecting ? (<><Loader2 size={14} className="spin" /> Connecting...</>) : (<><Wifi size={14} /> Connect</>)}
          </button>
        )}
      </div>

      {testResult && (
        <div className={`duet-settings__banner ${testResult.success ? 'duet-settings__banner--success' : 'duet-settings__banner--error'}`}>
          {testResult.success ? (
            <>
              <CheckCircle size={16} />
              <div>
                <div className="duet-settings__banner-heading">Connection successful</div>
                {testResult.firmwareVersion && (
                  <div className="duet-settings__banner-detail">Firmware: {testResult.firmwareVersion}</div>
                )}
              </div>
            </>
          ) : (
            <>
              <AlertCircle size={16} />
              <div>
                <div className="duet-settings__banner-heading">Connection failed</div>
                {testResult.error && <div className="duet-settings__banner-detail">{testResult.error}</div>}
              </div>
            </>
          )}
        </div>
      )}

      {error && !testResult && (
        <div className="duet-settings__banner duet-settings__banner--error">
          <AlertCircle size={16} /> {error}
        </div>
      )}
    </>
  );

  const renderGeneral = () => (
    <>
      <div className="duet-settings__page-title">General</div>
      <SettingRow
        label="Units"
        hint="Preferred unit system for display. Individual panels may override."
        control={
          <select
            className="duet-settings__select"
            value={prefs.units}
            onChange={(e) => patchPrefs({ units: e.target.value as Units })}
          >
            <option value="metric">Metric (mm)</option>
            <option value="imperial">Imperial (in)</option>
          </select>
        }
      />
      <SettingRow
        label="Webcam URL"
        hint="URL for the printer webcam stream. Leave blank to use the default (hostname/webcam/?action=stream)."
        control={
          <input
            className="duet-settings__input"
            type="text"
            value={prefs.webcamUrl}
            onChange={(e) => patchPrefs({ webcamUrl: e.target.value })}
            placeholder="e.g. http://192.168.1.100:8080/?action=stream"
          />
        }
      />
      <SettingRow
        label="Language"
        hint="Additional languages are planned — English only today."
        control={
          <select className="duet-settings__select" value="en" disabled>
            <option value="en">English</option>
          </select>
        }
      />
    </>
  );

  const renderAppearance = () => (
    <>
      <div className="duet-settings__page-title">Appearance</div>
      <SettingRow
        label="Theme"
        hint="Switch between light and dark themes. Applies immediately."
        control={
          <div className="duet-settings__mode-selector">
            {(['light', 'dark'] as ThemeMode[]).map((t) => (
              <button
                key={t}
                className={`duet-settings__mode-btn${theme === t ? ' is-active' : ''}`}
                onClick={() => setTheme(t)}
              >
                {t === 'light' ? <Sun size={14} /> : <Moon size={14} />}
                {t}
              </button>
            ))}
          </div>
        }
      />
    </>
  );

  const renderBehaviour = () => (
    <>
      <div className="duet-settings__page-title">Behaviour</div>
      <ToggleRow
        id="confirm-tool-change"
        checked={prefs.confirmToolChange}
        onChange={(v) => patchPrefs({ confirmToolChange: v })}
        label="Confirm tool changes"
        hint="Ask for confirmation before switching the active tool (T command)."
      />
      <ToggleRow
        id="silent-prompts"
        checked={prefs.silentPrompts}
        onChange={(v) => patchPrefs({ silentPrompts: v })}
        label="Silent prompts"
        hint="Suppress beeps for routine M291 message box dialogs."
      />
      <ToggleRow
        id="auto-reconnect"
        checked={prefs.autoReconnect}
        onChange={(v) => patchPrefs({ autoReconnect: v })}
        label="Auto-reconnect on startup"
        hint="Attempt to reconnect to the last-used Duet board when Dzign3D loads."
      />
    </>
  );

  const renderNotifications = () => (
    <>
      <div className="duet-settings__page-title">Notifications</div>
      <SettingRow
        label="Toast Duration"
        hint="How long notification toasts stay visible before auto-dismissing."
        control={
          <select
            className="duet-settings__select"
            value={prefs.toastDurationMs}
            onChange={(e) => patchPrefs({ toastDurationMs: Number(e.target.value) })}
          >
            <option value={3000}>3 seconds</option>
            <option value={5000}>5 seconds</option>
            <option value={8000}>8 seconds</option>
            <option value={12000}>12 seconds</option>
          </select>
        }
      />
      <ToggleRow
        id="notif-sound"
        checked={prefs.notificationsSound}
        onChange={(v) => patchPrefs({ notificationsSound: v })}
        label="Play sound on beep events"
        hint="Trigger a short tone when the firmware emits an M300 beep."
      />
      <SettingRow
        label="Minimum Severity"
        hint="Only show toasts at or above this severity level."
        control={
          <select
            className="duet-settings__select"
            value={prefs.notifMinSeverity}
            onChange={(e) => patchPrefs({ notifMinSeverity: e.target.value as NotifSeverity })}
          >
            <option value="info">Info and above</option>
            <option value="warning">Warning and above</option>
            <option value="error">Errors only</option>
          </select>
        }
      />
    </>
  );

  const renderMachine = () => (
    <>
      <div className="duet-settings__page-title">Machine</div>
      {!connected && (
        <div className="duet-settings__banner duet-settings__banner--info">
          <Info size={16} /> Connect to a Duet board to see live machine details.
        </div>
      )}

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Axis Limits (read-only)</div>
        {axes.length === 0 ? (
          <div className="duet-settings__dim-text">No axes reported.</div>
        ) : (
          <div className="duet-settings__info-grid">
            {axes.map((a, i) => (
              <React.Fragment key={i}>
                <span>{a.letter ?? `#${i}`}</span>
                <span className="duet-settings__mono">
                  {a.min?.toFixed(1) ?? '—'} → {a.max?.toFixed(1) ?? '—'} mm
                </span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Motion Limits</div>
        {axes.length === 0 ? (
          <div className="duet-settings__dim-text">No drivers reported.</div>
        ) : (
          <div className="duet-settings__info-grid">
            {axes.map((a, i) => (
              <React.Fragment key={i}>
                <span>{a.letter ?? `#${i}`} max speed</span>
                <span className="duet-settings__mono">{a.speed?.toFixed(0) ?? '—'} mm/s</span>
                <span>{a.letter ?? `#${i}`} acceleration</span>
                <span className="duet-settings__mono">{a.acceleration?.toFixed(0) ?? '—'} mm/s²</span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Board Info</div>
        {!board ? (
          <div className="duet-settings__dim-text">No board info reported.</div>
        ) : (
          <div className="duet-settings__info-grid">
            <span className="duet-settings__dim-text">Name</span>
            <span className="duet-settings__mono">{board.name ?? board.shortName ?? '—'}</span>
            <span className="duet-settings__dim-text">Firmware</span>
            <span className="duet-settings__mono">{board.firmwareName} {board.firmwareVersion}</span>
            {board.mcuTemp?.current !== undefined && (
              <>
                <span className="duet-settings__dim-text">MCU temp</span>
                <span className="duet-settings__mono">{board.mcuTemp.current.toFixed(1)}°</span>
              </>
            )}
            {board.vIn?.current !== undefined && (
              <>
                <span className="duet-settings__dim-text">VIN</span>
                <span className="duet-settings__mono">{board.vIn.current.toFixed(1)} V</span>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );

  const renderFirmware = () => (
    <>
      <div className="duet-settings__page-title">Firmware</div>

      {!connected && (
        <div className="duet-settings__banner duet-settings__banner--info">
          <Info size={16} /> Connect to a Duet board to upload firmware.
        </div>
      )}

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Current Firmware</div>
        {board ? (
          <div className="duet-settings__info-grid">
            <span className="duet-settings__dim-text">Board</span>
            <span className="duet-settings__mono">{board.name ?? board.shortName ?? '—'}</span>
            <span className="duet-settings__dim-text">Firmware</span>
            <span className="duet-settings__mono">{board.firmwareName} {board.firmwareVersion}</span>
            {board.firmwareDate && (
              <>
                <span className="duet-settings__dim-text">Build date</span>
                <span className="duet-settings__mono">{board.firmwareDate}</span>
              </>
            )}
          </div>
        ) : (
          <div className="duet-settings__dim-text">Not connected.</div>
        )}
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Upload Firmware</div>
        <p className="duet-settings__about-text duet-settings__about-text--mb">
          Select a RepRapFirmware <code className="duet-settings__code-accent">.bin</code> or{' '}
          <code className="duet-settings__code-accent">.uf2</code> file. It will be uploaded to{' '}
          <code className="duet-settings__code-accent">0:/firmware/</code> on the board.
        </p>

        <input
          ref={firmwareInputRef}
          type="file"
          accept=".bin,.uf2"
          className="duet-settings__file-input-hidden"
          onChange={(e) => handleFirmwareSelect(e.target.files)}
        />

        <div className="duet-settings__btn-row">
          <button
            className={`duet-settings__btn duet-settings__btn--secondary${!connected || uploading ? ' duet-settings__btn--disabled' : ''}`}
            onClick={() => firmwareInputRef.current?.click()}
            disabled={!connected || uploading}
          >
            <UploadCloud size={14} /> Choose File
          </button>
          <button
            className={`duet-settings__btn duet-settings__btn--primary${!firmwareFile || uploading || !connected ? ' duet-settings__btn--disabled' : ''}`}
            onClick={handleFirmwareUpload}
            disabled={!firmwareFile || uploading || !connected}
          >
            {uploading ? (
              <><Loader2 size={14} className="spin" /> Uploading {uploadProgress}%</>
            ) : (
              'Upload'
            )}
          </button>
          <button
            className={`duet-settings__btn duet-settings__btn--danger${!connected ? ' duet-settings__btn--disabled' : ''}`}
            onClick={handleFirmwareInstall}
            disabled={!connected}
          >
            <Zap size={14} /> Install (M997)
          </button>
        </div>

        {firmwareFile && !uploading && (
          <div className="duet-settings__firmware-hint">
            Selected: <span className="duet-settings__mono">{firmwareFile.name}</span>{' '}
            ({(firmwareFile.size / 1024).toFixed(1)} KB)
          </div>
        )}

        {uploading && (
          <div className="duet-settings__progress-wrapper">
            <div className="duet-settings__progress-track">
              <div
                className="duet-settings__progress-fill"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {firmwareStatus && (
          <div className={`duet-settings__banner duet-settings__banner--mt ${firmwareStatus.type === 'success' ? 'duet-settings__banner--success' : 'duet-settings__banner--error'}`}>
            {firmwareStatus.type === 'success' ? (
              <CheckCircle size={16} />
            ) : (
              <AlertCircle size={16} />
            )}
            <span>{firmwareStatus.message}</span>
          </div>
        )}
      </div>
    </>
  );

  const renderAbout = () => (
    <>
      <div className="duet-settings__page-title">About</div>
      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Dzign3D — Printer Panel</div>
        <p className="duet-settings__about-text">
          Communicates with Duet3D boards (Duet 2, Duet 3, and compatible) using the
          RepRapFirmware REST API. Compatible with RepRapFirmware 3.x and the DuetWebControl
          3.x protocol. Both standalone and SBC (DuetSoftwareFramework) modes are supported.
        </p>
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Firmware</div>
        {board ? (
          <div className="duet-settings__info-grid">
            <span className="duet-settings__dim-text">Board</span>
            <span className="duet-settings__mono">{board.name ?? board.shortName ?? '—'}</span>
            <span className="duet-settings__dim-text">Firmware</span>
            <span className="duet-settings__mono">{board.firmwareName} {board.firmwareVersion}</span>
            {board.firmwareDate && (
              <>
                <span className="duet-settings__dim-text">Build date</span>
                <span className="duet-settings__mono">{board.firmwareDate}</span>
              </>
            )}
          </div>
        ) : (
          <div className="duet-settings__dim-text">Not connected.</div>
        )}
      </div>
    </>
  );

  const pageContent = useMemo(() => {
    switch (tab) {
      case 'connection':    return renderConnection();
      case 'general':       return renderGeneral();
      case 'appearance':    return renderAppearance();
      case 'behaviour':     return renderBehaviour();
      case 'notifications': return renderNotifications();
      case 'machine':       return renderMachine();
      case 'firmware':      return renderFirmware();
      case 'about':         return renderAbout();
      default:              return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, prefs, theme, hostname, password, mode, testing, testResult, error, connected, connecting, axes, board, firmwareFile, firmwareStatus, uploading, uploadProgress]);

  if (!showSettings) return null;

  return (
    <div className="duet-settings__overlay" onClick={() => setShowSettings(false)}>
      <div className="duet-settings__dialog" onClick={(e) => e.stopPropagation()}>
        {/* ---- Header ---- */}
        <div className="duet-settings__header">
          <span className="duet-settings__header-title">Duet3D Settings</span>
          <button
            className="duet-settings__close-btn"
            onClick={() => setShowSettings(false)}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* ---- Main (nav + body) ---- */}
        <div className="duet-settings__main">
          <nav className="duet-settings__nav">
            {TABS.map(({ key, label, Icon }) => (
              <button
                key={key}
                className={`duet-settings__nav-item${tab === key ? ' is-active' : ''}`}
                onClick={() => setTab(key)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </nav>
          <div className="duet-settings__body">{pageContent}</div>
        </div>

        {/* ---- Footer ---- */}
        <div className="duet-settings__footer">
          <button
            className="duet-settings__btn duet-settings__btn--secondary"
            onClick={() => setShowSettings(false)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
