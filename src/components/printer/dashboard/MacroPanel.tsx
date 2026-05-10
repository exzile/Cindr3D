import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  FileText, Play, Folder, FolderOpen, Plus, Trash2,
  X, Check, RefreshCcw, Search, Loader2, ChevronDown,
} from 'lucide-react';
import type { DuetFileInfo } from '../../../types/duet';
import { usePrinterStore } from '../../../store/printerStore';
import { panelStyle, sectionTitleStyle as labelStyle } from '../../../utils/printerPanelStyles';

const DEFAULT_MACRO_BODY = '; New macro\n; G-code commands below\n';
const ROOT_PATH = '0:/macros';
const EXPANDED_KEY = 'macro-panel-expanded';

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}

function saveExpanded(set: Set<string>) {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...set])); } catch {
    // Ignore storage errors; expanded state is only a convenience.
  }
}

export default function MacroPanel() {
  const macros         = usePrinterStore((s) => s.macros);
  const service        = usePrinterStore((s) => s.service);
  const runMacro       = usePrinterStore((s) => s.runMacro);
  const createMacro    = usePrinterStore((s) => s.createMacro);
  const deleteMacro    = usePrinterStore((s) => s.deleteMacro);
  const refreshMacros  = usePrinterStore((s) => s.refreshMacros);
  const navigateMacros = usePrinterStore((s) => s.navigateMacros);
  const macroPath      = usePrinterStore((s) => s.macroPath);
  const connected      = usePrinterStore((s) => s.connected);

  // key = relative path from ROOT_PATH, e.g. "tuning" or "tuning/jerk tuning"
  // undefined = never fetched; [] = fetched but empty
  const [folderContents, setFolderContents] = useState<Record<string, DuetFileInfo[] | undefined>>({});
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const [expanded, setExpanded]             = useState<Set<string>>(loadExpanded);
  const [query,     setQuery]               = useState('');
  const [creating,  setCreating]            = useState(false);
  const [newName,   setNewName]             = useState('');
  const [newBody,   setNewBody]             = useState(DEFAULT_MACRO_BODY);
  const [busy,      setBusy]                = useState(false);
  const [confirmDel, setConfirmDel]         = useState<string | null>(null);
  const [running,   setRunning]             = useState<string | null>(null);
  const runTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rootFiles = useMemo(() => macros.filter((m) => m.type === 'f'), [macros]);
  const dirs      = useMemo(() => macros.filter((m) => m.type === 'd'), [macros]);

  useEffect(() => {
    if (macroPath !== ROOT_PATH) void navigateMacros(ROOT_PATH);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFolder = useCallback(async (relativePath: string) => {
    if (!service) return;
    setLoadingFolders((prev) => { const n = new Set(prev); n.add(relativePath); return n; });
    try {
      const files = await service.listFiles(`${ROOT_PATH}/${relativePath}`);
      setFolderContents((prev) => ({ ...prev, [relativePath]: files }));
    } catch {
      setFolderContents((prev) => ({ ...prev, [relativePath]: [] }));
    } finally {
      setLoadingFolders((prev) => { const n = new Set(prev); n.delete(relativePath); return n; });
    }
  }, [service]);

  // Cascading eager loader: loads every open folder whose contents are undefined.
  // Runs when service connects, dirs change, user toggles a folder, or a folder
  // finishes loading (revealing new sub-dirs to load).
  useEffect(() => {
    if (!service) return;
    const toLoad: string[] = [];

    // Top-level dirs from store
    for (const dir of dirs) {
      if (expanded.has(dir.name) && folderContents[dir.name] === undefined && !loadingFolders.has(dir.name)) {
        toLoad.push(dir.name);
      }
    }

    // Sub-dirs discovered inside already-loaded folders
    for (const [parentPath, contents] of Object.entries(folderContents)) {
      if (!contents) continue;
      for (const item of contents) {
        if (item.type !== 'd') continue;
        const subPath = `${parentPath}/${item.name}`;
        if (expanded.has(subPath) && folderContents[subPath] === undefined && !loadingFolders.has(subPath)) {
          toLoad.push(subPath);
        }
      }
    }

    for (const path of toLoad) void loadFolder(path);
  // loadingFolders excluded intentionally — avoids re-running during in-flight fetches
  }, [dirs, service, expanded, folderContents]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(async () => {
    await refreshMacros();
    setFolderContents({});  // clears all; useEffect above will re-fetch open ones
  }, [refreshMacros]);

  const toggleExpanded = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      saveExpanded(next);
      return next;
    });
  }, []);

  const totalFileCount = useMemo(() => {
    const root = rootFiles.length;
    const nested = Object.values(folderContents).reduce(
      (s, f) => s + (f ?? []).filter((x) => x.type === 'f').length, 0,
    );
    return root + nested;
  }, [rootFiles, folderContents]);

  const q = query.trim().toLowerCase();

  const filterFiles = useCallback(
    (files: DuetFileInfo[]) => {
      const f = files.filter((m) => m.type === 'f');
      return q ? f.filter((m) => m.name.toLowerCase().includes(q)) : f;
    },
    [q],
  );

  // Does this folder path (or any descendant) match the active filter?
  const folderMatchesFilter = useCallback((relativePath: string): boolean => {
    const contents = folderContents[relativePath];
    if (!contents) return false;
    if (filterFiles(contents).length > 0) return true;
    return contents
      .filter((m) => m.type === 'd')
      .some((sub) => folderMatchesFilter(`${relativePath}/${sub.name}`));
  }, [folderContents, filterFiles]);

  const handleRun = useCallback(async (relativePath: string) => {
    if (runTimerRef.current) clearTimeout(runTimerRef.current);
    setRunning(relativePath);
    try { await runMacro(relativePath); }
    finally {
      runTimerRef.current = setTimeout(
        () => setRunning((p) => (p === relativePath ? null : p)),
        900,
      );
    }
  }, [runMacro]);

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await createMacro(trimmed, newBody);
      setCreating(false);
      setNewName('');
      setNewBody(DEFAULT_MACRO_BODY);
    } finally { setBusy(false); }
  }, [createMacro, newBody, newName]);

  const handleDelete = useCallback(async (relativePath: string) => {
    setBusy(true);
    try {
      await deleteMacro(relativePath);
      setConfirmDel(null);
      const lastSlash = relativePath.lastIndexOf('/');
      if (lastSlash !== -1) void loadFolder(relativePath.substring(0, lastSlash));
    } finally { setBusy(false); }
  }, [deleteMacro, loadFolder]);

  const cancelCreate = useCallback(() => {
    setCreating(false);
    setNewName('');
    setNewBody(DEFAULT_MACRO_BODY);
  }, []);

  const renderMacroCard = (macro: DuetFileInfo, relativePath: string) => {
    const isConfirm = confirmDel === relativePath;
    const isRunning = running === relativePath;
    const displayName = macro.name.replace(/\.g$/i, '');
    return (
      <div key={relativePath} className={`mc-card${isConfirm ? ' is-confirming' : ''}${isRunning ? ' is-running' : ''}`}>
        <button
          className="mc-card-run"
          onClick={() => void handleRun(relativePath)}
          title={`Run ${macro.name}`}
          disabled={busy || isConfirm}
        >
          <span className="mc-card-run__icon">
            {isRunning ? <Loader2 size={10} className="mc-spin" /> : <Play size={10} />}
          </span>
          <span className="mc-card-name">{displayName}</span>
        </button>
        {isConfirm ? (
          <div className="mc-card-confirm">
            <button className="mc-icon-btn mc-icon-btn--danger" onClick={() => void handleDelete(relativePath)} disabled={busy} title="Confirm delete">
              <Check size={11} />
            </button>
            <button className="mc-icon-btn" onClick={() => setConfirmDel(null)} disabled={busy} title="Cancel">
              <X size={11} />
            </button>
          </div>
        ) : (
          <button className="mc-icon-btn mc-card-delete" onClick={() => setConfirmDel(relativePath)} title="Delete macro" disabled={busy || isRunning}>
            <Trash2 size={11} />
          </button>
        )}
      </div>
    );
  };

  // Recursively renders the body of a folder (its files + expandable sub-folders)
  const renderFolderBody = (relativePath: string) => {
    const rawContents = folderContents[relativePath];
    const isLoading   = loadingFolders.has(relativePath);

    if (isLoading) {
      return <div className="mc-folder-loading"><Loader2 size={12} className="mc-spin" /> Loading…</div>;
    }
    if (rawContents === undefined) {
      return <div className="mc-folder-empty">Could not load — click folder to retry</div>;
    }

    const files   = filterFiles(rawContents);
    const subDirs = rawContents.filter((m) => m.type === 'd');

    if (files.length === 0 && subDirs.length === 0) {
      return <div className="mc-folder-empty">No macros in this folder</div>;
    }

    return (
      <>
        {subDirs.map((sub) => {
          const subPath    = `${relativePath}/${sub.name}`;
          const subIsOpen  = expanded.has(subPath);
          const subLoading = loadingFolders.has(subPath);
          const subRaw     = folderContents[subPath];
          const subHasAny  = subRaw ? subRaw.length > 0 : false;

          if (q && !folderMatchesFilter(subPath)) return null;

          return (
            <div key={sub.name} className="mc-folder mc-folder--nested">
              <button
                className={`mc-folder-header${subIsOpen ? ' is-open' : ''}`}
                onClick={() => toggleExpanded(subPath)}
                title={subIsOpen ? `Collapse ${sub.name}` : `Expand ${sub.name}`}
              >
                <span className="mc-folder-header__icon">
                  {subIsOpen ? <FolderOpen size={12} /> : <Folder size={12} />}
                </span>
                <span className="mc-folder-header__name">{sub.name}</span>
                {subLoading && <Loader2 size={10} className="mc-spin mc-folder-header__spinner" />}
                {!subLoading && subRaw !== undefined && !subHasAny && (
                  <span className="mc-folder-header__empty">empty</span>
                )}
                <ChevronDown size={11} className={`mc-folder-header__chevron${subIsOpen ? '' : ' is-closed'}`} />
              </button>
              {subIsOpen && (
                <div className="mc-folder-body">
                  {renderFolderBody(subPath)}
                </div>
              )}
            </div>
          );
        })}
        {files.length > 0 && (
          <div className="mc-grid">
            {files.map((m) => renderMacroCard(m, `${relativePath}/${m.name}`))}
          </div>
        )}
      </>
    );
  };

  const hasMacros = totalFileCount > 0 || dirs.length > 0;

  return (
    <div style={panelStyle()}>
      <div style={labelStyle()} className="mc-header">
        <div className="duet-dash-section-title-row">
          <FileText size={14} /> Macros
          <span className="mc-count">{totalFileCount}</span>
        </div>
        <div className="mc-header-actions">
          {hasMacros && (
            <div className="mc-search-inline">
              <Search size={10} className="mc-search-inline__icon" />
              <input
                type="text"
                className="mc-search-inline__input"
                placeholder="Filter…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter macros"
              />
              {query && (
                <button className="mc-search-inline__clear" onClick={() => setQuery('')} title="Clear filter" tabIndex={-1}>
                  <X size={9} />
                </button>
              )}
            </div>
          )}
          <button className="mc-icon-btn" onClick={() => void reload()} title="Refresh macro list" disabled={!connected || busy}>
            <RefreshCcw size={11} />
          </button>
          <button className={`mc-new-btn${creating ? ' is-active' : ''}`} onClick={() => setCreating((v) => !v)} title="New macro" disabled={!connected || busy}>
            <Plus size={11} /> New
          </button>
        </div>
      </div>

      {creating && (
        <div className="mc-create-form">
          <input
            type="text" className="mc-input" placeholder="macro-name.g"
            value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleCreate(); } }}
          />
          <textarea className="mc-textarea" placeholder="; G-code commands" value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={4} spellCheck={false} />
          <div className="mc-create-actions">
            <button className="mc-btn-action mc-btn-action--cancel" onClick={cancelCreate} disabled={busy}><X size={11} /> Cancel</button>
            <button className="mc-btn-action mc-btn-action--save" onClick={() => void handleCreate()} disabled={busy || !newName.trim()}><Check size={11} /> Save</button>
          </div>
        </div>
      )}

      {!hasMacros && !creating && (
        <div className="mc-empty">
          <FileText size={22} className="mc-empty__icon" />
          <strong>{connected ? 'No macros yet' : 'Not connected'}</strong>
          <span>{connected ? 'Click New to create your first macro.' : 'Connect to a printer to view macros.'}</span>
        </div>
      )}

      {filterFiles(rootFiles).length > 0 && (
        <div className="mc-grid">
          {filterFiles(rootFiles).map((m) => renderMacroCard(m, m.name))}
        </div>
      )}

      {dirs.map((dir) => {
        const rawContents = folderContents[dir.name];
        const isLoading   = loadingFolders.has(dir.name);
        const isOpen      = expanded.has(dir.name);
        const hasAny      = rawContents ? rawContents.length > 0 : false;

        if (q && !folderMatchesFilter(dir.name)) return null;

        return (
          <div key={dir.name} className="mc-folder">
            <button
              className={`mc-folder-header${isOpen ? ' is-open' : ''}`}
              onClick={() => toggleExpanded(dir.name)}
              title={isOpen ? `Collapse ${dir.name}` : `Expand ${dir.name}`}
            >
              <span className="mc-folder-header__icon">
                {isOpen ? <FolderOpen size={12} /> : <Folder size={12} />}
              </span>
              <span className="mc-folder-header__name">{dir.name}</span>
              {isLoading && <Loader2 size={10} className="mc-spin mc-folder-header__spinner" />}
              {!isLoading && rawContents !== undefined && !hasAny && (
                <span className="mc-folder-header__empty">empty</span>
              )}
              <ChevronDown size={11} className={`mc-folder-header__chevron${isOpen ? '' : ' is-closed'}`} />
            </button>

            {isOpen && (
              <div className="mc-folder-body">
                {renderFolderBody(dir.name)}
              </div>
            )}
          </div>
        );
      })}

      {q && filterFiles(rootFiles).length === 0 && dirs.every((d) => !folderMatchesFilter(d.name)) && (
        <div className="mc-empty mc-empty--search">No macros match <strong>"{query}"</strong></div>
      )}
    </div>
  );
}
