import { useState, useRef, useEffect, useCallback, useId } from 'react';
import {
  Save, FolderOpen, Undo2, Redo2, FileUp, Download,
  Moon, Sun, Bell, HelpCircle, Settings, Bot,
  FilePlus, FileX, ChevronRight, SlidersHorizontal, X,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { useComponentStore } from '../../store/componentStore';
import { useThemeStore } from '../../store/themeStore';
import { usePrinterStore } from '../../store/printerStore';
import { PROVIDER_MODELS, useAiAssistantStore, type AiProvider } from '../../store/aiAssistantStore';
import {
  openBundle, saveBundleAs, saveBundleSlice,
  useProjectFileStore,
} from '../../utils/projectIO';
import type { BundleSlice } from '../../types/settings-io.types';
import UpdatePanel from '../updater/UpdatePanel';
import { AppHelpModal } from '../help/AppHelpModal';
import McpStatusBadge from '../ai/McpStatusBadge';

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
  const aiProvider = useAiAssistantStore((s) => s.provider);
  const aiModel = useAiAssistantStore((s) => s.model);
  const aiApiKey = useAiAssistantStore((s) => s.apiKey);
  const aiUseClaudeCode = useAiAssistantStore((s) => s.useClaudeCode);
  const aiConfirmDestructive = useAiAssistantStore((s) => s.confirmDestructive);
  const setAiProvider = useAiAssistantStore((s) => s.setProvider);
  const setAiModel = useAiAssistantStore((s) => s.setModel);
  const setAiApiKey = useAiAssistantStore((s) => s.setApiKey);
  const setAiUseClaudeCode = useAiAssistantStore((s) => s.setUseClaudeCode);
  const setAiConfirmDestructive = useAiAssistantStore((s) => s.setConfirmDestructive);

  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const undoStackLength = useCADStore((s) => s.undoStack.length);
  const redoStackLength = useCADStore((s) => s.redoStack.length);
  const undoAction = useCADStore((s) => s.undo);
  const redoAction = useCADStore((s) => s.redo);
  const saveToFile = useCADStore((s) => s.saveToFile);
  const loadFromFile = useCADStore((s) => s.loadFromFile);
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
  const showFileMenu = isDesign; // for undo/redo + design menu gating below

  const printerConnected = usePrinterStore((s) => s.connected);
  const printerModel = usePrinterStore((s) => s.model);
  const printerPrinters = usePrinterStore((s) => s.printers);
  const printerActivePrinterId = usePrinterStore((s) => s.activePrinterId);
  const activePrinterName = printerPrinters.find((p) => p.id === printerActivePrinterId)?.name ?? 'Printer';
  const printerStatus = printerModel.state?.status ?? 'disconnected';
  const isPrinterWorkspace = workspaceMode === 'printer';

  const bundleFilename = useProjectFileStore((s) => s.filename);
  const hasBundle = useProjectFileStore((s) => s.hasBundle);
  const sliceForWorkspace: BundleSlice =
    workspaceMode === 'design' ? 'cad'
    : workspaceMode === 'prepare' ? 'slicer'
    : 'printer';

  const handleSaveSettings = useCallback(async () => {
    const result = await saveBundleSlice(sliceForWorkspace);
    setStatusMessage(
      result.ok
        ? `Settings saved: ${result.filename ?? ''}`
        : `Save failed: ${result.error ?? 'unknown error'}`,
    );
  }, [sliceForWorkspace, setStatusMessage]);

  const handleSaveSettingsAs = useCallback(async () => {
    const result = await saveBundleAs('settings.dzn');
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
    setStatusMessage(
      `Settings loaded${result.filename ? ` from ${result.filename}` : ''}: ${result.appliedSections.join(', ')}`,
    );
  }, [setStatusMessage]);

  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [globalSettingsTab, setGlobalSettingsTab] = useState<'general' | 'ai'>('general');
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
  const getDesignJSON = useCADStore((s) => s.getDesignJSON);
  // Stored file handle for true in-place overwrite via File System Access API.
  // Set when user opens via showOpenFilePicker or saves via showSaveFilePicker.
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);

  type FSHandleWithPerms = FileSystemFileHandle & {
    queryPermission(opts: { mode: string }): Promise<PermissionState>;
    requestPermission(opts: { mode: string }): Promise<PermissionState>;
  };

  // Returns true if written, false if write permission is not yet granted
  // (silently skips so auto-save never triggers a browser permission dialog).
  const writeToHandle = async (handle: FileSystemFileHandle): Promise<boolean> => {
    const perm = await (handle as FSHandleWithPerms).queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return false;
    const json = getDesignJSON();
    const writable = await handle.createWritable();
    await writable.write(new Blob([json], { type: 'application/json' }));
    await writable.close();
    return true;
  };

  const saveAsThenRef = useRef<(() => void) | null>(null);
  const saveAsInputId = useId();
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  // Close the file menu when clicking outside
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
    setCurrentDesignFile(null);
    fileHandleRef.current = null;
    setConfirmMode(null);
  };

  const handleNew = () => {
    closeMenu();
    if (hasContent) setConfirmMode('new');
    else doNewDocument();
  };

  // Close = always prompts a save choice, even when the workspace already
  // looks empty — the user explicitly chose to "close the current file" and
  // should always get the save-or-discard modal. After the choice, the
  // workspace is reset to an empty "Untitled" document.
  const handleClose = () => {
    closeMenu();
    setConfirmMode('close');
  };

  const toggleAutoSave = () => {
    setAutoSave(v => {
      const next = !v;
      try { localStorage.setItem('dznd-autosave', String(next)); } catch {
        // Local storage can be unavailable in restricted browser contexts.
      }
      return next;
    });
  };

  // Auto-save interval — writes to the stored file handle when available (true overwrite),
  // falls back to a browser download only if no handle exists.
  useEffect(() => {
    if (!autoSave || !isDesign) return;
    const id = setInterval(async () => {
      const handle = fileHandleRef.current;
      const name = currentDesignFile ?? 'design';
      if (handle) {
        try {
          const wrote = await writeToHandle(handle);
          if (wrote) setStatusMessage(`Auto-saved: ${name}.dznd`);
          // If !wrote, write permission wasn't granted — skip silently (no browser dialog)
        } catch {
          setStatusMessage('Auto-save failed — file may have been moved or deleted');
        }
      } else if (currentDesignFile) {
        saveToFile(currentDesignFile);
        setStatusMessage(`Auto-saved: ${currentDesignFile}.dznd`);
      }
    }, autoSaveInterval * 1000);
    return () => clearInterval(id);
  // writeToHandle is stable (captures refs/store, not closured state)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave, autoSaveInterval, currentDesignFile, isDesign, saveToFile, setStatusMessage]);

  // Ctrl+S — write to stored handle (true overwrite) if available, else fallback
  useEffect(() => {
    if (!isDesign) return;
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const handle = fileHandleRef.current;
        const name = currentDesignFile ?? 'design';
        if (handle) {
          try {
            const wrote = await writeToHandle(handle);
            if (wrote) setStatusMessage(`Design saved: ${name}.dznd`);
            else { setSaveAsDraft(name); saveAsThenRef.current = null; setOverwritePrompt(false); setSaveAsOpen(true); }
          } catch {
            setStatusMessage('Save failed — file may have been moved or deleted');
          }
        } else if (currentDesignFile) {
          saveToFile(currentDesignFile);
          setStatusMessage(`Design saved: ${currentDesignFile}.dznd`);
        } else {
          setSaveAsDraft('design');
          saveAsThenRef.current = null;
          setOverwritePrompt(false);
          setSaveAsOpen(true);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  // writeToHandle is stable; currentDesignFile captures latest via closure on each re-run
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesign, currentDesignFile, saveToFile, setStatusMessage]);

  const openSaveAs = (then?: () => void) => {
    setSaveAsDraft(currentDesignFile ?? 'design');
    saveAsThenRef.current = then ?? null;
    setOverwritePrompt(false);
    setSaveAsOpen(true);
  };

  const closeSaveAs = () => {
    setSaveAsOpen(false);
    setOverwritePrompt(false);
  };

  const handleSaveAsConfirm = async () => {
    const name = saveAsDraft.trim() || 'design';
    const baseName = name.replace(/\.dznd$/i, '');
    // First click when name matches current file → show overwrite confirmation
    if (currentDesignFile && baseName === currentDesignFile && !overwritePrompt) {
      setOverwritePrompt(true);
      return;
    }

    const finish = (savedName: string) => {
      setCurrentDesignFile(savedName);
      saveAsThenRef.current?.();
      saveAsThenRef.current = null;
      setSaveAsOpen(false);
      setConfirmMode(null);
      setOverwritePrompt(false);
    };

    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as unknown as {
          showSaveFilePicker(opts?: object): Promise<FileSystemFileHandle>;
        }).showSaveFilePicker({
          suggestedName: `${baseName}.dznd`,
          types: [{ description: 'Cindr3D Design', accept: { 'application/json': ['.dznd'] } }],
        });
        const wrote = await writeToHandle(handle);
        if (!wrote) { setStatusMessage('Save failed — write permission not granted'); return; }
        fileHandleRef.current = handle;
        setStatusMessage(`Design saved: ${baseName}.dznd`);
        finish(baseName);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setStatusMessage('Save failed');
      }
    } else {
      saveToFile(name);
      finish(baseName);
    }
  };

  return (
    <div className="ribbon-quick-access">
      <div className="ribbon-quick-left">
        {/* ── File menu — available on every workspace ── */}
        <div className="file-menu-root" ref={fileMenuRef}>
          <button
            className={`file-menu-btn${fileMenuOpen ? ' open' : ''}`}
            onClick={() => setFileMenuOpen((v) => !v)}
          >
            File
          </button>
          {fileMenuOpen && (
            <div className="file-menu-dropdown">
              {/* Design-only: document lifecycle + project (.dznd) file */}
              {isDesign && (
                <>
                  <button className="file-menu-item" onClick={handleNew}>
                    <FilePlus size={15} />
                    <span>New</span>
                    <span className="file-menu-shortcut">Ctrl+N</span>
                  </button>
                  <button className="file-menu-item" onClick={handleClose}>
                    <FileX size={15} />
                    <span>Close</span>
                    <span className="file-menu-shortcut">Ctrl+W</span>
                  </button>
                  <div className="file-menu-separator" />
                  <button className="file-menu-item" onClick={async () => {
                    closeMenu();
                    if ('showOpenFilePicker' in window) {
                      try {
                        const [handle] = await (window as unknown as {
                          showOpenFilePicker(opts?: object): Promise<FileSystemFileHandle[]>;
                        }).showOpenFilePicker({
                          types: [{ description: 'Cindr3D Design', accept: { 'application/json': ['.dznd', '.json'] } }],
                          multiple: false,
                        });
                        const file = await handle.getFile();
                        const text = await file.text();
                        loadFromFile(text);
                        fileHandleRef.current = handle;
                        setCurrentDesignFile(file.name.replace(/\.(dznd|json)$/i, '') || null);
                        // Pre-request write permission while the user gesture (file picker) is
                        // still active so auto-save can overwrite without a browser dialog.
                        try {
                          await (handle as FSHandleWithPerms).requestPermission({ mode: 'readwrite' });
                        } catch { /* browser doesn't support it — writes fall back to download */ }
                      } catch (err) {
                        if ((err as Error).name !== 'AbortError') setStatusMessage('Open failed');
                      }
                    } else {
                      loadFileInputRef.current?.click();
                    }
                  }}>
                    <FolderOpen size={15} />
                    <span>Open Design…</span>
                    <span className="file-menu-shortcut">Ctrl+O</span>
                  </button>
                  <button className="file-menu-item" onClick={() => { closeMenu(); openSaveAs(); }}>
                    <Save size={15} />
                    <span>Save Design</span>
                    <span className="file-menu-shortcut">Ctrl+S</span>
                  </button>
                  <div className="file-menu-separator" />
                  <button className="file-menu-item" onClick={() => { fileInputRef.current?.click(); closeMenu(); }}>
                    <FileUp size={15} />
                    <span>Import…</span>
                  </button>
                  <button className="file-menu-item" onClick={() => { setShowExportDialog(true); closeMenu(); }}>
                    <Download size={15} />
                    <span>Export…</span>
                    <ChevronRight size={13} style={{ marginLeft: 'auto' }} />
                  </button>
                  <div className="file-menu-separator" />
                </>
              )}

              {/* Settings bundle (.dzn) — per-page save; available everywhere */}
              <button className="file-menu-item" onClick={() => { handleLoadSettings(); closeMenu(); }}>
                <FolderOpen size={15} />
                <span>Load Settings…</span>
              </button>
              <button
                className="file-menu-item"
                onClick={() => { handleSaveSettings(); closeMenu(); }}
                title={hasBundle && bundleFilename
                  ? `Update ${bundleFilename} — writes only the ${sliceForWorkspace} section`
                  : 'Choose a file to save settings into'}
              >
                <SlidersHorizontal size={15} />
                <span>
                  {hasBundle ? `Save ${sliceForWorkspace === 'cad' ? 'Design' : sliceForWorkspace === 'slicer' ? 'Slicer' : 'Printer'} Settings` : 'Save Settings'}
                </span>
                {bundleFilename && (
                  <span className="file-menu-shortcut" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {bundleFilename}
                  </span>
                )}
              </button>
              <button className="file-menu-item" onClick={() => { handleSaveSettingsAs(); closeMenu(); }}>
                <Save size={15} />
                <span>Save Settings As…</span>
              </button>
            </div>
          )}
        </div>

        {/* Auto-save toggle — compact pill switch next to File, design only */}
        {isDesign && (
          <button
            className={`autosave-toggle${autoSave ? ' autosave-on' : ''}`}
            title={autoSave ? `Auto-save ON (every ${autoSaveInterval}s) — click to disable` : 'Auto-save OFF — click to enable'}
            onClick={toggleAutoSave}
            role="switch"
            aria-checked={autoSave}
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
        {showFileMenu && (
          <>
            <div className="ribbon-quick-divider" />

            <button
              className={`ribbon-quick-btn${undoStackLength === 0 ? ' ribbon-quick-btn-disabled' : ''}`}
              title="Undo (Ctrl+Z)"
              onClick={undoAction}
              disabled={undoStackLength === 0}
            >
              <Undo2 size={14} />
            </button>
            <button
              className={`ribbon-quick-btn${redoStackLength === 0 ? ' ribbon-quick-btn-disabled' : ''}`}
              title="Redo (Ctrl+Y)"
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
            const reader = new FileReader();
            reader.onload = (evt) => {
              const text = evt.target?.result as string;
              if (text) {
                loadFromFile(text);
                setCurrentDesignFile(file.name.replace(/\.dznd$/i, '').replace(/\.json$/i, '') || null);
              }
            };
            reader.readAsText(file);
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
        >
          <Bot size={13} aria-hidden="true" />
          <span>AI</span>
        </button>
        <McpStatusBadge />
        <button className="ribbon-quick-btn" title="Toggle theme" onClick={toggleTheme}>
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
        </button>
        <div className="quick-popover-root" ref={notificationsRef}>
          <button
            className={`ribbon-quick-btn${hasUpdateAlert ? ' has-alert' : ''}`}
            title="Notifications"
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
        <button className="ribbon-quick-btn" title="Help" onClick={() => setHelpOpen(true)}>
          <HelpCircle size={14} />
        </button>
        <button
          className="ribbon-quick-btn"
          title="Global settings"
          onClick={() => {
            setGlobalSettingsOpen(true);
            setGlobalSettingsTab('general');
            setNotificationsOpen(false);
          }}
        >
          <Settings size={14} />
        </button>
      </div>
      {helpOpen && <AppHelpModal onClose={() => setHelpOpen(false)} />}

      {globalSettingsOpen && (
        <div className="global-settings-overlay" onClick={() => setGlobalSettingsOpen(false)}>
          <div className="global-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="global-settings-header">
              <div className="global-settings-icon">
                <Settings size={16} />
              </div>
              <div>
                <div className="global-settings-title">Global Settings</div>
                <div className="global-settings-subtitle">Application preferences and AI assistant configuration</div>
              </div>
              <button
                type="button"
                className="global-settings-close"
                onClick={() => setGlobalSettingsOpen(false)}
                title="Close settings"
              >
                <X size={15} />
              </button>
            </div>

            <div className="global-settings-body">
              <nav className="global-settings-nav" aria-label="Global settings sections">
                <button
                  type="button"
                  className={`global-settings-nav-item ${globalSettingsTab === 'general' ? 'active' : ''}`}
                  onClick={() => setGlobalSettingsTab('general')}
                >
                  <Settings size={15} />
                  <span>General</span>
                </button>
                <button
                  type="button"
                  className={`global-settings-nav-item ${globalSettingsTab === 'ai' ? 'active' : ''}`}
                  onClick={() => setGlobalSettingsTab('ai')}
                >
                  <Bot size={15} />
                  <span>AI Assistant</span>
                </button>
              </nav>

              <div className="global-settings-content">
                {globalSettingsTab === 'general' && (
                  <section className="global-settings-section">
                    <div className="global-settings-section-title">General</div>
                    <div className="global-settings-section-copy">Theme, settings bundles, and design workspace save preferences.</div>
                    <div className="global-settings-grid">
                      <button className="global-settings-action" onClick={toggleTheme}>
                        {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
                        <span>{theme === 'light' ? 'Dark theme' : 'Light theme'}</span>
                      </button>
                      <button className="global-settings-action" onClick={handleLoadSettings}>
                        <FolderOpen size={15} />
                        <span>Load settings</span>
                      </button>
                      <button className="global-settings-action" onClick={handleSaveSettingsAs}>
                        <Save size={15} />
                        <span>Save settings as</span>
                      </button>
                      {isDesign && (
                        <label className="global-settings-field inline">
                          <span>Auto-save interval</span>
                          <select
                            className="settings-interval-select"
                            value={autoSaveInterval}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setAutoSaveInterval(v);
                              try { localStorage.setItem('dznd-autosave-interval', String(v)); } catch {
                                // Local storage can be unavailable in restricted browser contexts.
                              }
                            }}
                          >
                            <option value={15}>15s</option>
                            <option value={30}>30s</option>
                            <option value={60}>1 min</option>
                            <option value={120}>2 min</option>
                            <option value={300}>5 min</option>
                          </select>
                        </label>
                      )}
                    </div>
                  </section>
                )}

                {globalSettingsTab === 'ai' && (
                  <section className="global-settings-section">
                    <div className="global-settings-section-title">AI Assistant</div>
                    <div className="global-settings-section-copy">Choose whether chat uses Claude Code MCP or your own provider API key.</div>
                    <div className="global-settings-grid">
                      <div className="global-settings-field inline full">
                        <span>Use Claude Code MCP</span>
                        <label className="tp-toggle">
                          <input
                            type="checkbox"
                            checked={aiUseClaudeCode}
                            onChange={(e) => setAiUseClaudeCode(e.target.checked)}
                          />
                          <span className="tp-toggle-track" />
                        </label>
                      </div>
                      {!aiUseClaudeCode && (
                        <>
                          <label className="global-settings-field">
                            <span>Provider</span>
                            <select
                              className="settings-wide-select"
                              value={aiProvider}
                              onChange={(e) => setAiProvider(e.target.value as AiProvider)}
                            >
                              <option value="anthropic">Anthropic</option>
                              <option value="openai">OpenAI</option>
                              <option value="openrouter">OpenRouter</option>
                            </select>
                          </label>
                          <label className="global-settings-field">
                            <span>Model</span>
                            <select
                              className="settings-wide-select"
                              value={aiModel}
                              onChange={(e) => setAiModel(e.target.value)}
                            >
                              {PROVIDER_MODELS[aiProvider].map((modelName) => (
                                <option key={modelName} value={modelName}>{modelName}</option>
                              ))}
                            </select>
                          </label>
                          <label className="global-settings-field full">
                            <span>API key</span>
                            <input
                              type="password"
                              className="settings-api-key"
                              value={aiApiKey}
                              onChange={(e) => setAiApiKey(e.target.value)}
                              placeholder="Stored locally"
                              autoComplete="off"
                            />
                          </label>
                        </>
                      )}
                      <div className="global-settings-field inline full">
                        <span>Confirm destructive ops</span>
                        <label className="tp-toggle">
                          <input
                            type="checkbox"
                            checked={aiConfirmDestructive}
                            onChange={(e) => setAiConfirmDestructive(e.target.checked)}
                          />
                          <span className="tp-toggle-track" />
                        </label>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Save Design modal ── */}
      {saveAsOpen && (
        <div className="new-doc-overlay">
          <div className="save-modal">
            <div className="save-modal-header">
              <div className="save-modal-icon"><Save size={15} /></div>
              <div className="save-modal-title">Save Design</div>
              <button className="save-modal-close" onClick={closeSaveAs} title="Cancel">
                <X size={14} />
              </button>
            </div>

            <div className="save-modal-body">
              <div className="save-modal-field">
                <label className="save-modal-label" htmlFor={saveAsInputId}>File name</label>
                <div className="save-modal-input-row">
                  <input
                    id={saveAsInputId}
                    type="text"
                    autoFocus
                    className="save-modal-input"
                    value={saveAsDraft}
                    placeholder="design"
                    spellCheck={false}
                    onChange={(e) => { setSaveAsDraft(e.target.value); setOverwritePrompt(false); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && saveAsDraft.trim()) handleSaveAsConfirm();
                      if (e.key === 'Escape') setSaveAsOpen(false);
                    }}
                  />
                  <span className="save-modal-ext">.dznd</span>
                </div>
                {currentDesignFile && saveAsDraft.trim() === currentDesignFile && (
                  <div className="save-modal-hint save-modal-hint-warn">
                    Saves over the currently open file
                  </div>
                )}
                {!currentDesignFile && (
                  <div className="save-modal-hint">
                    Creates a new file in your Downloads folder
                  </div>
                )}
              </div>

              <div className="save-modal-info">
                <div className="save-modal-info-row">
                  <span className="save-modal-info-label">Format</span>
                  <span className="save-modal-info-value">Cindr3D Design (.dznd)</span>
                </div>
                <div className="save-modal-info-row">
                  <span className="save-modal-info-label">Content</span>
                  <span className="save-modal-info-value">
                    {featureCount} feature{featureCount !== 1 ? 's' : ''},&nbsp;
                    {sketchCount} sketch{sketchCount !== 1 ? 'es' : ''}
                  </span>
                </div>
              </div>
            </div>

            <div className="save-modal-footer">
              {overwritePrompt ? (
                <>
                  <span className="save-modal-overwrite-msg">
                    Overwrite <strong>{saveAsDraft.trim()}.dznd</strong>?
                  </span>
                  <button className="save-modal-btn save-modal-btn-cancel" onClick={() => setOverwritePrompt(false)}>
                    No
                  </button>
                  <button className="save-modal-btn save-modal-btn-overwrite" onClick={handleSaveAsConfirm}>
                    <Save size={13} /> Overwrite
                  </button>
                </>
              ) : (
                <>
                  <button className="save-modal-btn save-modal-btn-cancel" onClick={closeSaveAs}>
                    Cancel
                  </button>
                  <button
                    className="save-modal-btn save-modal-btn-save"
                    disabled={!saveAsDraft.trim()}
                    onClick={handleSaveAsConfirm}
                  >
                    <Save size={13} />
                    Save
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── New / Close confirmation modal (shared flow with per-action copy) ── */}
      {confirmMode && (
        <div className="new-doc-overlay" onClick={() => setConfirmMode(null)}>
          <div className="new-doc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="new-doc-title">
              {confirmMode === 'new' ? 'Start a new document?' : 'Close the current file?'}
            </div>
            <div className="new-doc-body">
              {confirmMode === 'new'
                ? (hasContent
                  ? 'You have unsaved work. Would you like to save before starting a new document?'
                  : 'Start with a fresh workspace?')
                : (hasContent
                  ? 'Would you like to save before closing? Closing will reset the workspace.'
                  : 'This will reset the workspace to an empty document.')}
            </div>
            <div className="new-doc-actions">
              <button
                className="new-doc-btn new-doc-btn-save"
                onClick={() => openSaveAs(doNewDocument)}
              >
                {confirmMode === 'new' ? 'Save & New' : 'Save & Close'}
              </button>
              <button
                className="new-doc-btn new-doc-btn-discard"
                onClick={doNewDocument}
              >
                {confirmMode === 'new' ? 'Discard & New' : 'Discard & Close'}
              </button>
              <button
                className="new-doc-btn new-doc-btn-cancel"
                onClick={() => setConfirmMode(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
