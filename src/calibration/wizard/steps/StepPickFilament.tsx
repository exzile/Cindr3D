import { useEffect, useState } from 'react';
import { useSpoolStore } from '../../../store/spoolStore';

// ── Constants ─────────────────────────────────────────────────────────────────

const GENERIC_MATERIALS = ['PLA', 'PLA+', 'PETG', 'ABS', 'ASA', 'TPU', 'PC', 'Nylon', 'Other'] as const;

// ── Props ─────────────────────────────────────────────────────────────────────

interface StepPickFilamentProps {
  printerId: string;
  spoolId: string;
  filamentMaterial: string;
  onChange: (update: { spoolId: string; filamentMaterial: string }) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function StepPickFilament({
  printerId,
  spoolId,
  filamentMaterial,
  onChange,
}: StepPickFilamentProps) {
  // ── Store ──────────────────────────────────────────────────────────────────
  const spools                = useSpoolStore((s) => s.spools);
  const loadedSpoolByPrinterId = useSpoolStore((s) => s.loadedSpoolByPrinterId);
  const activeSpoolId         = useSpoolStore((s) => s.activeSpoolId);
  const addSpool              = useSpoolStore((s) => s.addSpool);
  const setPrinterLoadedSpool = useSpoolStore((s) => s.setPrinterLoadedSpool);

  const loadedSpoolId = loadedSpoolByPrinterId[printerId] ?? activeSpoolId;

  // ── Add-spool modal state ──────────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [brand,           setBrand]           = useState('Generic');
  const [addMaterial,     setAddMaterial]     = useState('PLA');
  const [colorName,       setColorName]       = useState('Natural');
  const [colorHex,        setColorHex]        = useState('d8d8d8');
  const [initialWeightG,  setInitialWeightG]  = useState('1000');
  const [usedWeightG,     setUsedWeightG]     = useState('0');
  const [diameterMm,      setDiameterMm]      = useState('1.75');
  const [costPerKg,       setCostPerKg]       = useState('');
  const [notes,           setNotes]           = useState('');

  // ── Auto-select loaded spool on first render ───────────────────────────────
  useEffect(() => {
    if (!spoolId && loadedSpoolId) {
      const spool = spools.find((s) => s.id === loadedSpoolId);
      onChange({
        spoolId: loadedSpoolId,
        filamentMaterial: spool?.material ?? filamentMaterial,
      });
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const selectedSpool = spools.find((s) => s.id === spoolId);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleMaterialChange = (mat: string) => {
    onChange({ spoolId: '', filamentMaterial: mat });
  };

  const handleSpoolChange = (id: string) => {
    if (!id) {
      onChange({ spoolId: '', filamentMaterial });
      return;
    }
    const spool = spools.find((s) => s.id === id);
    onChange({
      spoolId: id,
      filamentMaterial: spool?.material ?? filamentMaterial,
    });
  };

  const parsedInitialWeight = Number(initialWeightG);
  const parsedUsedWeight    = Number(usedWeightG);
  const parsedDiameter      = Number(diameterMm);
  const parsedCost          = Number(costPerKg);
  const canAddSpool =
    brand.trim() !== '' &&
    addMaterial.trim() !== '' &&
    colorName.trim() !== '' &&
    Number.isFinite(parsedInitialWeight) && parsedInitialWeight > 0 &&
    Number.isFinite(parsedUsedWeight)    && parsedUsedWeight >= 0 &&
    parsedUsedWeight <= parsedInitialWeight &&
    Number.isFinite(parsedDiameter)      && parsedDiameter > 0;

  const handleAddSpool = () => {
    if (!canAddSpool) return;
    const id = addSpool({
      brand: brand.trim(),
      material: addMaterial.trim(),
      colorHex: colorHex.replace(/^#/, '').trim() || 'd8d8d8',
      colorName: colorName.trim(),
      initialWeightG: parsedInitialWeight,
      usedWeightG: parsedUsedWeight,
      diameterMm: parsedDiameter,
      costPerKg: Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : undefined,
      notes: notes.trim(),
    });
    setPrinterLoadedSpool(printerId, id);
    onChange({ spoolId: id, filamentMaterial: addMaterial.trim() });
    setShowAddModal(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="calib-step">
      <p>Select your filament material and nozzle size — these adjust the auto-configured slicer settings in the next step.</p>

      {/* ── Material row ─────────────────────────────────────────────────── */}
      <div className="calib-step__inline-field">
        <label>
          <span>Material</span>
          <select
            value={selectedSpool ? selectedSpool.material : filamentMaterial}
            disabled={!!selectedSpool}
            onChange={(e) => handleMaterialChange(e.target.value)}
          >
            {GENERIC_MATERIALS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
      </div>

      {/* ── Spool row (optional) ─────────────────────────────────────────── */}
      <div className="calib-step__inline-field">
        <label>
          <span>Spool {spools.length === 0 ? '(none configured)' : '(optional)'}</span>
          <select
            value={spoolId}
            onChange={(e) => handleSpoolChange(e.target.value)}
            disabled={spools.length === 0}
          >
            <option value="">-- No specific spool --</option>
            {spools.map((spool) => (
              <option key={spool.id} value={spool.id}>
                {spool.id === loadedSpoolId ? '★ ' : ''}
                {spool.brand} {spool.material} – {spool.colorName}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setShowAddModal(true)}>
          + Add spool
        </button>
      </div>

      {/* Spool detail */}
      {selectedSpool && (
        <div className="calib-step__checklist">
          <span>Brand: {selectedSpool.brand}</span>
          <span>Material: {selectedSpool.material}</span>
          <span>Color: {selectedSpool.colorName}</span>
          <span>Filament ⌀: {selectedSpool.diameterMm} mm</span>
          {selectedSpool.id === loadedSpoolId && (
            <span style={{ color: 'var(--accent)' }}>★ Currently loaded on this printer</span>
          )}
        </div>
      )}

      {/* Info banner when no spool selected */}
      {!selectedSpool && (
        <p className="calib-step__muted" style={{ fontSize: '11px', marginTop: 4 }}>
          No spool required — material and nozzle above are enough to configure the calibration settings.
          Select a spool if you want to track filament usage.
        </p>
      )}

      {/* ── Add spool modal ───────────────────────────────────────────────── */}
      {showAddModal && (
        <div className="calib-step__modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-filament-title">
          <div className="calib-step__modal">
            <header className="calib-step__modal-header">
              <h4 id="add-filament-title">Add filament spool</h4>
              <button type="button" onClick={() => setShowAddModal(false)}>Close</button>
            </header>
            <div className="calib-step__modal-grid">
              <label>
                <span>Brand</span>
                <input value={brand} onChange={(e) => setBrand(e.target.value)} />
              </label>
              <label>
                <span>Material</span>
                <select value={addMaterial} onChange={(e) => setAddMaterial(e.target.value)}>
                  {GENERIC_MATERIALS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Color name</span>
                <input value={colorName} onChange={(e) => setColorName(e.target.value)} />
              </label>
              <label>
                <span>Color</span>
                <input
                  type="color"
                  value={`#${colorHex.replace(/^#/, '')}`}
                  onChange={(e) => setColorHex(e.target.value.replace(/^#/, ''))}
                />
              </label>
              <label>
                <span>Initial weight (g)</span>
                <input type="number" min={1} value={initialWeightG} onChange={(e) => setInitialWeightG(e.target.value)} />
              </label>
              <label>
                <span>Used weight (g)</span>
                <input type="number" min={0} value={usedWeightG} onChange={(e) => setUsedWeightG(e.target.value)} />
              </label>
              <label>
                <span>Diameter (mm)</span>
                <select value={diameterMm} onChange={(e) => setDiameterMm(e.target.value)}>
                  <option value="1.75">1.75</option>
                  <option value="2.85">2.85</option>
                </select>
              </label>
              <label>
                <span>Cost / kg</span>
                <input type="number" min={0} step={0.01} value={costPerKg} placeholder="Optional" onChange={(e) => setCostPerKg(e.target.value)} />
              </label>
              <label className="calib-step__modal-field--full">
                <span>Notes</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>
            {!canAddSpool && (
              <span className="calib-step__error">Fill in brand, material, color, valid weights, and diameter.</span>
            )}
            <footer className="calib-step__modal-footer">
              <button type="button" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button type="button" disabled={!canAddSpool} onClick={handleAddSpool}>
                Add and select
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
