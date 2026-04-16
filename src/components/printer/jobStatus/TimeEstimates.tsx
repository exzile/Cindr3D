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
    </div>
  );
}
