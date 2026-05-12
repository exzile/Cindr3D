import { useCallback } from 'react';
import { usePrinterStore } from '../../../store/printerStore';
import { sendIntegrationEvent, type IntegrationPrinterSnapshot } from '../../../services/integrations/notificationSender';
import type { IntegrationEventType } from '../../../store/integrationStore';
import type { ToastType } from './useToastStack';

type AddToast = (type: ToastType, message: string) => void;

export function useIntegrationEventDispatch(addToast: AddToast) {
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const connected = usePrinterStore((s) => s.connected);
  const model = usePrinterStore((s) => s.model);
  const printers = usePrinterStore((s) => s.printers);

  const buildSnapshot = useCallback((statusOverride?: string): IntegrationPrinterSnapshot => {
    const activePrinter = printers.find((p) => p.id === activePrinterId);
    const temperatures = Object.fromEntries(
      (model.heat?.heaters ?? []).map((heater, index) => [`heater${index}`, heater?.current ?? null]),
    );
    const position = Object.fromEntries(
      (model.move?.axes ?? []).map((axis) => [axis.letter, axis.userPosition ?? axis.machinePosition ?? null]),
    );
    return {
      printerId: activePrinterId,
      printerName: activePrinter?.name ?? model.network?.name ?? 'Printer',
      status: statusOverride ?? model.state?.status ?? (connected ? 'connected' : 'disconnected'),
      fileName: model.job?.file?.fileName ?? model.job?.lastFileName,
      layer: model.job?.layer,
      progress: model.job?.file?.size
        ? Math.round((model.job.filePosition / model.job.file.size) * 100)
        : undefined,
      temperatures,
      position,
    };
  }, [activePrinterId, connected, model, printers]);

  const dispatchIntegrationEvent = useCallback((event: IntegrationEventType, statusOverride?: string) => {
    void sendIntegrationEvent(event, buildSnapshot(statusOverride)).then((results) => {
      const failed = results.find((r) => !r.ok);
      if (failed) {
        addToast('warning', `Integration notification failed: ${failed.error ?? 'unknown error'}`);
      }
    });
  }, [addToast, buildSnapshot]);

  return { buildSnapshot, dispatchIntegrationEvent };
}
