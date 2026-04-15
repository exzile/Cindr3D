import { useState, useCallback } from 'react';
import { Edit3, Settings, Printer, Droplets, SlidersHorizontal, Search } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import type { PrintProfile } from '../../../../types/slicer';
import { SlicerSection } from '../../SlicerSection';
import { SlicerPrintProfileSettings } from '../../SlicerPrintProfileSettings';
import './SlicerWorkspaceSettingsPanel.css';

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
    <div className="slicer-workspace-settings-panel">
      <div className="slicer-workspace-settings-panel__header">
        <Settings size={16} />
        Slicer Settings
      </div>

      <div className="slicer-workspace-settings-panel__search-shell">
        <div className="slicer-workspace-settings-panel__search-wrap">
          <Search size={12} className="slicer-workspace-settings-panel__search-icon" />
          <input
            type="text"
            placeholder="Search settings..."
            value={settingsSearch}
            onChange={(e) => setSettingsSearch(e.target.value)}
            className="slicer-workspace-settings-panel__search-input"
          />
        </div>
      </div>

      <div className="slicer-workspace-settings-panel__content">
        <SlicerSection title="Printer" icon={<Printer size={14} />}>
          <select className="slicer-workspace-settings-panel__select" value={activePrinterId} onChange={(e) => setActivePrinter(e.target.value)}>
            {printerProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {printer && (
            <div className="slicer-workspace-settings-panel__meta">
              <div>Build: {printer.buildVolume.x} × {printer.buildVolume.y} × {printer.buildVolume.z} mm</div>
              <div>Nozzle: {printer.nozzleDiameter} mm · Filament: {printer.filamentDiameter} mm</div>
              <div>Heated Bed: {printer.hasHeatedBed ? 'Yes' : 'No'}{printer.hasHeatedChamber ? ' · Chamber: Yes' : ''}</div>
            </div>
          )}
          <button className="slicer-workspace-settings-panel__button" onClick={() => onEditProfile('printer')}>
            <Edit3 size={12} /> Edit Printer
          </button>
        </SlicerSection>

        <SlicerSection title="Material" icon={<Droplets size={14} />}>
          <select className="slicer-workspace-settings-panel__select" value={activeMaterialId} onChange={(e) => setActiveMaterial(e.target.value)}>
            {materialProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {material && (
            <div className="slicer-workspace-settings-panel__meta">
              <div className="slicer-workspace-settings-panel__material-row">
                <div className="slicer-workspace-settings-panel__material-swatch" style={{ background: material.color }} />
                {material.type} · {material.name}
              </div>
              <div>Nozzle: {material.nozzleTemp}°C (FL {material.nozzleTempFirstLayer}°C)</div>
              <div>Bed: {material.bedTemp}°C (FL {material.bedTempFirstLayer}°C)</div>
              <div>Fan: {material.fanSpeedMin}–{material.fanSpeedMax}% (off {material.fanDisableFirstLayers} layers)</div>
              <div>Retract: {material.retractionDistance}mm @ {material.retractionSpeed}mm/s · Z-hop: {material.retractionZHop}mm</div>
            </div>
          )}
          <button className="slicer-workspace-settings-panel__button" onClick={() => onEditProfile('material')}>
            <Edit3 size={12} /> Edit Material
          </button>
        </SlicerSection>

        <SlicerSection title="Print Profile" icon={<SlidersHorizontal size={14} />}>
          <div className="slicer-workspace-settings-panel__profile-row">
            <select className="slicer-workspace-settings-panel__profile-select" value={activePrintId} onChange={(e) => setActivePrint(e.target.value)}>
              {printProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="slicer-workspace-settings-panel__compact-button" onClick={() => onEditProfile('print')}>
              <Edit3 size={12} />
            </button>
          </div>
        </SlicerSection>

        {print && <SlicerPrintProfileSettings print={print} upd={upd} />}
      </div>
    </div>
  );
}
