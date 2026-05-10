import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckSquare, ChevronDown, ChevronRight, CircleAlert, CircleCheck, HelpCircle, Play, RefreshCcw, ScanLine } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { usePrintQueueStore } from '../../../store/printQueueStore';
import { useSchedulingStore } from '../../../store/schedulingStore';
import './BedClearPanel.css';

// ─── Toggle ───────────────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
}

function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <label className="bc-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="bc-toggle__track" />
      <span className="bc-toggle__thumb" />
    </label>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function ClearStatus({ state }: { state: boolean | null }) {
  if (state === true) {
    return (
      <span className="bed-clear-card__status clear">
        <CircleCheck size={12} /> Bed clear
      </span>
    );
  }
  if (state === false) {
    return (
      <span className="bed-clear-card__status occupied">
        <CircleAlert size={12} /> Occupied
      </span>
    );
  }
  return (
    <span className="bed-clear-card__status unknown">
      <HelpCircle size={12} /> Unknown
    </span>
  );
}

// ─── Per-printer card ─────────────────────────────────────────────────────────

interface PrinterCardProps {
  printerId: string;
  printerName: string;
}

function PrinterCard({ printerId, printerName }: PrinterCardProps) {
  const [expanded, setExpanded] = useState(true);

  const getBedClearSettings = useSchedulingStore((s) => s.getBedClearSettings);
  const upsertBedClearSettings = useSchedulingStore((s) => s.upsertBedClearSettings);
  const markBedCleared = useSchedulingStore((s) => s.markBedCleared);
  const settings = getBedClearSettings(printerId);

  const printers = usePrinterStore((s) => s.printers);
  const selectPrinter = usePrinterStore((s) => s.selectPrinter);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const startPrint = usePrinterStore((s) => s.startPrint);

  const selectNextReadyJob = usePrintQueueStore((s) => s.selectNextReadyJob);
  const markJobPrinting = usePrintQueueStore((s) => s.markJobPrinting);
  const setJobStatus = usePrintQueueStore((s) => s.setJobStatus);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const lastCheckedLabel = useMemo(() => {
    if (!settings.lastCheckedAt) return null;
    const diff = now - settings.lastCheckedAt;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }, [now, settings.lastCheckedAt]);

  const handleConfirmClear = useCallback(() => markBedCleared(printerId, true), [markBedCleared, printerId]);
  const handleMarkOccupied = useCallback(() => markBedCleared(printerId, false), [markBedCleared, printerId]);

  const handleStartNextJob = useCallback(async () => {
    // Switch to this printer if not already active
    if (activePrinterId !== printerId) {
      await selectPrinter(printerId);
    }
    const nextJob = selectNextReadyJob(printerId, printers);
    if (!nextJob) return;
    markJobPrinting(nextJob.id);
    try {
      await startPrint(nextJob.filePath);
    } catch (err) {
      setJobStatus(nextJob.id, 'failed');
      throw err;
    }
  }, [activePrinterId, printerId, selectPrinter, printers, selectNextReadyJob, markJobPrinting, setJobStatus, startPrint]);

  return (
    <div className="bed-clear-card">
      <div className="bed-clear-card__head" onClick={() => setExpanded((s) => !s)}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="bed-clear-card__name">{printerName}</span>
        <ClearStatus state={settings.lastClearState} />
      </div>

      {expanded && (
        <div className="bed-clear-card__body">
          {/* Enable toggle */}
          <div className="bed-clear-toggle-row">
            <span className="bed-clear-toggle-row__label">Enable bed-clear auto-queue</span>
            <Toggle
              checked={settings.enabled}
              onChange={(v) => upsertBedClearSettings(printerId, { enabled: v })}
            />
          </div>

          {settings.enabled && (
            <>
              {/* Delay after print */}
              <div className="bed-clear-number-row">
                <label>Wait after print completes</label>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={settings.delayAfterPrintSec}
                  onChange={(e) =>
                    upsertBedClearSettings(printerId, { delayAfterPrintSec: Number(e.target.value) })
                  }
                />
                <span>seconds before checking bed</span>
              </div>

              {/* Auto-start next job */}
              <div className="bed-clear-toggle-row">
                <span className="bed-clear-toggle-row__label">Auto-start next queued job when bed is clear</span>
                <Toggle
                  checked={settings.autoStartNextJob}
                  onChange={(v) => upsertBedClearSettings(printerId, { autoStartNextJob: v })}
                />
              </div>
            </>
          )}

          {/* Manual actions */}
          <div className="bed-clear-action-row">
            <button className="bed-clear-btn" onClick={handleMarkOccupied} title="Mark bed as occupied">
              <ScanLine size={13} /> Mark occupied
            </button>
            <button className="bed-clear-btn success" onClick={handleConfirmClear} title="Confirm bed is clear">
              <CheckSquare size={13} /> Confirm clear
            </button>
            {settings.enabled && settings.lastClearState === true && (
              <button className="bed-clear-btn primary" onClick={handleStartNextJob}>
                <Play size={12} /> Start next job
              </button>
            )}
            {lastCheckedLabel && (
              <span className="bed-clear-last-checked">
                <RefreshCcw size={10} style={{ marginRight: 3 }} />
                {lastCheckedLabel}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BedClearPanel() {
  const printers = usePrinterStore((s) => s.printers);

  return (
    <div className="bed-clear-panel">
      <div className="bed-clear-panel__header">
        <ScanLine size={16} />
        <h2>Bed-Clear Auto-Queue</h2>
      </div>

      <div className="bed-clear-panel__body">
        {printers.length === 0 ? (
          <div className="bed-clear-empty">No printers configured.</div>
        ) : (
          printers.map((p) => (
            <PrinterCard key={p.id} printerId={p.id} printerName={p.name} />
          ))
        )}
      </div>
    </div>
  );
}
