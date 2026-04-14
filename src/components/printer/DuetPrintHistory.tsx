import { useEffect } from 'react';
import {
  History, RefreshCw, Play, CheckCircle, XCircle, Loader2, FileText,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { formatDurationWords } from '../../utils/printerFormat';

const formatDuration = (sec?: number) => formatDurationWords(sec, '', false);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DuetPrintHistory() {
  const connected = usePrinterStore((s) => s.connected);
  const history = usePrinterStore((s) => s.printHistory);
  const loading = usePrinterStore((s) => s.printHistoryLoading);
  const refresh = usePrinterStore((s) => s.refreshPrintHistory);
  const startPrint = usePrinterStore((s) => s.startPrint);

  useEffect(() => {
    if (connected && history.length === 0 && !loading) {
      void refresh();
    }
    // Intentionally only on connect — avoid refetching on every history update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  return (
    <div className="duet-history-wrap">
      <div className="duet-history-panel">
        <div className="duet-history-header">
          <div className="duet-history-title">
            <History size={14} /> Print History
            <span className="duet-history-count">
              ({history.length})
            </span>
          </div>
          <button
            className="duet-history-refresh-btn"
            onClick={() => refresh()}
            disabled={loading}
            title="Refresh from 0:/sys/eventlog.txt"
          >
            {loading ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
            Refresh
          </button>
        </div>

        {loading && history.length === 0 && (
          <div className="duet-history-state">
            Loading event log…
          </div>
        )}

        {!loading && history.length === 0 && (
          <div className="duet-history-state">
            <FileText size={18} className="duet-history-empty-icon" />
            <div>No print events recorded yet.</div>
            <div className="duet-history-empty-sub">
              Reads from <code>0:/sys/eventlog.txt</code>
            </div>
          </div>
        )}

        {history.map((entry, i) => {
          const Icon = entry.kind === 'finish'
            ? CheckCircle
            : entry.kind === 'cancel'
            ? XCircle
            : Play;
          return (
            <div key={`${entry.timestamp}-${i}`} className="duet-history-row">
              <span className="duet-history-time">
                {entry.timestamp}
              </span>
              <span className="duet-history-main">
                {entry.file ?? entry.message}
                {entry.durationSec !== undefined && (
                  <span className="duet-history-duration">
                    ({formatDuration(entry.durationSec)})
                  </span>
                )}
              </span>
              <span className={`duet-history-kind duet-history-kind-${entry.kind}`}>
                <Icon size={11} />
                {entry.kind}
              </span>
              {entry.file ? (
                <button
                  className="duet-history-reprint-btn"
                  onClick={() => startPrint(entry.file!)}
                  title={`Re-print ${entry.file}`}
                >
                  <Play size={11} /> Re-print
                </button>
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
