import { Radio, X } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { usePrinterStore } from '../../store/printerStore';
import { usePrintSessionStore } from '../../store/printSessionStore';
import './PrintSessionResumeBanner.css';

function formatStartedAt(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function PrintSessionResumeBanner() {
  const activeSession = usePrintSessionStore((state) => state.activeSession);
  const clearActiveSession = usePrintSessionStore((state) => state.clearActiveSession);
  const printers = usePrinterStore((state) => state.printers);
  const activePrinterId = usePrinterStore((state) => state.activePrinterId);
  const connected = usePrinterStore((state) => state.connected);
  const connecting = usePrinterStore((state) => state.connecting);
  const selectPrinter = usePrinterStore((state) => state.selectPrinter);
  const connect = usePrinterStore((state) => state.connect);
  const setActiveTab = usePrinterStore((state) => state.setActiveTab);
  const setWorkspaceMode = useCADStore((state) => state.setWorkspaceMode);

  if (!activeSession) return null;

  const printerExists = printers.some((printer) => printer.id === activeSession.printerId);
  const progressLabel = activeSession.progress !== null
    ? `${Math.round(activeSession.progress * 100)}%`
    : activeSession.layer !== null
      ? `Layer ${activeSession.layer}`
      : activeSession.status;

  const reconnect = async () => {
    if (!printerExists || connecting) return;
    if (activePrinterId !== activeSession.printerId) {
      await selectPrinter(activeSession.printerId);
    }
    setWorkspaceMode('printer');
    setActiveTab('job');
    if (!connected) await connect();
  };

  return (
    <div className="print-session-banner" role="status">
      <Radio size={15} aria-hidden="true" />
      <div className="print-session-banner__copy">
        <span className="print-session-banner__title">
          {activeSession.fileName}
        </span>
        <span className="print-session-banner__meta">
          Print was started from {activeSession.sourceDeviceLabel} on {formatStartedAt(activeSession.startedAt)}
          {' '}on {activeSession.printerName} · {progressLabel}
        </span>
      </div>
      <button
        type="button"
        className="print-session-banner__action"
        onClick={reconnect}
        disabled={!printerExists || connecting}
      >
        {connecting ? 'Connecting...' : 'Reconnect'}
      </button>
      <button
        type="button"
        className="print-session-banner__close"
        onClick={() => clearActiveSession(activeSession.printerId)}
        title="Dismiss print session"
        aria-label="Dismiss print session"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
