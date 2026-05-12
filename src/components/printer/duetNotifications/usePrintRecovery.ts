import { useState, useCallback, useEffect, useRef } from 'react';
import { usePrinterStore } from '../../../store/printerStore';
import { usePrintRecoveryStore, type PrintRecoverySnapshot } from '../../../store/printRecoveryStore';
import type { ToastType } from './useToastStack';

type AddToast = (type: ToastType, message: string) => void;

export function usePrintRecovery(addToast: AddToast) {
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const model = usePrinterStore((s) => s.model);
  const printers = usePrinterStore((s) => s.printers);
  const boardType = usePrinterStore((s) => s.config.boardType ?? 'duet');
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const saveRecoverySnapshot = usePrintRecoveryStore((s) => s.saveSnapshot);
  const clearRecoverySnapshot = usePrintRecoveryStore((s) => s.clearSnapshot);
  const dismissRecoverySnapshot = usePrintRecoveryStore((s) => s.dismissSnapshot);
  const getRecoverableSnapshot = usePrintRecoveryStore((s) => s.getRecoverableSnapshot);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const lastRecoverySnapshotRef = useRef(0);

  const recoverySnapshot = getRecoverableSnapshot(activePrinterId, model.state?.status ?? 'disconnected');

  const buildRecoverySnapshot = useCallback((): PrintRecoverySnapshot | null => {
    const activePrinter = printers.find((p) => p.id === activePrinterId);
    const fileName = model.job?.file?.fileName ?? model.job?.lastFileName;
    const filePosition = model.job?.filePosition ?? 0;
    if (!activePrinterId || !fileName || filePosition <= 0) return null;
    const bedHeater = model.heat?.bedHeaters?.[0];
    const toolHeater = model.tools?.[model.state?.currentTool ?? 0]?.heaters?.[0];
    const zAxis = model.move?.axes?.find((axis) => axis.letter.toUpperCase() === 'Z');
    return {
      printerId: activePrinterId,
      printerName: activePrinter?.name ?? model.network?.name ?? 'Printer',
      fileName,
      filePosition,
      z: typeof zAxis?.userPosition === 'number' ? zAxis.userPosition : null,
      layer: typeof model.job?.layer === 'number' ? model.job.layer : null,
      bedTemp: typeof bedHeater === 'number' ? model.heat?.heaters?.[bedHeater]?.active ?? null : null,
      toolTemp: typeof toolHeater === 'number' ? model.heat?.heaters?.[toolHeater]?.active ?? null : null,
      status: model.state?.status ?? 'disconnected',
      updatedAt: Date.now(),
    };
  }, [activePrinterId, model, printers]);

  const handleResumeRecovery = useCallback(async () => {
    if (!recoverySnapshot) return;
    if (boardType !== 'duet') {
      addToast('error', 'Recovery resume by file position is only supported for Duet/RRF printers.');
      return;
    }
    setRecoveryBusy(true);
    try {
      if (recoverySnapshot.bedTemp && recoverySnapshot.bedTemp > 0) await sendGCode(`M190 S${recoverySnapshot.bedTemp}`);
      if (recoverySnapshot.toolTemp && recoverySnapshot.toolTemp > 0) await sendGCode(`M109 S${recoverySnapshot.toolTemp}`);
      if (recoverySnapshot.z !== null) await sendGCode(`G92 Z${recoverySnapshot.z.toFixed(3)}`);
      await sendGCode(`M24 S${Math.max(0, Math.floor(recoverySnapshot.filePosition))}`);
      clearRecoverySnapshot(recoverySnapshot.printerId);
      addToast('success', 'Recovery preheat and resume commands sent');
    } catch (error) {
      addToast('error', `Recovery resume failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setRecoveryBusy(false);
    }
  }, [addToast, boardType, clearRecoverySnapshot, recoverySnapshot, sendGCode]);

  useEffect(() => {
    if (model.state?.status !== 'processing') return;
    const now = Date.now();
    if (now - lastRecoverySnapshotRef.current < 5000) return;
    const snapshot = buildRecoverySnapshot();
    if (!snapshot) return;
    lastRecoverySnapshotRef.current = now;
    saveRecoverySnapshot(snapshot);
  }, [buildRecoverySnapshot, model.job?.filePosition, model.job?.layer, model.state?.status, saveRecoverySnapshot]);

  return { recoverySnapshot, recoveryBusy, handleResumeRecovery, dismissRecoverySnapshot };
}
