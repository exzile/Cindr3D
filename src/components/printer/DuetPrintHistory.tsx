import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  History, RefreshCw, Play, CheckCircle, XCircle, Loader2, FileText,
  Search, X, Download,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { formatDurationWords } from '../../utils/printerFormat';

const formatDuration = (sec?: number) => formatDurationWords(sec, '', false);

// ---------------------------------------------------------------------------
// CSV export helper
// ---------------------------------------------------------------------------
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DuetPrintHistory() {
  const connected = usePrinterStore((s) => s.connected);
  const history = usePrinterStore((s) => s.printHistory);
  const loading = usePrinterStore((s) => s.printHistoryLoading);
  const refresh = usePrinterStore((s) => s.refreshPrintHistory);
  const startPrint = usePrinterStore((s) => s.startPrint);

  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (connected && history.length === 0 && !loading) {
      void refresh();
    }
    // Intentionally only on connect — avoid refetching on every history update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // Filter history by filename or date (case-insensitive substring match)
  const filteredHistory = useMemo(() => {
    if (!searchQuery) return history;
    const q = searchQuery.toLowerCase();
    return history.filter((entry) => {
      const filename = (entry.file ?? entry.message).toLowerCase();
      const date = entry.timestamp.toLowerCase();
      return filename.includes(q) || date.includes(q);
    });
  }, [history, searchQuery]);

  // Export filtered history as CSV
  const handleExportCSV = useCallback(() => {
    const header = 'Filename,Date,Duration,Status';
    const rows = filteredHistory.map((entry) => {
      const filename = escapeCSV(entry.file ?? entry.message);
      const date = escapeCSV(entry.timestamp);
      const duration = entry.durationSec !== undefined ? formatDuration(entry.durationSec) : '';
      const status = entry.kind;
      return `${filename},${date},${escapeCSV(duration)},${status}`;
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `print-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filteredHistory]);

  return (
    <div className="duet-history-wrap">
      <div className="duet-history-panel">
        <div className="duet-history-header">
          <div className="duet-history-title">
            <History size={14} /> Print History
            <span className="duet-history-count">
              ({filteredHistory.length}{searchQuery ? ` / ${history.length}` : ''})
            </span>
          </div>
          <div className="duet-history-actions">
            <button
              className="duet-history-refresh-btn"
              onClick={handleExportCSV}
              disabled={filteredHistory.length === 0}
              title="Export filtered history as CSV"
            >
              <Download size={12} />
              Export CSV
            </button>
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
        </div>

        {/* Search / filter bar */}
        <div className="duet-history-search-bar">
          <Search size={14} className="duet-history-search-icon" />
          <input
            className="duet-history-search-input"
            type="text"
            placeholder="Filter by filename or date..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="duet-history-search-clear"
              onClick={() => setSearchQuery('')}
              title="Clear filter"
            >
              <X size={14} />
            </button>
          )}
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

        {!loading && history.length > 0 && filteredHistory.length === 0 && (
          <div className="duet-history-state">
            No entries matching &ldquo;{searchQuery}&rdquo;
          </div>
        )}

        {filteredHistory.map((entry, i) => {
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
