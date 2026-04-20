import { useMemo, useState } from 'react';
import { Clock, DollarSign, Scale, Layers as LayersIcon, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import type { SliceLayer, SliceMove } from '../../../../types/slicer';
import './SlicerCostBreakdown.css';

// Group move types into a user-friendly category. Matches the colour legend.
const CATEGORY_LABEL: Record<SliceMove['type'], { label: string; cat: string; color: string }> = {
  'wall-outer':  { label: 'Outer Wall', cat: 'Walls',     color: '#ff8844' },
  'wall-inner':  { label: 'Inner Wall', cat: 'Walls',     color: '#ffbb66' },
  'top-bottom':  { label: 'Top/Bottom', cat: 'Skin',      color: '#44ff88' },
  'ironing':     { label: 'Ironing',    cat: 'Skin',      color: '#88ff88' },
  infill:        { label: 'Infill',     cat: 'Infill',    color: '#44aaff' },
  support:       { label: 'Support',    cat: 'Support',   color: '#ff44ff' },
  skirt:         { label: 'Skirt',      cat: 'Adhesion',  color: '#aaaaaa' },
  brim:          { label: 'Brim',       cat: 'Adhesion',  color: '#aaaaaa' },
  raft:          { label: 'Raft',       cat: 'Adhesion',  color: '#888888' },
  bridge:        { label: 'Bridge',     cat: 'Infill',    color: '#ff4444' },
  travel:        { label: 'Travel',     cat: 'Travel',    color: '#666666' },
};

const CATEGORY_ORDER = ['Walls', 'Skin', 'Infill', 'Support', 'Adhesion', 'Travel', 'Other'];

interface TimeBreakdown {
  category: string;
  color: string;
  seconds: number;
}

function computeTimeBreakdown(layers: SliceLayer[]): TimeBreakdown[] {
  // Sum move time (distance / speed) per category.
  const times = new Map<string, { seconds: number; color: string }>();
  for (const layer of layers) {
    for (const move of layer.moves) {
      const meta = CATEGORY_LABEL[move.type] ?? { cat: 'Other', color: '#888888' };
      const dx = move.to.x - move.from.x;
      const dy = move.to.y - move.from.y;
      const dist = Math.hypot(dx, dy);
      const t = move.speed > 0 ? dist / move.speed : 0;
      const existing = times.get(meta.cat);
      if (existing) existing.seconds += t;
      else times.set(meta.cat, { seconds: t, color: meta.color });
    }
  }
  return CATEGORY_ORDER
    .map((cat) => {
      const v = times.get(cat);
      return v ? { category: cat, color: v.color, seconds: v.seconds } : null;
    })
    .filter((v): v is TimeBreakdown => v !== null && v.seconds > 0.5);
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function SlicerCostBreakdown() {
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const material = useSlicerStore((s) => s.getActiveMaterialProfile());
  const plateObjects = useSlicerStore((s) => s.plateObjects);

  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [laborRate, setLaborRate] = useState<number>(() => {
    const saved = Number(localStorage.getItem('dzign3d-labor-rate'));
    return isFinite(saved) && saved >= 0 ? saved : 0;
  });

  const breakdown = useMemo(
    () => (sliceResult ? computeTimeBreakdown(sliceResult.layers) : []),
    [sliceResult],
  );

  const totalSeconds = breakdown.reduce((n, b) => n + b.seconds, 0);

  if (!sliceResult || dismissed) return null;

  const hours = sliceResult.printTime / 3600;
  const laborCost = hours * laborRate;
  const materialCost = sliceResult.filamentCost;
  const totalCost = materialCost + laborCost;
  const filamentMeters = sliceResult.filamentUsed / 1000;
  const filamentDiameter = sliceResult.filamentUsed > 0 && sliceResult.filamentWeight > 0
    ? undefined
    : undefined;
  void filamentDiameter;

  const handleLaborRateChange = (v: number) => {
    setLaborRate(v);
    try { localStorage.setItem('dzign3d-labor-rate', String(v)); } catch { /* ignore */ }
  };

  return (
    <div className={`slicer-cost-breakdown${expanded ? ' is-expanded' : ''}`}>
      <div className="slicer-cost-breakdown__header">
        <button
          type="button"
          className="slicer-cost-breakdown__toggle"
          onClick={() => setExpanded(!expanded)}
          title={expanded ? 'Collapse summary' : 'Expand summary'}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          <span>Print Summary</span>
        </button>
        <button
          type="button"
          className="slicer-cost-breakdown__close"
          onClick={() => setDismissed(true)}
          title="Dismiss — slice again to show"
          aria-label="Dismiss"
        >
          <X size={12} />
        </button>
      </div>

      {expanded && (
        <div className="slicer-cost-breakdown__body">
          {/* Headline stats */}
          <div className="slicer-cost-breakdown__stats">
            <div className="slicer-cost-breakdown__stat">
              <Clock size={14} className="slicer-cost-breakdown__stat-icon" />
              <div>
                <div className="slicer-cost-breakdown__stat-value">{formatTime(sliceResult.printTime)}</div>
                <div className="slicer-cost-breakdown__stat-label">Print time</div>
              </div>
            </div>
            <div className="slicer-cost-breakdown__stat">
              <Scale size={14} className="slicer-cost-breakdown__stat-icon" />
              <div>
                <div className="slicer-cost-breakdown__stat-value">
                  {sliceResult.filamentWeight.toFixed(1)}g
                </div>
                <div className="slicer-cost-breakdown__stat-label">
                  {filamentMeters.toFixed(2)} m{material ? ` · ${material.name}` : ''}
                </div>
              </div>
            </div>
            <div className="slicer-cost-breakdown__stat">
              <LayersIcon size={14} className="slicer-cost-breakdown__stat-icon" />
              <div>
                <div className="slicer-cost-breakdown__stat-value">{sliceResult.layerCount}</div>
                <div className="slicer-cost-breakdown__stat-label">Layers · {plateObjects.length} objects</div>
              </div>
            </div>
            <div className="slicer-cost-breakdown__stat slicer-cost-breakdown__stat--total">
              <DollarSign size={14} className="slicer-cost-breakdown__stat-icon" />
              <div>
                <div className="slicer-cost-breakdown__stat-value">${totalCost.toFixed(2)}</div>
                <div className="slicer-cost-breakdown__stat-label">
                  ${materialCost.toFixed(2)} material
                  {laborRate > 0 && ` + $${laborCost.toFixed(2)} labor`}
                </div>
              </div>
            </div>
          </div>

          {/* Time breakdown bar */}
          {breakdown.length > 0 && totalSeconds > 0 && (
            <>
              <div className="slicer-cost-breakdown__section-title">Time by feature</div>
              <div className="slicer-cost-breakdown__bar">
                {breakdown.map((b) => (
                  <div
                    key={b.category}
                    className="slicer-cost-breakdown__bar-segment"
                    style={{
                      width: `${(b.seconds / totalSeconds) * 100}%`,
                      background: b.color,
                    }}
                    title={`${b.category}: ${formatTime(b.seconds)}`}
                  />
                ))}
              </div>
              <div className="slicer-cost-breakdown__legend">
                {breakdown.map((b) => (
                  <div key={b.category} className="slicer-cost-breakdown__legend-item">
                    <span className="slicer-cost-breakdown__legend-swatch" style={{ background: b.color }} />
                    <span>{b.category}</span>
                    <span className="slicer-cost-breakdown__legend-value">{formatTime(b.seconds)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Labor rate slider */}
          <div className="slicer-cost-breakdown__labor">
            <label>
              Labor rate:
              <input
                type="number"
                min={0}
                step={1}
                value={laborRate}
                onChange={(e) => handleLaborRateChange(Math.max(0, Number(e.target.value) || 0))}
              />
              <span className="slicer-cost-breakdown__labor-unit">$/h</span>
            </label>
            <span className="slicer-cost-breakdown__labor-total">
              = ${totalCost.toFixed(2)} all-in
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
