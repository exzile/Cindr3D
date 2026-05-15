import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Bot, HelpCircle, Moon, Redo2, Settings, Sun, Undo2 } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { useComponentStore } from '../../store/componentStore';
import { useThemeStore } from '../../store/themeStore';
import { usePrinterStore } from '../../store/printerStore';
import { useAiAssistantStore } from '../../store/aiAssistantStore';
import { errorMessage } from '../../utils/errorHandling';
import {
  downloadProfileSpoolSyncPayload,
  pullProfileSpoolSync,
  pushProfileSpoolSync,
} from '../../utils/profileSpoolSync';
import {
  getLastOfflineBundleMetadata, openBundle, restoreLastOfflineBundle, saveBundleAs, saveBundleSlice,
  useProjectFileStore,
} from '../../utils/projectIO';
import type { BundleSlice } from '../../types/settings-io.types';
import UpdatePanel from '../updater/UpdatePanel';
import { AppHelpModal } from '../help/AppHelpModal';
import McpStatusBadge from '../ai/McpStatusBadge';
import { FileMenu } from './quickAccess/FileMenu';
import { NewCloseConfirmModal } from './quickAccess/NewCloseConfirmModal';
import { SaveDesignModal } from './quickAccess/SaveDesignModal';
import { GlobalSettingsModal } from './quickAccess/GlobalSettingsModal';
import { useDesignFileIO } from './quickAccess/useDesignFileIO';

import type { RefObject, ChangeEvent } from 'react';

interface QuickAccessBarProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  loadFileInputRef: RefObject<HTMLInputElement | null>;
  onImport: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function QuickAccessBar({ fileInputRef, loadFileInputRef, onImport }: QuickAccessBarProps) {
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const theme = useThemeStore((s) => s.theme);
  const aiPanelOpen = useAiAssistantStore((s) => s.panelOpen);
  const toggleAiPanel = useAiAssistantStore((s) => s.togglePanel);

  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const undoStackLength = useCADStore((s) => s.undoStack.length);
  const redoStackLength = useCADStore((s) => s.redoStack.length);
  const undoAction = useCADStore((s) => s.undo);
  const redoAction = useCADStore((s) => s.redo);
  const setShowExportDialog = useCADStore((s) => s.setShowExportDialog);
  const cadNewDocument = useCADStore((s) => s.newDocument);
  const featureCount = useCADStore((s) => s.features.length);
  const sketchCount = useCADStore((s) => s.sketches.length);
  const componentNewDocument = useComponentStore((s) => s.newDocument);
  // The File menu is available on every workspace now — the design-specific
  // items (New/Open/Save design, Import, Export) are still gated to design
  // mode, but every workspace gets the settings-bundle items (Save Settings /
  // Save Settings As / Load Settings).
  const workspaceMode = useCADStore((s) => s.workspaceMode);
  const isDesign = workspaceMode === 'design';

  const printerConnected = usePrinterStore((s) => s.connected);
  const printerModel = usePrinterStore((s) => s.model);
  const printerPrinters = usePrinterStore((s) => s.printers);
  const printerActivePrinterId = usePrinterStore((s) => s.activePrinterId);
  const activePrinterName = printerPrinters.find((p) => p.id === printerActivePrinterId)?.name ?? 'Printer';
  const printerStatus = printerModel.state?.status ?? 'disconnected';
  const isPrinterWorkspace = workspaceMode === 'printer';

  const bundleFilename = useProjectFileStore((s) => s.filename);
  const hasBundle = useProjectFileStore((s) => s.hasBundle);
  const [offlineBundle, setOfflineBundle] = useState(() => getLastOfflineBundleMetadata());
  const sliceForWorkspace: BundleSlice =
    workspaceMode === 'design' ? 'cad'
    : workspaceMode === 'prepare' ? 'slicer'
    : 'printer';

  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hasUpdateAlert, setHasUpdateAlert] = useState(false);
  // null = modal hidden; 'new' / 'close' = modal showing with action-specific copy
  const [confirmMode, setConfirmMode] = useState<'new' | 'close' | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsDraft, setSaveAsDraft] = useState('design');
  const [overwritePrompt, setOverwritePrompt] = useState(false);
  // Tracks the last-saved/loaded filename (without extension) so Save re-populates it
  const [currentDesignFile, setCurrentDesignFile] = useState<string | null>(null);
  const [autoSave, setAutoSave] = useState(() => {
    try { return localStorage.getItem('dznd-autosave') === 'true'; } catch { return false; }
  });
  const [autoSaveInterval, setAutoSaveInterval] = useState<number>(() => {
    try { return Number(localStorage.getItem('dznd-autosave-interval') || '30'); } catch { return 30; }
  });

  const saveAsThenRef = useRef<(() => void) | null>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  const openSaveAs = useCallback((then?: () => void) => {
    setSaveAsDraft(currentDesignFile ?? 'design');
    saveAsThenRef.current = then ?? null;
    setOverwritePrompt(false);
    setSaveAsOpen(true);
  }, [currentDesignFile]);

  const closeSaveAs = () => {
    setSaveAsOpen(false);
    setOverwritePrompt(false);
  };

  const fileIO = useDesignFileIO({
    isDesign, autoSave, autoSaveInterval, currentDesignFile,
    setCurrentDesignFile, setStatusMessage, openSaveAs: () => openSaveAs(),
  });

  // ── Settings-bundle handlers ───────────────────────────────────────────
  const handleSaveSettings = useCallback(async () => {
    const result = await saveBundleSlice(sliceForWorkspace);
    setOfflineBundle(getLastOfflineBundleMetadata());
    setStatusMessage(
      result.ok
        ? `Settings saved: ${result.filename ?? ''}`
        : `Save failed: ${result.error ?? 'unknown error'}`,
    );
  }, [sliceForWorkspace, setStatusMessage]);

  const handleSaveSettingsAs = useCallback(async () => {
    const result = await saveBundleAs('settings.dzn');
    setOfflineBundle(getLastOfflineBundleMetadata());
    setStatusMessage(
      result.ok
        ? `Settings saved: ${result.filename ?? ''}`
        : `Save failed: ${result.error ?? 'unknown error'}`,
    );
  }, [setStatusMessage]);

  const handleLoadSettings = useCallback(async () => {
    const result = await openBundle();
    if (!result.ok) {
      setStatusMessage(`Load failed: ${result.error ?? 'unknown error'}`);
      return;
    }
    setOfflineBundle(getLastOfflineBundleMetadata());
    setStatusMessage(
      `Settings loaded${result.filename ? ` from ${result.filename}` : ''}: ${result.appliedSections.join(', ')}`,
    );
  }, [setStatusMessage]);

  const handleRestoreOfflineSettings = useCallback(() => {
    const result = restoreLastOfflineBundle();
    setOfflineBundle(getLastOfflineBundleMetadata());
    if (!result.ok) {
      setStatusMessage(`Offline restore failed: ${result.error ?? 'unknown error'}`);
      return;
    }
    setStatusMessage(
      `Offline settings restored${result.filename ? ` from ${result.filename}` : ''}: ${result.appliedSections.join(', ')}`,
    );
  }, [setStatusMessage]);

  // ── Profile-sync handlers ──────────────────────────────────────────────
  const handlePullProfileSync = useCallback(async () => {
    try {
      const payload = await pullProfileSpoolSync();
      setStatusMessage(`Profile sync pulled: ${payload.exportedAt}`);
    } catch (err) {
      setStatusMessage(`Profile sync failed: ${errorMessage(err, 'Unknown error')}`);
    }
  }, [setStatusMessage]);

  const handlePushProfileSync = useCallback(async () => {
    try {
      await pushProfileSpoolSync();
      setStatusMessage('Profile sync pushed to GitHub');
    } catch (err) {
      setStatusMessage(`Profile sync push failed: ${errorMessage(err, 'Unknown error')}`);
    }
  }, [setStatusMessage]);

  const handleExportProfileSync = useCallback(() => {
    downloadProfileSpoolSyncPayload();
    setStatusMessage('Profile sync file exported');
  }, [setStatusMessage]);

  // Close the file menu / notifications popover when clicking outside
  useEffect(() => {
    if (!fileMenuOpen && !notificationsOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (fileMenuRef.current && !fileMenuRef.current.contains(target)) {
        setFileMenuOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(target)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [fileMenuOpen, notificationsOpen]);

  useEffect(() => {
    if (!globalSettingsOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGlobalSettingsOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [globalSettingsOpen]);

  const closeMenu = () => setFileMenuOpen(false);

  const hasContent = featureCount > 0 || sketchCount > 0;

  const doNewDocument = () => {
    cadNewDocument();
    componentNewDocument();
    fileIO.resetFileState();
    setConfirmMode(null);
  };

  const handleNew = () => {
    closeMenu();
    if (hasContent) setConfirmMode('new');
    else doNewDocument();
  };

  // Close = always prompts a save choice, even when the workspace already
  // looks empty — the user explicitly chose to "close the current file" and
  // should always get the save-or-discard modal.
  const handleClose = () => {
    closeMenu();
    setConfirmMode('close');
  };

  const toggleAutoSave = () => {
    setAutoSave((v) => {
      const next = !v;
      try { localStorage.setItem('dznd-autosave', String(next)); } catch {
        // Local storage can be unavailable in restricted browser contexts.
      }
      return next;
    });
  };

  const handleSaveAsConfirm = async () => {
    const name = saveAsDraft.trim() || 'design';
    const baseName = name.replace(/\.dznd$/i, '');
    // First click when name matches current file → show overwrite confirmation
    if (currentDesignFile && baseName === currentDesignFile && !overwritePrompt) {
      setOverwritePrompt(true);
      return;
    }
    const ok = await fileIO.saveDesignAs(baseName);
    if (!ok) return;
    saveAsThenRef.current?.();
    saveAsThenRef.current = null;
    setSaveAsOpen(false);
    setConfirmMode(null);
    setOverwritePrompt(false);
  };

  return (
    <div className="ribbon-quick-access">
      <div className="ribbon-quick-left">
        <FileMenu
          ref={fileMenuRef}
          open={fileMenuOpen}
          isDesign={isDesign}
          hasBundle={hasBundle}
          bundleFilename={bundleFilename ?? null}
          sliceForWorkspace={sliceForWorkspace}
          offlineBundle={offlineBundle}
          onToggleOpen={() => setFileMenuOpen((v) => !v)}
          onNew={handleNew}
          onClose={handleClose}
          onOpenDesign={async () => { closeMenu(); await fileIO.openDesignFile(loadFileInputRef); }}
          onSaveDesign={() => { closeMenu(); openSaveAs(); }}
          onImport={() => { fileInputRef.current?.click(); closeMenu(); }}
          onExport={() => { setShowExportDialog(true); closeMenu(); }}
          onLoadSettings={() => { void handleLoadSettings(); closeMenu(); }}
          onRestoreOfflineSettings={() => { handleRestoreOfflineSettings(); closeMenu(); }}
          onSaveSettings={() => { void handleSaveSettings(); closeMenu(); }}
          onSaveSettingsAs={() => { void handleSaveSettingsAs(); closeMenu(); }}
        />

        {/* Auto-save toggle — compact pill switch next to File, design only */}
        {isDesign && (
          <button
            className={`autosave-toggle${autoSave ? ' autosave-on' : ''}`}
            title={autoSave ? `Auto-save ON (every ${autoSaveInterval}s) — click to disable` : 'Auto-save OFF — click to enable'}
            onClick={toggleAutoSave}
            role="switch"
            aria-checked={autoSave}
            aria-label={autoSave ? `Disable auto-save, currently every ${autoSaveInterval} seconds` : 'Enable auto-save'}
          >
            <span className="autosave-label">Auto</span>
            <span className="autosave-track">
              <span className="autosave-thumb" />
            </span>
          </button>
        )}

        {/* File menu + undo/redo are design-workspace concepts; the slicer
            and printer workspaces have their own action history that would
            be confused by a shared undo button. */}
        {isDesign && (
          <>
            <div className="ribbon-quick-divider" />

            <button
              className={`ribbon-quick-btn${undoStackLength === 0 ? ' ribbon-quick-btn-disabled' : ''}`}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              onClick={undoAction}
              disabled={undoStackLength === 0}
            >
              <Undo2 size={14} />
            </button>
            <button
              className={`ribbon-quick-btn${redoStackLength === 0 ? ' ribbon-quick-btn-disabled' : ''}`}
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
              onClick={redoAction}
              disabled={redoStackLength === 0}
            >
              <Redo2 size={14} />
            </button>
          </>
        )}

        <input ref={fileInputRef} type="file" accept=".step,.stp,.f3d,.stl,.obj" hidden onChange={onImport} />
        <input
          ref={loadFileInputRef}
          type="file"
          accept=".dznd,.dzn,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            fileIO.importTextFromInput(file);
            if (loadFileInputRef.current) loadFileInputRef.current.value = '';
          }}
        />
      </div>
      <div className="ribbon-quick-center">
        {/* Only the design workspace shows the filename prefix — the slicer
            and printer workspaces are not "file-backed" in the same sense. */}
        <span className="ribbon-title">
          {isDesign
            ? (currentDesignFile ? `${currentDesignFile}.dznd — Cindr3D` : 'Untitled — Cindr3D')
            : 'Cindr3D'}
          {bundleFilename && !isDesign ? ` — ${bundleFilename}` : ''}
        </span>
        {isPrinterWorkspace && (
          <span className={`ribbon-printer-pill${printerConnected ? ' is-connected' : ''}`}>
            <span className="ribbon-printer-pill__dot" />
            <span className="ribbon-printer-pill__name">{activePrinterName}</span>
            {printerConnected && (
              <span className="ribbon-printer-pill__status">{printerStatus}</span>
            )}
          </span>
        )}
      </div>
      <div className="ribbon-quick-right">
        <button
          type="button"
          className={`quick-ai-toggle${aiPanelOpen ? ' active' : ''}`}
          onClick={toggleAiPanel}
          title="Toggle AI Assistant"
          aria-pressed={aiPanelOpen}
          aria-label="Toggle AI Assistant"
        >
          <Bot size={13} aria-hidden="true" />
          <span>AI</span>
        </button>
        <McpStatusBadge />
        <button className="ribbon-quick-btn" title="Toggle theme" aria-label="Toggle theme" onClick={toggleTheme}>
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
        </button>
        <div className="quick-popover-root" ref={notificationsRef}>
          <button
            className={`ribbon-quick-btn${hasUpdateAlert ? ' has-alert' : ''}`}
            title="Notifications"
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            onClick={() => {
              setNotificationsOpen((value) => !value);
              setGlobalSettingsOpen(false);
            }}
          >
            <Bell size={14} />
            {hasUpdateAlert && <span className="quick-alert-dot" />}
          </button>
          <div
            className={`quick-popover quick-notifications-popover${notificationsOpen ? '' : ' is-hidden'}`}
            aria-hidden={!notificationsOpen}
          >
            <div className="quick-popover-title">Notifications</div>
            <UpdatePanel onAlertChange={setHasUpdateAlert} />
          </div>
        </div>
        <button className="ribbon-quick-btn" title="Help" aria-label="Help" onClick={() => setHelpOpen(true)}>
          <HelpCircle size={14} />
        </button>
        <button
          className="ribbon-quick-btn"
          title="Global settings"
          aria-label="Global settings"
          aria-expanded={globalSettingsOpen}
          onClick={() => {
            setGlobalSettingsOpen(true);
            setNotificationsOpen(false);
          }}
        >
          <Settings size={14} />
        </button>
      </div>

      {helpOpen && <AppHelpModal onClose={() => setHelpOpen(false)} />}

      {globalSettingsOpen && (
        <GlobalSettingsModal
          isDesign={isDesign}
          autoSaveInterval={autoSaveInterval}
          onAutoSaveIntervalChange={(v) => {
            setAutoSaveInterval(v);
            try { localStorage.setItem('dznd-autosave-interval', String(v)); } catch {
              // Local storage can be unavailable in restricted browser contexts.
            }
          }}
          offlineBundleAvailable={Boolean(offlineBundle)}
          onLoadSettings={() => void handleLoadSettings()}
          onRestoreOfflineSettings={handleRestoreOfflineSettings}
          onSaveSettingsAs={() => void handleSaveSettingsAs()}
          onPullProfileSync={() => void handlePullProfileSync()}
          onPushProfileSync={() => void handlePushProfileSync()}
          onExportProfileSync={handleExportProfileSync}
          onClose={() => setGlobalSettingsOpen(false)}
        />
      )}

      {saveAsOpen && (
        <SaveDesignModal
          draft={saveAsDraft}
          overwritePrompt={overwritePrompt}
          currentDesignFile={currentDesignFile}
          featureCount={featureCount}
          sketchCount={sketchCount}
          onDraftChange={(next) => { setSaveAsDraft(next); setOverwritePrompt(false); }}
          onConfirm={handleSaveAsConfirm}
          onCancelOverwrite={() => setOverwritePrompt(false)}
          onClose={closeSaveAs}
        />
      )}

      {confirmMode && (
        <NewCloseConfirmModal
          mode={confirmMode}
          hasContent={hasContent}
          onSaveThenAct={() => openSaveAs(doNewDocument)}
          onDiscardAndAct={doNewDocument}
          onCancel={() => setConfirmMode(null)}
        />
      )}
    </div>
  );
}
