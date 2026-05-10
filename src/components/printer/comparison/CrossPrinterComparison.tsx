import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Clock, FileCode, Play, Plus, Trophy } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { usePrintQueueStore } from '../../../store/printQueueStore';
import {
  summarizeComparison,
  useAbComparisonStore,
  type ComparisonLeg,
  type ComparisonLegId,
  type ComparisonQualityRating,
} from '../../../store/abComparisonStore';
import { formatDurationWords } from '../../../utils/printerFormat';
import './CrossPrinterComparison.css';

const QUALITY_OPTIONS: Array<{ value: ComparisonQualityRating; label: string }> = [
  { value: 'unrated', label: 'Unrated' },
  { value: 'best', label: 'Best' },
  { value: 'acceptable', label: 'Acceptable' },
  { value: 'needs-review', label: 'Needs review' },
  { value: 'failed', label: 'Failed' },
];

function legProgress(leg: ComparisonLeg): number {
  const last = leg.samples[leg.samples.length - 1];
  if (last?.elapsedSeconds == null || last.remainingSeconds == null) return 0;
  const total = last.elapsedSeconds + last.remainingSeconds;
  return total > 0 ? Math.min(100, Math.max(0, (last.elapsedSeconds / total) * 100)) : 0;
}

function latestLayer(leg: ComparisonLeg): string {
  const sample = [...leg.samples].reverse().find((entry) => entry.layer !== undefined);
  return sample?.layer === undefined ? '--' : String(sample.layer);
}

export default function CrossPrinterComparison() {
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const connected = usePrinterStore((s) => s.connected);
  const model = usePrinterStore((s) => s.model);
  const startPrint = usePrinterStore((s) => s.startPrint);
  const selectPrinter = usePrinterStore((s) => s.selectPrinter);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);
  const addCopies = usePrintQueueStore((s) => s.addCopies);
  const [filePath, setFilePath] = useState('0:/gcodes/');
  const [printerAId, setPrinterAId] = useState(printers[0]?.id ?? '');
  const [printerBId, setPrinterBId] = useState(printers[1]?.id ?? printers[0]?.id ?? '');

  const sessions = useAbComparisonStore((s) => s.sessions);
  const activeSessionId = useAbComparisonStore((s) => s.activeSessionId);
  const createSession = useAbComparisonStore((s) => s.createSession);
  const setActiveSession = useAbComparisonStore((s) => s.setActiveSession);
  const updateLeg = useAbComparisonStore((s) => s.updateLeg);
  const recordSample = useAbComparisonStore((s) => s.recordSample);
  const setLegQuality = useAbComparisonStore((s) => s.setLegQuality);
  const setLegNotes = useAbComparisonStore((s) => s.setLegNotes);

  const selectedPrinterAId = printerAId || printers[0]?.id || '';
  const selectedPrinterBId = printerBId || printers[1]?.id || printers[0]?.id || '';

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null,
    [activeSessionId, sessions],
  );
  const report = useMemo(() => summarizeComparison(activeSession), [activeSession]);

  useEffect(() => {
    if (!activeSession || !connected) return;
    const legId = (['a', 'b'] as ComparisonLegId[]).find((candidate) => activeSession.legs[candidate].printerId === activePrinterId);
    if (!legId) return;
    const status = model.state?.status;
    if (status === 'processing' || status === 'simulating') {
      recordSample(activeSession.id, legId, {
        layer: model.job?.layer,
        elapsedSeconds: model.job?.duration,
        remainingSeconds: model.job?.timesLeft?.file,
      });
      updateLeg(activeSession.id, legId, {
        status: 'running',
        startedAt: activeSession.legs[legId].startedAt ?? Date.now(),
      });
    }
    if (status === 'idle' && activeSession.legs[legId].status === 'running') {
      updateLeg(activeSession.id, legId, {
        status: 'done',
        finishedAt: Date.now(),
        totalSeconds: model.job?.lastDuration || model.job?.duration || activeSession.legs[legId].samples.at(-1)?.elapsedSeconds,
      });
    }
  }, [activePrinterId, activeSession, connected, model.job?.duration, model.job?.lastDuration, model.job?.layer, model.job?.timesLeft?.file, model.state?.status, recordSample, updateLeg]);

  const createComparison = useCallback(() => {
    const printerA = printers.find((printer) => printer.id === selectedPrinterAId);
    const printerB = printers.find((printer) => printer.id === selectedPrinterBId);
    const path = filePath.trim();
    if (!printerA || !printerB || !path || printerA.id === printerB.id) return;
    const sessionId = createSession({
      filePath: path,
      printerA: { id: printerA.id, name: printerA.name },
      printerB: { id: printerB.id, name: printerB.name },
    });
    const [jobA] = addCopies({ filePath: path, printerId: printerA.id, routingMode: 'manual' }, printers);
    const [jobB] = addCopies({ filePath: path, printerId: printerB.id, routingMode: 'manual' }, printers);
    updateLeg(sessionId, 'a', { status: 'queued', queueJobId: jobA });
    updateLeg(sessionId, 'b', { status: 'queued', queueJobId: jobB });
    setActiveTab('comparison');
  }, [addCopies, createSession, filePath, printers, selectedPrinterAId, selectedPrinterBId, setActiveTab, updateLeg]);

  const startLeg = useCallback(async (legId: ComparisonLegId) => {
    if (!activeSession) return;
    const leg = activeSession.legs[legId];
    if (leg.printerId !== activePrinterId) {
      await selectPrinter(leg.printerId);
      return;
    }
    if (!connected) return;
    updateLeg(activeSession.id, legId, { status: 'running', startedAt: Date.now() });
    await startPrint(activeSession.filePath);
  }, [activePrinterId, activeSession, connected, selectPrinter, startPrint, updateLeg]);

  const renderLeg = (legId: ComparisonLegId, leg: ComparisonLeg) => {
    const progress = legProgress(leg);
    const latest = leg.samples[leg.samples.length - 1];
    const isWinner = report.fasterLeg === legId || report.qualityLeg === legId;
    return (
      <article className={`comparison-leg${isWinner ? ' is-winner' : ''}`}>
        <div className="comparison-leg__header">
          <div>
            <span>Printer {legId.toUpperCase()}</span>
            <h3>{leg.printerName}</h3>
          </div>
          <strong>{leg.status}</strong>
        </div>
        <div className="comparison-leg__metrics">
          <div><Clock size={14} /><span>Elapsed</span><strong>{formatDurationWords(latest?.elapsedSeconds ?? leg.totalSeconds, '--', false)}</strong></div>
          <div><Clock size={14} /><span>ETA</span><strong>{formatDurationWords(latest?.remainingSeconds, '--', false)}</strong></div>
          <div><BarChart3 size={14} /><span>Layer</span><strong>{latestLayer(leg)}</strong></div>
        </div>
        <div className="comparison-leg__bar"><span style={{ width: `${progress}%` }} /></div>
        <div className="comparison-leg__controls">
          <button type="button" onClick={() => { void startLeg(legId); }}>
            <Play size={13} /> {leg.printerId === activePrinterId ? 'Start' : 'Switch'}
          </button>
          <select
            value={leg.quality}
            onChange={(event) => activeSession && setLegQuality(activeSession.id, legId, event.target.value as ComparisonQualityRating)}
          >
            {QUALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <textarea
          value={leg.notes}
          onChange={(event) => activeSession && setLegNotes(activeSession.id, legId, event.target.value)}
          placeholder="Quality notes"
        />
      </article>
    );
  };

  return (
    <section className="cross-printer-comparison" aria-label="Cross-printer A/B comparison">
      <div className="comparison-toolbar">
        <div className="comparison-toolbar__title">
          <Trophy size={18} />
          <h2>A/B Comparison</h2>
        </div>
        <select value={activeSession?.id ?? ''} onChange={(event) => setActiveSession(event.target.value || null)}>
          <option value="">Latest comparison</option>
          {sessions.map((session) => <option key={session.id} value={session.id}>{session.fileName}</option>)}
        </select>
      </div>

      <div className="comparison-setup">
        <label>
          <FileCode size={14} />
          <input value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder="0:/gcodes/test.gcode" />
        </label>
        <select value={selectedPrinterAId} onChange={(event) => setPrinterAId(event.target.value)}>
          {printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name}</option>)}
        </select>
        <select value={selectedPrinterBId} onChange={(event) => setPrinterBId(event.target.value)}>
          {printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name}</option>)}
        </select>
        <button type="button" onClick={createComparison} disabled={!filePath.trim() || selectedPrinterAId === selectedPrinterBId}>
          <Plus size={14} /> Queue A/B run
        </button>
      </div>

      {activeSession ? (
        <>
          <div className="comparison-summary">
            <CheckCircle2 size={16} />
            <span>{report.summary}</span>
            {report.timeDeltaSeconds !== null && <strong>{formatDurationWords(report.timeDeltaSeconds, '--', false)} delta</strong>}
          </div>
          <div className="comparison-legs">
            {renderLeg('a', activeSession.legs.a)}
            {renderLeg('b', activeSession.legs.b)}
          </div>
        </>
      ) : (
        <div className="comparison-empty">Create a comparison to queue the same G-code for two printers.</div>
      )}
    </section>
  );
}
