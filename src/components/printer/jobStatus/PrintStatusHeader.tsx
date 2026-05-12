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
  const statusClass = isPrinting
    ? 'duet-job__header-status-label duet-job__header-status-label--printing'
    : isPaused
      ? 'duet-job__header-status-label duet-job__header-status-label--paused'
      : isSimulating
        ? 'duet-job__header-status-label duet-job__header-status-label--simulating'
        : 'duet-job__header-status-label';

  return (
    <div className="duet-job__header">
      <div className="duet-job__header-info">
        <div className="duet-job__header-filename" title={fileName}>
          <FileText className="duet-job__header-filename-icon" size={14} />
          {shortName}
        </div>
        <div className="duet-job__header-status">
          <span className={statusClass} style={{ color: statusColor }}>{statusLabel}</span>
        </div>
      </div>

      {isActive && (
        <div className="duet-job__header-actions">
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
