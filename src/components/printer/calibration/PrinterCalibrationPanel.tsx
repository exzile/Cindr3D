import { useState } from 'react';
import { errorMessage } from '../../../utils/errorHandling';
import { ExternalLink } from 'lucide-react';
import { useStlThumbnails } from './useStlThumbnails';
import { useCADStore } from '../../../store/cadStore';
import {
  CALIBRATION_ITEMS,
  getCalibrationStatuses,
  getComponentStatus,
  getMoistureStatus,
  useCalibrationStore,
  type CalibrationItemId,
  type WizardSession,
} from '../../../store/calibrationStore';
import { usePrinterStore } from '../../../store/printerStore';
import { useSpoolStore } from '../../../store/spoolStore';
import { useSlicerStore } from '../../../store/slicerStore';
import { CalibrationWizard } from '../../../calibration/wizard/CalibrationWizard';
import {
  CATEGORY_ACCENT,
  PRESETS,
  type CalibrationPreset,
} from './calibrationContent';
import {
  defaultCalibrationRecords,
  downloadGCode,
  testRecordItemIds,
} from './calibrationHelpers';
import { CalibrationAgingSection } from './CalibrationAgingSection';
import { CalibrationCardsGrid } from './CalibrationCardsGrid';
import { CalibrationPresetsGrid } from './CalibrationPresetsGrid';
import { CalibrationTestsSection } from './CalibrationTestsSection';
import { FilamentMoistureSection } from './FilamentMoistureSection';
import { WearTrackingSection } from './WearTrackingSection';
import { CalibrationResultsSection } from './results/CalibrationResultsSection';
import { VisionFailureAlertsSection } from './VisionFailureAlertsSection';
import './PrinterCalibrationPanel.css';

export default function PrinterCalibrationPanel() {
  // Shared service-form fields (used by both wear "record replacement"
  // and moisture "log service entry").
  const [servicePerson, setServicePerson] = useState('Local user');
  const [serviceCost, setServiceCost] = useState('');

  // Wizard mount state.
  const [wizardTestType, setWizardTestType] = useState<string | null>(null);
  const [wizardSessionId, setWizardSessionId] = useState<string | null>(null);

  // Collapsible-open flags for the lifecycle sections.
  const [isCalibrationTestsOpen, setIsCalibrationTestsOpen] = useState(false);
  const [isCalibrationAgingOpen, setIsCalibrationAgingOpen] = useState(false);
  const [isCalibrationResultsOpen, setIsCalibrationResultsOpen] = useState(false);
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

      <VisionFailureAlertsSection
        printerId={activePrinterId}
        startCalibrationTest={startCalibrationTest}
      />

      <CalibrationCardsGrid
        activeWizardSessionsByTest={activeWizardSessionsByTest}
        calibrationStatusById={calibrationStatusById}
        getCardStatusClass={getCardStatusClass}
        startCalibrationTest={startCalibrationTest}
        openWizardSession={openWizardSession}
      />

      <section className="printer-calibration-panel__lifecycle" aria-label="Maintenance lifecycle">
        <CalibrationTestsSection
          printerWizardSessions={printerWizardSessions}
          isOpen={isCalibrationTestsOpen}
          setIsOpen={setIsCalibrationTestsOpen}
          updateWizardSessionById={updateWizardSessionById}
          openWizardSession={openWizardSession}
          completeCalibrationTest={completeCalibrationTest}
          removeCalibrationTest={removeCalibrationTest}
        />

        <CalibrationAgingSection
          isOpen={isCalibrationAgingOpen}
          setIsOpen={setIsCalibrationAgingOpen}
          activePrinterId={activePrinterId}
          calibrationStatuses={calibrationStatuses}
          updateCalibrationInterval={updateCalibrationInterval}
          markCalibration={markCalibration}
        />

        <CalibrationResultsSection
          isOpen={isCalibrationResultsOpen}
          setIsOpen={setIsCalibrationResultsOpen}
          activePrinterId={activePrinterId}
        />

        <div className="printer-calibration-panel__split">
          <WearTrackingSection
            isOpen={isWearTrackingOpen}
            setIsOpen={setIsWearTrackingOpen}
            activePrinterId={activePrinterId}
            printerComponents={printerComponents}
            componentStatuses={componentStatuses}
            servicePerson={servicePerson}
            serviceCost={serviceCost}
            addComponent={addComponent}
            updateComponent={updateComponent}
            removeComponent={removeComponent}
            logService={logService}
          />

          <FilamentMoistureSection
            isOpen={isFilamentMoistureOpen}
            setIsOpen={setIsFilamentMoistureOpen}
            loadedSpool={loadedSpool}
            moistureProfile={moistureProfile}
            moistureStatus={moistureStatus}
            upsertMoistureProfile={upsertMoistureProfile}
            activePrinterId={activePrinterId}
            serviceLog={serviceLog}
            servicePerson={servicePerson}
            setServicePerson={setServicePerson}
            serviceCost={serviceCost}
            setServiceCost={setServiceCost}
            logService={logService}
          />
        </div>
      </section>

      <CalibrationPresetsGrid
        ready={ready}
        stlThumbnails={stlThumbnails}
        runPreset={runPreset}
        openInPrepare={openInPrepare}
      />

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
