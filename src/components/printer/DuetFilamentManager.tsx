import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  RefreshCw, Plus, Loader2, FlaskConical, Check, X,
} from 'lucide-react';
import { errorMessage } from '../../utils/errorHandling';
import { usePrinterStore } from '../../store/printerStore';
import DuetFileEditor from './DuetFileEditor';
import './DuetFilamentManager.css';
import {
  DEFAULT_LOAD_MACRO,
  DEFAULT_UNLOAD_MACRO,
  type FilamentProps,
  loadFilamentColors,
  loadFilamentProps,
  loadSpoolData,
  type SpoolData,
} from './duetFilamentManager/storage';
import { FilamentTable } from './duetFilamentManager/FilamentTable';


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DuetFilamentManager() {
  const service = usePrinterStore((s) => s.service);
  const connected = usePrinterStore((s) => s.connected);
  const filaments = usePrinterStore((s) => s.filaments);
  const refreshFilaments = usePrinterStore((s) => s.refreshFilaments);
  const model = usePrinterStore((s) => s.model);

  // Build a map: filament name -> tool(s) that have it loaded
  // Duet stores loaded filament on move.extruders[n].filament; tools reference extruder indices.
  const filamentToolMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    const tools = model?.tools ?? [];
    const extruders = model?.move?.extruders ?? [];
    for (const tool of tools) {
      for (const extIdx of tool.extruders ?? []) {
        const ext = extruders[extIdx];
        if (ext && typeof ext.filament === 'string' && ext.filament.length > 0) {
          const key = ext.filament;
          if (!map[key]) map[key] = [];
          map[key].push(`T${tool.number}`);
        }
      }
    }
    return map;
  }, [model?.tools, model?.move?.extruders]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Creating a new filament
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Renaming
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Deleting
  const [deletingName, setDeletingName] = useState<string | null>(null);

  // Filament colors
  const [filamentColors, setFilamentColors] = useState<Record<string, string>>(loadFilamentColors);

  // Filament properties (diameter, material)
  const [filamentProps, setFilamentProps] = useState<Record<string, FilamentProps>>(loadFilamentProps);

  // Spool weight tracking
  const [spoolData, setSpoolData] = useState<Record<string, SpoolData>>(loadSpoolData);

  // File editor
  const [editingPath, setEditingPath] = useState<string | null>(null);

  // Load filament list on mount / connection
  useEffect(() => {
    if (!connected) return;
    setLoading(true);
    refreshFilaments().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await refreshFilaments();
    } catch (err) {
      setError(errorMessage(err, 'Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [refreshFilaments]);

  // Create a new filament directory + default macros
  const handleCreate = useCallback(async () => {
    if (!service || !newName.trim()) return;
    const name = newName.trim();
    const base = `0:/filaments/${name}`;
    setCreating(true);
    setError(null);
    try {
      await service.createDirectory(base);
      // Write default macros as text blobs
      await service.uploadFile(`${base}/config.g`, new Blob([DEFAULT_LOAD_MACRO], { type: 'text/plain' }));
      await service.uploadFile(`${base}/unload.g`, new Blob([DEFAULT_UNLOAD_MACRO], { type: 'text/plain' }));
      await refreshFilaments();
      setNewName('');
      setShowNew(false);
    } catch (err) {
      setError(`Create failed: ${errorMessage(err, 'Unknown error')}`);
    } finally {
      setCreating(false);
    }
  }, [service, newName, refreshFilaments]);

  // Rename via move
  const handleRenameCommit = useCallback(async () => {
    if (!service || !renamingName || !renameValue.trim()) return;
    const newVal = renameValue.trim();
    if (newVal === renamingName) { setRenamingName(null); return; }
    setRenaming(true);
    setError(null);
    try {
      await service.moveFile(`0:/filaments/${renamingName}`, `0:/filaments/${newVal}`);
      await refreshFilaments();
      setRenamingName(null);
    } catch (err) {
      setError(`Rename failed: ${errorMessage(err, 'Unknown error')}`);
    } finally {
      setRenaming(false);
    }
  }, [service, renamingName, renameValue, refreshFilaments]);

  // Delete directory (Duet: delete files first, then dir)
  const handleDelete = useCallback(async (name: string) => {
    if (!service) return;
    setDeletingName(name);
    setError(null);
    try {
      const base = `0:/filaments/${name}`;
      // Try to delete known files first; ignore errors if they don't exist
      for (const file of ['config.g', 'unload.g']) {
        await service.deleteFile(`${base}/${file}`).catch(() => undefined);
      }
      // Try to delete the directory itself
      await service.deleteFile(base);
      await refreshFilaments();
    } catch (err) {
      setError(`Delete failed: ${errorMessage(err, 'Unknown error')}`);
    } finally {
      setDeletingName(null);
    }
  }, [service, refreshFilaments]);

  return (
    <div className="duet-filament-mgr">
      {/* Toolbar */}
      <div className="duet-filament-mgr__toolbar">
        <button
          className="duet-filament-mgr__toolbar-btn--primary"
          onClick={() => { setShowNew(true); setNewName(''); }}
          disabled={!connected}
          title="Create new filament"
        >
          <Plus size={13} /> New Filament
        </button>
        <button
          className="duet-filament-mgr__toolbar-btn"
          onClick={handleRefresh}
          disabled={loading || !connected}
          title="Refresh filament list"
        >
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
        {error && (
          <span className="duet-filament-mgr__error">{error}</span>
        )}
      </div>

      {/* Filament list */}
      <div className="duet-filament-mgr__scroll-area">
        {!connected ? (
          <div className="duet-filament-mgr__empty-state">
            <FlaskConical size={40} strokeWidth={1} color="var(--text-muted)" />
            <p className="duet-filament-mgr__empty-text">Not connected</p>
            <p className="duet-filament-mgr__empty-hint">Connect to a printer to manage filaments.</p>
          </div>
        ) : loading && filaments.length === 0 ? (
          <div className="duet-filament-mgr__loading-row">
            <Loader2 size={16} className="spin" /> Loading filaments…
          </div>
        ) : filaments.length === 0 ? (
          <div className="duet-filament-mgr__empty-state">
            <FlaskConical size={40} strokeWidth={1} color="var(--text-muted)" />
            <p className="duet-filament-mgr__empty-text">No filaments defined</p>
            <p className="duet-filament-mgr__empty-hint">Click "New Filament" to add one. Each filament gets load / unload G-code macros.</p>
          </div>
        ) : (
          <FilamentTable
            deletingName={deletingName}
            filamentColors={filamentColors}
            filamentProps={filamentProps}
            filamentToolMap={filamentToolMap}
            filaments={filaments}
            handleDelete={handleDelete}
            handleRenameCommit={handleRenameCommit}
            renaming={renaming}
            renamingName={renamingName}
            renameValue={renameValue}
            setEditingPath={setEditingPath}
            setFilamentColors={setFilamentColors}
            setFilamentProps={setFilamentProps}
            setRenameValue={setRenameValue}
            setRenamingName={setRenamingName}
            setSpoolData={setSpoolData}
            spoolData={spoolData}
          />
        )}
      </div>

      {/* New filament bar */}
      {showNew && (
        <div className="duet-filament-mgr__new-bar">
          <FlaskConical size={14} color="var(--info)" />
          <input
            className="duet-filament-mgr__new-input"
            placeholder="Filament name (e.g. PLA-White)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); if (e.key === 'Escape') setShowNew(false); }}
            autoFocus
            disabled={creating}
          />
          <button
            className="duet-filament-mgr__confirm-btn"
            onClick={() => void handleCreate()}
            disabled={creating || !newName.trim()}
          >
            {creating ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
            Create
          </button>
          <button className="duet-filament-mgr__cancel-btn" onClick={() => setShowNew(false)} disabled={creating}>
            <X size={12} /> Cancel
          </button>
        </div>
      )}

      {/* G-code editor overlay */}
      {editingPath && (
        <DuetFileEditor filePath={editingPath} onClose={() => setEditingPath(null)} />
      )}
    </div>
  );
}
