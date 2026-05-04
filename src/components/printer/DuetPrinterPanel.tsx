import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import './PrinterPanel.css';
import { usePrinterStore } from '../../store/printerStore';
import { useSpoolStore } from '../../store/spoolStore';
import { useThemeStore } from '../../store/themeStore';
import { getDuetPrefs } from '../../utils/duetPrefs';
import DuetMessageBox from './DuetMessageBox';
import './DuetAnalytics.css';
import { type TabKey, TAB_COMPONENTS } from './duetPrinterPanel/config';
import { PanelBanners, PanelFooter, PanelHeader, PanelTabBar } from './duetPrinterPanel/chrome';
import { panelStyles } from './duetPrinterPanel/styles';

export default function DuetPrinterPanel({ fullscreen = false }: { fullscreen?: boolean } = {}) {
  const showPrinter = usePrinterStore((s) => s.showPrinter);
  const connected = usePrinterStore((s) => s.connected);
  const config = usePrinterStore((s) => s.config);
  const model = usePrinterStore((s) => s.model);
  const activeTab = usePrinterStore((s) => s.activeTab);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);
  const setShowPrinter = usePrinterStore((s) => s.setShowPrinter);
  const emergencyStop = usePrinterStore((s) => s.emergencyStop);
  const error = usePrinterStore((s) => s.error);
  const reconnecting = usePrinterStore((s) => s.reconnecting);
  const lastModelUpdate = usePrinterStore((s) => s.lastModelUpdate);
  const files = usePrinterStore((s) => s.files);
  const macros = usePrinterStore((s) => s.macros);
  const filaments = usePrinterStore((s) => s.filaments);
  const printHistory = usePrinterStore((s) => s.printHistory);
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const deductFilamentForPrinter = useSpoolStore((s) => s.deductFilamentForPrinter);

  const boardType = (config as { boardType?: import('../../types/duet').PrinterBoardType }).boardType ?? 'duet';

  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

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

  const [globalSearch, setGlobalSearch] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchResults = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return [];
    const results: { label: string; tab: TabKey; type: string }[] = [];

    for (const f of files) {
      if (f.name.toLowerCase().includes(q)) {
        results.push({ label: f.name, tab: 'files', type: 'File' });
      }
      if (results.length >= 20) break;
    }
    for (const m of macros) {
      if (m.name.toLowerCase().includes(q)) {
        results.push({ label: m.name, tab: 'macros', type: 'Macro' });
      }
      if (results.length >= 20) break;
    }
    for (const f of filaments) {
      if (f.toLowerCase().includes(q)) {
        results.push({ label: f, tab: 'filaments', type: 'Filament' });
      }
      if (results.length >= 20) break;
    }
    for (const h of printHistory) {
      if (h.message.toLowerCase().includes(q) || (h.file && h.file.toLowerCase().includes(q))) {
        results.push({ label: h.file ?? h.message.slice(0, 60), tab: 'history', type: 'History' });
      }
      if (results.length >= 20) break;
    }

    return results.slice(0, 20);
  }, [globalSearch, files, macros, filaments, printHistory]);

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

  const originalTitleRef = useRef(document.title);

  useEffect(() => {
    const originalTitle = originalTitleRef.current;
    const status = model.state?.status;
    const isPrinting = status === 'processing' || status === 'simulating';
    if (!isPrinting) {
      document.title = originalTitle;
      return;
    }
    const fileName = model.job?.file?.fileName ?? 'print';
    const fileSize = model.job?.file?.size ?? 0;
    const filePos = model.job?.filePosition ?? 0;
    const pct = fileSize > 0 ? Math.min(100, (filePos / fileSize) * 100) : 0;
    document.title = `${Math.round(pct)}% - ${fileName}`;

    return () => {
      document.title = originalTitle;
    };
  }, [model.state?.status, model.job?.file?.fileName, model.job?.file?.size, model.job?.filePosition]);

  const prevStatusRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const status = model.state?.status;
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    if (prev === undefined) return;
    const wasActive = prev === 'processing' || prev === 'simulating'
      || prev === 'pausing' || prev === 'paused' || prev === 'resuming'
      || prev === 'cancelling';
    if (!wasActive) return;

    const isComplete = status === 'idle';
    const isError = status === 'halted';
    if (!isComplete && !isError) return;

    if (isComplete) {
      const filamentMm = model.job?.file?.filament?.reduce((sum, value) => sum + value, 0) ?? 0;
      if (filamentMm > 0) {
        deductFilamentForPrinter(activePrinterId, filamentMm);
      }
    }

    const prefs = getDuetPrefs();
    if (!prefs.soundAlertOnComplete) return;

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
      if (isError) {
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        oscillator.stop(ctx.currentTime + 0.6);
      } else {
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
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
      // Audio not available.
    }
  }, [activePrinterId, deductFilamentForPrinter, model.job?.file?.filament, model.state?.status]);

  if (!fullscreen && !showPrinter) return null;

  const machineStatus = model.state?.status ?? 'disconnected';
  const upTime = model.state?.upTime ?? 0;
  const board = model.boards?.[0];
  const currentTool = model.state?.currentTool !== undefined && model.state.currentTool >= 0
    ? `T${model.state.currentTool}`
    : 'None';
  const printProgress =
    model.job?.file?.fileName && model.job.duration !== undefined
      ? model.job.filePosition !== undefined && model.job.file.size
        ? Math.min(100, (model.job.filePosition / model.job.file.size) * 100)
        : null
      : null;

  const ActiveTabComponent = TAB_COMPONENTS[(activeTab as TabKey)] ?? TAB_COMPONENTS.dashboard;
  const setPanelTab = (tab: TabKey) => setActiveTab(tab as typeof activeTab);
  const activePrinter = printers.find((printer) => printer.id === activePrinterId);
  const isPrintersPage = (activeTab as string) === 'printers';

  return (
    <div
      ref={panelRootRef}
      style={fullscreen ? panelStyles.fullscreen : panelStyles.overlay}
      className={isNarrow ? 'printer-panel--narrow' : undefined}
    >
      {connected && <DuetMessageBox />}

      {!fullscreen && (
        <PanelHeader
          boardType={boardType}
          connected={connected}
          globalSearch={globalSearch}
          hostname={config.hostname}
          searchInputRef={searchInputRef}
          searchResults={searchResults}
          showSearchResults={showSearchResults}
          theme={theme}
          onClose={() => setShowPrinter(false)}
          onEmergencyStop={handleEmergencyStop}
          onOpenSettings={() => setActiveTab('settings')}
          onResultSelect={(tab) => {
            setPanelTab(tab);
            setGlobalSearch('');
            setShowSearchResults(false);
          }}
          onSearchBlur={() => {
            setTimeout(() => setShowSearchResults(false), 200);
          }}
          onSearchChange={(value) => {
            setGlobalSearch(value);
            setShowSearchResults(true);
          }}
          onSearchFocus={() => {
            if (globalSearch.trim()) setShowSearchResults(true);
          }}
          onToggleTheme={toggleTheme}
        />
      )}

      {activeTab !== 'settings' && activeTab !== 'printers' && (
        <PanelBanners
          boardType={boardType}
          connected={connected}
          error={error}
          hasStaleModel={hasStaleModel}
          lastUpdatedText={lastUpdatedText}
          reconnecting={reconnecting}
          onOpenSettings={() => setActiveTab('settings')}
        />
      )}

      {!isPrintersPage && (
        <div className="printer-context-strip">
          <div className="printer-context-strip__main">
            <span className="printer-context-strip__label">Selected Printer</span>
            <strong>{activePrinter?.name ?? 'Printer'}</strong>
          </div>
          <div className="printer-context-strip__meta">
            <span>{config.hostname || 'No host configured'}</span>
            <span>{boardType === 'duet' ? (config.mode === 'sbc' ? 'SBC' : 'Standalone') : boardType.charAt(0).toUpperCase() + boardType.slice(1)}</span>
            <span className={connected ? 'is-connected' : 'is-offline'}>
              {connected ? machineStatus : 'Offline'}
            </span>
          </div>
        </div>
      )}

      {!fullscreen && <PanelTabBar activeTab={activeTab as TabKey} boardType={boardType} onTabChange={setPanelTab} />}

      <div
        style={{
          ...panelStyles.content,
          ...(hasStaleModel ? { opacity: 0.55, pointerEvents: 'none' as const } : {}),
        }}
      >
        <ActiveTabComponent />
      </div>

      <PanelFooter
        board={board}
        connected={connected}
        currentTool={currentTool}
        machineStatus={machineStatus}
        printProgress={printProgress}
        upTime={upTime}
      />
    </div>
  );
}
