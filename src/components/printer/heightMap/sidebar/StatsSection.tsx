import { TriangleAlert } from 'lucide-react';
import type { HeightMapStats } from '../utils';
import { Z_DATUM_SUGGEST_THRESHOLD } from '../types';

/** Statistics block in the heightmap sidebar — quality badge, RMS bar, min/max chips, mean/grid grid, Z-offset callout. */
export function StatsSection({
  stats,
  isDemo,
  quality,
}: {
  stats: HeightMapStats;
  isDemo: boolean;
  quality: { label: string; color: string };
}) {
  return (
    <div className="hm-side-section hm-side-section--stats">
      <div className="hm-side-title">Statistics</div>

      {/* Quality badge + RMS on one row */}
      <div
        className={`hm-stat-header${isDemo ? ' is-demo' : ''}`}
        style={{ '--qc': quality.color } as React.CSSProperties}
        title={`Bed flatness: ${quality.label} — RMS deviation ${stats.rms.toFixed(4)} mm`}
      >
        <div className="hm-quality-inline">
          <span className="hm-quality-dot" />
          <div>
            <span className="hm-quality-label">{quality.label}</span>
            <span className="hm-quality-sub">Bed Flatness</span>
          </div>
        </div>
        <div className="hm-rms-inline">
          <span className="hm-rms-label">RMS</span>
          <span className="hm-rms-val" style={stats.rms > 0.2 ? { color: '#f59e0b' } : { color: '#34d399' }}>
            {stats.rms.toFixed(4)} mm
          </span>
        </div>
      </div>

      {/* RMS bar */}
      <div className={`hm-rms-track-wrap${isDemo ? ' is-demo' : ''}`}>
        <div className="hm-rms-track">
          <div className="hm-rms-fill" style={{ width: `${Math.min(100, stats.rms / 0.5 * 100)}%` }} />
        </div>
        <div className="hm-rms-scale"><span>0</span><span>0.1</span><span>0.25</span><span>0.5+mm</span></div>
      </div>

      {/* Min/Max chips */}
      <div className={`hm-minmax-row${isDemo ? ' is-demo' : ''}`}>
        <div className="hm-minmax-chip hm-minmax-chip--low" title="Lowest measured deviation — bed is below nozzle at this point">
          <span className="hm-minmax-chip__tag">LOW</span>
          <span className="hm-minmax-chip__val">{stats.min >= 0 ? '+' : ''}{stats.min.toFixed(3)} mm</span>
        </div>
        <div className="hm-minmax-chip hm-minmax-chip--high" title="Highest measured deviation — bed is above nozzle at this point">
          <span className="hm-minmax-chip__tag">HIGH</span>
          <span className="hm-minmax-chip__val">{stats.max >= 0 ? '+' : ''}{stats.max.toFixed(3)} mm</span>
        </div>
      </div>

      {/* 2-column stat grid */}
      <div className={`hm-stat-grid${isDemo ? ' is-demo' : ''}`}>
        <div className="hm-stat-cell" title="Mean deviation — average offset across all probe points">
          <span className="hm-stat-label">Mean</span>
          <span className="hm-stat-value">{stats.mean >= 0 ? '+' : ''}{stats.mean.toFixed(3)} mm</span>
        </div>
        <div className="hm-stat-cell" title="Probe grid dimensions and total number of sampled points">
          <span className="hm-stat-label">Grid</span>
          <span className="hm-stat-value">{stats.gridDimensions} ({stats.probePoints} pts)</span>
        </div>
      </div>

      {/* Z offset callout — shown when mean is large enough to indicate trigger height drift */}
      {!isDemo && Math.abs(stats.mean) >= Z_DATUM_SUGGEST_THRESHOLD && (
        <div className="hm-z-offset-callout">
          <TriangleAlert size={11} className="hm-z-offset-callout__icon" />
          <span className="hm-z-offset-callout__text">
            Mean offset {stats.mean >= 0 ? '+' : ''}{stats.mean.toFixed(3)} mm — Z probe trigger height may be off.
            Run <strong>G30 S-1</strong> before next probe to recalibrate.
          </span>
        </div>
      )}
    </div>
  );
}
