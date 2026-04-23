import type { Dispatch, SetStateAction } from 'react';
import {
  Check,
  FileCode,
  FlaskConical,
  Loader2,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import type { FilamentProps, SpoolData } from './storage';
import {
  MATERIAL_TYPES,
  saveFilamentColor,
  saveFilamentProps,
  saveSpoolEntry,
} from './storage';

export function FilamentTable({
  deletingName,
  filamentColors,
  filamentProps,
  filamentToolMap,
  filaments,
  handleDelete,
  handleRenameCommit,
  renaming,
  renamingName,
  renameValue,
  setEditingPath,
  setFilamentColors,
  setFilamentProps,
  setRenameValue,
  setRenamingName,
  setSpoolData,
  spoolData,
}: {
  deletingName: string | null;
  filamentColors: Record<string, string>;
  filamentProps: Record<string, FilamentProps>;
  filamentToolMap: Record<string, string[]>;
  filaments: string[];
  handleDelete: (name: string) => Promise<void>;
  handleRenameCommit: () => Promise<void>;
  renaming: boolean;
  renamingName: string | null;
  renameValue: string;
  setEditingPath: (path: string | null) => void;
  setFilamentColors: Dispatch<SetStateAction<Record<string, string>>>;
  setFilamentProps: Dispatch<SetStateAction<Record<string, FilamentProps>>>;
  setRenameValue: (value: string) => void;
  setRenamingName: (name: string | null) => void;
  setSpoolData: Dispatch<SetStateAction<Record<string, SpoolData>>>;
  spoolData: Record<string, SpoolData>;
}) {
  return (
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
          <tr key={name} className="duet-filament-mgr__tr">
            <td className="duet-filament-mgr__td duet-filament-mgr__td--center">
              <label style={{ position: 'relative', display: 'inline-block', width: 20, height: 20, cursor: 'pointer' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: filamentColors[name] ?? '#888888',
                    border: '2px solid var(--border-strong)',
                  }}
                />
                <input
                  type="color"
                  value={filamentColors[name] ?? '#888888'}
                  onChange={(event) => {
                    const color = event.target.value;
                    saveFilamentColor(name, color);
                    setFilamentColors((prev) => ({ ...prev, [name]: color }));
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
                  onSubmit={(event) => { event.preventDefault(); void handleRenameCommit(); }}
                >
                  <input
                    className="duet-filament-mgr__rename-input"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
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
                onChange={(event) => {
                  const diameter = parseFloat(event.target.value);
                  if (Number.isNaN(diameter)) return;
                  const props: FilamentProps = { ...(filamentProps[name] ?? { diameter: 1.75, material: 'PLA' }), diameter };
                  saveFilamentProps(name, props);
                  setFilamentProps((prev) => ({ ...prev, [name]: props }));
                }}
                style={{
                  width: 60,
                  padding: '2px 4px',
                  fontSize: 12,
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  fontFamily: 'inherit',
                }}
                title="Filament diameter in mm"
              />
            </td>
            <td className="duet-filament-mgr__td">
              <select
                value={filamentProps[name]?.material ?? 'PLA'}
                onChange={(event) => {
                  const props: FilamentProps = { ...(filamentProps[name] ?? { diameter: 1.75, material: 'PLA' }), material: event.target.value };
                  saveFilamentProps(name, props);
                  setFilamentProps((prev) => ({ ...prev, [name]: props }));
                }}
                style={{
                  padding: '2px 4px',
                  fontSize: 12,
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  fontFamily: 'inherit',
                }}
                title="Material type"
              >
                {MATERIAL_TYPES.map((material) => (
                  <option key={material} value={material}>{material}</option>
                ))}
              </select>
            </td>
            <td className="duet-filament-mgr__td duet-filament-mgr__td--center">
              <input
                className="duet-filament-mgr__spool-input"
                type="number"
                min={0}
                step={1}
                placeholder="1000"
                value={spoolData[name]?.spoolWeight ?? ''}
                onChange={(event) => {
                  const value = event.target.value === '' ? 0 : Number(event.target.value);
                  const current = spoolData[name] ?? { spoolWeight: 0, usedWeight: 0 };
                  const updated = { ...current, spoolWeight: value };
                  saveSpoolEntry(name, updated);
                  setSpoolData((prev) => ({ ...prev, [name]: updated }));
                }}
              />
            </td>
            <td className="duet-filament-mgr__td duet-filament-mgr__td--center">
              <input
                className="duet-filament-mgr__spool-input"
                type="number"
                min={0}
                step={1}
                placeholder="0"
                value={spoolData[name]?.usedWeight ?? ''}
                onChange={(event) => {
                  const value = event.target.value === '' ? 0 : Number(event.target.value);
                  const current = spoolData[name] ?? { spoolWeight: 0, usedWeight: 0 };
                  const updated = { ...current, usedWeight: value };
                  saveSpoolEntry(name, updated);
                  setSpoolData((prev) => ({ ...prev, [name]: updated }));
                }}
              />
            </td>
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
                <span className="duet-filament-mgr__loaded-badge">{filamentToolMap[name].join(', ')}</span>
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
                  {deletingName === name ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
