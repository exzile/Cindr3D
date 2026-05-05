import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CirclePause,
  CopyPlus,
  ListOrdered,
  Play,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { usePrintQueueStore, type PrintQueueJob } from '../../../store/printQueueStore';

const ACTIVE_STATUSES = new Set(['processing', 'simulating', 'pausing', 'paused', 'resuming', 'cancelling']);

function statusTone(status: PrintQueueJob['status']): string {
  if (status === 'ready') return 'var(--success)';
  if (status === 'blocked' || status === 'failed' || status === 'cancelled') return 'var(--error)';
  if (status === 'printing') return 'var(--accent)';
  if (status === 'paused') return 'var(--warning)';
  if (status === 'done') return 'var(--text-muted)';
  return 'var(--text-secondary)';
}

function routeDetails(job: PrintQueueJob, printerName: (printerId: string | null) => string): string {
  if (job.status === 'blocked') {
    const reasons = Object.entries(job.routing.blockedReasons)
      .flatMap(([printerId, items]) => items.map((reason) => `${printerName(printerId)}: ${reason}`));
    return reasons.slice(0, 3).join(' | ') || job.routing.summary;
  }
  if (job.printerId) return printerName(job.printerId);
  return job.routing.summary;
}

export function PrintQueue() {
  const [collapsed, setCollapsed] = useState(false);
  const [quickPath, setQuickPath] = useState('');
  const [quickCopies, setQuickCopies] = useState(1);
  const [quickPrinterId, setQuickPrinterId] = useState('');
  const [quickMaterial, setQuickMaterial] = useState('');
  const [quickNozzle, setQuickNozzle] = useState('');

  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const connected = usePrinterStore((s) => s.connected);
  const model = usePrinterStore((s) => s.model);
  const startPrint = usePrinterStore((s) => s.startPrint);
  const pausePrint = usePrinterStore((s) => s.pausePrint);
  const resumePrint = usePrinterStore((s) => s.resumePrint);
  const cancelPrint = usePrinterStore((s) => s.cancelPrint);
  const selectPrinter = usePrinterStore((s) => s.selectPrinter);

  const jobs = usePrintQueueStore((s) => s.jobs);
  const activeJobId = usePrintQueueStore((s) => s.activeJobId);
  const autoStart = usePrintQueueStore((s) => s.autoStart);
  const addCopies = usePrintQueueStore((s) => s.addCopies);
  const clearCompleted = usePrintQueueStore((s) => s.clearCompleted);
  const clearAll = usePrintQueueStore((s) => s.clearAll);
  const moveJob = usePrintQueueStore((s) => s.moveJob);
  const assignPrinter = usePrintQueueStore((s) => s.assignPrinter);
  const setAutoStart = usePrintQueueStore((s) => s.setAutoStart);
  const setJobStatus = usePrintQueueStore((s) => s.setJobStatus);
  const reconcileWithPrinters = usePrintQueueStore((s) => s.reconcileWithPrinters);
  const markActiveJobComplete = usePrintQueueStore((s) => s.markActiveJobComplete);
  const selectNextReadyJob = usePrintQueueStore((s) => s.selectNextReadyJob);
  const markJobPrinting = usePrintQueueStore((s) => s.markJobPrinting);

  const activeJobs = useMemo(
    () => jobs.filter((job) => !['done', 'cancelled', 'failed'].includes(job.status)),
    [jobs],
  );
  const completedCount = jobs.length - activeJobs.length;

  const printerName = useCallback((printerId: string | null) => {
    if (!printerId) return 'Auto route';
    return printers.find((printer) => printer.id === printerId)?.name ?? 'Unknown printer';
  }, [printers]);

  const startQueueJob = useCallback(async (job: PrintQueueJob) => {
    const targetPrinterId = job.printerId ?? (job.routing.candidatePrinterIds.includes(activePrinterId) ? activePrinterId : job.routing.candidatePrinterIds[0]);
    if (targetPrinterId && targetPrinterId !== activePrinterId) {
      await selectPrinter(targetPrinterId);
      assignPrinter(job.id, targetPrinterId, printers);
      return;
    }
    if (!connected) return;
    markJobPrinting(job.id);
    try {
      await startPrint(job.filePath);
    } catch (err) {
      setJobStatus(job.id, 'failed');
      throw err;
    }
  }, [activePrinterId, assignPrinter, connected, markJobPrinting, printers, selectPrinter, setJobStatus, startPrint]);

  const startNextForActivePrinter = useCallback(async () => {
    const nextJob = selectNextReadyJob(activePrinterId, printers);
    if (nextJob) await startQueueJob(nextJob);
  }, [activePrinterId, printers, selectNextReadyJob, startQueueJob]);

  useEffect(() => {
    reconcileWithPrinters(printers);
  }, [printers, reconcileWithPrinters]);

  const prevStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = model.state?.status;
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    if (prev === undefined) return;
    const wasActive = ACTIVE_STATUSES.has(prev);
    if (!wasActive || status !== 'idle') return;

    markActiveJobComplete(prev === 'cancelling' ? 'cancelled' : 'done');
    if (autoStart && connected) {
      void startNextForActivePrinter();
    }
  }, [autoStart, connected, markActiveJobComplete, model.state?.status, startNextForActivePrinter]);

  const handleQuickAdd = useCallback(() => {
    const filePath = quickPath.trim();
    if (!filePath) return;
    const nozzleDiameter = Number(quickNozzle);
    addCopies({
      filePath,
      copies: quickCopies,
      printerId: quickPrinterId || null,
      routingMode: quickPrinterId ? 'manual' : 'auto',
      requirements: {
        material: quickMaterial.trim() || undefined,
        nozzleDiameter: quickNozzle && Number.isFinite(nozzleDiameter) && nozzleDiameter > 0 ? nozzleDiameter : undefined,
      },
    }, printers);
    setQuickPath('');
  }, [addCopies, printers, quickCopies, quickMaterial, quickNozzle, quickPath, quickPrinterId]);

  const handleCancel = useCallback((job: PrintQueueJob) => {
    if (job.id === activeJobId && job.status === 'printing') {
      void cancelPrint().finally(() => setJobStatus(job.id, 'cancelled'));
      return;
    }
    setJobStatus(job.id, 'cancelled');
  }, [activeJobId, cancelPrint, setJobStatus]);

  const handlePauseResume = useCallback((job: PrintQueueJob) => {
    if (job.id === activeJobId && job.status === 'printing') {
      void pausePrint();
      setJobStatus(job.id, 'paused');
      return;
    }
    if (job.id === activeJobId && job.status === 'paused') {
      void resumePrint();
      setJobStatus(job.id, 'printing');
      return;
    }
    setJobStatus(job.id, job.status === 'paused' ? 'queued' : 'paused');
    reconcileWithPrinters(printers);
  }, [activeJobId, pausePrint, printers, reconcileWithPrinters, resumePrint, setJobStatus]);

  return (
    <div style={{
      margin: '0 14px 12px', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden', background: 'var(--bg-panel)',
    }}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          width: '100%', padding: '8px 12px', border: 'none',
          background: 'var(--bg-elevated)', color: 'var(--text-primary)',
          cursor: 'pointer', fontSize: 13, fontWeight: 600,
          fontFamily: 'inherit', textAlign: 'left',
          borderBottom: collapsed ? 'none' : '1px solid var(--border)',
        }}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <ListOrdered size={14} />
        Smart Print Queue ({activeJobs.length})
        <label
          onClick={(e) => e.stopPropagation()}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 400 }}
        >
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(e) => setAutoStart(e.target.checked)}
          />
          Auto-start
        </label>
      </button>

      {!collapsed && (
        <div style={{ maxHeight: 420, overflow: 'auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(160px, 1fr) 72px minmax(120px, 160px) 96px 84px',
            gap: 6,
            padding: 10,
            borderBottom: '1px solid var(--border)',
          }}>
            <input
              value={quickPath}
              onChange={(e) => setQuickPath(e.target.value)}
              placeholder="0:/gcodes/part.gcode"
              style={{ minWidth: 0 }}
            />
            <input
              type="number"
              min={1}
              value={quickCopies}
              onChange={(e) => setQuickCopies(Math.max(1, Number(e.target.value) || 1))}
              title="Copies"
            />
            <select value={quickPrinterId} onChange={(e) => setQuickPrinterId(e.target.value)} title="Target printer">
              <option value="">Auto route</option>
              {printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name}</option>)}
            </select>
            <input
              value={quickMaterial}
              onChange={(e) => setQuickMaterial(e.target.value)}
              placeholder="Material"
              title="Required material"
            />
            <input
              value={quickNozzle}
              onChange={(e) => setQuickNozzle(e.target.value)}
              placeholder="Nozzle"
              title="Required nozzle"
            />
            <button type="button" onClick={handleQuickAdd} style={{ gridColumn: '1 / -1' }}>
              <CopyPlus size={13} /> Add copies
            </button>
          </div>

          {activeJobs.length === 0 ? (
            <div style={{
              padding: '16px 12px', color: 'var(--text-muted)',
              fontSize: 12, textAlign: 'center',
            }}>
              Queue is empty. Add files from the Files tab or queue copies here.
            </div>
          ) : (
            activeJobs.map((job, index) => (
              <div
                key={job.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '24px minmax(120px, 1fr) minmax(100px, 150px) 84px 112px',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  fontSize: 12,
                  borderBottom: index < activeJobs.length - 1 ? '1px solid var(--border)' : 'none',
                  color: 'var(--text-primary)',
                }}
              >
                <span style={{
                  color: 'var(--text-muted)', fontSize: 11,
                  fontFamily: 'monospace', textAlign: 'right',
                }}>
                  {index + 1}.
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    title={job.filePath}
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}
                  >
                    {job.fileName}
                  </div>
                  <div style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Copy {job.copyIndex}/{job.requestedCopies} - {routeDetails(job, printerName)}
                  </div>
                </div>
                <select
                  value={job.printerId ?? ''}
                  onChange={(e) => assignPrinter(job.id, e.target.value || null, printers)}
                  title="Move job to printer"
                >
                  <option value="">Auto route</option>
                  {printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name}</option>)}
                </select>
                <span style={{
                  color: statusTone(job.status),
                  border: `1px solid ${statusTone(job.status)}`,
                  borderRadius: 999,
                  padding: '2px 8px',
                  textAlign: 'center',
                  textTransform: 'capitalize',
                }}>
                  {job.status}
                </span>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                  <button type="button" onClick={() => moveJob(job.id, -1)} disabled={index === 0} title="Move up">
                    <ArrowUp size={13} />
                  </button>
                  <button type="button" onClick={() => moveJob(job.id, 1)} disabled={index === activeJobs.length - 1} title="Move down">
                    <ArrowDown size={13} />
                  </button>
                  <button type="button" onClick={() => void startQueueJob(job)} disabled={job.status === 'blocked' || job.status === 'printing'} title="Start or switch to target printer">
                    <Play size={13} />
                  </button>
                  <button type="button" onClick={() => handlePauseResume(job)} title={job.status === 'paused' ? 'Resume' : 'Pause'}>
                    {job.status === 'paused' ? <RotateCcw size={13} /> : <CirclePause size={13} />}
                  </button>
                  <button type="button" onClick={() => handleCancel(job)} title="Cancel">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}

          {(completedCount > 0 || activeJobs.length > 0) && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: 10, borderTop: '1px solid var(--border)' }}>
              <button type="button" onClick={clearCompleted} disabled={completedCount === 0}>Clear completed</button>
              <button type="button" onClick={clearAll} disabled={jobs.length === 0}>Clear all</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
