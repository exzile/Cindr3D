import { useState, useCallback, useEffect } from 'react';
import {
  RefreshCw, Plus, Pencil, Trash2, FileCode, Loader2, FlaskConical, Check, X,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import DuetFileEditor from './DuetFileEditor';

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
// Styles
// ---------------------------------------------------------------------------

const S: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#1e1e1e',
    color: '#ccc',
    fontSize: 13,
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 12px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #333',
    flexShrink: 0,
  },
  toolbarBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    fontSize: 12,
    border: '1px solid #555',
    borderRadius: 4,
    background: '#353535',
    color: '#ccc',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  toolbarBtnPrimary: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    fontSize: 12,
    border: 'none',
    borderRadius: 4,
    background: '#0078d4',
    color: '#fff',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  scrollArea: {
    flex: 1,
    overflow: 'auto',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: '48px 24px',
    color: '#666',
  },
  emptyText: {
    margin: 0,
    fontSize: 14,
    color: '#888',
  },
  emptyHint: {
    margin: 0,
    fontSize: 12,
    color: '#555',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  thead: {
    backgroundColor: '#252526',
    position: 'sticky' as const,
    top: 0,
    zIndex: 1,
  },
  th: {
    padding: '7px 12px',
    textAlign: 'left' as const,
    fontSize: 11,
    fontWeight: 600,
    color: '#888',
    borderBottom: '1px solid #333',
    whiteSpace: 'nowrap' as const,
  },
  tr: {
    borderBottom: '1px solid #2a2a2a',
    transition: 'background 0.1s',
  },
  td: {
    padding: '7px 12px',
    verticalAlign: 'middle' as const,
  },
  filamentName: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontWeight: 500,
    color: '#e0e0e0',
  },
  actions: {
    display: 'flex',
    gap: 4,
    justifyContent: 'flex-end',
  },
  iconBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    borderRadius: 3,
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: '#888',
  },
  iconBtnDanger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    borderRadius: 3,
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: '#e57373',
  },
  loadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '24px 12px',
    color: '#666',
    fontSize: 13,
  },
  newFilamentBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 12px',
    backgroundColor: '#252526',
    borderTop: '1px solid #333',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    padding: '4px 8px',
    fontSize: 12,
    border: '1px solid #555',
    borderRadius: 4,
    backgroundColor: '#1e1e1e',
    color: '#ccc',
    outline: 'none',
  },
  confirmBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    padding: '4px 10px',
    fontSize: 12,
    border: 'none',
    borderRadius: 4,
    background: '#388e3c',
    color: '#fff',
    cursor: 'pointer',
  },
  cancelBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    padding: '4px 10px',
    fontSize: 12,
    border: '1px solid #555',
    borderRadius: 4,
    background: '#353535',
    color: '#aaa',
    cursor: 'pointer',
  },
  renameInput: {
    padding: '2px 6px',
    fontSize: 13,
    border: '1px solid #0078d4',
    borderRadius: 3,
    backgroundColor: '#1e1e1e',
    color: '#e0e0e0',
    outline: 'none',
    width: 160,
  },
};

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
    <div style={S.wrap}>
      {/* Toolbar */}
      <div style={S.toolbar}>
        <button
          style={S.toolbarBtnPrimary}
          onClick={() => { setShowNew(true); setNewName(''); }}
          disabled={!connected}
          title="Create new filament"
        >
          <Plus size={13} /> New Filament
        </button>
        <button
          style={S.toolbarBtn}
          onClick={handleRefresh}
          disabled={loading || !connected}
          title="Refresh filament list"
        >
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
        {error && (
          <span style={{ color: '#ef5350', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {error}
          </span>
        )}
      </div>

      {/* Filament list */}
      <div style={S.scrollArea}>
        {!connected ? (
          <div style={S.emptyState}>
            <FlaskConical size={40} strokeWidth={1} color="#555" />
            <p style={S.emptyText}>Not connected</p>
            <p style={S.emptyHint}>Connect to a printer to manage filaments.</p>
          </div>
        ) : loading && filaments.length === 0 ? (
          <div style={S.loadingRow}>
            <Loader2 size={16} className="spin" /> Loading filaments…
          </div>
        ) : filaments.length === 0 ? (
          <div style={S.emptyState}>
            <FlaskConical size={40} strokeWidth={1} color="#555" />
            <p style={S.emptyText}>No filaments defined</p>
            <p style={S.emptyHint}>Click "New Filament" to add one. Each filament gets load / unload G-code macros.</p>
          </div>
        ) : (
          <table style={S.table}>
            <thead style={S.thead}>
              <tr>
                <th style={S.th}>Name</th>
                <th style={{ ...S.th, textAlign: 'center' }}>Load Macro</th>
                <th style={{ ...S.th, textAlign: 'center' }}>Unload Macro</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filaments.map((name) => (
                <tr
                  key={name}
                  style={S.tr}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#2a2a2a'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = ''; }}
                >
                  <td style={S.td}>
                    {renamingName === name ? (
                      <form
                        style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                        onSubmit={(e) => { e.preventDefault(); void handleRenameCommit(); }}
                      >
                        <input
                          style={S.renameInput}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          autoFocus
                          disabled={renaming}
                        />
                        <button type="submit" style={S.confirmBtn} disabled={renaming}>
                          {renaming ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
                        </button>
                        <button type="button" style={S.cancelBtn} onClick={() => setRenamingName(null)}>
                          <X size={12} />
                        </button>
                      </form>
                    ) : (
                      <div style={S.filamentName}>
                        <FlaskConical size={14} color="#90caf9" />
                        {name}
                      </div>
                    )}
                  </td>
                  <td style={{ ...S.td, textAlign: 'center' }}>
                    <button
                      style={{ ...S.iconBtn, color: '#80cbc4' }}
                      onClick={() => setEditingPath(`0:/filaments/${name}/config.g`)}
                      title="Edit load macro (config.g)"
                    >
                      <FileCode size={14} />
                    </button>
                  </td>
                  <td style={{ ...S.td, textAlign: 'center' }}>
                    <button
                      style={{ ...S.iconBtn, color: '#80cbc4' }}
                      onClick={() => setEditingPath(`0:/filaments/${name}/unload.g`)}
                      title="Edit unload macro (unload.g)"
                    >
                      <FileCode size={14} />
                    </button>
                  </td>
                  <td style={{ ...S.td, textAlign: 'right' }}>
                    <div style={S.actions}>
                      <button
                        style={S.iconBtn}
                        onClick={() => { setRenamingName(name); setRenameValue(name); }}
                        title="Rename filament"
                        disabled={renamingName !== null}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        style={S.iconBtnDanger}
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
        <div style={S.newFilamentBar}>
          <FlaskConical size={14} color="#90caf9" />
          <input
            style={S.input}
            placeholder="Filament name (e.g. PLA-White)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); if (e.key === 'Escape') setShowNew(false); }}
            autoFocus
            disabled={creating}
          />
          <button
            style={S.confirmBtn}
            onClick={() => void handleCreate()}
            disabled={creating || !newName.trim()}
          >
            {creating ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
            Create
          </button>
          <button style={S.cancelBtn} onClick={() => setShowNew(false)} disabled={creating}>
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
