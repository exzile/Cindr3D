import { useState } from 'react';
import { AlertCircle, CheckCircle, Info, Loader2, Usb, Wifi, WifiOff } from 'lucide-react';
import { errorMessage } from '../../../utils/errorHandling';
import type { DuetPrefs } from '../../../utils/duetPrefs';
import type { DuetTransport, PrinterBoardType } from '../../../types/duet';
import { isWebSerialSupported, requestSerialPort } from '../../../services/usb/webSerial';
import { PRESET_LOOKUP, PRINTER_PRESETS } from './printerPresets';
import { SerialConsoleSection } from './serialConsoleSection';
import { SettingRow, ToggleRow } from './common';

const COMMON_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 250000, 500000, 1000000];

interface TestResultState {
  success: boolean;
  firmwareVersion?: string;
  error?: string;
}

const BOARD_TYPE_OPTIONS: { value: PrinterBoardType; label: string; hint: string }[] = [
  { value: 'duet',      label: 'Duet (RRF)', hint: 'Duet 2/3 boards running RepRapFirmware' },
  { value: 'klipper',   label: 'Klipper',    hint: 'Klipper firmware via Moonraker API' },
  { value: 'marlin',    label: 'Marlin',     hint: 'Marlin firmware via OctoPrint or direct serial' },
  { value: 'smoothie',  label: 'Smoothieware', hint: 'Smoothieboard / LPC-based boards' },
  { value: 'grbl',      label: 'grbl',       hint: 'grbl-based motion controllers' },
  { value: 'repetier',  label: 'Repetier',   hint: 'Repetier-Firmware via Repetier-Server' },
  { value: 'other',     label: 'Other',      hint: 'Generic G-code printer' },
];
const BOARD_TYPE_LOOKUP = new Map(BOARD_TYPE_OPTIONS.map((o) => [o.value, o]));

const TRANSPORT_OPTIONS: { value: DuetTransport; label: string; Icon: typeof Wifi; hint: string }[] = [
  { value: 'network', label: 'Network', Icon: Wifi, hint: "Connect over Wi-Fi or Ethernet via the board's HTTP API." },
  { value: 'usb',     label: 'USB',     Icon: Usb,  hint: 'Connect a USB-attached printer board through Web Serial (Chrome / Edge).' },
];
const TRANSPORT_LOOKUP = new Map(TRANSPORT_OPTIONS.map((o) => [o.value, o]));

interface ConnectionSectionProps {
  boardType: PrinterBoardType;
  canConnect: boolean;
  config: {
    hostname: string;
    transport?: DuetTransport;
    serialBaudRate?: number;
    serialPortLabel?: string;
    serialVendorId?: number;
    serialProductId?: number;
  };
  connected: boolean;
  connecting: boolean;
  error: string | null;
  handleConnect: () => void;
  handleDisconnect: () => void;
  handleTest: () => void;
  hostname: string;
  mode: 'standalone' | 'sbc';
  password: string;
  prefs: DuetPrefs;
  patchPrefs: (patch: Partial<DuetPrefs>) => void;
  setBoardType: (value: PrinterBoardType) => void;
  setConfig: (patch: {
    transport?: DuetTransport;
    serialBaudRate?: number;
    serialPortLabel?: string;
    serialVendorId?: number;
    serialProductId?: number;
  }) => void;
  setHostname: (value: string) => void;
  setMode: (value: 'standalone' | 'sbc') => void;
  setPassword: (value: string) => void;
  testResult: TestResultState | null;
  testing: boolean;
}

export function ConnectionSection({
  boardType,
  canConnect,
  config,
  connected,
  connecting,
  error,
  handleConnect,
  handleDisconnect,
  handleTest,
  hostname,
  mode,
  password,
  prefs,
  patchPrefs,
  setBoardType,
  setConfig,
  setHostname,
  setMode,
  setPassword,
  testResult,
  testing,
}: ConnectionSectionProps) {
  const isDuet = boardType === 'duet';
  const transport: DuetTransport = config.transport ?? 'network';
  const isUsb = transport === 'usb';
  const baudRate = config.serialBaudRate ?? 115200;
  const portLabel = config.serialPortLabel ?? '';
  const webSerialOk = isWebSerialSupported();
  const [serialPickError, setSerialPickError] = useState<string | null>(null);

  const boardOption = BOARD_TYPE_LOOKUP.get(boardType);
  const boardLabel = boardOption?.label ?? 'printer';
  const transportHint = TRANSPORT_LOOKUP.get(transport)?.hint ?? '';

  const ready = isUsb ? webSerialOk && !!portLabel : hostname.trim().length > 0;
  const testDisabled = testing || connected || !ready;
  const connectDisabled = !ready || (isUsb ? connecting : !canConnect);

  const handlePresetChange = (presetId: string) => {
    const preset = PRESET_LOOKUP.get(presetId);
    if (!preset || preset.id === 'custom') return;
    if (preset.boardType) setBoardType(preset.boardType);
    const patch: Parameters<typeof setConfig>[0] = {};
    if (preset.serialBaudRate !== undefined) patch.serialBaudRate = preset.serialBaudRate;
    if (Object.keys(patch).length > 0) setConfig(patch);
    if (preset.machineConfig) {
      patchPrefs({ machineConfig: { ...prefs.machineConfig, ...preset.machineConfig } });
    }
  };

  const handleSelectSerialPort = async () => {
    setSerialPickError(null);
    try {
      const { info } = await requestSerialPort();
      setConfig({ serialPortLabel: info.label, serialVendorId: info.vendorId, serialProductId: info.productId });
    } catch (err) {
      const msg = errorMessage(err, 'Unknown error') || 'Could not request a serial port.';
      if (!/no port selected|user cancelled/i.test(msg)) setSerialPickError(msg);
    }
  };

  const handleClearSerialPort = () => {
    setSerialPickError(null);
    setConfig({ serialPortLabel: '', serialVendorId: undefined, serialProductId: undefined });
  };

  return (
    <>
      <div className="duet-settings__page-title">Connection</div>

      <SettingRow
        label="Printer Preset"
        hint="One-click defaults for common community printers. Patches board type, baud rate, build volume, and kinematics. Pick Custom to leave settings alone."
        control={
          <select
            className="duet-settings__select"
            defaultValue="custom"
            onChange={(e) => { handlePresetChange(e.target.value); e.target.value = 'custom'; }}
            disabled={connected}
          >
            {PRINTER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.vendor ? `${p.vendor} ${p.name}` : p.name}</option>
            ))}
          </select>
        }
      />

      <SettingRow
        label="Connection Type"
        hint={transportHint}
        control={
          <div className="duet-settings__mode-selector">
            {TRANSPORT_OPTIONS.map(({ value, label, Icon }) => (
              <button
                key={value}
                className={`duet-settings__mode-btn${transport === value ? ' is-active' : ''}`}
                onClick={() => setConfig({ transport: value })}
                disabled={connected}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        }
      />

      <SettingRow
        label="Board Type"
        hint={boardOption?.hint ?? ''}
        control={
          <div className="duet-settings__mode-selector">
            {BOARD_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`duet-settings__mode-btn${boardType === opt.value ? ' is-active' : ''}`}
                onClick={() => setBoardType(opt.value)}
                disabled={connected}
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />

      {connected ? (
        <div className="duet-settings__banner duet-settings__banner--success">
          {isUsb ? <Usb size={16} /> : <Wifi size={16} />}
          {isUsb
            ? <span>Connected via USB ({portLabel || 'serial port'}) @ {baudRate} baud</span>
            : <span>Connected to {boardLabel} at {config.hostname}</span>
          }
        </div>
      ) : (
        <div className="duet-settings__banner duet-settings__banner--info">
          <Info size={16} />
          {isUsb
            ? 'Pick a USB serial port your printer is plugged into and choose a baud rate.'
            : isDuet ? 'Connect to your Duet3D board via its REST API'
                     : `Connect to your ${boardLabel}`}
        </div>
      )}

      {isUsb && !webSerialOk && (
        <div className="duet-settings__banner duet-settings__banner--warning">
          <AlertCircle size={16} />
          <div>
            <div className="duet-settings__banner-heading">Web Serial unavailable</div>
            <div className="duet-settings__banner-detail">
              This browser doesn't expose <code>navigator.serial</code>. USB connections work in Chrome, Edge, and Opera over HTTPS or localhost.
            </div>
          </div>
        </div>
      )}

      {!isUsb && (
        <>
          <SettingRow
            label="Hostname / IP Address"
            hint={isDuet ? 'Enter the IP address or hostname of your Duet3D board (without http://)' : 'Enter the IP address or hostname of your printer (without http://)'}
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
            hint={isDuet ? 'Only required if your board has a password set in config.g (M551)' : 'Only required if your printer interface is password-protected'}
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
          {isDuet && (
            <SettingRow
              label="Connection Mode"
              hint={mode === 'standalone'
                ? 'Connect directly to the Duet board via its built-in WiFi/Ethernet.'
                : 'Connect via a Single Board Computer running DuetSoftwareFramework.'}
              control={
                <div className="duet-settings__mode-selector">
                  <button className={`duet-settings__mode-btn${mode === 'standalone' ? ' is-active' : ''}`} onClick={() => setMode('standalone')} disabled={connected}>
                    Standalone
                  </button>
                  <button className={`duet-settings__mode-btn${mode === 'sbc' ? ' is-active' : ''}`} onClick={() => setMode('sbc')} disabled={connected}>
                    SBC (Raspberry Pi)
                  </button>
                </div>
              }
            />
          )}
        </>
      )}

      {isUsb && (
        <div className="duet-settings__section">
          <div className="duet-settings__section-title">USB Serial Port</div>
          <SettingRow
            label="Serial Port"
            hint={portLabel
              ? 'A USB device has been authorised for this printer. The same port will be re-used on connect.'
              : 'No port has been picked yet. Click below to pick the USB device your printer is on. Browsers only expose ports the user explicitly grants.'}
            control={
              <div className="duet-settings__port-row">
                <code className="duet-settings__mono duet-settings__port-label">
                  {portLabel || 'No port selected'}
                </code>
                <button
                  className={`duet-settings__btn duet-settings__btn--secondary${connected || !webSerialOk ? ' duet-settings__btn--disabled' : ''}`}
                  onClick={handleSelectSerialPort}
                  disabled={connected || !webSerialOk}
                >
                  <Usb size={14} /> {portLabel ? 'Change Port' : 'Select USB Port'}
                </button>
                {portLabel && !connected && (
                  <button className="duet-settings__btn duet-settings__btn--secondary" onClick={handleClearSerialPort}>
                    Clear
                  </button>
                )}
              </div>
            }
          />
          <SettingRow
            label="Baud Rate"
            hint="Match the baud configured in your firmware. Marlin defaults to 115200 or 250000; RepRapFirmware uses 115200."
            control={
              <select
                className="duet-settings__select"
                value={baudRate}
                onChange={(e) => setConfig({ serialBaudRate: Number(e.target.value) })}
                disabled={connected}
              >
                {COMMON_BAUD_RATES.map((rate) => (
                  <option key={rate} value={rate}>{rate.toLocaleString()} baud</option>
                ))}
              </select>
            }
          />
          {serialPickError && (
            <div className="duet-settings__banner duet-settings__banner--error">
              <AlertCircle size={16} /> {serialPickError}
            </div>
          )}
        </div>
      )}

      {isUsb && portLabel && !connected && (
        <SerialConsoleSection
          baudRate={baudRate}
          vendorId={config.serialVendorId}
          productId={config.serialProductId}
          portLabel={portLabel}
          busy={connecting || testing}
        />
      )}

      <div className="duet-settings__btn-row">
        <button
          className={`duet-settings__btn duet-settings__btn--secondary${testDisabled ? ' duet-settings__btn--disabled' : ''}`}
          onClick={handleTest}
          disabled={testDisabled}
        >
          {testing ? <><Loader2 size={14} className="spin" /> Testing...</> : 'Test Connection'}
        </button>
        {connected ? (
          <button className="duet-settings__btn duet-settings__btn--danger" onClick={handleDisconnect}>
            <WifiOff size={14} /> Disconnect
          </button>
        ) : (
          <button
            className={`duet-settings__btn duet-settings__btn--primary${connectDisabled ? ' duet-settings__btn--disabled' : ''}`}
            onClick={handleConnect}
            disabled={connectDisabled}
          >
            {connecting
              ? <><Loader2 size={14} className="spin" /> Connecting...</>
              : <>{isUsb ? <Usb size={14} /> : <Wifi size={14} />} Connect</>
            }
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
                {testResult.firmwareVersion && <div className="duet-settings__banner-detail">Firmware: {testResult.firmwareVersion}</div>}
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

      <div className="duet-settings__section duet-settings__section--mt">
        <div className="duet-settings__section-title">Auto-Reconnect</div>
        <ToggleRow
          id="auto-reconnect-conn"
          checked={prefs.autoReconnect}
          onChange={(value) => patchPrefs({ autoReconnect: value })}
          label="Enable auto-reconnect"
          hint="Automatically attempt to reconnect when the connection drops."
        />
        {prefs.autoReconnect && (
          <>
            <SettingRow
              label="Reconnect Interval"
              hint="Time between reconnect attempts."
              control={
                <select className="duet-settings__select" value={prefs.reconnectInterval} onChange={(e) => patchPrefs({ reconnectInterval: Number(e.target.value) })}>
                  <option value={2000}>2 seconds</option>
                  <option value={5000}>5 seconds</option>
                  <option value={10000}>10 seconds</option>
                  <option value={30000}>30 seconds</option>
                  <option value={60000}>60 seconds</option>
                </select>
              }
            />
            <SettingRow
              label="Max Retries"
              hint="Maximum number of reconnect attempts before giving up."
              control={
                <select className="duet-settings__select" value={prefs.maxRetries} onChange={(e) => patchPrefs({ maxRetries: Number(e.target.value) })}>
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={0}>Unlimited</option>
                </select>
              }
            />
          </>
        )}
      </div>
    </>
  );
}
