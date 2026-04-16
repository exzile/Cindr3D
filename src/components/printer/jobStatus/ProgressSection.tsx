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
      {/* Large progress bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', marginBottom: 4,
          fontSize: 12, color: '#aaaacc',
        }}>
          <span>Overall</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#e0e0ff' }}>
            {pct.toFixed(1)}%
          </span>
        </div>
        <div style={{
          height: 10, background: '#1a1a2e', borderRadius: 5, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${Math.min(100, pct)}%`,
            background: 'linear-gradient(90deg, #44aaff, #44cc88)',
            borderRadius: 5, transition: 'width 0.5s ease',
          }} />
        </div>
      </div>
      {/* Detail rows */}
      <div className="job-detail-grid">
        <JobDetailRow label="File progress" value={`${formatBytes(filePos)} / ${formatBytes(fileSize)}`} />
        <JobDetailRow label="Layer" value={`${currentLayer} / ${totalLayers}`} />
        <JobDetailRow label="Current height" value={`${currentHeight.toFixed(2)} mm`} />
      </div>
    </div>
  );
}
