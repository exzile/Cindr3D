import { useState } from 'react';
import { X, Printer, Plus, Trash2, ChevronRight, RefreshCw } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { usePrinterStore } from '../../../../store/printerStore';
import type { PrinterProfile } from '../../../../types/slicer';
import { colors, sharedStyles } from '../../../../utils/theme';
import { parseDuetConfig } from '../../../../utils/duetConfigParser';

// ── shared primitives ─────────────────────────────────────────────────────────

const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 0 };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minHeight: 30, marginBottom: 4 };

function Lbl({ children }: { children: React.ReactNode }) {
  return <div style={{ flex: 1, fontSize: 12, color: colors.text }}>{children}</div>;
}

function NumIn({ value, onChange, step = 1, min, max, suffix, width = 80 }: {
  value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; suffix?: string; width?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{
          ...sharedStyles.input,
          width,
          textAlign: 'right',
          borderRadius: suffix ? '4px 0 0 4px' : 4,
          borderRight: suffix ? 'none' : undefined,
        }}
      />
      {suffix && (
        <div style={{
          padding: '0 7px',
          fontSize: 11,
          color: colors.textDim,
          background: colors.panelLight,
          border: `1px solid ${colors.panelBorder}`,
          borderLeft: 'none',
          borderRadius: '0 4px 4px 0',
          height: 24,
          display: 'flex',
          alignItems: 'center',
        }}>
          {suffix}
        </div>
      )}
    </div>
  );
}

function SelIn<T extends string>({ value, onChange, options, width = 180 }: {
  value: T; onChange: (v: T) => void;
  options: { value: T; label: string }[]; width?: number;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{ ...sharedStyles.select, width }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Chk({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ ...row, cursor: 'pointer', gap: 7, marginBottom: 2 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: colors.accent }} />
      <span style={{ fontSize: 12, color: colors.text }}>{label}</span>
    </label>
  );
}

function GCode({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...sharedStyles.input,
          flex: 1,
          minHeight: 140,
          fontFamily: 'monospace',
          fontSize: 11,
          resize: 'none',
          lineHeight: 1.5,
        }}
      />
    </div>
  );
}

function ColHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 10 }}>{children}</div>
  );
}

// ── Printer tab ───────────────────────────────────────────────────────────────

function PrinterTab({ p, upd }: { p: PrinterProfile; upd: (u: Partial<PrinterProfile>) => void }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Top: two columns */}
      <div style={{ display: 'flex', gap: 32 }}>

        {/* Left: Printer Settings */}
        <div style={col}>
          <ColHead>Printer Settings</ColHead>
          <div style={row}><Lbl>X (Width)</Lbl><NumIn value={p.buildVolume.x} onChange={(v) => upd({ buildVolume: { ...p.buildVolume, x: v } })} suffix="mm" min={1} /></div>
          <div style={row}><Lbl>Y (Depth)</Lbl><NumIn value={p.buildVolume.y} onChange={(v) => upd({ buildVolume: { ...p.buildVolume, y: v } })} suffix="mm" min={1} /></div>
          <div style={row}><Lbl>Z (Height)</Lbl><NumIn value={p.buildVolume.z} onChange={(v) => upd({ buildVolume: { ...p.buildVolume, z: v } })} suffix="mm" min={1} /></div>
          <div style={row}>
            <Lbl>Build plate shape</Lbl>
            <SelIn
              value={p.buildPlateShape ?? 'rectangular'}
              onChange={(v) => upd({ buildPlateShape: v })}
              options={[{ value: 'rectangular', label: 'Rectangular' }, { value: 'elliptic', label: 'Elliptic' }]}
              width={150}
            />
          </div>
          <Chk checked={p.originCenter} onChange={(v) => upd({ originCenter: v })} label="Origin at center" />
          <Chk checked={p.hasHeatedBed} onChange={(v) => upd({ hasHeatedBed: v })} label="Heated bed" />
          <Chk checked={p.hasHeatedChamber} onChange={(v) => upd({ hasHeatedChamber: v })} label="Heated build volume" />
          <div style={{ ...row, marginTop: 4 }}>
            <Lbl>G-code flavor</Lbl>
            <SelIn
              value={p.gcodeFlavorType}
              onChange={(v) => upd({ gcodeFlavorType: v })}
              options={[
                { value: 'marlin',  label: 'Marlin' },
                { value: 'reprap',  label: 'RepRap (Sprinter / Repetier)' },
                { value: 'klipper', label: 'Klipper' },
                { value: 'duet',    label: 'Duet (RepRap Firmware)' },
              ]}
              width={200}
            />
          </div>
          <div style={row}>
            <Lbl>Print Time Estimation Factor</Lbl>
            <NumIn
              value={Math.round((p.printTimeEstimationFactor ?? 1.0) * 100)}
              onChange={(v) => upd({ printTimeEstimationFactor: v / 100 })}
              suffix="%"
              min={10}
              max={500}
            />
          </div>
        </div>

        {/* Right: Printhead Settings */}
        <div style={col}>
          <ColHead>Printhead Settings</ColHead>
          <div style={row}><Lbl>X min</Lbl><NumIn value={p.printheadMinX ?? -20} onChange={(v) => upd({ printheadMinX: v })} suffix="mm" /></div>
          <div style={row}><Lbl>Y min ('-' towards back)</Lbl><NumIn value={p.printheadMinY ?? -10} onChange={(v) => upd({ printheadMinY: v })} suffix="mm" /></div>
          <div style={row}><Lbl>X max</Lbl><NumIn value={p.printheadMaxX ?? 10} onChange={(v) => upd({ printheadMaxX: v })} suffix="mm" /></div>
          <div style={row}><Lbl>Y max ('+' towards front)</Lbl><NumIn value={p.printheadMaxY ?? 10} onChange={(v) => upd({ printheadMaxY: v })} suffix="mm" /></div>
          <div style={row}><Lbl>Gantry Height</Lbl><NumIn value={p.gantryHeight ?? p.buildVolume.z} onChange={(v) => upd({ gantryHeight: v })} suffix="mm" min={0} /></div>
          <div style={row}>
            <Lbl>Number of Extruders</Lbl>
            <SelIn
              value={String(p.nozzleCount) as '1'|'2'|'3'|'4'}
              onChange={(v) => upd({ nozzleCount: parseInt(v) })}
              options={(['1','2','3','4'] as const).map((n) => ({ value: n, label: n }))}
              width={80}
            />
          </div>
          <Chk checked={p.applyExtruderOffsets ?? true} onChange={(v) => upd({ applyExtruderOffsets: v })} label="Apply Extruder offsets to GCode" />
          <Chk checked={p.startGCodeMustBeFirst ?? false} onChange={(v) => upd({ startGCodeMustBeFirst: v })} label="Start GCode must be first" />
        </div>
      </div>

      {/* Bottom: G-code side by side */}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 200 }}>
        <GCode label="Start G-code" value={p.startGCode} onChange={(v) => upd({ startGCode: v })} />
        <GCode label="End G-code"   value={p.endGCode}   onChange={(v) => upd({ endGCode: v })} />
      </div>
    </div>
  );
}

// ── Extruder tab ──────────────────────────────────────────────────────────────

function ExtruderTab({ p, upd }: { p: PrinterProfile; upd: (u: Partial<PrinterProfile>) => void }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 32 }}>
        {/* Left */}
        <div style={col}>
          <ColHead>Nozzle Settings</ColHead>
          <div style={row}><Lbl>Nozzle size</Lbl><NumIn value={p.nozzleDiameter} onChange={(v) => upd({ nozzleDiameter: v })} step={0.1} min={0.1} max={2} suffix="mm" /></div>
          <div style={row}>
            <Lbl>Compatible material diameter</Lbl>
            <SelIn
              value={p.filamentDiameter === 2.85 ? '2.85' : '1.75'}
              onChange={(v) => upd({ filamentDiameter: parseFloat(v) })}
              options={[{ value: '1.75', label: '1.75 mm' }, { value: '2.85', label: '2.85 mm' }]}
              width={110}
            />
          </div>
          <div style={row}><Lbl>Nozzle offset X</Lbl><NumIn value={p.extruderOffsetX ?? 0} onChange={(v) => upd({ extruderOffsetX: v })} suffix="mm" /></div>
          <div style={row}><Lbl>Nozzle offset Y</Lbl><NumIn value={p.extruderOffsetY ?? 0} onChange={(v) => upd({ extruderOffsetY: v })} suffix="mm" /></div>
          <div style={row}><Lbl>Cooling Fan Number</Lbl><NumIn value={p.coolingFanNumber ?? 0} onChange={(v) => upd({ coolingFanNumber: Math.max(0, Math.round(v)) })} min={0} max={8} width={60} /></div>
        </div>

        {/* Right */}
        <div style={col}>
          <ColHead>&nbsp;</ColHead>
          <div style={row}><Lbl>Extruder Change duration</Lbl><NumIn value={p.extruderChangeDuration ?? 0} onChange={(v) => upd({ extruderChangeDuration: v })} step={0.1} min={0} suffix="s" /></div>
          <div style={row}><Lbl>Extruder Start G-code duration</Lbl><NumIn value={p.extruderStartGCodeDuration ?? 0} onChange={(v) => upd({ extruderStartGCodeDuration: v })} step={0.1} min={0} suffix="s" /></div>
          <div style={row}><Lbl>Extruder End G-code duration</Lbl><NumIn value={p.extruderEndGCodeDuration ?? 0} onChange={(v) => upd({ extruderEndGCodeDuration: v })} step={0.1} min={0} suffix="s" /></div>
        </div>
      </div>

      {/* G-code areas */}
      <div style={{ display: 'flex', gap: 16, flex: 1 }}>
        <div style={{ ...col, gap: 12 }}>
          <GCode label="Extruder Prestart G-code" value={p.extruderPrestartGCode ?? ''} onChange={(v) => upd({ extruderPrestartGCode: v })} />
          <GCode label="Extruder Start G-code"    value={p.extruderStartGCode ?? ''}    onChange={(v) => upd({ extruderStartGCode: v })} />
        </div>
        <div style={{ ...col, gap: 12 }}>
          <GCode label="Extruder End G-code" value={p.extruderEndGCode ?? ''} onChange={(v) => upd({ extruderEndGCode: v })} />
        </div>
      </div>
    </div>
  );
}

// ── main modal ────────────────────────────────────────────────────────────────

const TABS = ['Printer', 'Extruder 1'] as const;

export function SlicerPrinterManagerModal({ onClose }: { onClose: () => void }) {
  const printerProfiles  = useSlicerStore((s) => s.printerProfiles);
  const activePrinterId  = useSlicerStore((s) => s.activePrinterProfileId);
  const setActivePrinter = useSlicerStore((s) => s.setActivePrinterProfile);
  const deletePrinter    = useSlicerStore((s) => s.deletePrinterProfile);
  const createPrinter         = useSlicerStore((s) => s.createPrinterWithDefaults);
  const updatePrinter         = useSlicerStore((s) => s.updatePrinterProfile);
  const updateMaterialProfile = useSlicerStore((s) => s.updateMaterialProfile);
  const updatePrintProfile    = useSlicerStore((s) => s.updatePrintProfile);

  // Connected Duet printers from the printer store
  const duetPrinters     = usePrinterStore((s) => s.printers);
  const printerService   = usePrinterStore((s) => s.service);
  const printerConnected = usePrinterStore((s) => s.connected);
  const activeDuetId     = usePrinterStore((s) => s.activePrinterId);

  const [selectedId, setSelectedId]   = useState(activePrinterId);
  const [tab, setTab]                 = useState<typeof TABS[number]>('Printer');
  const [addingName, setAddingName]   = useState('');
  const [showAdd, setShowAdd]         = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [syncing, setSyncing]         = useState(false);
  const [syncError, setSyncError]     = useState<string | null>(null);
  const [syncStatus, setSyncStatus]   = useState<string | null>(null);
  const [selectedDuetId, setSelectedDuetId] = useState(activeDuetId);

  const selectedPrinter = printerProfiles.find((p) => p.id === selectedId) ?? printerProfiles[0];

  function upd(updates: Partial<PrinterProfile>) {
    if (selectedPrinter) updatePrinter(selectedPrinter.id, updates);
  }

  function handleCreate() {
    const name = addingName.trim();
    if (!name) return;
    createPrinter(name);
    const newId = useSlicerStore.getState().activePrinterProfileId;
    setSelectedId(newId);
    setAddingName('');
    setShowAdd(false);
    setSyncError(null);
  }

  async function handleSyncFromDuet() {
    const name = addingName.trim();
    if (!name) return;
    const service = printerService ?? usePrinterStore.getState().service;
    if (!service) { setSyncError('No connected Duet printer'); return; }
    setSyncing(true);
    setSyncError(null);
    try {
      const readFile = async (path: string) => {
        try { return await (await service.downloadFile(path)).text(); }
        catch { return ''; }
      };
      const [configG, startG, stopG, overrideG, tool0G, tpre0G, tfree0G] = await Promise.all([
        readFile('0:/sys/config.g'),
        readFile('0:/sys/start.g'),
        readFile('0:/sys/stop.g'),
        readFile('0:/sys/config-override.g'),  // calibrated M92/M566/M201/M203 values from M500
        readFile('0:/sys/tool0.g'),             // extruder start G-code (runs when T0 selected)
        readFile('0:/sys/tpre0.g'),             // extruder prestart G-code
        readFile('0:/sys/tfree0.g'),            // extruder end G-code (runs when T0 released)
      ]);
      const { profile, startGCode, endGCode, extruderStartGCode, extruderEndGCode, extruderPrestartGCode, materialPatch, printPatch } =
        parseDuetConfig(configG, startG, stopG, overrideG, tool0G, tpre0G, tfree0G);

      const duetPrinterName = duetPrinters.find((p) => p.id === selectedDuetId)?.name ?? '';
      const finalName = name || duetPrinterName || 'Duet Printer';

      createPrinter(finalName);
      const newId = useSlicerStore.getState().activePrinterProfileId;
      const existingProfile = useSlicerStore.getState().printerProfiles.find((p) => p.id === newId);
      updatePrinter(newId, {
        ...profile,
        gcodeFlavorType: 'duet',
        startGCode: startGCode || (existingProfile?.startGCode ?? ''),
        endGCode:   endGCode   || (existingProfile?.endGCode   ?? ''),
        ...(extruderStartGCode   ? { extruderStartGCode }   : {}),
        ...(extruderEndGCode     ? { extruderEndGCode }     : {}),
        ...(extruderPrestartGCode ? { extruderPrestartGCode } : {}),
      });

      // Apply material-profile patch (retraction, pressure advance)
      if (Object.keys(materialPatch.fields).length > 0) {
        const state = useSlicerStore.getState();
        const defaultMaterialId = state.printerLastMaterial[newId]
          ?? state.materialProfiles.find((m) => m.printerId === newId)?.id;
        if (defaultMaterialId) {
          updateMaterialProfile(defaultMaterialId, {
            ...materialPatch.fields,
            machineSourcedFields: materialPatch.machineSourcedFields,
          });
        }
      }

      // Apply print-profile patch (acceleration, jerk)
      if (Object.keys(printPatch.fields).length > 0) {
        const state = useSlicerStore.getState();
        const defaultPrintId = state.printerLastPrint[newId]
          ?? state.printProfiles.find((p) => p.printerId === newId)?.id;
        if (defaultPrintId) {
          updatePrintProfile(defaultPrintId, {
            ...printPatch.fields,
            machineSourcedFields: printPatch.machineSourcedFields,
          });
        }
      }
      setSelectedId(newId);
      setAddingName('');
      setShowAdd(false);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  // Re-sync the currently selected (already-added) printer from the connected
  // Duet board. Unlike handleSyncFromDuet which creates a new profile, this
  // updates the existing printer profile plus its bound material and print
  // profiles in place — pulling fresh acceleration (M204/M201) and jerk (M566)
  // values into the print profile so the slicer matches the board.
  async function handleSyncSelected() {
    if (!selectedPrinter) return;
    const service = printerService ?? usePrinterStore.getState().service;
    if (!service) { setSyncError('No connected Duet printer'); setSyncStatus(null); return; }
    setSyncing(true);
    setSyncError(null);
    setSyncStatus(null);
    try {
      const readFile = async (path: string) => {
        try { return await (await service.downloadFile(path)).text(); }
        catch { return ''; }
      };
      const [configG, startG, stopG, overrideG, tool0G, tpre0G, tfree0G] = await Promise.all([
        readFile('0:/sys/config.g'),
        readFile('0:/sys/start.g'),
        readFile('0:/sys/stop.g'),
        readFile('0:/sys/config-override.g'),
        readFile('0:/sys/tool0.g'),
        readFile('0:/sys/tpre0.g'),
        readFile('0:/sys/tfree0.g'),
      ]);
      if (!configG.trim()) {
        throw new Error('config.g is empty or missing on the board');
      }
      const { profile, startGCode, endGCode, extruderStartGCode, extruderEndGCode, extruderPrestartGCode, materialPatch, printPatch } =
        parseDuetConfig(configG, startG, stopG, overrideG, tool0G, tpre0G, tfree0G);

      updatePrinter(selectedPrinter.id, {
        ...profile,
        gcodeFlavorType: 'duet',
        ...(startGCode ? { startGCode } : {}),
        ...(endGCode   ? { endGCode }   : {}),
        ...(extruderStartGCode    ? { extruderStartGCode }    : {}),
        ...(extruderEndGCode      ? { extruderEndGCode }      : {}),
        ...(extruderPrestartGCode ? { extruderPrestartGCode } : {}),
      });

      const state = useSlicerStore.getState();

      if (Object.keys(materialPatch.fields).length > 0) {
        const materialId = state.printerLastMaterial[selectedPrinter.id]
          ?? state.materialProfiles.find((m) => m.printerId === selectedPrinter.id)?.id;
        if (materialId) {
          updateMaterialProfile(materialId, {
            ...materialPatch.fields,
            machineSourcedFields: materialPatch.machineSourcedFields,
          });
        }
      }

      if (Object.keys(printPatch.fields).length > 0) {
        const printId = state.printerLastPrint[selectedPrinter.id]
          ?? state.printProfiles.find((p) => p.printerId === selectedPrinter.id)?.id;
        if (printId) {
          updatePrintProfile(printId, {
            ...printPatch.fields,
            machineSourcedFields: printPatch.machineSourcedFields,
          });
        }
      }

      const printerFieldCount    = Object.keys(profile).length;
      const materialFieldCount   = Object.keys(materialPatch.fields).length;
      const printFieldCount      = Object.keys(printPatch.fields).length;
      setSyncStatus(`Synced ${printerFieldCount} printer, ${materialFieldCount} material, ${printFieldCount} print fields from Duet`);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  function handleDelete(id: string) {
    if (printerProfiles.length <= 1) return;
    deletePrinter(id);
    const remaining = printerProfiles.filter((p) => p.id !== id);
    setSelectedId(remaining[0]?.id ?? '');
    setConfirmDelete(null);
  }

  function handleSelectRow(id: string) {
    setSelectedId(id);
    setActivePrinter(id);
    setConfirmDelete(null);
    setSyncError(null);
    setSyncStatus(null);
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: colors.panel,
          border: `1px solid ${colors.panelBorder}`,
          borderRadius: 10,
          width: 860,
          height: 640,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 18px', flexShrink: 0,
          borderBottom: `1px solid ${colors.panelBorder}`,
          background: `linear-gradient(to bottom, color-mix(in srgb, ${colors.accent} 8%, ${colors.panelLight}), ${colors.panel})`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.text, fontSize: 14, fontWeight: 700 }}>
            <Printer size={16} color={colors.accent} />
            {selectedPrinter?.name ?? 'Manage Printers'}
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* Tabs (Cura puts them at the top, full width) */}
        <div style={{
          display: 'flex',
          borderBottom: `1px solid ${colors.panelBorder}`,
          background: colors.panelLight,
          flexShrink: 0,
        }}>
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '9px 24px',
                fontSize: 13,
                fontWeight: tab === t ? 700 : 400,
                color: tab === t ? colors.accent : colors.textDim,
                background: tab === t ? colors.panel : 'transparent',
                border: 'none',
                borderBottom: `2px solid ${tab === t ? colors.accent : 'transparent'}`,
                cursor: 'pointer',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body: sidebar + content */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* Left sidebar: printer list */}
          <div style={{
            width: 195,
            flexShrink: 0,
            borderRight: `1px solid ${colors.panelBorder}`,
            display: 'flex',
            flexDirection: 'column',
            background: colors.panelLight,
          }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {printerProfiles.map((printer) => {
                const isSel = printer.id === selectedId;
                const isConfirming = confirmDelete === printer.id;
                return (
                  <div
                    key={printer.id}
                    onClick={() => handleSelectRow(printer.id)}
                    style={{
                      padding: '8px 10px',
                      cursor: 'pointer',
                      borderBottom: `1px solid ${colors.panelBorder}`,
                      borderLeft: `3px solid ${isSel ? colors.accent : 'transparent'}`,
                      background: isSel ? `color-mix(in srgb, ${colors.accent} 10%, ${colors.panel})` : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: isSel ? 600 : 400, color: isSel ? colors.accent : colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {printer.name}
                        </div>
                        <div style={{ fontSize: 10, color: colors.textDim, marginTop: 1 }}>
                          {printer.buildVolume.x}×{printer.buildVolume.y}×{printer.buildVolume.z} mm
                        </div>
                      </div>
                      {isSel && <ChevronRight size={11} color={colors.accent} />}
                    </div>

                    {isConfirming ? (
                      <div style={{ display: 'flex', gap: 4, marginTop: 5 }} onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => handleDelete(printer.id)} style={{ ...sharedStyles.btnDanger, fontSize: 10, padding: '2px 7px' }}>Delete</button>
                        <button onClick={() => setConfirmDelete(null)} style={{ ...sharedStyles.btnBase, fontSize: 10, padding: '2px 7px' }}>Cancel</button>
                      </div>
                    ) : (
                      <button
                        disabled={printerProfiles.length <= 1}
                        onClick={(e) => { e.stopPropagation(); setConfirmDelete(printer.id); }}
                        style={{
                          background: 'transparent', border: 'none', color: colors.textDim,
                          cursor: printerProfiles.length <= 1 ? 'not-allowed' : 'pointer',
                          display: 'flex', padding: '2px 0', marginTop: 3,
                          opacity: printerProfiles.length <= 1 ? 0.3 : 1,
                          fontSize: 10, alignItems: 'center', gap: 3,
                        }}
                        onMouseEnter={(e) => { if (printerProfiles.length > 1) (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = colors.textDim; }}
                      >
                        <Trash2 size={10} /> Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add printer */}
            {showAdd ? (
              <div style={{ padding: '8px 10px', borderTop: `1px solid ${colors.panelBorder}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  autoFocus
                  style={{ ...sharedStyles.input, width: '100%', boxSizing: 'border-box', fontSize: 12 }}
                  placeholder="Printer name…"
                  value={addingName}
                  onChange={(e) => { setAddingName(e.target.value); setSyncError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setShowAdd(false); setAddingName(''); setSyncError(null); } }}
                />

                {/* Duet sync row — only visible when a Duet is connected */}
                {printerConnected && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 10, color: colors.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Sync from Duet
                    </div>
                    {duetPrinters.length > 1 && (
                      <select
                        value={selectedDuetId}
                        onChange={(e) => setSelectedDuetId(e.target.value)}
                        style={{ ...sharedStyles.select, width: '100%', fontSize: 11 }}
                      >
                        {duetPrinters.map((dp) => (
                          <option key={dp.id} value={dp.id}>{dp.name}</option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={handleSyncFromDuet}
                      disabled={syncing || !addingName.trim()}
                      style={{
                        ...sharedStyles.btnBase,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                        fontSize: 11, width: '100%',
                        opacity: (syncing || !addingName.trim()) ? 0.5 : 1,
                        cursor: (syncing || !addingName.trim()) ? 'not-allowed' : 'pointer',
                        color: colors.accent, borderColor: colors.accent,
                      }}
                    >
                      <RefreshCw size={11} className={syncing ? 'spin' : undefined} />
                      {syncing ? 'Reading config.g…' : 'Import from config.g'}
                    </button>
                    {syncError && (
                      <div style={{ fontSize: 10, color: '#ef4444' }}>{syncError}</div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={handleCreate} disabled={!addingName.trim()} style={{ ...sharedStyles.btnAccent, flex: 1, justifyContent: 'center', fontSize: 11, opacity: addingName.trim() ? 1 : 0.5 }}>Create</button>
                  <button onClick={() => { setShowAdd(false); setAddingName(''); setSyncError(null); }} style={{ ...sharedStyles.btnBase, fontSize: 11 }}>✕</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAdd(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px',
                  cursor: 'pointer', background: 'transparent', border: 'none',
                  borderTop: `1px solid ${colors.panelBorder}`,
                  color: colors.accent, fontSize: 12, fontWeight: 500, width: '100%',
                }}
              >
                <Plus size={13} /> Add Printer
              </button>
            )}
          </div>

          {/* Right: tab content */}
          {selectedPrinter ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {tab === 'Printer'     && <PrinterTab  p={selectedPrinter} upd={upd} />}
              {tab === 'Extruder 1' && <ExtruderTab p={selectedPrinter} upd={upd} />}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textDim, fontSize: 13 }}>
              Select a printer to edit
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 18px', borderTop: `1px solid ${colors.panelBorder}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            {printerConnected && selectedPrinter && (
              <button
                onClick={handleSyncSelected}
                disabled={syncing}
                title="Re-read config.g from the connected Duet and update this printer + its material and print profiles (acceleration, jerk, retraction, pressure advance)."
                style={{
                  ...sharedStyles.btnBase,
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12,
                  opacity: syncing ? 0.6 : 1,
                  cursor: syncing ? 'wait' : 'pointer',
                  color: colors.accent, borderColor: colors.accent,
                }}
              >
                <RefreshCw size={12} className={syncing ? 'spin' : undefined} />
                {syncing ? 'Syncing…' : 'Sync from Duet'}
              </button>
            )}
            {syncError && (
              <div style={{ fontSize: 11, color: '#ef4444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {syncError}
              </div>
            )}
            {!syncError && syncStatus && (
              <div style={{ fontSize: 11, color: colors.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {syncStatus}
              </div>
            )}
          </div>
          <button style={sharedStyles.btnAccent} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
