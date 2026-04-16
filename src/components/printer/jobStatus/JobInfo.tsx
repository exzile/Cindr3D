import { FileText } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { JobDetailRow, formatTime, formatBytes } from './helpers';
import '../DuetJobStatus.css';

export function JobInfo() {
  const model = usePrinterStore((s) => s.model);
  const job = model.job;
  if (!job?.file) return null;

  const f = job.file;
  const objectCount = job.build?.objects?.length ?? 0;
  const slicer = f.generatedBy?.trim();
  const sliceTime = f.simulatedTime > 0 ? f.simulatedTime : f.printTime;

  return (
    <div className="job-section">
      <div className="job-section-title">
        <FileText size={14} /> Job Info
      </div>
      <div className="job-detail-grid">
        {slicer && <JobDetailRow label="Slicer" value={slicer} />}
        {sliceTime > 0 && (
          <JobDetailRow
            label={f.simulatedTime > 0 ? 'Simulated time' : 'Estimated time'}
            value={formatTime(sliceTime)}
          />
        )}
        {f.layerHeight > 0 && (
          <JobDetailRow label="Layer height" value={`${f.layerHeight.toFixed(2)} mm`} />
        )}
        {f.firstLayerHeight > 0 && (
          <JobDetailRow label="First layer" value={`${f.firstLayerHeight.toFixed(2)} mm`} />
        )}
        {f.height > 0 && (
          <JobDetailRow label="Object height" value={`${f.height.toFixed(2)} mm`} />
        )}
        {f.size > 0 && <JobDetailRow label="File size" value={formatBytes(f.size)} />}
        {objectCount > 0 && (
          <JobDetailRow label="Objects" value={String(objectCount)} />
        )}
      </div>
    </div>
  );
}
