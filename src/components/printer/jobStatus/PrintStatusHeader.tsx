import { Play, Pause, Square, FileText } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import '../DuetJobStatus.css';

export function PrintStatusHeader() {
  const model = usePrinterStore((s) => s.model);
  const pausePrint = usePrinterStore((s) => s.pausePrint);
  const resumePrint = usePrinterStore((s) => s.resumePrint);
  const cancelPrint = usePrinterStore((s) => s.cancelPrint);

  const job = model.job;
  const status = model.state?.status ?? 'idle';
  const fileName = job?.file?.fileName ?? 'Unknown file';
  const shortName = fileName.split('/').pop() ?? fileName;

  const isPrinting = status === 'processing';
  const isPaused = status === 'paused' || status === 'pausing';
  const isSimulating = status === 'simulating';
  const isActive = isPrinting || isPaused || isSimulating;

  const statusLabel = isPrinting
    ? 'Printing'
    : isPaused
      ? 'Paused'
      : isSimulating
        ? 'Simulating'
        : status.charAt(0).toUpperCase() + status.slice(1);

  const statusColor = isPrinting
    ? '#44cc88'
    : isPaused
      ? '#ffaa44'
      : isSimulating
        ? '#44aaff'
        : '#666680';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', background: '#1a1a2e', borderRadius: 8, marginBottom: 12,
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 14, fontWeight: 600, color: '#e0e0ff',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }} title={fileName}>
          <FileText size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
          {shortName}
        </div>
        <div style={{ fontSize: 12, marginTop: 2 }}>
          <span style={{ color: statusColor, fontWeight: 500 }}>{statusLabel}</span>
        </div>
      </div>

      {isActive && (
        <div style={{ display: 'flex', gap: 6, marginLeft: 12, flexShrink: 0 }}>
          {isPrinting && (
            <button className="control-btn" title="Pause print" onClick={() => pausePrint()}>
              <Pause size={16} />
            </button>
          )}
          {isPaused && (
            <button className="control-btn success" title="Resume print" onClick={() => resumePrint()}>
              <Play size={16} />
            </button>
          )}
          <button
            className="control-btn danger"
            title="Cancel print"
            onClick={() => {
              if (confirm('Cancel the current print?')) cancelPrint();
            }}
          >
            <Square size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
