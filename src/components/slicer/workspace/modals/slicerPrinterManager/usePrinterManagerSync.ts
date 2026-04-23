import { useState } from 'react';
import { useSlicerStore } from '../../../../../store/slicerStore';
import { usePrinterStore } from '../../../../../store/printerStore';
import { parseDuetConfig } from '../../../../../utils/duetConfigParser';

export const TABS = ['Printer', 'Extruder 1'] as const;

export function usePrinterManagerSync() {
  const printerProfiles = useSlicerStore((s) => s.printerProfiles);
  const activePrinterId = useSlicerStore((s) => s.activePrinterProfileId);
  const setActivePrinter = useSlicerStore((s) => s.setActivePrinterProfile);
  const deletePrinter = useSlicerStore((s) => s.deletePrinterProfile);
  const createPrinter = useSlicerStore((s) => s.createPrinterWithDefaults);
  const updatePrinter = useSlicerStore((s) => s.updatePrinterProfile);
  const updateMaterialProfile = useSlicerStore((s) => s.updateMaterialProfile);
  const updatePrintProfile = useSlicerStore((s) => s.updatePrintProfile);

  const duetPrinters = usePrinterStore((s) => s.printers);
  const printerService = usePrinterStore((s) => s.service);
  const printerConnected = usePrinterStore((s) => s.connected);
  const activeDuetId = usePrinterStore((s) => s.activePrinterId);

  const [selectedId, setSelectedId] = useState(activePrinterId);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Printer');
  const [addingName, setAddingName] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [selectedDuetId, setSelectedDuetId] = useState(activeDuetId);

  const selectedPrinter = printerProfiles.find((p) => p.id === selectedId) ?? printerProfiles[0];

  function upd<T extends object>(updates: T) {
    if (selectedPrinter) updatePrinter(selectedPrinter.id, updates);
  }

  async function readBoardFiles(service: NonNullable<typeof printerService>) {
    const readFile = async (path: string) => {
      try {
        return await (await service.downloadFile(path)).text();
      } catch {
        return '';
      }
    };

    return Promise.all([
      readFile('0:/sys/config.g'),
      readFile('0:/sys/start.g'),
      readFile('0:/sys/stop.g'),
      readFile('0:/sys/config-override.g'),
      readFile('0:/sys/tool0.g'),
      readFile('0:/sys/tpre0.g'),
      readFile('0:/sys/tfree0.g'),
    ]);
  }

  function resetAddState() {
    setAddingName('');
    setShowAdd(false);
    setSyncError(null);
  }

  function handleCreate() {
    const name = addingName.trim();
    if (!name) return;
    createPrinter(name);
    const newId = useSlicerStore.getState().activePrinterProfileId;
    setSelectedId(newId);
    resetAddState();
  }

  async function handleSyncFromDuet() {
    const name = addingName.trim();
    if (!name) return;
    const service = printerService ?? usePrinterStore.getState().service;
    if (!service) {
      setSyncError('No connected Duet printer');
      return;
    }

    setSyncing(true);
    setSyncError(null);
    try {
      const [configG, startG, stopG, overrideG, tool0G, tpre0G, tfree0G] = await readBoardFiles(service);
      const {
        profile,
        profileMachineSourcedFields,
        startGCode,
        endGCode,
        extruderStartGCode,
        extruderEndGCode,
        extruderPrestartGCode,
        materialPatch,
        printPatch,
      } = parseDuetConfig(configG, startG, stopG, overrideG, tool0G, tpre0G, tfree0G);

      const duetPrinterName = duetPrinters.find((p) => p.id === selectedDuetId)?.name ?? '';
      const finalName = name || duetPrinterName || 'Duet Printer';

      createPrinter(finalName);
      const newId = useSlicerStore.getState().activePrinterProfileId;
      const existingProfile = useSlicerStore.getState().printerProfiles.find((p) => p.id === newId);
      updatePrinter(newId, {
        ...profile,
        gcodeFlavorType: 'duet',
        startGCode: startGCode || (existingProfile?.startGCode ?? ''),
        endGCode: endGCode || (existingProfile?.endGCode ?? ''),
        ...(extruderStartGCode ? { extruderStartGCode } : {}),
        ...(extruderEndGCode ? { extruderEndGCode } : {}),
        ...(extruderPrestartGCode ? { extruderPrestartGCode } : {}),
        machineSourcedFields: profileMachineSourcedFields,
      });

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
      resetAddState();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncSelected() {
    if (!selectedPrinter) return;
    const service = printerService ?? usePrinterStore.getState().service;
    if (!service) {
      setSyncError('No connected Duet printer');
      setSyncStatus(null);
      return;
    }

    setSyncing(true);
    setSyncError(null);
    setSyncStatus(null);
    try {
      const [configG, startG, stopG, overrideG, tool0G, tpre0G, tfree0G] = await readBoardFiles(service);
      if (!configG.trim()) throw new Error('config.g is empty or missing on the board');

      const {
        profile,
        profileMachineSourcedFields,
        startGCode,
        endGCode,
        extruderStartGCode,
        extruderEndGCode,
        extruderPrestartGCode,
        materialPatch,
        printPatch,
      } = parseDuetConfig(configG, startG, stopG, overrideG, tool0G, tpre0G, tfree0G);

      updatePrinter(selectedPrinter.id, {
        ...profile,
        gcodeFlavorType: 'duet',
        ...(startGCode ? { startGCode } : {}),
        ...(endGCode ? { endGCode } : {}),
        ...(extruderStartGCode ? { extruderStartGCode } : {}),
        ...(extruderEndGCode ? { extruderEndGCode } : {}),
        ...(extruderPrestartGCode ? { extruderPrestartGCode } : {}),
        machineSourcedFields: profileMachineSourcedFields,
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

      setSyncStatus(
        `Synced ${Object.keys(profile).length} printer, ${Object.keys(materialPatch.fields).length} material, ${Object.keys(printPatch.fields).length} print fields from Duet`,
      );
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

  return {
    activeDuetId,
    addingName,
    confirmDelete,
    duetPrinters,
    printerConnected,
    printerProfiles,
    selectedDuetId,
    selectedId,
    selectedPrinter,
    showAdd,
    syncError,
    syncing,
    syncStatus,
    tab,
    upd,
    setAddingName,
    setConfirmDelete,
    setSelectedDuetId,
    setShowAdd,
    setTab,
    handleCreate,
    handleDelete,
    handleSelectRow,
    handleSyncFromDuet,
    handleSyncSelected,
    resetAddState,
  };
}
