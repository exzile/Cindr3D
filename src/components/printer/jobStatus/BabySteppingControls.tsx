import { ArrowUpDown, Minus, Plus } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import '../DuetJobStatus.css';

export function BabySteppingControls() {
  const model = usePrinterStore((s) => s.model);
  const setBabyStep = usePrinterStore((s) => s.setBabyStep);

  // Current baby step offset from move axes Z
  const zAxis = model.move?.axes?.find((a) => a.letter === 'Z');
  const currentOffset = zAxis ? (zAxis.userPosition - zAxis.machinePosition) : 0;

  return (
    <div className="job-section">
      <div className="job-section-title">
        <ArrowUpDown size={14} /> Baby Stepping (Z Offset)
      </div>
      <div className="duet-job__babystep-row">
        <button
          className="control-btn duet-job__babystep-btn"
          title="Lower Z by 0.02mm"
          onClick={() => setBabyStep(-0.02)}
        >
          <Minus size={16} />
        </button>
        <div className="duet-job__babystep-display">
          <div className="duet-job__babystep-label">Z Offset</div>
          <div className="duet-job__babystep-value">
            {currentOffset >= 0 ? '+' : ''}{currentOffset.toFixed(3)} mm
          </div>
        </div>
        <button
          className="control-btn duet-job__babystep-btn"
          title="Raise Z by 0.02mm"
          onClick={() => setBabyStep(0.02)}
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="duet-job__babystep-hint">
        Step: 0.02 mm
      </div>
    </div>
  );
}
