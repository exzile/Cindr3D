import { usePrinterStore, type PrinterStore } from '../store/printerStore';
import { usePrintSessionStore, type PrintSessionSnapshot } from '../store/printSessionStore';

const ACTIVE_STATUSES = new Set(['processing', 'paused', 'pausing', 'resuming', 'simulating']);
const DEVICE_ID_KEY = 'cindr3d-session-device-id';

function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch {
    return 'unknown-device';
  }
}

function getDeviceLabel(): string {
  const platform = navigator.platform?.trim();
  if (platform) return platform;
  return getDeviceId().slice(0, 13);
}

export function snapshotFromPrinterState(state: PrinterStore): PrintSessionSnapshot | null {
  const status = state.model.state?.status;
  const filePath = state.model.job?.file?.fileName;
  if (!status || !ACTIVE_STATUSES.has(status) || !filePath) return null;

  const activePrinter = state.printers.find((printer) => printer.id === state.activePrinterId);
  const fileSize = state.model.job?.file?.size ?? 0;
  const filePosition = state.model.job?.filePosition ?? 0;
  const progress = fileSize > 0 ? Math.min(1, Math.max(0, filePosition / fileSize)) : null;
  const previous = usePrintSessionStore.getState().activeSession;
  const now = Date.now();

  return {
    printerId: state.activePrinterId,
    printerName: activePrinter?.name ?? 'Printer',
    fileName: filePath.split('/').filter(Boolean).pop() ?? filePath,
    filePath,
    status,
    startedAt: previous?.filePath === filePath && previous.printerId === state.activePrinterId
      ? previous.startedAt
      : now,
    lastSeenAt: now,
    sourceDeviceLabel: previous?.sourceDeviceLabel ?? getDeviceLabel(),
    layer: typeof state.model.job?.layer === 'number' ? state.model.job.layer : null,
    progress,
  };
}

function hasKnownInactivePrinterState(state: PrinterStore): boolean {
  const status = state.model.state?.status;
  if (!status) return false;
  return !ACTIVE_STATUSES.has(status);
}

usePrinterStore.subscribe((state) => {
  const snapshot = snapshotFromPrinterState(state);
  const sessionStore = usePrintSessionStore.getState();
  if (snapshot) {
    sessionStore.setActiveSession(snapshot);
    return;
  }

  const active = sessionStore.activeSession;
  if (active?.printerId === state.activePrinterId && hasKnownInactivePrinterState(state)) {
    sessionStore.clearActiveSession(active.printerId);
  }
});
