/**
 * SpoolManager — universal filament spool tracker.
 * Uses localStorage via spoolStore. Works with any printer firmware.
 */
import { useState } from 'react';
import { AlertTriangle, Package, Plus, Trash2, CheckCircle, Circle, Pencil, X, Save } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { aggregateInventory, remainingG, useSpoolStore, type Spool } from '../../store/spoolStore';
import './KlipperTabs.css';

const MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'Nylon', 'PC', 'PLA+', 'SILK PLA', 'Other'];
const DIAMETERS = [1.75, 2.85, 3.0];

const DEFAULT_FORM = {
  brand: '',
  material: 'PLA',
  colorHex: 'ff5500',
  colorName: '',
  initialWeightG: 1000,
  usedWeightG: 0,
  diameterMm: 1.75,
  notes: '',
};

type FormState = typeof DEFAULT_FORM;

function pctRemaining(spool: Spool) {
  if (spool.initialWeightG <= 0) return 0;
  return Math.max(0, Math.min(100, (remainingG(spool) / spool.initialWeightG) * 100));
}

function AddSpoolModal({ onClose }: { onClose: () => void }) {
  const addSpool = useSpoolStore((s) => s.addSpool);
  const setActiveSpool = useSpoolStore((s) => s.setActiveSpool);
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM });

  const patch = (k: keyof FormState, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = () => {
    const id = addSpool({
      ...form,
      colorHex: form.colorHex.replace(/^#/, ''),
    });
    setActiveSpool(id);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8,
        padding: 20, width: 380, display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Add Spool</span>
          <button className="klipper-btn" style={{ padding: '2px 6px' }} onClick={onClose}><X size={13} /></button>
        </div>

        <div className="klipper-form-row">
          <label style={{ minWidth: 100 }}>Brand</label>
          <input type="text" placeholder="e.g. Hatchbox" value={form.brand}
            onChange={(e) => patch('brand', e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="klipper-form-row">
          <label style={{ minWidth: 100 }}>Material</label>
          <select value={form.material} onChange={(e) => patch('material', e.target.value)} style={{ flex: 1 }}>
            {MATERIALS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div className="klipper-form-row">
          <label style={{ minWidth: 100 }}>Color</label>
          <input type="color" value={`#${form.colorHex}`}
            onChange={(e) => patch('colorHex', e.target.value.replace('#', ''))}
            style={{ width: 36, height: 28, padding: 0, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }} />
          <input type="text" placeholder="Name (e.g. Sunset Orange)" value={form.colorName}
            onChange={(e) => patch('colorName', e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="klipper-form-row">
          <label style={{ minWidth: 100 }}>Weight (g)</label>
          <input type="number" min={0} value={form.initialWeightG}
            onChange={(e) => patch('initialWeightG', parseFloat(e.target.value) || 0)} style={{ width: 90 }} />
          <label>Used (g)</label>
          <input type="number" min={0} max={form.initialWeightG} value={form.usedWeightG}
            onChange={(e) => patch('usedWeightG', parseFloat(e.target.value) || 0)} style={{ width: 90 }} />
        </div>
        <div className="klipper-form-row">
          <label style={{ minWidth: 100 }}>Diameter</label>
          <select value={form.diameterMm} onChange={(e) => patch('diameterMm', parseFloat(e.target.value))} style={{ width: 90 }}>
            {DIAMETERS.map((d) => <option key={d} value={d}>{d} mm</option>)}
          </select>
        </div>
        <div className="klipper-form-row" style={{ alignItems: 'flex-start' }}>
          <label style={{ minWidth: 100, paddingTop: 4 }}>Notes</label>
          <textarea rows={2} value={form.notes} onChange={(e) => patch('notes', e.target.value)}
            style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4,
              background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12, resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="klipper-btn" onClick={onClose}>Cancel</button>
          <button className="klipper-btn klipper-btn-primary" onClick={handleSubmit}
            disabled={!form.brand && !form.colorName}>
            <Save size={13} /> Add Spool
          </button>
        </div>
      </div>
    </div>
  );
}

function SpoolRow({ spool, isActive }: { spool: Spool; isActive: boolean }) {
  const { setActiveSpool, removeSpool, updateSpool } = useSpoolStore();
  const [editing, setEditing] = useState(false);
  const [editUsed, setEditUsed] = useState(String(spool.usedWeightG));
  const pct = pctRemaining(spool);
  const barColor = pct > 50 ? '#22c55e' : pct > 20 ? '#f59e0b' : '#ef4444';

  const saveEdit = () => {
    const v = parseFloat(editUsed);
    if (!isNaN(v)) updateSpool(spool.id, { usedWeightG: Math.max(0, Math.min(v, spool.initialWeightG)) });
    setEditing(false);
  };

  return (
    <tr>
      <td>
        <button
          className="klipper-btn"
          style={{ padding: '3px 6px', borderColor: isActive ? 'var(--accent)' : undefined, color: isActive ? 'var(--accent)' : undefined }}
          onClick={() => setActiveSpool(isActive ? null : spool.id)}
          title={isActive ? 'Deselect' : 'Set as active spool'}
        >
          {isActive ? <CheckCircle size={13} /> : <Circle size={13} />}
        </button>
      </td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 18, height: 18, borderRadius: '50%',
            background: `#${spool.colorHex}`,
            border: '1px solid var(--border)', flexShrink: 0,
          }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 12 }}>{spool.brand || '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{spool.colorName || `#${spool.colorHex}`}</div>
          </div>
        </div>
      </td>
      <td>
        <span className="klipper-badge info">{spool.material}</span>
      </td>
      <td>{spool.diameterMm} mm</td>
      <td>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {editing ? (
              <>
                <input type="number" min={0} max={spool.initialWeightG} value={editUsed}
                  onChange={(e) => setEditUsed(e.target.value)}
                  style={{ width: 70, padding: '2px 6px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/ {spool.initialWeightG} g used</span>
                <button className="klipper-btn klipper-btn-primary" style={{ padding: '2px 6px' }} onClick={saveEdit}><Save size={11} /></button>
                <button className="klipper-btn" style={{ padding: '2px 6px' }} onClick={() => setEditing(false)}><X size={11} /></button>
              </>
            ) : (
              <>
                <span style={{ fontSize: 12 }}>{remainingG(spool).toFixed(0)} g left</span>
                <button className="klipper-btn" style={{ padding: '2px 4px' }} onClick={() => { setEditUsed(String(spool.usedWeightG)); setEditing(true); }}><Pencil size={11} /></button>
              </>
            )}
          </div>
          <div style={{ width: 100, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct.toFixed(1)}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>
      </td>
      <td>
        <button className="klipper-btn klipper-btn-danger" style={{ padding: '3px 6px' }}
          onClick={() => { if (confirm(`Remove spool "${spool.brand} ${spool.colorName}"?`)) removeSpool(spool.id); }}>
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  );
}

export default function SpoolManager() {
  const printers = usePrinterStore((s) => s.printers);
  const {
    spools,
    activeSpoolId,
    loadedSpoolByPrinterId,
    lowStockThresholdByMaterial,
    setPrinterLoadedSpool,
    setMaterialThreshold,
  } = useSpoolStore();
  const [showAdd, setShowAdd] = useState(false);
  const activeSpool = spools.find((s) => s.id === activeSpoolId) ?? null;
  const materialSummary = aggregateInventory(spools, lowStockThresholdByMaterial);

  return (
    <div className="klipper-tab">
      {showAdd && <AddSpoolModal onClose={() => setShowAdd(false)} />}

      <div className="klipper-tab-bar">
        <Package size={15} />
        <h3>Spool Manager</h3>
        <div className="spacer" />
        <button className="klipper-btn klipper-btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Add Spool
        </button>
      </div>

      <div className="klipper-tab-body">
        {/* Active spool summary */}
        {activeSpool && (
          <div className="klipper-card">
            <div className="klipper-card-header">Active Spool</div>
            <div className="klipper-card-body" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: `#${activeSpool.colorHex}`,
                border: '2px solid var(--border)', flexShrink: 0,
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {activeSpool.brand} — {activeSpool.colorName || `#${activeSpool.colorHex}`}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {activeSpool.material} · {activeSpool.diameterMm} mm · {remainingG(activeSpool).toFixed(0)} g remaining
                </div>
                <div style={{ marginTop: 6, width: '100%', height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${pctRemaining(activeSpool).toFixed(1)}%`,
                    background: pctRemaining(activeSpool) > 50 ? '#22c55e' : pctRemaining(activeSpool) > 20 ? '#f59e0b' : '#ef4444',
                    borderRadius: 3, transition: 'width 0.3s',
                  }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Fleet inventory rollup */}
        <div className="klipper-card">
          <div className="klipper-card-header">Fleet Inventory</div>
          <div className="klipper-card-body" style={{ gap: 12 }}>
            {materialSummary.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No material inventory yet.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                {materialSummary.map((summary) => (
                  <div
                    key={summary.material}
                    style={{
                      display: 'grid',
                      gap: 6,
                      padding: 10,
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--bg-primary)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{summary.material}</strong>
                      {summary.lowStock && <span className="klipper-badge warning"><AlertTriangle size={11} /> Low</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {summary.remainingG.toFixed(0)} g across {summary.spoolCount} spool{summary.spoolCount === 1 ? '' : 's'}
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                      Warn below
                      <input
                        type="number"
                        min={0}
                        value={summary.thresholdG}
                        onChange={(event) => setMaterialThreshold(summary.material, parseFloat(event.target.value) || 0)}
                        style={{ width: 72, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                      />
                      g
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Per-printer loaded spool assignments */}
        <div className="klipper-card">
          <div className="klipper-card-header">Loaded Spools by Printer</div>
          <div className="klipper-card-body" style={{ gap: 8 }}>
            {printers.map((printer) => (
              <div key={printer.id} className="klipper-form-row">
                <label style={{ minWidth: 140 }}>{printer.name}</label>
                <select
                  value={loadedSpoolByPrinterId[printer.id] ?? ''}
                  onChange={(event) => setPrinterLoadedSpool(printer.id, event.target.value || null)}
                  style={{ flex: 1 }}
                >
                  <option value="">No loaded spool</option>
                  {spools.map((spool) => (
                    <option key={spool.id} value={spool.id}>
                      {spool.material} - {spool.brand || spool.colorName || spool.id} ({remainingG(spool).toFixed(0)} g)
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {printers.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Add printers before assigning loaded spools.</div>
            )}
          </div>
        </div>

        {/* Spool inventory table */}
        <div className="klipper-card">
          <div className="klipper-card-header">
            Inventory
            <span className="klipper-badge info" style={{ marginLeft: 6 }}>{spools.length}</span>
          </div>
          <div className="klipper-card-body" style={{ padding: 0 }}>
            {spools.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                No spools yet. Add your first spool with the button above.
              </div>
            ) : (
              <table className="klipper-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>Brand / Color</th>
                    <th>Material</th>
                    <th>Dia.</th>
                    <th>Remaining</th>
                    <th style={{ width: 48 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {spools.map((sp) => (
                    <SpoolRow key={sp.id} spool={sp} isActive={sp.id === activeSpoolId} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="klipper-card">
          <div className="klipper-card-header">About Spool Tracking</div>
          <div className="klipper-card-body">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              Spool data is stored locally in your browser. Assign loaded spools per printer to allow automatic
              deduction from slicer-estimated filament usage when a print completes. Manually update the <strong>Used</strong> weight with the edit button when needed.
              For automatic tracking with Klipper + Spoolman, see the Klipper Spoolman tab.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
