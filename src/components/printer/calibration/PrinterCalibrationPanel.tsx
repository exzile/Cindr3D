import { useState } from 'react';
import { errorMessage } from '../../../utils/errorHandling';
import { Activity, CheckCircle2, ChevronDown, Cpu, Download, Droplets, ExternalLink, FlaskConical, Gauge, Layers, Plus, RefreshCw, Ruler, Sparkles, Thermometer, Trash2, TrendingUp, Undo2, Wrench, Zap } from 'lucide-react';
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
import { CALIBRATION_STL_URLS } from '../../../calibration/calibrationModels';
import { useStlThumbnails } from './useStlThumbnails';
import { useCADStore } from '../../../store/cadStore';
import {
  CALIBRATION_ITEMS,
  DEFAULT_COMPONENTS,
  getCalibrationStatuses,
  getComponentStatus,
  getMoistureStatus,
  useCalibrationStore,
  type CalibrationItemId,
  type WizardSession,
  type WearComponent,
} from '../../../store/calibrationStore';
import { usePrinterStore } from '../../../store/printerStore';
import { useSpoolStore } from '../../../store/spoolStore';
import { useSlicerStore } from '../../../store/slicerStore';
import type { MaterialProfile, PrinterProfile, PrintProfile } from '../../../types/slicer';
import { CalibrationWizard } from '../../../calibration/wizard/CalibrationWizard';
import './PrinterCalibrationPanel.css';

const CATEGORY_ACCENT: Record<string, string> = {
  Geometry: '#3b82f6',
  Material: '#f97316',
  Motion:   '#10b981',
};

type CalibrationPreset = {
  id: string;
  title: string;
  summary: string;
  category: 'Geometry' | 'Material' | 'Motion';
  filename: string;
  stlUrl: string;
  Icon: typeof FlaskConical;
  generator: (printer: PrinterProfile, material: MaterialProfile, print: PrintProfile) => string;
};

const PRESETS: CalibrationPreset[] = [
  {
    id: 'cube',
    title: '20mm calibration cube',
    summary: 'Check X/Y/Z dimensional scale and basic extrusion consistency across all three axes.',
    category: 'Geometry',
    filename: 'calibration-cube-20mm.gcode',
    stlUrl: CALIBRATION_STL_URLS['dimensional-accuracy'],
    Icon: Ruler,
    generator: generateCalibrationCubeGCode,
  },
  {
    id: 'first-layer',
    title: 'First-layer test',
    summary: 'Five adhesion pads for dialling Z offset, mesh compensation, flow, and bed temperature.',
    category: 'Geometry',
    filename: 'calibration-first-layer-test.gcode',
    stlUrl: CALIBRATION_STL_URLS['first-layer'],
    Icon: Sparkles,
    generator: generateFirstLayerTestGCode,
  },
  {
    id: 'dimensional',
    title: 'Dimensional accuracy gauge',
    summary: '20 / 40 / 60 mm XY reference steps for shrinkage and compensation tuning.',
    category: 'Geometry',
    filename: 'calibration-dimensional-accuracy.gcode',
    stlUrl: CALIBRATION_STL_URLS['dimensional-accuracy'],
    Icon: Ruler,
    generator: generateDimensionalAccuracyGCode,
  },
  {
    id: 'temp',
    title: 'Temperature tower',
    summary: 'Bands nozzle temperature ±10 °C around the active material target for bonding and detail.',
    category: 'Material',
    filename: 'calibration-temperature-tower.gcode',
    stlUrl: CALIBRATION_STL_URLS['temperature-tower'],
    Icon: Thermometer,
    generator: generateTemperatureTowerGCode,
  },
  {
    id: 'retraction',
    title: 'Retraction tower',
    summary: 'Steps retraction distance by height so stringing changes are immediately visible.',
    category: 'Material',
    filename: 'calibration-retraction-tower.gcode',
    stlUrl: CALIBRATION_STL_URLS['retraction'],
    Icon: Undo2,
    generator: generateRetractionTowerGCode,
  },
  {
    id: 'flow',
    title: 'Flow rate tower',
    summary: 'Steps M221 from under- to over-extrusion to locate the ideal flow multiplier.',
    category: 'Material',
    filename: 'calibration-flow-tower.gcode',
    stlUrl: CALIBRATION_STL_URLS['flow-rate'],
    Icon: Gauge,
    generator: generateFlowTowerGCode,
  },
  {
    id: 'pa-pattern',
    title: 'Pressure advance pattern',
    summary: 'Flat-line pattern for fast K-factor screening without printing a full tower.',
    category: 'Motion',
    filename: 'calibration-pressure-advance-pattern.gcode',
    stlUrl: CALIBRATION_STL_URLS['pressure-advance'],
    Icon: TrendingUp,
    generator: generatePressureAdvancePatternGCode,
  },
  {
    id: 'pa-tower',
    title: 'Pressure advance tower',
    summary: 'Vertical PA bands for inspecting corner bulge and line-start gaps at speed.',
    category: 'Motion',
    filename: 'calibration-pressure-advance-tower.gcode',
    stlUrl: CALIBRATION_STL_URLS['pressure-advance'],
    Icon: TrendingUp,
    generator: generatePressureAdvanceTowerGCode,
  },
  {
    id: 'input-shaper',
    title: 'Input shaper tower',
    summary: 'Acceleration bands to visualise ringing and resonance for IS / MZV tuning.',
    category: 'Motion',
    filename: 'calibration-input-shaper-tower.gcode',
    stlUrl: CALIBRATION_STL_URLS['input-shaper'],
    Icon: Activity,
    generator: generateInputShaperTowerGCode,
  },
];

type CalibrationCard = {
  id: string;
  testType: string;
  category: string;
  categoryClass: 'system' | 'geometry' | 'material' | 'motion';
  title: string;
  description: string;
  linkedItemIds: CalibrationItemId[];
  Icon: typeof Cpu;
};

const CALIBRATION_CARDS: CalibrationCard[] = [
  {
    id: 'firmware-health',
    testType: 'firmware-health',
    category: 'System',
    categoryClass: 'system',
    title: 'Firmware health',
    description: 'Baseline command, heater, motion, and sensor checks before deeper tuning.',
    linkedItemIds: [],
    Icon: Cpu,
  },
  {
    id: 'first-layer',
    testType: 'first-layer',
    category: 'Geometry',
    categoryClass: 'geometry',
    title: 'First layer',
    description: 'Bed adhesion, mesh quality, and Z-offset confirmation across the build surface.',
    linkedItemIds: ['first-layer', 'z-offset'],
    Icon: Layers,
  },
  {
    id: 'flow-rate',
    testType: 'flow-rate',
    category: 'Material',
    categoryClass: 'material',
    title: 'Flow rate',
    description: 'Extrusion multiplier check for wall thickness and surface consistency.',
    linkedItemIds: [],
    Icon: Gauge,
  },
  {
    id: 'temperature-tower',
    testType: 'temperature-tower',
    category: 'Material',
    categoryClass: 'material',
    title: 'Temperature tower',
    description: 'Temperature bands for layer bonding, gloss, bridging, and detail quality.',
    linkedItemIds: [],
    Icon: Thermometer,
  },
  {
    id: 'retraction',
    testType: 'retraction',
    category: 'Material',
    categoryClass: 'material',
    title: 'Retraction',
    description: 'Stringing and travel cleanup across distance and speed changes.',
    linkedItemIds: [],
    Icon: Undo2,
  },
  {
    id: 'pressure-advance',
    testType: 'pressure-advance',
    category: 'Motion',
    categoryClass: 'motion',
    title: 'Pressure advance',
    description: 'Corner bulge and line-start tuning for faster, cleaner extrusion.',
    linkedItemIds: ['pressure-advance'],
    Icon: TrendingUp,
  },
  {
    id: 'input-shaper',
    testType: 'input-shaper',
    category: 'Motion',
    categoryClass: 'motion',
    title: 'Input shaper',
    description: 'Ringing and resonance review for acceleration-safe print profiles.',
    linkedItemIds: ['input-shaper'],
    Icon: Activity,
  },
  {
    id: 'dimensional-accuracy',
    testType: 'dimensional-accuracy',
    category: 'Geometry',
    categoryClass: 'geometry',
    title: 'Dimensional accuracy',
    description: 'Scale, shrinkage, and fit checks against measured reference dimensions.',
    linkedItemIds: [],
    Icon: Ruler,
  },
  {
    id: 'max-volumetric-speed',
    testType: 'max-volumetric-speed',
    category: 'Material',
    categoryClass: 'material',
    title: 'Max volumetric speed',
    description: 'Throughput ceiling test for reliable high-flow slicing limits.',
    linkedItemIds: [],
    Icon: Zap,
  },
];

const WIZARD_STEP_LABELS = [
  'Pick filament',
  'Setup checks',
  'Load model',
  'Slice preview',
  'Send to printer',
  'Monitor',
  'Inspect',
  'Apply result',
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

function defaultCalibrationRecords(records: ReturnType<typeof useCalibrationStore.getState>['calibrationByPrinterId'][string] | undefined) {
  return CALIBRATION_ITEMS.map((item) => records?.[item.id] ?? {
    itemId: item.id,
    lastRunAt: null,
    intervalDays: item.defaultIntervalDays,
    note: '',
  });
}

function parseNonNegativeNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function parseOptionalNonNegativeNumber(value: string): number | null | undefined {
  if (value.trim() === '') return null;
  return parseNonNegativeNumber(value) ?? undefined;
}

function titleForTestType(testType: string): string {
  return CALIBRATION_CARDS.find((card) => card.testType === testType)?.title
    ?? testType.replace(/-/g, ' ');
}

function testRecordItemIds(testType: string): CalibrationItemId[] {
  const card = CALIBRATION_CARDS.find((item) => item.testType === testType);
  if (card && card.linkedItemIds.length > 0) return card.linkedItemIds;
  return CALIBRATION_ITEMS.some((item) => item.id === testType)
    ? [testType as CalibrationItemId]
    : [];
}

export default function PrinterCalibrationPanel() {
  const [newComponentName, setNewComponentName] = useState('');
  const [newComponentCategory, setNewComponentCategory] = useState<WearComponent['category']>('other');
  const [newComponentHours, setNewComponentHours] = useState('800');
  const [newComponentFilamentKm, setNewComponentFilamentKm] = useState('');
  const [serviceSummary, setServiceSummary] = useState('');
  const [servicePerson, setServicePerson] = useState('Local user');
  const [serviceCost, setServiceCost] = useState('');
  const [editSessionId, setEditSessionId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [wizardTestType, setWizardTestType] = useState<string | null>(null);
  const [wizardSessionId, setWizardSessionId] = useState<string | null>(null);
  const [isCalibrationTestsOpen, setIsCalibrationTestsOpen] = useState(false);
  const [isCalibrationAgingOpen, setIsCalibrationAgingOpen] = useState(false);
  const [isWearTrackingOpen, setIsWearTrackingOpen] = useState(false);
  const [isFilamentMoistureOpen, setIsFilamentMoistureOpen] = useState(false);
  const setWorkspaceMode = useCADStore((s) => s.setWorkspaceMode);
  const importFileToPlate = useSlicerStore((s) => s.importFileToPlate);
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const setError = usePrinterStore((s) => s.setError);
  const activePrinter = useSlicerStore((s) => s.getActivePrinterProfile());
  const activeMaterial = useSlicerStore((s) => s.getActiveMaterialProfile());
  const activePrint = useSlicerStore((s) => s.getActivePrintProfile());
  const spools = useSpoolStore((s) => s.spools);
  const loadedSpoolByPrinterId = useSpoolStore((s) => s.loadedSpoolByPrinterId);
  const activeSpoolId = useSpoolStore((s) => s.activeSpoolId);
  const calibrationByPrinterId = useCalibrationStore((s) => s.calibrationByPrinterId);
  const wizardSessions = useCalibrationStore((s) => s.wizardSessions);
  const createWizardSession = useCalibrationStore((s) => s.createWizardSession);
  const updateWizardSessionById = useCalibrationStore((s) => s.updateWizardSessionById);
  const completeWizardSession = useCalibrationStore((s) => s.completeWizardSession);
  const deleteWizardSession = useCalibrationStore((s) => s.deleteWizardSession);
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

  const stlThumbnailEntries = PRESETS.map((p) => ({
    url: p.stlUrl,
    accent: CATEGORY_ACCENT[p.category] ?? '#6366f1',
  }));
  const stlThumbnails = useStlThumbnails(stlThumbnailEntries);

  const ready = activePrinter !== null && activeMaterial !== null && activePrint !== null;
  const profileSummary = ready
    ? `${activePrinter.name} / ${activeMaterial.name} / ${activePrint.name}`
    : 'Select printer, material, and print profiles in Prepare';
  const activeFleetPrinter = printers.find((printer) => printer.id === activePrinterId);
  const printerLabel = activeFleetPrinter?.name ?? 'Active printer';
  const calibrationRecords = defaultCalibrationRecords(calibrationByPrinterId[activePrinterId]);
  const calibrationStatuses = getCalibrationStatuses(calibrationRecords);
  const printerComponents = components.filter((component) => component.printerId === activePrinterId);
  const componentStatuses = printerComponents.map(getComponentStatus);
  const loadedSpoolId = loadedSpoolByPrinterId[activePrinterId] ?? activeSpoolId;
  const loadedSpool = spools.find((spool) => spool.id === loadedSpoolId) ?? null;
  const moistureProfile = loadedSpool ? moistureBySpoolId[loadedSpool.id] ?? null : null;
  const moistureStatus = moistureProfile ? getMoistureStatus(moistureProfile) : null;
  const calibrationStatusById = Object.fromEntries(
    calibrationStatuses.map((item) => [item.record.itemId, item]),
  ) as Partial<Record<CalibrationItemId, (typeof calibrationStatuses)[number]>>;

  const printerWizardSessions = wizardSessions
    .filter((session) => session.printerId === activePrinterId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const activeWizardSessionsByTest = new Map(
    printerWizardSessions
      .filter((session) => session.status === 'active')
      .filter((session, index, sessions) => (
        sessions.findIndex((candidate) => candidate.testType === session.testType) === index
      ))
      .map((session) => [session.testType, session]),
  );

  const getCardStatusClass = (linkedItemIds: CalibrationItemId[]) => {
    if (linkedItemIds.some((itemId) => {
      const status = calibrationStatusById[itemId]?.status;
      return status === 'overdue' || status === 'never';
    })) return 'is-overdue';
    if (linkedItemIds.some((itemId) => calibrationStatusById[itemId]?.status === 'upcoming')) return 'is-upcoming';
    return 'is-ok';
  };

  const runPreset = (preset: CalibrationPreset) => {
    if (!activePrinter || !activeMaterial || !activePrint) return;
    downloadGCode(preset.filename, preset.generator(activePrinter, activeMaterial, activePrint));
  };

  const openInPrepare = async (preset: CalibrationPreset) => {
    try {
      const response = await fetch(preset.stlUrl);
      const blob = await response.blob();
      const file = new File([blob], `${preset.id}.stl`, { type: 'model/stl' });
      await importFileToPlate(file);
      setWorkspaceMode('prepare');
    } catch (err) {
      setError(`Failed to open calibration model: ${errorMessage(err, 'Unknown error')}`);
    }
  };

  const openPrepare = () => {
    setWorkspaceMode('prepare');
  };

  const openWizardSession = (session: WizardSession) => {
    setWizardTestType(session.testType);
    setWizardSessionId(session.id);
  };

  const startCalibrationTest = (testType: string) => {
    const id = createWizardSession(activePrinterId, testType, loadedSpoolId ?? '');
    setWizardTestType(testType);
    setWizardSessionId(id);
  };

  const completeCalibrationTest = (session: WizardSession) => {
    completeWizardSession(session.id);
    for (const itemId of testRecordItemIds(session.testType)) {
      recordCalibration(activePrinterId, itemId);
    }
  };

  const removeCalibrationTest = (session: WizardSession) => {
    deleteWizardSession(session.id);
    if (wizardSessionId === session.id) {
      setWizardTestType(null);
      setWizardSessionId(null);
    }
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
    const reminderHours = parseOptionalNonNegativeNumber(newComponentHours);
    const reminderFilamentKm = parseOptionalNonNegativeNumber(newComponentFilamentKm);
    if (reminderHours === undefined || reminderFilamentKm === undefined) return;
    addComponent({
      printerId: activePrinterId,
      name,
      category: newComponentCategory,
      reminderHours,
      reminderFilamentKm,
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
    const replacementCost = parseOptionalNonNegativeNumber(serviceCost);
    if (replacementCost === undefined) return;
    updateComponent(component.id, {
      installedAt: Date.now(),
      hoursOn: 0,
      filamentKm: 0,
      replacementCost: replacementCost ?? component.replacementCost,
    });
    logService({
      printerId: activePrinterId,
      componentId: component.id,
      summary: `${component.name} replaced`,
      performedBy: servicePerson.trim() || 'Local user',
      cost: replacementCost ?? component.replacementCost,
    });
  };

  const addServiceLogEntry = () => {
    const summaryText = serviceSummary.trim();
    if (!summaryText) return;
    const cost = parseOptionalNonNegativeNumber(serviceCost);
    if (cost === undefined) return;
    logService({
      printerId: activePrinterId,
      componentId: null,
      summary: summaryText,
      performedBy: servicePerson.trim() || 'Local user',
      cost,
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

      <section className="calib-center" aria-label="Calibration Center">
        <div className="calib-center__grid">
          {CALIBRATION_CARDS.map((card) => {
            const CardIcon = card.Icon;
            const sessionInProgress = activeWizardSessionsByTest.get(card.testType) ?? null;
            const isInProgress = sessionInProgress !== null;
            const inProgressStep = sessionInProgress?.step ?? null;
            return (
              <div
                key={card.id}
                className={`calib-center__card calib-center__card--${card.categoryClass} ${isInProgress ? 'is-in-progress' : getCardStatusClass(card.linkedItemIds)}`}
              >
                <div className="calib-center__card-body">
                  <span className="calib-center__category"><CardIcon size={12} /> {card.category}</span>
                  <strong className="calib-center__title">{card.title}</strong>
                  <p className="calib-center__desc">{card.description}</p>
                  <div className="calib-center__badges">
                    {isInProgress && (
                      <span className="printer-calibration-panel__pill calib-center__in-progress-pill">
                        In progress — step {inProgressStep} of 8
                      </span>
                    )}
                    {!isInProgress && card.linkedItemIds.map((itemId) => {
                      const linkedStatus = calibrationStatusById[itemId];
                      return (
                        <span key={itemId} className="printer-calibration-panel__pill">
                          {linkedStatus ? statusLabel(linkedStatus.status, linkedStatus.daysUntilDue) : 'Current'}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  className="calib-center__start"
                  onClick={() => {
                    if (sessionInProgress) openWizardSession(sessionInProgress);
                    else startCalibrationTest(card.testType);
                  }}
                >
                  {isInProgress ? 'Resume →' : 'Start →'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="printer-calibration-panel__lifecycle" aria-label="Maintenance lifecycle">
        <div className="printer-calibration-panel__section printer-calibration-panel__section--tests">
          <div className="printer-calibration-panel__section-head">
            <button
              type="button"
              className="printer-calibration-panel__section-toggle"
              aria-expanded={isCalibrationTestsOpen}
              aria-controls="calibration-tests-section"
              onClick={() => setIsCalibrationTestsOpen((open) => !open)}
            >
              <ChevronDown size={14} className={isCalibrationTestsOpen ? 'is-open' : ''} />
              <span className="printer-calibration-panel__section-title"><CheckCircle2 size={15} /> Calibration tests</span>
            </button>
          </div>
          {isCalibrationTestsOpen && (
            <div id="calibration-tests-section" className="printer-calibration-panel__section-body">
              {printerWizardSessions.length === 0 ? (
                <div className="printer-calibration-panel__empty">Start a calibration card above to save a test run here.</div>
              ) : (
                <div className="printer-calibration-panel__rows">
                  {printerWizardSessions.map((session) => {
                    const isEditing = editSessionId === session.id;
                    const isConfirmingDelete = deleteConfirmId === session.id;
                    return (
                      <div key={session.id} className={`printer-calibration-panel__test-row is-${session.status}`}>
                        <div>
                          <strong>{titleForTestType(session.testType)}</strong>
                          <span>
                            Started {formatDate(session.startedAt)}
                            {' · '}
                            Updated {formatDate(session.updatedAt)}
                          </span>
                        </div>

                        <span className="printer-calibration-panel__pill">
                          {session.status === 'completed' ? 'Completed' : `Step ${session.step} of ${WIZARD_STEP_LABELS.length}`}
                        </span>

                        {/* ── Inline edit form ──────────────────────────── */}
                        {isEditing && (
                          <div className="printer-calibration-panel__test-edit">
                            <label>
                              <span>Step</span>
                              <select
                                value={session.step}
                                onChange={(event) => updateWizardSessionById(session.id, { step: Number(event.target.value) })}
                              >
                                {WIZARD_STEP_LABELS.map((label, index) => (
                                  <option key={label} value={index + 1}>
                                    {index + 1}. {label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button type="button" onClick={() => setEditSessionId(null)}>
                              Done
                            </button>
                          </div>
                        )}

                        {/* ── Delete confirmation ───────────────────────── */}
                        {isConfirmingDelete && (
                          <div className="printer-calibration-panel__test-confirm">
                            <span>Delete this test run? This cannot be undone.</span>
                            <button
                              type="button"
                              className="printer-calibration-panel__test-confirm-yes"
                              onClick={() => {
                                removeCalibrationTest(session);
                                setDeleteConfirmId(null);
                              }}
                            >
                              Yes, delete
                            </button>
                            <button type="button" onClick={() => setDeleteConfirmId(null)}>
                              Cancel
                            </button>
                          </div>
                        )}

                        {/* ── Row actions ───────────────────────────────── */}
                        <div className="printer-calibration-panel__test-actions">
                          <button
                            type="button"
                            title="Edit step"
                            onClick={() => setEditSessionId(isEditing ? null : session.id)}
                          >
                            <Wrench size={13} /> {isEditing ? 'Close' : 'Edit'}
                          </button>
                          <button
                            type="button"
                            onClick={() => openWizardSession(session)}
                            disabled={session.status === 'completed'}
                          >
                            Resume
                          </button>
                          <button
                            type="button"
                            onClick={() => completeCalibrationTest(session)}
                            disabled={session.status === 'completed'}
                          >
                            <CheckCircle2 size={13} /> Complete
                          </button>
                          <button
                            type="button"
                            title="Delete test"
                            className="printer-calibration-panel__test-delete"
                            onClick={() => setDeleteConfirmId(isConfirmingDelete ? null : session.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="printer-calibration-panel__section printer-calibration-panel__section--aging">
          <div className="printer-calibration-panel__section-head">
            <button
              type="button"
              className="printer-calibration-panel__section-toggle"
              aria-expanded={isCalibrationAgingOpen}
              aria-controls="calibration-aging-section"
              onClick={() => setIsCalibrationAgingOpen((open) => !open)}
            >
              <ChevronDown size={14} className={isCalibrationAgingOpen ? 'is-open' : ''} />
              <span className="printer-calibration-panel__section-title"><Gauge size={15} /> Calibration aging</span>
            </button>
          </div>
          {isCalibrationAgingOpen && (
            <div id="calibration-aging-section" className="printer-calibration-panel__rows">
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
                      onChange={(event) => {
                        const intervalDays = parseNonNegativeNumber(event.target.value);
                        if (intervalDays !== null && intervalDays >= 1) {
                          updateCalibrationInterval(activePrinterId, item.record.itemId, intervalDays);
                        }
                      }}
                    />
                  </label>
                  <span className="printer-calibration-panel__pill">{statusLabel(item.status, item.daysUntilDue)}</span>
                  <button type="button" onClick={() => markCalibration(item.record.itemId)}>
                    <Sparkles size={13} /> Mark run
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="printer-calibration-panel__split">
          <div className="printer-calibration-panel__section printer-calibration-panel__section--wear">
            <div className="printer-calibration-panel__section-head">
              <button
                type="button"
                className="printer-calibration-panel__section-toggle"
                aria-expanded={isWearTrackingOpen}
                aria-controls="wear-tracking-section"
                onClick={() => setIsWearTrackingOpen((open) => !open)}
              >
                <ChevronDown size={14} className={isWearTrackingOpen ? 'is-open' : ''} />
                <span className="printer-calibration-panel__section-title"><Wrench size={15} /> Wear tracking</span>
              </button>
              <button type="button" onClick={seedDefaultComponents}>
                <Plus size={13} /> Defaults
              </button>
            </div>
            {isWearTrackingOpen && (
              <div id="wear-tracking-section" className="printer-calibration-panel__section-body">
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
                        <label><span>Hours</span><input type="number" min={0} value={component.hoursOn} onChange={(event) => {
                          const hoursOn = parseNonNegativeNumber(event.target.value);
                          if (hoursOn !== null) updateComponent(component.id, { hoursOn });
                        }} /></label>
                        <label><span>km</span><input type="number" min={0} step={0.1} value={component.filamentKm} onChange={(event) => {
                          const filamentKm = parseNonNegativeNumber(event.target.value);
                          if (filamentKm !== null) updateComponent(component.id, { filamentKm });
                        }} /></label>
                        <label><span>Due h</span><input type="number" min={0} value={component.reminderHours ?? ''} onChange={(event) => {
                          const reminderHours = parseOptionalNonNegativeNumber(event.target.value);
                          if (reminderHours !== undefined) updateComponent(component.id, { reminderHours });
                        }} /></label>
                        <label><span>Due km</span><input type="number" min={0} step={0.1} value={component.reminderFilamentKm ?? ''} onChange={(event) => {
                          const reminderFilamentKm = parseOptionalNonNegativeNumber(event.target.value);
                          if (reminderFilamentKm !== undefined) updateComponent(component.id, { reminderFilamentKm });
                        }} /></label>
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
            )}
          </div>

          <div className="printer-calibration-panel__section printer-calibration-panel__section--moisture">
            <div className="printer-calibration-panel__section-head">
              <button
                type="button"
                className="printer-calibration-panel__section-toggle"
                aria-expanded={isFilamentMoistureOpen}
                aria-controls="filament-moisture-section"
                onClick={() => setIsFilamentMoistureOpen((open) => !open)}
              >
                <ChevronDown size={14} className={isFilamentMoistureOpen ? 'is-open' : ''} />
                <span className="printer-calibration-panel__section-title"><Droplets size={15} /> Filament moisture</span>
              </button>
            </div>
            {isFilamentMoistureOpen && (
              <div id="filament-moisture-section" className="printer-calibration-panel__section-body">
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
                          onChange={(event) => {
                            const ambientHumidityPct = parseNonNegativeNumber(event.target.value);
                            if (ambientHumidityPct !== null) {
                              upsertMoistureProfile(loadedSpool.id, { ambientHumidityPct: Math.min(100, ambientHumidityPct) });
                            }
                          }}
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
            )}
          </div>
        </div>
      </section>

      <div className="printer-calibration-panel__grid">
        {PRESETS.map((preset) => {
          const PresetIcon = preset.Icon;
          const accent = CATEGORY_ACCENT[preset.category] ?? '#6366f1';
          const thumbnail = stlThumbnails.get(preset.stlUrl);
          return (
            <div
              key={preset.id}
              className={`calib-preset-card calib-preset-card--${preset.category.toLowerCase()}`}
            >
              <div className="calib-preset-card__preview">
                {thumbnail ? (
                  <img src={thumbnail} alt={preset.title} />
                ) : (
                  <div className="calib-preset-card__preview-placeholder">
                    <PresetIcon size={28} style={{ color: accent, opacity: 0.5 }} />
                  </div>
                )}
              </div>
              <div className="calib-preset-card__meta">
                <span className="calib-preset-card__category">
                  <PresetIcon size={11} /> {preset.category}
                </span>
                <strong className="calib-preset-card__title">{preset.title}</strong>
                <p className="calib-preset-card__desc">{preset.summary}</p>
              </div>
              <div className="calib-preset-card__footer">
                <button
                  type="button"
                  className="calib-preset-card__action calib-preset-card__action--secondary"
                  onClick={() => openInPrepare(preset)}
                  title="Open this calibration model in the Prepare workspace"
                >
                  Open in Prepare
                </button>
                <button
                  type="button"
                  className="calib-preset-card__action calib-preset-card__action--primary"
                  disabled={!ready}
                  onClick={() => runPreset(preset)}
                  title={ready ? `Download ${preset.title} G-code` : 'Choose printer, material, and print profiles in Prepare first'}
                >
                  <Download size={12} /> G-code
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {wizardTestType && (
        <CalibrationWizard
          testType={wizardTestType}
          printerId={activePrinterId}
          sessionId={wizardSessionId ?? undefined}
          onClose={() => {
            setWizardTestType(null);
            setWizardSessionId(null);
          }}
        />
      )}
    </div>
  );
}
