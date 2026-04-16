import { useState, useCallback, useEffect } from 'react';
import {
  RefreshCw, Plus, Pencil, Trash2, FileCode, Loader2, FlaskConical, Check, X,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import DuetFileEditor from './DuetFileEditor';
import './DuetFilamentManager.css';

// ---------------------------------------------------------------------------
// Default macro templates
// ---------------------------------------------------------------------------

const DEFAULT_LOAD_MACRO = `; Filament load macro
; Called by M701 when this filament is loaded
M104 S200           ; heat to printing temperature (adjust as needed)
M116                ; wait for temperatures
M83                 ; relative extrusion
G1 E50 F300         ; load filament
G4 S3               ; wait 3 seconds
M82                 ; absolute extrusion
`;

const DEFAULT_UNLOAD_MACRO = `; Filament unload macro
; Called by M702 when this filament is unloaded
M104 S200           ; heat to printing temperature (adjust as needed)
M116                ; wait for temperatures
M83                 ; relative extrusion
G1 E5 F300          ; prime slightly
G4 S2               ; wait
G1 E-80 F1800       ; retract to unload
G1 E-20 F300        ; slow final retract
M82                 ; absolute extrusion
M104 S0             ; cool down
`;


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DuetFilamentManager() {
  const service = usePrinterStore((s) => s.service);
  const connected = usePrinterStore((s) => s.connected);
  const filaments = usePrinterStore((s) => s.filaments);
  const refreshFilaments = usePrinterStore((s) => s.refreshFilaments);

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
      setError((err as Error).message);
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
      setError(`Create failed: ${(err as Error).message}`);
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
      setError(`Rename failed: ${(err as Error).message}`);
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
      setError(`Delete failed: ${(err as Error).message}`);
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
          <table className="duet-filament-mgr__table">
            <thead className="duet-filament-mgr__thead">
              <tr>
                <th className="duet-filament-mgr__th">Name</th>
                <th className="duet-filament-mgr__th duet-filament-mgr__th--center">Load Macro</th>
                <th className="duet-filament-mgr__th duet-filament-mgr__th--center">Unload Macro</th>
                <th className="duet-filament-mgr__th duet-filament-mgr__th--right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filaments.map((name) => (
                <tr
                  key={name}
                  className="duet-filament-mgr__tr"
                >
                  <td className="duet-filament-mgr__td">
                    {renamingName === name ? (
                      <form
                        className="duet-filament-mgr__rename-form"
                        onSubmit={(e) => { e.preventDefault(); void handleRenameCommit(); }}
                      >
                        <input
                          className="duet-filament-mgr__rename-input"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          autoFocus
                          disabled={renaming}
                        />
                        <button type="submit" className="duet-filament-mgr__confirm-btn" disabled={renaming}>
                          {renaming ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
                        </button>
                        <button type="button" className="duet-filament-mgr__cancel-btn" onClick={() => setRenamingName(null)}>
                          <X size={12} />
                        </button>
                      </form>
                    ) : (
                      <div className="duet-filament-mgr__name-cell">
                        <FlaskConical size={14} color="var(--info)" />
                        {name}
                      </div>
                    )}
                  </td>
                  <td className="duet-filament-mgr__td duet-filament-mgr__td--center">
                    <button
                      className="duet-filament-mgr__icon-btn duet-filament-mgr__icon-btn--edit"
                      onClick={() => setEditingPath(`0:/filaments/${name}/config.g`)}
                      title="Edit load macro (config.g)"
                    >
                      <FileCode size={14} />
                    </button>
                  </td>
                  <td className="duet-filament-mgr__td duet-filament-mgr__td--center">
                    <button
                      className="duet-filament-mgr__icon-btn duet-filament-mgr__icon-btn--edit"
                      onClick={() => setEditingPath(`0:/filaments/${name}/unload.g`)}
                      title="Edit unload macro (unload.g)"
                    >
                      <FileCode size={14} />
                    </button>
                  </td>
                  <td className="duet-filament-mgr__td duet-filament-mgr__td--right">
                    <div className="duet-filament-mgr__actions">
                      <button
                        className="duet-filament-mgr__icon-btn"
                        onClick={() => { setRenamingName(name); setRenameValue(name); }}
                        title="Rename filament"
                        disabled={renamingName !== null}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className="duet-filament-mgr__icon-btn--danger"
                        onClick={() => void handleDelete(name)}
                        title="Delete filament"
                        disabled={deletingName === name}
                      >
                        {deletingName === name
                          ? <Loader2 size={13} className="spin" />
                          : <Trash2 size={13} />
                        }
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
