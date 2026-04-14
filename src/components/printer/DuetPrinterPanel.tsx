import React, { useCallback } from 'react';
import {
  LayoutDashboard, Terminal, Play, FolderOpen, FileCode, Grid3x3,
  Settings, X, OctagonAlert, Wifi, WifiOff, Minimize2,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import DuetDashboard from './DuetDashboard';
import DuetConsole from './DuetConsole';
import DuetJobStatus from './DuetJobStatus';
import DuetFileManager from './DuetFileManager';
import DuetMacros from './DuetMacros';
import DuetHeightMap from './DuetHeightMap';
import DuetMessageBox from './DuetMessageBox';
import DuetNotifications from './DuetNotifications';

// ---------------------------------------------------------------------------
// Theme — shared CSS-var tokens so all pages follow the active theme
// ---------------------------------------------------------------------------
import { colors as COLORS } from '../../utils/theme';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------
const TABS = [
  { key: 'dashboard' as const, label: 'Dashboard', Icon: LayoutDashboard },
  { key: 'console' as const, label: 'Console', Icon: Terminal },
  { key: 'job' as const, label: 'Job', Icon: Play },
  { key: 'files' as const, label: 'Files', Icon: FolderOpen },
  { key: 'macros' as const, label: 'Macros', Icon: FileCode },
  { key: 'heightmap' as const, label: 'Height Map', Icon: Grid3x3 },
];

type TabKey = (typeof TABS)[number]['key'];

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 440,
    maxWidth: '100vw',
    display: 'flex',
    flexDirection: 'column',
    background: COLORS.bg,
    borderLeft: `1px solid ${COLORS.panelBorder}`,
    zIndex: 1000,
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    color: COLORS.text,
    fontSize: 13,
    boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
    resize: 'horizontal',
    overflow: 'hidden',
    minWidth: 360,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: COLORS.panel,
    borderBottom: `1px solid ${COLORS.panelBorder}`,
    flexShrink: 0,
  },
  headerTitle: {
    fontWeight: 600,
    fontSize: 14,
    whiteSpace: 'nowrap',
    marginRight: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  hostname: {
    color: COLORS.textDim,
    fontSize: 11,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 120,
  },
  spacer: { flex: 1 },
  headerBtn: {
    background: 'none',
    border: 'none',
    color: COLORS.textDim,
    cursor: 'pointer',
    padding: 4,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyBtn: {
    background: COLORS.danger,
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    padding: '4px 10px',
    borderRadius: 4,
    fontWeight: 700,
    fontSize: 11,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    letterSpacing: 0.5,
  },
  tabBar: {
    display: 'flex',
    gap: 0,
    background: COLORS.panel,
    borderBottom: `1px solid ${COLORS.panelBorder}`,
    flexShrink: 0,
    overflowX: 'auto',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '8px 12px',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: COLORS.textDim,
    cursor: 'pointer',
    fontSize: 12,
    whiteSpace: 'nowrap',
    transition: 'color 0.15s, border-color 0.15s',
  },
  tabActive: {
    color: COLORS.accent,
    borderBottomColor: COLORS.accent,
  },
  content: {
    flex: 1,
    overflow: 'auto',
    background: COLORS.bg,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 12px',
    background: COLORS.panel,
    borderTop: `1px solid ${COLORS.panelBorder}`,
    fontSize: 11,
    color: COLORS.textDim,
    flexShrink: 0,
  },
  footerStatus: {
    fontWeight: 600,
    textTransform: 'capitalize' as const,
  },
  footerProgress: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  progressBarOuter: {
    width: 80,
    height: 6,
    background: COLORS.inputBg,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarInner: {
    height: '100%',
    background: COLORS.accent,
    borderRadius: 3,
    transition: 'width 0.3s ease',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DuetPrinterPanel() {
  const showPrinter = usePrinterStore((s) => s.showPrinter);
  const connected = usePrinterStore((s) => s.connected);
  const config = usePrinterStore((s) => s.config);
  const model = usePrinterStore((s) => s.model);
  const activeTab = usePrinterStore((s) => s.activeTab);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);
  const setShowPrinter = usePrinterStore((s) => s.setShowPrinter);
  const setShowSettings = usePrinterStore((s) => s.setShowSettings);
  const emergencyStop = usePrinterStore((s) => s.emergencyStop);
  const error = usePrinterStore((s) => s.error);

  const handleEmergencyStop = useCallback(() => {
    if (confirm('Send emergency stop (M112)? This will immediately halt the machine.')) {
      emergencyStop();
    }
  }, [emergencyStop]);

  if (!showPrinter) return null;

  // Derive display values from model
  const machineStatus = model.state?.status ?? 'disconnected';
  const currentTool = model.state?.currentTool !== undefined && model.state.currentTool >= 0
    ? `T${model.state.currentTool}`
    : 'None';
  const printProgress =
    model.job?.file?.fileName && model.job.duration !== undefined
      ? model.job.filePosition !== undefined && model.job.file.size
        ? Math.min(100, (model.job.filePosition / model.job.file.size) * 100)
        : null
      : null;

  // -----------------------------------------------------------------------
  // Render active tab content
  // -----------------------------------------------------------------------
  const renderTabContent = () => {
    switch (activeTab as TabKey) {
      case 'dashboard':
        return <DuetDashboard />;
      case 'console':
        return <DuetConsole />;
      case 'job':
        return <DuetJobStatus />;
      case 'files':
        return <DuetFileManager />;
      case 'macros':
        return <DuetMacros />;
      case 'heightmap':
        return <DuetHeightMap />;
      default:
        return <DuetDashboard />;
    }
  };

  return (
    <div style={styles.overlay}>
      {/* ---- Message Box Modal (M291 prompts) ---- */}
      {connected && <DuetMessageBox />}

      {/* ---- Notification toasts ---- */}
      <DuetNotifications />

      {/* ---- Header ---- */}
      <div style={styles.header}>
        <div
          style={{
            ...styles.statusDot,
            background: connected ? COLORS.success : COLORS.danger,
          }}
          title={connected ? 'Connected' : 'Disconnected'}
        />
        <span style={styles.headerTitle}>Duet3D Control</span>
        {connected && config.hostname && (
          <span style={styles.hostname} title={config.hostname}>
            {config.hostname}
          </span>
        )}
        <div style={styles.spacer} />

        {/* Emergency Stop */}
        <button
          style={styles.emergencyBtn}
          onClick={handleEmergencyStop}
          title="Emergency Stop (M112)"
        >
          <OctagonAlert size={14} /> E-STOP
        </button>

        {/* Settings */}
        <button
          style={styles.headerBtn}
          onClick={() => setShowSettings(true)}
          title="Settings"
          onMouseEnter={(e) => (e.currentTarget.style.color = COLORS.text)}
          onMouseLeave={(e) => (e.currentTarget.style.color = COLORS.textDim)}
        >
          <Settings size={16} />
        </button>

        {/* Close */}
        <button
          style={styles.headerBtn}
          onClick={() => setShowPrinter(false)}
          title="Close panel"
          onMouseEnter={(e) => (e.currentTarget.style.color = COLORS.text)}
          onMouseLeave={(e) => (e.currentTarget.style.color = COLORS.textDim)}
        >
          <X size={16} />
        </button>
      </div>

      {/* ---- Error Banner ---- */}
      {error && (
        <div
          style={{
            padding: '6px 12px',
            background: 'rgba(239,68,68,0.15)',
            color: COLORS.danger,
            fontSize: 12,
            borderBottom: `1px solid ${COLORS.panelBorder}`,
          }}
        >
          {error}
        </div>
      )}

      {/* ---- Tab Bar ---- */}
      <div style={styles.tabBar}>
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            style={{
              ...styles.tab,
              ...(activeTab === key ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab(key)}
            title={label}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* ---- Content ---- */}
      <div style={styles.content}>
        {!connected ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 16,
              padding: 32,
              textAlign: 'center',
            }}
          >
            <WifiOff size={40} color={COLORS.textDim} />
            <p style={{ color: COLORS.textDim, margin: 0 }}>
              Not connected to a Duet3D board
            </p>
            <button
              style={{
                background: COLORS.accent,
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 20px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 13,
              }}
              onClick={() => setShowSettings(true)}
            >
              <Wifi size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
              Configure Connection
            </button>
          </div>
        ) : (
          renderTabContent()
        )}
      </div>

      {/* ---- Status Footer ---- */}
      <div style={styles.footer}>
        <span style={{ ...styles.footerStatus, color: connected ? COLORS.success : COLORS.textDim }}>
          {machineStatus}
        </span>
        <span style={{ color: COLORS.textDim }}>|</span>
        <span>Tool: {currentTool}</span>

        {printProgress !== null && (
          <div style={styles.footerProgress}>
            <div style={styles.progressBarOuter}>
              <div
                style={{
                  ...styles.progressBarInner,
                  width: `${printProgress.toFixed(1)}%`,
                }}
              />
            </div>
            <span>{printProgress.toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
