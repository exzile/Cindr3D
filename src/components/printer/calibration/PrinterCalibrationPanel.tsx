import { useState } from 'react';
import { errorMessage } from '../../../utils/errorHandling';
import { CheckCircle2, ChevronDown, Download, Droplets, ExternalLink, Plus, RefreshCw, Sparkles, Thermometer, Trash2, Wrench } from 'lucide-react';
import { useStlThumbnails } from './useStlThumbnails';
import { useCADStore } from '../../../store/cadStore';
import {
  CALIBRATION_ITEMS,
  DEFAULT_COMPONENTS,
  getCalibrationStatuses,
  getComponentStatus,
  getMoistureStatus,
  useCalibrationStore,
  type WizardSession,
  type WearComponent,
} from '../../../store/calibrationStore';
import { usePrinterStore } from '../../../store/printerStore';
import { useSpoolStore } from '../../../store/spoolStore';
import { useSlicerStore } from '../../../store/slicerStore';
import { CalibrationWizard } from '../../../calibration/wizard/CalibrationWizard';
import {
  CALIBRATION_CARDS,
  CATEGORY_ACCENT,
  PRESETS,
  WIZARD_STEP_LABELS,
  type CalibrationPreset,
} from './calibrationContent';
import {
  defaultCalibrationRecords,
  downloadGCode,
  formatDate,
  parseNonNegativeNumber,
  parseOptionalNonNegativeNumber,
  statusLabel,
  testRecordItemIds,
  titleForTestType,
} from './calibrationHelpers';
import './PrinterCalibrationPanel.css';

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
