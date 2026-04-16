import { Droplets } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { JobDetailRow, formatFilament } from './helpers';
import '../DuetJobStatus.css';

export function FilamentUsage() {
  const model = usePrinterStore((s) => s.model);
  const job = model.job;
  if (!job) return null;

  const requiredFilament = job.file?.filament ?? [];
  const totalRequired = requiredFilament.reduce((a, b) => a + b, 0);

  // Per-extruder used totals from layer data
  const perExtruderUsed: number[] = [];
  for (const layer of job.layers ?? []) {
    const f = layer.filament ?? [];
    for (let i = 0; i < f.length; i++) {
      perExtruderUsed[i] = (perExtruderUsed[i] ?? 0) + f[i];
    }
  }
  const usedFilament = perExtruderUsed.reduce((a, b) => a + b, 0);

  if (totalRequired <= 0 && usedFilament <= 0) return null;

  // Show per-extruder rows when there's more than one extruder
  const multiExtruder = requiredFilament.length > 1 || perExtruderUsed.length > 1;

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Droplets size={14} /> Filament Usage
      </div>
      <div className="job-detail-grid">
        {totalRequired > 0 && (
          <JobDetailRow label="Required" value={formatFilament(totalRequired)} />
        )}
        <JobDetailRow label="Used so far" value={formatFilament(usedFilament)} />
        {totalRequired > 0 && usedFilament > 0 && (
          <JobDetailRow
            label="Remaining"
            value={formatFilament(Math.max(0, totalRequired - usedFilament))}
          />
        )}
        {multiExtruder && requiredFilament.map((req, i) => {
          const used = perExtruderUsed[i] ?? 0;
          return (
            <JobDetailRow
              key={i}
              label={`E${i}`}
              value={`${formatFilament(used)} / ${formatFilament(req)}`}
            />
          );
        })}
      </div>
    </div>
  );
}
