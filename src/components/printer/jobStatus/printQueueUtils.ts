import type { SavedPrinter } from '../../../types/duet';
import type { AddPrintQueueJobInput } from '../../../store/printQueueStore';
import { usePrintQueueStore } from '../../../store/printQueueStore';

export function loadQueue(): string[] {
  return usePrintQueueStore.getState().jobs
    .filter((job) => !['done', 'cancelled', 'failed'].includes(job.status))
    .map((job) => job.filePath);
}

export function saveQueue(queue: string[]): void {
  usePrintQueueStore.getState().replaceWithFilePaths(queue);
}

export function addToQueue(
  filePath: string,
  options: Omit<AddPrintQueueJobInput, 'filePath'> = {},
  printers: SavedPrinter[] = [],
): void {
  usePrintQueueStore.getState().addCopies({ filePath, ...options }, printers);
  window.dispatchEvent(new Event('print-queue-changed'));
}
