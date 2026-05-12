import { Thermometer } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import '../DuetJobStatus.css';

export function TemperatureChart() {
  const history = usePrinterStore((s) => s.temperatureHistory);

  if (history.length < 2) return null;

  const W = 480;
  const H = 160;
  const PAD = { top: 10, right: 10, bottom: 24, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Flatten all temperatures to compute Y range
  const allTemps: number[] = [];
  for (const s of history) {
    for (const h of s.heaters ?? []) {
      if (h.current != null) allTemps.push(h.current);
      if (h.active != null && h.active > 0) allTemps.push(h.active);
    }
  }
  if (allTemps.length === 0) return null;

  const minT = 0;
  const maxT = Math.max(50, ...allTemps) + 10;
  const tStart = history[0].timestamp;
  const tEnd = history[history.length - 1].timestamp;
  const tRange = Math.max(tEnd - tStart, 1);

  const toX = (ts: number) => PAD.left + ((ts - tStart) / tRange) * plotW;
  const toY = (temp: number) => PAD.top + plotH - ((temp - minT) / (maxT - minT)) * plotH;

  // Build polylines per heater index
  const heaterIndices = new Set<number>();
  for (const s of history) {
    for (const h of s.heaters ?? []) heaterIndices.add(h.index);
  }
  const colors = ['#ff8844', '#44aaff', '#44cc88', '#cc66ff', '#ffcc44'];

  const lines: { idx: number; path: string; color: string }[] = [];
  let ci = 0;
  for (const idx of heaterIndices) {
    const pts = history
      .map((s) => {
        const h = s.heaters?.find((x) => x.index === idx);
        return h ? { x: toX(s.timestamp), y: toY(h.current) } : null;
      })
      .filter(Boolean) as { x: number; y: number }[];
    if (pts.length > 1) {
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      lines.push({ idx, path: d, color: colors[ci % colors.length] });
    }
    ci++;
  }

  // Y-axis gridlines
  const yTicks: number[] = [];
  const step = maxT <= 100 ? 25 : maxT <= 300 ? 50 : 100;
  for (let t = 0; t <= maxT; t += step) yTicks.push(t);

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Thermometer size={14} /> Temperature History
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="duet-job__svg-chart">
        {/* Grid */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left} y1={toY(t)} x2={W - PAD.right} y2={toY(t)}
              stroke="#2a2a4a" strokeWidth={0.5}
            />
            <text x={PAD.left - 4} y={toY(t) + 3} fill="#666680" fontSize={9} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {/* Lines */}
        {lines.map((l) => (
          <path key={l.idx} d={l.path} fill="none" stroke={l.color} strokeWidth={1.5} />
        ))}
        {/* Legend */}
        {lines.map((l, i) => (
          <g key={`leg-${l.idx}`}>
            <rect x={PAD.left + i * 80} y={H - 14} width={10} height={10} rx={2} fill={l.color} />
            <text
              x={PAD.left + i * 80 + 14} y={H - 5}
              fill="#aaaacc" fontSize={9}
            >
              Heater {l.idx}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
