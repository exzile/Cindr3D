import { useState } from 'react';
import { Download, Droplets, ExternalLink, FlaskConical, Gauge, Plus, RefreshCw, Ruler, Sparkles, Trash2, Wrench } from 'lucide-react';
import {
  generateCalibrationCubeGCode,
  generateDimensionalAccuracyGCode,
  generateFirstLayerTestGCode,
  generateFlowTowerGCode,
  generateInputShaperTowerGCode,
  generatePressureAdvancePatternGCode,
  generatePressureAdvanceTowerGCode,
  generateRetractionTowerGCode,
  generateTemperatureTowerGCode,
} from '../../../engine/calibration';
import { useCADStore } from '../../../store/cadStore';
import {
  CALIBRATION_ITEMS,
  DEFAULT_COMPONENTS,
  getCalibrationStatuses,
  getComponentStatus,
  getMoistureStatus,
  summarizeMaintenance,
  useCalibrationStore,
  type CalibrationItemId,
  type WearComponent,
} from '../../../store/calibrationStore';
import { usePrinterStore } from '../../../store/printerStore';
import { useSpoolStore } from '../../../store/spoolStore';
import { useSlicerStore } from '../../../store/slicerStore';
import type { MaterialProfile, PrinterProfile, PrintProfile } from '../../../types/slicer';
import './PrinterCalibrationPanel.css';

type CalibrationPreset = {
  id: string;
  title: string;
  summary: string;
  category: 'Geometry' | 'Material' | 'Motion';
  filename: string;
  Icon: typeof FlaskConical;
  generator: (printer: PrinterProfile, material: MaterialProfile, print: PrintProfile) => string;
};

const PRESETS: CalibrationPreset[] = [
  {
    id: 'cube',
    title: '20mm calibration cube',
    summary: 'Check X/Y/Z scale and basic extrusion consistency.',
    category: 'Geometry',
    filename: 'calibration-cube-20mm.gcode',
    Icon: Ruler,
    generator: generateCalibrationCubeGCode,
  },
  {
    id: 'first-layer',
    title: 'First-layer test',
    summary: 'Five pads for Z offset, mesh, flow, and bed temperature.',
    category: 'Geometry',
    filename: 'calibration-first-layer-test.gcode',
    Icon: Sparkles,
    generator: generateFirstLayerTestGCode,
  },
  {
    id: 'dimensional',
    title: 'Dimensional accuracy gauge',
    summary: '20/40/60mm XY references for shrinkage compensation.',
    category: 'Geometry',
    filename: 'calibration-dimensional-accuracy.gcode',
    Icon: Ruler,
    generator: generateDimensionalAccuracyGCode,
  },
  {
    id: 'temp',
    title: 'Temperature tower',
    summary: 'Bands nozzle temperature around the active material target.',
    category: 'Material',
    filename: 'calibration-temperature-tower.gcode',
    Icon: FlaskConical,
    generator: generateTemperatureTowerGCode,
  },
  {
    id: 'retraction',
    title: 'Retraction tower',
    summary: 'Tune stringing by stepping retraction distance by height.',
    category: 'Material',
    filename: 'calibration-retraction-tower.gcode',
    Icon: FlaskConical,
    generator: generateRetractionTowerGCode,
  },
  {
    id: 'flow',
    title: 'Flow tower',
    summary: 'Steps M221 flow from under to over extrusion.',
    category: 'Material',
    filename: 'calibration-flow-tower.gcode',
    Icon: Gauge,
    generator: generateFlowTowerGCode,
  },
  {
    id: 'pa-pattern',
    title: 'Pressure advance pattern',
    summary: 'Flat-line pattern for fast K-factor screening.',
    category: 'Motion',
    filename: 'calibration-pressure-advance-pattern.gcode',
    Icon: Gauge,
    generator: generatePressureAdvancePatternGCode,
  },
  {
    id: 'pa-tower',
    title: 'Pressure advance tower',
    summary: 'Vertical PA bands for corner bulge and gap inspection.',
    category: 'Motion',
    filename: 'calibration-pressure-advance-tower.gcode',
    Icon: Gauge,
    generator: generatePressureAdvanceTowerGCode,
  },
  {
    id: 'input-shaper',
    title: 'Input shaper tower',
    summary: 'Acceleration bands for ringing and resonance tuning.',
    category: 'Motion',
    filename: 'calibration-input-shaper-tower.gcode',
    Icon: Gauge,
    generator: generateInputShaperTowerGCode,
  },
];

function downloadGCode(filename: string, gcode: string): void {
  const blob = new Blob([gcode], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function formatDate(epochMs: number | null): string {
  if (!epochMs) return 'Never';
  return new Date(epochMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusLabel(status: string, daysUntilDue?: number | null): string {
  if (status === 'never') return 'Not recorded';
  if (status === 'overdue') return daysUntilDue == null ? 'Overdue' : `${Math.abs(daysUntilDue)}d overdue`;
  if (status === 'upcoming') return daysUntilDue == null ? 'Upcoming' : `Due in ${Math.max(0, daysUntilDue)}d`;
  return 'Current';
}

export default function PrinterCalibrationPanel() {
  const [newComponentName, setNewComponentName] = useState('');
  const [newComponentCategory, setNewComponentCategory] = useState<WearComponent['category']>('other');
  const [newComponentHours, setNewComponentHours] = useState('800');
  const [newComponentFilamentKm, setNewComponentFilamentKm] = useState('');
  const [serviceSummary, setServiceSummary] = useState('');
  const [servicePerson, setServicePerson] = useState('Local user');
  const [serviceCost, setServiceCost] = useState('');
  const setWorkspaceMode = useCADStore((s) => s.setWorkspaceMode);
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const activePrinter = useSlicerStore((s) => s.getActivePrinterProfile());
  const activeMaterial = useSlicerStore((s) => s.getActiveMaterialProfile());
  const activePrint = useSlicerStore((s) => s.getActivePrintProfile());
  const spools = useSpoolStore((s) => s.spools);
  const loadedSpoolByPrinterId = useSpoolStore((s) => s.loadedSpoolByPrinterId);
  const activeSpoolId = useSpoolStore((s) => s.activeSpoolId);
  const getCalibrationRecords = useCalibrationStore((s) => s.getCalibrationRecords);
  const recordCalibration = useCalibrationStore((s) => s.recordCalibration);
  const updateCalibrationInterval = useCalibrationStore((s) => s.updateCalibrationInterval);
  const components = useCalibrationStore((s) => s.components);
  const serviceLog = useCalibrationStore((s) => s.serviceLog);
  const moistureBySpoolId = useCalibrationStore((s) => s.moistureBySpoolId);
  const addComponent = useCalibrationStore((s) => s.addComponent);
  const updateComponent = useCalibrationStore((s) => s.updateComponent);
  const removeComponent = useCalibrationStore((s) => s.removeComponent);
  const logService = useCalibrationStore((s) => s.logService);
  const upsertMoistureProfile = useCalibrationStore((s) => s.upsertMoistureProfile);

  const ready = activePrinter !== null && activeMaterial !== null && activePrint !== null;
  const profileSummary = ready
    ? `${activePrinter.name} / ${activeMaterial.name} / ${activePrint.name}`
    : 'Select printer, material, and print profiles in Prepare';
  const activeFleetPrinter = printers.find((printer) => printer.id === activePrinterId);
  const printerLabel = activeFleetPrinter?.name ?? 'Active printer';
  const calibrationRecords = getCalibrationRecords(activePrinterId);
  const calibrationStatuses = getCalibrationStatuses(calibrationRecords);
  const printerComponents = components.filter((component) => component.printerId === activePrinterId);
  const componentStatuses = printerComponents.map(getComponentStatus);
  const loadedSpoolId = loadedSpoolByPrinterId[activePrinterId] ?? activeSpoolId;
  const loadedSpool = spools.find((spool) => spool.id === loadedSpoolId) ?? null;
  const moistureProfile = loadedSpool ? moistureBySpoolId[loadedSpool.id] ?? null : null;
  const moistureStatus = moistureProfile ? getMoistureStatus(moistureProfile) : null;
  const summary = summarizeMaintenance(
    calibrationRecords,
    printerComponents,
    moistureProfile ? [moistureProfile] : [],
  );

  const runPreset = (preset: CalibrationPreset) => {
    if (!activePrinter || !activeMaterial || !activePrint) return;
    downloadGCode(preset.filename, preset.generator(activePrinter, activeMaterial, activePrint));
  };

  const openPrepare = () => {
    setWorkspaceMode('prepare');
  };

  const seedDefaultComponents = () => {
    for (const component of DEFAULT_COMPONENTS) {
      if (printerComponents.some((existing) => existing.name.toLowerCase() === component.name.toLowerCase())) continue;
      addComponent({
        printerId: activePrinterId,
        name: component.name,
        category: component.category,
        reminderHours: component.reminderHours,
        reminderFilamentKm: component.reminderFilamentKm,
        replacementCost: null,
        note: '',
      });
    }
  };

  const markCalibration = (itemId: CalibrationItemId) => {
    recordCalibration(activePrinterId, itemId);
    logService({
      printerId: activePrinterId,
      componentId: null,
      summary: `${CALIBRATION_ITEMS.find((item) => item.id === itemId)?.label ?? 'Calibration'} recorded`,
      performedBy: 'Local user',
      cost: null,
    });
  };

  const addCustomComponent = () => {
    const name = newComponentName.trim();
    if (!name) return;
    addComponent({
      printerId: activePrinterId,
      name,
      category: newComponentCategory,
      reminderHours: newComponentHours.trim() ? Number(newComponentHours) : null,
      reminderFilamentKm: newComponentFilamentKm.trim() ? Number(newComponentFilamentKm) : null,
      replacementCost: null,
      note: '',
    });
    logService({
      printerId: activePrinterId,
      componentId: null,
      summary: `${name} added to component register`,
      performedBy: servicePerson.trim() || 'Local user',
      cost: null,
    });
    setNewComponentName('');
  };

  const recordReplacement = (component: WearComponent) => {
    updateComponent(component.id, {
      installedAt: Date.now(),
      hoursOn: 0,
      filamentKm: 0,
      replacementCost: serviceCost.trim() ? Number(serviceCost) : component.replacementCost,
    });
    logService({
      printerId: activePrinterId,
      componentId: component.id,
      summary: `${component.name} replaced`,
      performedBy: servicePerson.trim() || 'Local user',
      cost: serviceCost.trim() ? Number(serviceCost) : component.replacementCost,
    });
  };

  const addServiceLogEntry = () => {
    const summaryText = serviceSummary.trim();
    if (!summaryText) return;
    logService({
      printerId: activePrinterId,
      componentId: null,
      summary: summaryText,
      performedBy: servicePerson.trim() || 'Local user',
      cost: serviceCost.trim() ? Number(serviceCost) : null,
    });
    setServiceSummary('');
    setServiceCost('');
  };

  return (
    <div className="printer-calibration-panel">
      <header className="printer-calibration-panel__header">
        <div>
          <h2>Maintenance & Calibration</h2>
          <p>{printerLabel} - {profileSummary}</p>
        </div>
        <button type="button" className="printer-calibration-panel__prepare" onClick={openPrepare}>
          <ExternalLink size={14} /> Prepare
        </button>
      </header>

      <section className="printer-calibration-panel__lifecycle" aria-label="Maintenance lifecycle">
        <div className="printer-calibration-panel__summary">
          <div className="printer-calibration-panel__summary-card is-overdue">
            <span>Overdue</span>
            <strong>{summary.overdue + summary.never}</strong>
          </div>
          <div className="printer-calibration-panel__summary-card is-upcoming">
            <span>Upcoming</span>
            <strong>{summary.upcoming}</strong>
          </div>
          <div className="printer-calibration-panel__summary-card is-ok">
            <span>Current</span>
            <strong>{summary.ok}</strong>
          </div>
        </div>

        <div className="printer-calibration-panel__section">
          <div className="printer-calibration-panel__section-head">
            <h3><Gauge size={15} /> Calibration aging</h3>
          </div>
          <div className="printer-calibration-panel__rows">
            {calibrationStatuses.map((item) => (
              <div key={item.record.itemId} className={`printer-calibration-panel__life-row is-${item.status}`}>
                <div>
                  <strong>{item.definition.label}</strong>
                  <span>Last run: {formatDate(item.record.lastRunAt)}</span>
                </div>
                <label>
                  <span>Interval</span>
                  <input
                    type="number"
                    min={1}
                    value={item.record.intervalDays}
                    onChange={(event) => updateCalibrationInterval(activePrinterId, item.record.itemId, Number(event.target.value))}
                  />
                </label>
                <span className="printer-calibration-panel__pill">{statusLabel(item.status, item.daysUntilDue)}</span>
                <button type="button" onClick={() => markCalibration(item.record.itemId)}>
                  <Sparkles size={13} /> Mark run
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="printer-calibration-panel__split">
          <div className="printer-calibration-panel__section">
            <div className="printer-calibration-panel__section-head">
              <h3><Wrench size={15} /> Wear tracking</h3>
              <button type="button" onClick={seedDefaultComponents}>
                <Plus size={13} /> Defaults
              </button>
            </div>
            <div className="printer-calibration-panel__rows">
              {componentStatuses.map(({ component, status, hoursRemaining, filamentKmRemaining }) => (
                <div key={component.id} className={`printer-calibration-panel__component is-${status}`}>
                  <div>
                    <strong>{component.name}</strong>
                    <span>
                      {hoursRemaining !== null ? `${Math.max(0, Math.round(hoursRemaining))}h left` : 'No hour reminder'}
                      {' - '}
                      {filamentKmRemaining !== null ? `${Math.max(0, filamentKmRemaining).toFixed(1)}km filament left` : 'No filament reminder'}
                    </span>
                  </div>
                  <div className="printer-calibration-panel__component-inputs">
                    <label><span>Hours</span><input type="number" min={0} value={component.hoursOn} onChange={(event) => updateComponent(component.id, { hoursOn: Number(event.target.value) })} /></label>
                    <label><span>km</span><input type="number" min={0} step={0.1} value={component.filamentKm} onChange={(event) => updateComponent(component.id, { filamentKm: Number(event.target.value) })} /></label>
                    <label><span>Due h</span><input type="number" min={0} value={component.reminderHours ?? ''} onChange={(event) => updateComponent(component.id, { reminderHours: event.target.value ? Number(event.target.value) : null })} /></label>
                    <label><span>Due km</span><input type="number" min={0} step={0.1} value={component.reminderFilamentKm ?? ''} onChange={(event) => updateComponent(component.id, { reminderFilamentKm: event.target.value ? Number(event.target.value) : null })} /></label>
                  </div>
                  <div className="printer-calibration-panel__component-actions">
                    <button type="button" title="Record replacement" onClick={() => recordReplacement(component)}>
                      <RefreshCw size={13} />
                    </button>
                    <button type="button" title="Remove component" onClick={() => removeComponent(component.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {componentStatuses.length === 0 && (
                <div className="printer-calibration-panel__empty">Add the default component register to start wear reminders.</div>
              )}
            </div>
            <div className="printer-calibration-panel__add-component">
              <input value={newComponentName} placeholder="Component name" onChange={(event) => setNewComponentName(event.target.value)} />
              <select value={newComponentCategory} onChange={(event) => setNewComponentCategory(event.target.value as WearComponent['category'])}>
                <option value="nozzle">Nozzle</option>
                <option value="belt">Belt</option>
                <option value="bearing">Bearing</option>
                <option value="hotend">Hotend</option>
                <option value="build-plate">Build plate</option>
                <option value="other">Other</option>
              </select>
              <input value={newComponentHours} placeholder="Reminder h" type="number" min={0} onChange={(event) => setNewComponentHours(event.target.value)} />
              <input value={newComponentFilamentKm} placeholder="Reminder km" type="number" min={0} step={0.1} onChange={(event) => setNewComponentFilamentKm(event.target.value)} />
              <button type="button" onClick={addCustomComponent}><Plus size={13} /> Add</button>
            </div>
          </div>

          <div className="printer-calibration-panel__section">
            <div className="printer-calibration-panel__section-head">
              <h3><Droplets size={15} /> Filament moisture</h3>
            </div>
            {loadedSpool ? (
              <div className={`printer-calibration-panel__moisture is-${moistureStatus?.status ?? 'never'}`}>
                <strong>{loadedSpool.brand} {loadedSpool.material}</strong>
                <span>{moistureStatus ? statusLabel(moistureStatus.status) : 'Not opened'}</span>
                <div className="printer-calibration-panel__component-inputs">
                  <label>
                    <span>Opened</span>
                    <input
                      type="date"
                      value={moistureProfile?.openedAt ? new Date(moistureProfile.openedAt).toISOString().slice(0, 10) : ''}
                      onChange={(event) => upsertMoistureProfile(loadedSpool.id, { openedAt: event.target.value ? new Date(`${event.target.value}T12:00:00`).getTime() : null })}
                    />
                  </label>
                  <label>
                    <span>RH%</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={moistureProfile?.ambientHumidityPct ?? 50}
                      onChange={(event) => upsertMoistureProfile(loadedSpool.id, { ambientHumidityPct: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span>Sensor</span>
                    <input
                      value={moistureProfile?.sensorLabel ?? ''}
                      placeholder="Manual"
                      onChange={(event) => upsertMoistureProfile(loadedSpool.id, { sensorLabel: event.target.value })}
                    />
                  </label>
                </div>
                {moistureStatus && (
                  <p>{moistureStatus.exposureDays?.toFixed(1)} days exposed at {moistureStatus.profile.ambientHumidityPct}% RH.</p>
                )}
              </div>
            ) : (
              <div className="printer-calibration-panel__empty">Load or select a spool to model moisture exposure.</div>
            )}

            <div className="printer-calibration-panel__service-log">
              <h4>Service log</h4>
              <div className="printer-calibration-panel__service-form">
                <input value={serviceSummary} placeholder="Service note" onChange={(event) => setServiceSummary(event.target.value)} />
                <input value={servicePerson} placeholder="Performed by" onChange={(event) => setServicePerson(event.target.value)} />
                <input value={serviceCost} placeholder="Cost" type="number" min={0} step={0.01} onChange={(event) => setServiceCost(event.target.value)} />
                <button type="button" onClick={addServiceLogEntry}><Plus size={13} /> Log</button>
              </div>
              {serviceLog.filter((entry) => entry.printerId === activePrinterId).slice(0, 4).map((entry) => (
                <div key={entry.id}>
                  <strong>{entry.summary}</strong>
                  <span>{formatDate(entry.performedAt)} - {entry.performedBy}{entry.cost !== null ? ` - $${entry.cost.toFixed(2)}` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="printer-calibration-panel__grid">
        {PRESETS.map((preset) => {
          const Icon = preset.Icon;
          return (
            <button
              type="button"
              key={preset.id}
              className="printer-calibration-panel__preset"
              disabled={!ready}
              onClick={() => runPreset(preset)}
              title={ready ? `Download ${preset.title}` : 'Choose printer, material, and print profiles in Prepare first'}
            >
              <span className="printer-calibration-panel__icon"><Icon size={17} /></span>
              <span className="printer-calibration-panel__body">
                <span className="printer-calibration-panel__category">{preset.category}</span>
                <span className="printer-calibration-panel__title">{preset.title}</span>
                <span className="printer-calibration-panel__summary">{preset.summary}</span>
              </span>
              <Download size={15} className="printer-calibration-panel__download" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
