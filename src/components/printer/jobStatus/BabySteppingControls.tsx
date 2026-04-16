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
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '8px 0',
      }}>
        <button
          className="control-btn"
          title="Lower Z by 0.02mm"
          onClick={() => setBabyStep(-0.02)}
          style={{ width: 40, height: 40 }}
        >
          <Minus size={16} />
        </button>
        <div style={{
          textAlign: 'center', minWidth: 100,
        }}>
          <div style={{ fontSize: 10, color: '#666680', marginBottom: 2 }}>Z Offset</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#e0e0ff', fontFamily: 'monospace' }}>
            {currentOffset >= 0 ? '+' : ''}{currentOffset.toFixed(3)} mm
          </div>
        </div>
        <button
          className="control-btn"
          title="Raise Z by 0.02mm"
          onClick={() => setBabyStep(0.02)}
          style={{ width: 40, height: 40 }}
        >
          <Plus size={16} />
        </button>
      </div>
      <div style={{ fontSize: 10, color: '#555', textAlign: 'center' }}>
        Step: 0.02 mm
      </div>
    </div>
  );
}
