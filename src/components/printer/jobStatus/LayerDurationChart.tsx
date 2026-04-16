import { Timer } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { formatTime } from './helpers';
import '../DuetJobStatus.css';

export function LayerDurationChart() {
  const model = usePrinterStore((s) => s.model);
  const layers = model.job?.layers;

  if (!layers || layers.length < 2) return null;

  const W = 480;
  const H = 120;
  const PAD = { top: 10, right: 10, bottom: 20, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxDur = Math.max(...layers.map((l) => l.duration), 1);
  const barW = Math.max(1, plotW / layers.length - 1);

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Timer size={14} /> Layer Duration
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {layers.map((layer, i) => {
          const barH = (layer.duration / maxDur) * plotH;
          const x = PAD.left + (i / layers.length) * plotW;
          const y = PAD.top + plotH - barH;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={Math.max(barW, 1)}
              height={barH}
              fill="#44aaff"
              opacity={0.8}
              rx={1}
            >
              <title>Layer {i + 1}: {formatTime(layer.duration)}</title>
            </rect>
          );
        })}
        {/* X axis label */}
        <text x={W / 2} y={H - 3} fill="#666680" fontSize={9} textAnchor="middle">
          Layer
        </text>
        {/* Y axis ticks */}
        {[0, 0.5, 1].map((frac) => {
          const val = frac * maxDur;
          const y = PAD.top + plotH - frac * plotH;
          return (
            <g key={frac}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#2a2a4a" strokeWidth={0.5} />
              <text x={PAD.left - 4} y={y + 3} fill="#666680" fontSize={9} textAnchor="end">
                {formatTime(val)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
