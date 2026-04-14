import { Wifi, WifiOff, Settings } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';

export default function PrinterMonitor() {
  const connected = usePrinterStore((s) => s.connected);
  const model = usePrinterStore((s) => s.model);
  const error = usePrinterStore((s) => s.error);
  const showPrinter = usePrinterStore((s) => s.showPrinter);
  const setShowSettings = usePrinterStore((s) => s.setShowSettings);
  const stateLabel = model.state?.status ?? 'disconnected';

  if (!showPrinter) return null;

  return (
    <div className="printer-panel">
      <div className="printer-header">
        <div className="printer-title">
          {connected ? <Wifi size={14} className="connected" /> : <WifiOff size={14} className="disconnected" />}
          <h3>3D Printer</h3>
        </div>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
          <Settings size={14} />
        </button>
      </div>

      {error && (
        <div className="printer-error">{error}</div>
      )}

      {!connected ? (
        <div className="printer-disconnected">
          <WifiOff size={32} />
          <p>Not connected to printer</p>
          <button className="btn btn-primary btn-sm" onClick={() => setShowSettings(true)}>
            Connect
          </button>
        </div>
      ) : (
        <div className="printer-content">
          <div className="printer-status">
            <span className={`status-dot ${stateLabel === 'processing' ? 'printing' : stateLabel === 'idle' ? 'ready' : 'idle'}`} />
            <span>{stateLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}
