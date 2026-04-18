import { Clock } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { JobDetailRow, formatTime, estimatedCompletion } from './helpers';
import '../DuetJobStatus.css';

export function TimeEstimates() {
  const model = usePrinterStore((s) => s.model);
  const job = model.job;
  if (!job) return null;

  const elapsed = job.duration ?? 0;
  const warmUp = job.warmUpDuration ?? 0;
  const layerTime = job.layerTime ?? 0;
  const layers = job.layers ?? [];
  const avgLayerTime = layers.length > 0
    ? layers.reduce((sum, l) => sum + (l.duration ?? 0), 0) / layers.length
    : 0;
  const tl = job.timesLeft;

  // Pick best remaining estimate (prefer file, then slicer, then filament, then layer)
  const bestRemaining = tl
    ? (tl.file > 0 ? tl.file : tl.slicer > 0 ? tl.slicer : tl.filament > 0 ? tl.filament : tl.layer > 0 ? tl.layer : 0)
    : 0;

  // Simulated vs actual comparison
  const simTime = job.file?.simulatedTime ?? 0;

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Clock size={14} /> Time Estimates
      </div>
      <div className="job-detail-grid">
        <JobDetailRow label="Elapsed" value={formatTime(elapsed)} />
        {layerTime > 0 && (
          <JobDetailRow label="Current layer time" value={formatTime(layerTime)} />
        )}
        {avgLayerTime > 0 && (
          <JobDetailRow label="Avg layer time" value={formatTime(avgLayerTime)} />
        )}
        {tl && tl.file > 0 && (
          <JobDetailRow label="Remaining (file)" value={formatTime(tl.file)} />
        )}
        {tl && tl.filament > 0 && (
          <JobDetailRow label="Remaining (filament)" value={formatTime(tl.filament)} />
        )}
        {tl && tl.slicer > 0 && (
          <JobDetailRow label="Remaining (slicer)" value={formatTime(tl.slicer)} />
        )}
        {tl && tl.layer > 0 && (
          <JobDetailRow label="Remaining (layer)" value={formatTime(tl.layer)} />
        )}
        {bestRemaining > 0 && (
          <JobDetailRow
            label="Est. completion"
            value={estimatedCompletion(bestRemaining)}
            highlight
          />
        )}
        {warmUp > 0 && (
          <JobDetailRow label="Warm-up duration" value={formatTime(warmUp)} />
        )}
      </div>

      {/* Simulated vs Actual comparison */}
      {simTime > 0 && elapsed > 0 && (
        <SimulatedVsActual simulatedTime={simTime} elapsedTime={elapsed} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simulated vs Actual sub-component
// ---------------------------------------------------------------------------

function SimulatedVsActual({ simulatedTime, elapsedTime }: { simulatedTime: number; elapsedTime: number }) {
  // Accuracy: how close is the simulation to the actual elapsed time so far
  // 100% = perfect match. >100% means print is going faster than predicted.
  const accuracyPct = Math.round((simulatedTime / elapsedTime) * 100);
  const delta = elapsedTime - simulatedTime;
  const isSlower = delta > 0;
  const absDelta = Math.abs(delta);

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: '#888899',
        textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6,
      }}>
        Simulated vs Actual
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: '#888899' }}>Simulated</span>
        <span style={{ color: '#e0e0ff', fontFamily: 'monospace' }}>{formatTime(simulatedTime)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: '#888899' }}>Elapsed</span>
        <span style={{ color: '#e0e0ff', fontFamily: 'monospace' }}>{formatTime(elapsedTime)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
        <span style={{ color: '#888899' }}>Difference</span>
        <span style={{
          fontFamily: 'monospace',
          color: isSlower ? '#ff8866' : '#44cc88',
        }}>
          {isSlower ? '+' : '-'}{formatTime(absDelta)} ({isSlower ? 'slower' : 'faster'})
        </span>
      </div>
      {/* Accuracy bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#888899', flexShrink: 0 }}>Accuracy</span>
        <div style={{
          flex: 1, height: 6, background: 'var(--bg-elevated, #333)',
          borderRadius: 3, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 3, transition: 'width 0.3s ease',
            width: `${Math.min(100, accuracyPct)}%`,
            background: accuracyPct > 85 && accuracyPct < 115 ? '#44cc88'
              : accuracyPct > 70 && accuracyPct < 130 ? '#ffaa44' : '#ff6644',
          }} />
        </div>
        <span style={{
          fontSize: 12, fontFamily: 'monospace', fontWeight: 600, flexShrink: 0,
          color: accuracyPct > 85 && accuracyPct < 115 ? '#44cc88'
            : accuracyPct > 70 && accuracyPct < 130 ? '#ffaa44' : '#ff6644',
        }}>
          {accuracyPct}%
        </span>
      </div>
    </div>
  );
}
