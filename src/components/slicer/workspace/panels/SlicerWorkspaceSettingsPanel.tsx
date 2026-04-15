import { useState, useCallback, type CSSProperties } from 'react';
import { Edit3, Settings, Printer, Droplets, SlidersHorizontal, Search } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import type { PrintProfile } from '../../../../types/slicer';
import { colors, sharedStyles } from '../../../../utils/theme';
import { SlicerSection } from '../../SlicerSection';
import { SlicerPrintProfileSettings } from '../../SlicerPrintProfileSettings';

const panelStyle: CSSProperties = {
  background: colors.panel,
  borderRight: `1px solid ${colors.panelBorder}`,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const btnBase = sharedStyles.btnBase;
const inputStyle = sharedStyles.input;
const selectStyle = sharedStyles.select;

export function SlicerWorkspaceSettingsPanel({ onEditProfile }: { onEditProfile: (type: 'printer' | 'material' | 'print') => void }) {
  const printerProfiles = useSlicerStore((s) => s.printerProfiles);
  const materialProfiles = useSlicerStore((s) => s.materialProfiles);
  const printProfiles = useSlicerStore((s) => s.printProfiles);
  const activePrinterId = useSlicerStore((s) => s.activePrinterProfileId);
  const activeMaterialId = useSlicerStore((s) => s.activeMaterialProfileId);
  const activePrintId = useSlicerStore((s) => s.activePrintProfileId);
  const setActivePrinter = useSlicerStore((s) => s.setActivePrinterProfile);
  const setActiveMaterial = useSlicerStore((s) => s.setActiveMaterialProfile);
  const setActivePrint = useSlicerStore((s) => s.setActivePrintProfile);
  const getActivePrinterProfile = useSlicerStore((s) => s.getActivePrinterProfile);
  const getActiveMaterialProfile = useSlicerStore((s) => s.getActiveMaterialProfile);
  const getActivePrintProfile = useSlicerStore((s) => s.getActivePrintProfile);
  const updatePrintProfile = useSlicerStore((s) => s.updatePrintProfile);

  const printer = getActivePrinterProfile();
  const material = getActiveMaterialProfile();
  const print = getActivePrintProfile();

  const [settingsSearch, setSettingsSearch] = useState('');

  const upd = useCallback((updates: Record<string, unknown>) => {
    if (print) updatePrintProfile(print.id, updates as Partial<PrintProfile>);
  }, [print, updatePrintProfile]);

  return (
    <div style={{ ...panelStyle, width: 300, borderLeft: `1px solid ${colors.panelBorder}`, borderRight: 'none' }}>
      <div style={{
        padding: '10px', borderBottom: `1px solid ${colors.panelBorder}`,
        display: 'flex', alignItems: 'center', gap: 6,
        color: colors.text, fontSize: 13, fontWeight: 600,
      }}>
        <Settings size={16} />
        Slicer Settings
      </div>

      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${colors.panelBorder}` }}>
        <div style={{ position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: colors.textDim }} />
          <input
            type="text"
            placeholder="Search settings..."
            value={settingsSearch}
            onChange={(e) => setSettingsSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft: 24, fontSize: 11 }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <SlicerSection title="Printer" icon={<Printer size={14} />}>
          <select style={selectStyle} value={activePrinterId} onChange={(e) => setActivePrinter(e.target.value)}>
            {printerProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {printer && (
            <div style={{ marginTop: 6, fontSize: 11, color: colors.textDim, lineHeight: 1.7 }}>
              <div>Build: {printer.buildVolume.x} × {printer.buildVolume.y} × {printer.buildVolume.z} mm</div>
              <div>Nozzle: {printer.nozzleDiameter} mm · Filament: {printer.filamentDiameter} mm</div>
              <div>Heated Bed: {printer.hasHeatedBed ? 'Yes' : 'No'}{printer.hasHeatedChamber ? ' · Chamber: Yes' : ''}</div>
            </div>
          )}
          <button style={{ ...btnBase, marginTop: 6, fontSize: 11 }} onClick={() => onEditProfile('printer')}>
            <Edit3 size={12} /> Edit Printer
          </button>
        </SlicerSection>

        <SlicerSection title="Material" icon={<Droplets size={14} />}>
          <select style={selectStyle} value={activeMaterialId} onChange={(e) => setActiveMaterial(e.target.value)}>
            {materialProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {material && (
            <div style={{ marginTop: 6, fontSize: 11, color: colors.textDim, lineHeight: 1.7 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: material.color, border: '1px solid #555', flexShrink: 0 }} />
                {material.type} · {material.name}
              </div>
              <div>Nozzle: {material.nozzleTemp}°C (FL {material.nozzleTempFirstLayer}°C)</div>
              <div>Bed: {material.bedTemp}°C (FL {material.bedTempFirstLayer}°C)</div>
              <div>Fan: {material.fanSpeedMin}–{material.fanSpeedMax}% (off {material.fanDisableFirstLayers} layers)</div>
              <div>Retract: {material.retractionDistance}mm @ {material.retractionSpeed}mm/s · Z-hop: {material.retractionZHop}mm</div>
            </div>
          )}
          <button style={{ ...btnBase, marginTop: 6, fontSize: 11 }} onClick={() => onEditProfile('material')}>
            <Edit3 size={12} /> Edit Material
          </button>
        </SlicerSection>

        <SlicerSection title="Print Profile" icon={<SlidersHorizontal size={14} />}>
          <div style={{ display: 'flex', gap: 6 }}>
            <select style={{ ...selectStyle, flex: 1 }} value={activePrintId} onChange={(e) => setActivePrint(e.target.value)}>
              {printProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button style={{ ...btnBase, padding: '3px 8px', fontSize: 11 }} onClick={() => onEditProfile('print')}>
              <Edit3 size={12} />
            </button>
          </div>
        </SlicerSection>

        {print && <SlicerPrintProfileSettings print={print} upd={upd} />}
      </div>
    </div>
  );
}
