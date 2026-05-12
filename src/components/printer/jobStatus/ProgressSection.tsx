import { Layers } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { JobDetailRow, formatBytes } from './helpers';
import '../DuetJobStatus.css';

export function ProgressSection() {
  const model = usePrinterStore((s) => s.model);
  const job = model.job;
  if (!job) return null;

  const fileSize = job.file?.size ?? 0;
  const filePos = job.filePosition ?? 0;
  const pct = fileSize > 0 ? (filePos / fileSize) * 100 : 0;
  const currentLayer = job.layer ?? 0;
  const totalLayers = job.file?.numLayers ?? 0;
  const layerHeight = job.file?.layerHeight ?? 0;
  const currentHeight = currentLayer > 0
    ? (job.file?.firstLayerHeight ?? layerHeight) + (currentLayer - 1) * layerHeight
    : 0;

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Layers size={14} /> Progress
      </div>
      <div className="duet-job__progress-bar-wrap">
        <div className="duet-job__progress-bar-row">
          <span>Overall</span>
          <span className="duet-job__progress-bar-pct">
            {pct.toFixed(1)}%
          </span>
        </div>
        <div className="duet-job__progress-bar-track">
          <div className="duet-job__progress-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </div>
      <div className="job-detail-grid">
        <JobDetailRow label="File progress" value={`${formatBytes(filePos)} / ${formatBytes(fileSize)}`} />
        <JobDetailRow label="Layer" value={`${currentLayer} / ${totalLayers}`} />
        <JobDetailRow label="Current height" value={`${currentHeight.toFixed(2)} mm`} />
      </div>
    </div>
  );
}
