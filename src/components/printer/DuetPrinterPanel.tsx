import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import './PrinterPanel.css';
import {
  LayoutDashboard, Activity, Terminal, Play, FolderOpen, FileCode, Grid3x3,
  History, Braces, Settings, X, OctagonAlert, Wifi, WifiOff, FlaskConical,
  Sun, Moon, Search, Loader2,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { useThemeStore } from '../../store/themeStore';
import { getDuetPrefs } from '../../utils/duetPrefs';
import DuetDashboard from './DuetDashboard';
import DuetStatus from './DuetStatus';
import DuetConsole from './DuetConsole';
import DuetJobStatus from './DuetJobStatus';
import DuetPrintHistory from './DuetPrintHistory';
import DuetFileManager from './DuetFileManager';
import DuetFilamentManager from './DuetFilamentManager';
import DuetMacros from './DuetMacros';
import DuetHeightMap from './DuetHeightMap';
import DuetObjectModelBrowser from './DuetObjectModelBrowser';
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
  { key: 'status' as const, label: 'Status', Icon: Activity },
  { key: 'console' as const, label: 'Console', Icon: Terminal },
  { key: 'job' as const, label: 'Job', Icon: Play },
  { key: 'history' as const, label: 'History', Icon: History },
  { key: 'files' as const, label: 'Files', Icon: FolderOpen },
  { key: 'filaments' as const, label: 'Filaments', Icon: FlaskConical },
  { key: 'macros' as const, label: 'Macros', Icon: FileCode },
  { key: 'heightmap' as const, label: 'Height Map', Icon: Grid3x3 },
  { key: 'model' as const, label: 'Model', Icon: Braces },
];

type TabKey = (typeof TABS)[number]['key'];

const TAB_COMPONENTS: Record<TabKey, React.ComponentType> = {
  dashboard: DuetDashboard,
  status: DuetStatus,
  console: DuetConsole,
  job: DuetJobStatus,
  history: DuetPrintHistory,
  files: DuetFileManager,
  filaments: DuetFilamentManager,
  macros: DuetMacros,
  heightmap: DuetHeightMap,
  model: DuetObjectModelBrowser,
};

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
  fullscreen: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: COLORS.bg,
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    color: COLORS.text,
    fontSize: 13,
    overflow: 'hidden',
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
  connectBtn: {
    background: 'none',
    border: `1px solid ${COLORS.success}`,
    color: COLORS.success,
    cursor: 'pointer',
    padding: '2px 8px',
    borderRadius: 4,
    fontWeight: 600,
    fontSize: 11,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginLeft: 6,
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
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
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
export default function DuetPrinterPanel({ fullscreen = false }: { fullscreen?: boolean } = {}) {
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
  const reconnecting = usePrinterStore((s) => s.reconnecting);
  const lastModelUpdate = usePrinterStore((s) => s.lastModelUpdate);
  const files = usePrinterStore((s) => s.files);
  const macros = usePrinterStore((s) => s.macros);
  const filaments = usePrinterStore((s) => s.filaments);
  const printHistory = usePrinterStore((s) => s.printHistory);

  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  // Narrow-mode detection via ResizeObserver
  const panelRootRef = useRef<HTMLDivElement>(null);
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const el = panelRootRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsNarrow(entry.contentRect.width < 480);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Global search state
  const [globalSearch, setGlobalSearch] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchResults = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return [];
    const results: { label: string; tab: TabKey; type: string }[] = [];
    // Search files
    for (const f of files) {
      if (f.name.toLowerCase().includes(q)) {
        results.push({ label: f.name, tab: 'files', type: 'File' });
      }
      if (results.length >= 20) break;
    }
    // Search macros
    for (const m of macros) {
      if (m.name.toLowerCase().includes(q)) {
        results.push({ label: m.name, tab: 'macros', type: 'Macro' });
      }
      if (results.length >= 20) break;
    }
    // Search filaments
    for (const f of filaments) {
      if (f.toLowerCase().includes(q)) {
        results.push({ label: f, tab: 'filaments', type: 'Filament' });
      }
      if (results.length >= 20) break;
    }
    // Search history
    for (const h of printHistory) {
      if (h.message.toLowerCase().includes(q) || (h.file && h.file.toLowerCase().includes(q))) {
        results.push({ label: h.file ?? h.message.slice(0, 60), tab: 'history', type: 'History' });
      }
      if (results.length >= 20) break;
    }
    return results.slice(0, 20);
  }, [globalSearch, files, macros, filaments, printHistory]);

  // -----------------------------------------------------------------------
  // "Last updated" ticker — re-render every 15s while disconnected so the
  // relative timestamp stays fresh.
  // -----------------------------------------------------------------------
  const [now, setNow] = useState(Date.now);
  const hasStaleModel = !connected && lastModelUpdate !== null && Object.keys(model).length > 0;

  useEffect(() => {
    if (!hasStaleModel) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [hasStaleModel]);

  const lastUpdatedText = useMemo(() => {
    if (!lastModelUpdate) return null;
    const diffMs = now - lastModelUpdate;
    const secs = Math.floor(diffMs / 1000);
    if (secs < 10) return 'just now';
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m ago`;
  }, [lastModelUpdate, now]);

  const handleEmergencyStop = useCallback(() => {
    if (confirm('Send emergency stop (M112)? This will immediately halt the machine.')) {
      emergencyStop();
    }
  }, [emergencyStop]);

  // -----------------------------------------------------------------------
  // Task 1: Update browser tab title with print progress
  // -----------------------------------------------------------------------
  const originalTitleRef = useRef(document.title);

  useEffect(() => {
    const status = model.state?.status;
    const isPrinting = status === 'processing' || status === 'simulating';
    if (!isPrinting) {
      // Reset title when not printing
      document.title = originalTitleRef.current;
      return;
    }
    const fileName = model.job?.file?.fileName ?? 'print';
    const fileSize = model.job?.file?.size ?? 0;
    const filePos = model.job?.filePosition ?? 0;
    const pct = fileSize > 0 ? Math.min(100, (filePos / fileSize) * 100) : 0;
    document.title = `${Math.round(pct)}% - ${fileName}`;

    return () => {
      document.title = originalTitleRef.current;
    };
  }, [model.state?.status, model.job?.file?.fileName, model.job?.file?.size, model.job?.filePosition]);

  // -----------------------------------------------------------------------
  // Task 2: Sound alert when print completes or errors
  // -----------------------------------------------------------------------
  const prevStatusRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const status = model.state?.status;
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    // Only fire on transitions from an active print state to idle/halted
    if (prev === undefined) return;
    const wasActive = prev === 'processing' || prev === 'simulating'
      || prev === 'pausing' || prev === 'paused' || prev === 'resuming'
      || prev === 'cancelling';
    if (!wasActive) return;

    const isComplete = status === 'idle';
    const isError = status === 'halted';
    if (!isComplete && !isError) return;

    const prefs = getDuetPrefs();
    if (!prefs.soundAlertOnComplete) return;

    // Play a short beep via the Web Audio API
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.value = isError ? 440 : 880;
      gain.gain.value = 0.3;
      oscillator.start();
      // Play two short beeps for completion, one longer for error
      if (isError) {
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        oscillator.stop(ctx.currentTime + 0.6);
      } else {
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        // Second beep
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.type = 'sine';
        osc2.frequency.value = 1100;
        gain2.gain.setValueAtTime(0.001, ctx.currentTime + 0.2);
        gain2.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.22);
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc2.start(ctx.currentTime + 0.2);
        osc2.stop(ctx.currentTime + 0.4);
        oscillator.stop(ctx.currentTime + 0.15);
      }
    } catch {
      // Audio not available — silently ignore
    }
  }, [model.state?.status]);

  if (!fullscreen && !showPrinter) return null;

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
  const ActiveTabComponent = TAB_COMPONENTS[(activeTab as TabKey)] ?? DuetDashboard;

  return (
    <div
      ref={panelRootRef}
      style={fullscreen ? styles.fullscreen : styles.overlay}
      className={isNarrow ? 'printer-panel--narrow' : undefined}
    >
      {/* ---- Message Box Modal (M291 prompts) ---- */}
      {connected && <DuetMessageBox />}

      {/* ---- Notification toasts ---- */}
      <DuetNotifications />

      {/* ---- Header (overlay/side-panel mode only — fullscreen uses the ribbon) ---- */}
      {!fullscreen && (
        <div style={styles.header}>
          <div
            style={{
              ...styles.statusDot,
              background: connected ? COLORS.success : COLORS.danger,
            }}
            title={connected ? 'Connected' : 'Disconnected'}
          />
          {!connected && (
            <button
              style={styles.connectBtn}
              onClick={() => setShowSettings(true)}
              title="Connect to printer"
            >
              <Wifi size={12} /> Connect
            </button>
          )}
          <span style={styles.headerTitle}>Duet3D Control</span>
          {connected && config.hostname && (
            <span style={styles.hostname} title={config.hostname}>
              {config.hostname}
            </span>
          )}
          <div style={styles.spacer} />

          {/* Global Search */}
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: COLORS.inputBg, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 4, padding: '2px 6px' }}>
              <Search size={12} style={{ color: COLORS.textDim, flexShrink: 0 }} />
              <input
                ref={searchInputRef}
                type="text"
                value={globalSearch}
                onChange={(e) => { setGlobalSearch(e.target.value); setShowSearchResults(true); }}
                onFocus={() => { if (globalSearch.trim()) setShowSearchResults(true); }}
                onBlur={() => { setTimeout(() => setShowSearchResults(false), 200); }}
                placeholder="Search..."
                style={{
                  border: 'none', background: 'transparent', color: COLORS.text,
                  fontSize: 11, outline: 'none', width: 100, padding: '2px 0',
                  fontFamily: 'inherit',
                }}
              />
            </div>
            {showSearchResults && searchResults.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4,
                background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`,
                borderRadius: 4, maxHeight: 240, overflowY: 'auto', zIndex: 1100,
                minWidth: 220, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}>
                {searchResults.map((r, i) => (
                  <div
                    key={`${r.tab}-${r.label}-${i}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', cursor: 'pointer', fontSize: 12,
                      borderBottom: `1px solid ${COLORS.panelBorder}`,
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setActiveTab(r.tab);
                      setGlobalSearch('');
                      setShowSearchResults(false);
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.inputBg; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ color: COLORS.accent, fontWeight: 600, fontSize: 10, minWidth: 50 }}>{r.type}</span>
                    <span style={{ color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Theme Toggle */}
          <button
            style={styles.headerBtn}
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onMouseEnter={(e) => (e.currentTarget.style.color = COLORS.text)}
            onMouseLeave={(e) => (e.currentTarget.style.color = COLORS.textDim)}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

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
      )}

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

      {/* ---- Tab Bar (overlay/side-panel mode only — fullscreen uses the ribbon) ---- */}
      {!fullscreen && (
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
              <span className="tab-label">{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ---- Reconnecting banner ---- */}
      {!connected && reconnecting && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 14px',
            background: 'rgba(234,179,8,0.12)',
            borderBottom: `1px solid ${COLORS.panelBorder}`,
            color: COLORS.warning,
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          <Loader2 size={14} className="spin" />
          <span>Reconnecting to printer...</span>
        </div>
      )}

      {/* ---- Disconnect banner (non-blocking — tabs still render) ---- */}
      {!connected && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            background: 'rgba(239,68,68,0.08)',
            borderBottom: `1px solid ${COLORS.panelBorder}`,
            color: COLORS.textDim,
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          <WifiOff size={14} color={COLORS.danger} />
          <span>
            {hasStaleModel
              ? `Disconnected — showing last known values (updated ${lastUpdatedText}).`
              : 'Not connected to a Duet3D board.'}
          </span>
          <div style={{ flex: 1 }} />
          <button
            style={{
              background: COLORS.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '4px 12px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            onClick={() => setShowSettings(true)}
          >
            <Wifi size={12} /> Connect
          </button>
        </div>
      )}

      {/* ---- Content ---- */}
      <div style={{
        ...styles.content,
        ...(hasStaleModel ? { opacity: 0.55, pointerEvents: 'none' as const } : {}),
      }}>
        <ActiveTabComponent />
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
