import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  RefreshCw, Plus, Pencil, Trash2, FileCode, Loader2, FlaskConical, Check, X,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import DuetFileEditor from './DuetFileEditor';
import './DuetFilamentManager.css';

// ---------------------------------------------------------------------------
// Filament color helpers (persisted in localStorage)
// ---------------------------------------------------------------------------

const FILAMENT_COLORS_KEY = 'dzign3d-filament-colors';
const FILAMENT_PROPS_KEY = 'dzign3d-filament-props';
const FILAMENT_SPOOLS_KEY = 'dzign3d-filament-spools';

const MATERIAL_TYPES = ['PLA', 'ABS', 'PETG', 'TPU', 'Nylon', 'ASA', 'PC', 'HIPS', 'PVA', 'Other'] as const;

interface FilamentProps {
  diameter: number;   // mm
  material: string;
}

interface SpoolData {
  spoolWeight: number; // total spool weight in grams
  usedWeight: number;  // weight used so far in grams
}

function loadFilamentColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FILAMENT_COLORS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveFilamentColor(name: string, color: string) {
  const colors = loadFilamentColors();
  colors[name] = color;
  try { localStorage.setItem(FILAMENT_COLORS_KEY, JSON.stringify(colors)); } catch { /* ignore */ }
}

function loadFilamentProps(): Record<string, FilamentProps> {
  try {
    const raw = localStorage.getItem(FILAMENT_PROPS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveFilamentProps(name: string, props: FilamentProps) {
  const all = loadFilamentProps();
  all[name] = props;
  try { localStorage.setItem(FILAMENT_PROPS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

function loadSpoolData(): Record<string, SpoolData> {
  try {
    const raw = localStorage.getItem(FILAMENT_SPOOLS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveSpoolEntry(name: string, data: SpoolData) {
  const all = loadSpoolData();
  all[name] = data;
  try { localStorage.setItem(FILAMENT_SPOOLS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

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
                <th className="duet-filament-mgr__th duet-filament-mgr__th--center" style={{ width: 40 }}>Color</th>
                <th className="duet-filament-mgr__th">Name</th>
                <th className="duet-filament-mgr__th" style={{ width: 80 }}>Diameter</th>
                <th className="duet-filament-mgr__th" style={{ width: 90 }}>Material</th>
                <th className="duet-filament-mgr__th duet-filament-mgr__th--center" style={{ width: 80 }}>Spool (g)</th>
                <th className="duet-filament-mgr__th duet-filament-mgr__th--center" style={{ width: 80 }}>Used (g)</th>
                <th className="duet-filament-mgr__th duet-filament-mgr__th--center" style={{ width: 130 }}>Remaining</th>
                <th className="duet-filament-mgr__th">Loaded In</th>
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
                  <td className="duet-filament-mgr__td duet-filament-mgr__td--center">
                    <label style={{ position: 'relative', display: 'inline-block', width: 20, height: 20, cursor: 'pointer' }}>
                      <span style={{
                        display: 'inline-block',
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: filamentColors[name] ?? '#888888',
                        border: '2px solid var(--border-strong)',
                      }} />
                      <input
                        type="color"
                        value={filamentColors[name] ?? '#888888'}
                        onChange={(e) => {
                          const c = e.target.value;
                          saveFilamentColor(name, c);
                          setFilamentColors((prev) => ({ ...prev, [name]: c }));
                        }}
                        style={{
                          position: 'absolute', inset: 0, opacity: 0,
                          width: '100%', height: '100%', cursor: 'pointer', padding: 0, border: 'none',
                        }}
                      />
                    </label>
                  </td>
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
                  <td className="duet-filament-mgr__td">
                    <input
                      type="number"
                      step="0.05"
                      min="0.5"
                      max="5"
                      value={filamentProps[name]?.diameter ?? 1.75}
                      onChange={(e) => {
                        const d = parseFloat(e.target.value);
                        if (isNaN(d)) return;
                        const props: FilamentProps = { ...(filamentProps[name] ?? { diameter: 1.75, material: 'PLA' }), diameter: d };
                        saveFilamentProps(name, props);
                        setFilamentProps((prev) => ({ ...prev, [name]: props }));
                      }}
                      style={{
                        width: 60, padding: '2px 4px', fontSize: 12,
                        background: 'var(--bg-input)', color: 'var(--text-primary)',
                        border: '1px solid var(--border)', borderRadius: 3,
                        fontFamily: 'inherit',
                      }}
                      title="Filament diameter in mm"
                    />
                  </td>
                  <td className="duet-filament-mgr__td">
                    <select
                      value={filamentProps[name]?.material ?? 'PLA'}
                      onChange={(e) => {
                        const props: FilamentProps = { ...(filamentProps[name] ?? { diameter: 1.75, material: 'PLA' }), material: e.target.value };
                        saveFilamentProps(name, props);
                        setFilamentProps((prev) => ({ ...prev, [name]: props }));
                      }}
                      style={{
                        padding: '2px 4px', fontSize: 12,
                        background: 'var(--bg-input)', color: 'var(--text-primary)',
                        border: '1px solid var(--border)', borderRadius: 3,
                        fontFamily: 'inherit',
                      }}
                      title="Material type"
                    >
                      {MATERIAL_TYPES.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </td>
                  {/* Spool weight */}
                  <td className="duet-filament-mgr__td duet-filament-mgr__td--center">
                    <input
                      className="duet-filament-mgr__spool-input"
                      type="number"
                      min={0}
                      step={1}
                      placeholder="1000"
                      value={spoolData[name]?.spoolWeight ?? ''}
                      onChange={(e) => {
                        const v = e.target.value === '' ? 0 : Number(e.target.value);
                        const cur = spoolData[name] ?? { spoolWeight: 0, usedWeight: 0 };
                        const updated = { ...cur, spoolWeight: v };
                        saveSpoolEntry(name, updated);
                        setSpoolData((prev) => ({ ...prev, [name]: updated }));
                      }}
                    />
                  </td>
                  {/* Used weight */}
                  <td className="duet-filament-mgr__td duet-filament-mgr__td--center">
                    <input
                      className="duet-filament-mgr__spool-input"
                      type="number"
                      min={0}
                      step={1}
                      placeholder="0"
                      value={spoolData[name]?.usedWeight ?? ''}
                      onChange={(e) => {
                        const v = e.target.value === '' ? 0 : Number(e.target.value);
                        const cur = spoolData[name] ?? { spoolWeight: 0, usedWeight: 0 };
                        const updated = { ...cur, usedWeight: v };
                        saveSpoolEntry(name, updated);
                        setSpoolData((prev) => ({ ...prev, [name]: updated }));
                      }}
                    />
                  </td>
                  {/* Remaining weight + percentage bar */}
                  <td className="duet-filament-mgr__td duet-filament-mgr__td--center">
                    {(() => {
                      const spool = spoolData[name];
                      if (!spool || spool.spoolWeight <= 0) return <span className="duet-filament-mgr__not-loaded">--</span>;
                      const remaining = Math.max(0, spool.spoolWeight - spool.usedWeight);
                      const pct = Math.round((remaining / spool.spoolWeight) * 100);
                      return (
                        <div className="duet-filament-mgr__remaining-wrap">
                          <span className="duet-filament-mgr__remaining-text">{remaining}g ({pct}%)</span>
                          <div className="duet-filament-mgr__remaining-bar-track">
                            <div
                              className="duet-filament-mgr__remaining-bar-fill"
                              style={{
                                width: `${pct}%`,
                                background: pct > 25 ? 'var(--success)' : pct > 10 ? 'var(--warning)' : 'var(--error)',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="duet-filament-mgr__td">
                    {filamentToolMap[name] ? (
                      <span className="duet-filament-mgr__loaded-badge">
                        {filamentToolMap[name].join(', ')}
                      </span>
                    ) : (
                      <span className="duet-filament-mgr__not-loaded">--</span>
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
