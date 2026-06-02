import { deviationColor, divergingColor, type HeightMapStats } from '../utils';
import { getBedQuality } from './quality';

/** Color scale legend shown beneath the 2D heatmap. */
export function ColorScaleLegend({
  min,
  max,
  diverging = false,
}: {
  min: number;
  max: number;
  diverging?: boolean;
}) {
  const labels = Array.from({ length: 11 }, (_, i) => {
    const value = min + (i / 10) * (max - min);
    return { value, color: (diverging ? divergingColor : deviationColor)(value, min, max) };
  });

  return (
    <div className="heightmap-legend">
      <span className="legend-label">{min.toFixed(3)}</span>
      <div className="legend-bar">
        {labels.map((label, index) => (
          <div key={index} className="legend-segment" style={{ background: label.color, flex: 1 }} title={`${label.value.toFixed(3)} mm`} />
        ))}
      </div>
      <span className="legend-label">{max.toFixed(3)}</span>
      <span className="legend-unit">mm</span>
    </div>
  );
}

/** Stats panel - kept for backwards compat; sidebar uses inline rows. */
export function StatsPanel({ stats }: { stats: HeightMapStats }) {
  const minColor = stats.min < 0 ? '#60a5fa' : '#34d399';
  const maxColor = stats.max > 0 ? '#f87171' : '#34d399';
  const rmsWarning = stats.rms > 0.2;
  const quality = getBedQuality(stats.rms);

  return (
    <div className="heightmap-stats">
      <div className="stat-row">
        <span className="stat-label">Min</span>
        <span className="stat-value" style={{ color: minColor }}>{stats.min.toFixed(4)}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Max</span>
        <span className="stat-value" style={{ color: maxColor }}>{stats.max.toFixed(4)}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Mean</span>
        <span className="stat-value">{stats.mean.toFixed(4)}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">RMS</span>
        <span className="stat-value" style={rmsWarning ? { color: '#f59e0b' } : undefined}>{stats.rms.toFixed(4)}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Points</span>
        <span className="stat-value">{stats.probePoints}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Grid</span>
        <span className="stat-value">{stats.gridDimensions}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Flatness</span>
        <span className="stat-value" style={{ color: quality.color, fontWeight: 800 }}>{quality.label}</span>
      </div>
    </div>
  );
}
