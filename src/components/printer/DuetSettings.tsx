import React, { useState, useCallback } from 'react';
import { X, Wifi, WifiOff, Loader2, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { colors as COLORS } from '../../utils/theme';

const AUTO_RECONNECT_KEY = 'dzign3d-duet-autoreconnect';

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    color: COLORS.text,
    fontSize: 13,
  },
  dialog: {
    background: COLORS.panel,
    border: `1px solid ${COLORS.panelBorder}`,
    borderRadius: 10,
    width: 480,
    maxWidth: '95vw',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 20px',
    borderBottom: `1px solid ${COLORS.panelBorder}`,
  },
  headerTitle: {
    fontWeight: 600,
    fontSize: 15,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: COLORS.textDim,
    cursor: 'pointer',
    padding: 4,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
  },
  body: {
    padding: '16px 20px',
    overflowY: 'auto',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: COLORS.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  input: {
    background: COLORS.inputBg,
    border: `1px solid ${COLORS.inputBorder}`,
    borderRadius: 6,
    color: COLORS.text,
    padding: '8px 12px',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  hint: {
    fontSize: 11,
    color: COLORS.textDim,
    marginTop: 2,
  },
  modeSelector: {
    display: 'flex',
    gap: 0,
    borderRadius: 6,
    overflow: 'hidden',
    border: `1px solid ${COLORS.inputBorder}`,
  },
  modeBtn: {
    flex: 1,
    padding: '8px 12px',
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    transition: 'background 0.15s, color 0.15s',
  },
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 6,
    fontSize: 12,
  },
  bannerSuccess: {
    background: 'rgba(34,197,94,0.12)',
    color: COLORS.success,
  },
  bannerError: {
    background: 'rgba(239,68,68,0.12)',
    color: COLORS.danger,
  },
  bannerInfo: {
    background: 'rgba(80,120,255,0.1)',
    color: COLORS.accent,
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    accentColor: COLORS.accent,
    width: 16,
    height: 16,
    cursor: 'pointer',
  },
  btnRow: {
    display: 'flex',
    gap: 8,
  },
  btn: {
    border: 'none',
    borderRadius: 6,
    padding: '8px 18px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  btnPrimary: {
    background: COLORS.accent,
    color: '#fff',
  },
  btnDanger: {
    background: COLORS.danger,
    color: '#fff',
  },
  btnSecondary: {
    background: COLORS.surface,
    color: COLORS.text,
    border: `1px solid ${COLORS.inputBorder}`,
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  section: {
    background: COLORS.surface,
    borderRadius: 8,
    padding: '14px 16px',
    border: `1px solid ${COLORS.panelBorder}`,
  },
  sectionTitle: {
    fontWeight: 600,
    fontSize: 13,
    marginBottom: 10,
    color: COLORS.text,
  },
  guideList: {
    margin: 0,
    paddingLeft: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    color: COLORS.textDim,
    fontSize: 12,
    lineHeight: 1.5,
  },
  aboutText: {
    color: COLORS.textDim,
    fontSize: 12,
    lineHeight: 1.6,
    margin: 0,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '12px 20px',
    borderTop: `1px solid ${COLORS.panelBorder}`,
  },
};

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

  const [hostname, setHostname] = useState(config.hostname || '');
  const [password, setPassword] = useState(config.password || '');
  const [mode, setMode] = useState<'standalone' | 'sbc'>(
    (config as any).mode ?? 'standalone',
  );
  const [autoReconnect, setAutoReconnect] = useState(() => {
    try {
      return localStorage.getItem(AUTO_RECONNECT_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    firmwareVersion?: string;
    boardName?: string;
    error?: string;
  } | null>(null);

  const handleAutoReconnectChange = useCallback((checked: boolean) => {
    setAutoReconnect(checked);
    try {
      localStorage.setItem(AUTO_RECONNECT_KEY, String(checked));
    } catch {
      // storage unavailable
    }
  }, []);

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

  if (!showSettings) return null;

  const canConnect = hostname.trim().length > 0 && !connecting;

  return (
    <div style={styles.overlay} onClick={() => setShowSettings(false)}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        {/* ---- Header ---- */}
        <div style={styles.header}>
          <span style={styles.headerTitle}>Duet3D Connection Settings</span>
          <button
            style={styles.closeBtn}
            onClick={() => setShowSettings(false)}
            title="Close"
            onMouseEnter={(e) => (e.currentTarget.style.color = COLORS.text)}
            onMouseLeave={(e) => (e.currentTarget.style.color = COLORS.textDim)}
          >
            <X size={18} />
          </button>
        </div>

        {/* ---- Body ---- */}
        <div style={styles.body}>
          {/* Connection status banner */}
          {connected ? (
            <div style={{ ...styles.banner, ...styles.bannerSuccess }}>
              <Wifi size={16} />
              Connected to Duet3D board at {config.hostname}
            </div>
          ) : (
            <div style={{ ...styles.banner, ...styles.bannerInfo }}>
              <Info size={16} />
              Connect to your Duet3D board via its REST API
            </div>
          )}

          {/* Hostname */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Hostname / IP Address</label>
            <input
              style={styles.input}
              type="text"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="192.168.1.100 or myprinter.local"
              disabled={connected}
              onFocus={(e) => (e.currentTarget.style.borderColor = COLORS.accent)}
              onBlur={(e) => (e.currentTarget.style.borderColor = COLORS.inputBorder)}
            />
            <span style={styles.hint}>
              Enter the IP address or hostname of your Duet3D board (without http://)
            </span>
          </div>

          {/* Password */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Board Password (optional)</label>
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank if no password is set"
              disabled={connected}
              onFocus={(e) => (e.currentTarget.style.borderColor = COLORS.accent)}
              onBlur={(e) => (e.currentTarget.style.borderColor = COLORS.inputBorder)}
            />
            <span style={styles.hint}>
              Only required if your board has a password set in config.g (M551)
            </span>
          </div>

          {/* Connection mode */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Connection Mode</label>
            <div style={styles.modeSelector}>
              <button
                style={{
                  ...styles.modeBtn,
                  background: mode === 'standalone' ? COLORS.accent : COLORS.inputBg,
                  color: mode === 'standalone' ? '#fff' : COLORS.textDim,
                }}
                onClick={() => setMode('standalone')}
                disabled={connected}
              >
                Standalone
              </button>
              <button
                style={{
                  ...styles.modeBtn,
                  background: mode === 'sbc' ? COLORS.accent : COLORS.inputBg,
                  color: mode === 'sbc' ? '#fff' : COLORS.textDim,
                }}
                onClick={() => setMode('sbc')}
                disabled={connected}
              >
                SBC (Raspberry Pi)
              </button>
            </div>
            <span style={styles.hint}>
              {mode === 'standalone'
                ? 'Connect directly to the Duet board via its built-in WiFi/Ethernet.'
                : 'Connect via a Single Board Computer (e.g., Raspberry Pi) running DuetSoftwareFramework.'}
            </span>
          </div>

          {/* Auto-reconnect */}
          <div style={styles.checkboxRow}>
            <input
              type="checkbox"
              id="auto-reconnect"
              style={styles.checkbox}
              checked={autoReconnect}
              onChange={(e) => handleAutoReconnectChange(e.target.checked)}
            />
            <label htmlFor="auto-reconnect" style={{ cursor: 'pointer', fontSize: 13 }}>
              Auto-reconnect on startup
            </label>
          </div>

          {/* Test / Connect buttons */}
          <div style={styles.btnRow}>
            <button
              style={{
                ...styles.btn,
                ...styles.btnSecondary,
                ...(testing || connected ? styles.btnDisabled : {}),
              }}
              onClick={handleTest}
              disabled={testing || connected || !hostname.trim()}
            >
              {testing ? (
                <>
                  <Loader2 size={14} className="spin" /> Testing...
                </>
              ) : (
                'Test Connection'
              )}
            </button>

            {connected ? (
              <button
                style={{ ...styles.btn, ...styles.btnDanger }}
                onClick={handleDisconnect}
              >
                <WifiOff size={14} /> Disconnect
              </button>
            ) : (
              <button
                style={{
                  ...styles.btn,
                  ...styles.btnPrimary,
                  ...(!canConnect ? styles.btnDisabled : {}),
                }}
                onClick={handleConnect}
                disabled={!canConnect}
              >
                {connecting ? (
                  <>
                    <Loader2 size={14} className="spin" /> Connecting...
                  </>
                ) : (
                  <>
                    <Wifi size={14} /> Connect
                  </>
                )}
              </button>
            )}
          </div>

          {/* Test result */}
          {testResult && (
            <div
              style={{
                ...styles.banner,
                ...(testResult.success ? styles.bannerSuccess : styles.bannerError),
              }}
            >
              {testResult.success ? (
                <>
                  <CheckCircle size={16} />
                  <div>
                    <div style={{ fontWeight: 600 }}>Connection successful</div>
                    {testResult.firmwareVersion && (
                      <div style={{ marginTop: 2, opacity: 0.85 }}>
                        Firmware: {testResult.firmwareVersion}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle size={16} />
                  <div>
                    <div style={{ fontWeight: 600 }}>Connection failed</div>
                    {testResult.error && (
                      <div style={{ marginTop: 2, opacity: 0.85 }}>
                        {testResult.error}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Store error */}
          {error && !testResult && (
            <div style={{ ...styles.banner, ...styles.bannerError }}>
              <AlertCircle size={16} /> {error}
            </div>
          )}

          {/* Setup guide */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Setup Guide</div>
            <ol style={styles.guideList as any}>
              <li>
                Find your Duet board's IP address from the PanelDue display, or check your
                router's DHCP client list. Boards with WiFi typically show the IP on startup.
              </li>
              <li>
                If you are connecting from a different machine, ensure CORS is enabled on the
                board. Add <code style={{ color: COLORS.accent }}>M586 C"*"</code> to your
                config.g or use a CORS proxy.
              </li>
              <li>
                Both your computer and the Duet board must be on the same local network.
                If using a hostname like "myprinter.local", mDNS must be supported on your
                network.
              </li>
              <li>
                For SBC mode, the Raspberry Pi must be running DuetSoftwareFramework and
                be accessible on the network.
              </li>
              <li>
                If the board has a password configured via M551, enter it in the password field
                above.
              </li>
            </ol>
          </div>

          {/* About */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>About</div>
            <p style={styles.aboutText}>
              This panel communicates with Duet3D boards (Duet 2, Duet 3, and compatible)
              using the RepRapFirmware REST API. It is compatible with RepRapFirmware 3.x
              and DuetWebControl 3.x protocol. Both standalone and SBC (DuetSoftwareFramework)
              modes are supported.
            </p>
            <p style={{ ...styles.aboutText, marginTop: 8 }}>
              Features include real-time machine monitoring, G-code console, file management,
              macro execution, and height map visualization -- all integrated directly into
              Dzign3D.
            </p>
          </div>
        </div>

        {/* ---- Footer ---- */}
        <div style={styles.footer}>
          <button
            style={{ ...styles.btn, ...styles.btnSecondary }}
            onClick={() => setShowSettings(false)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
