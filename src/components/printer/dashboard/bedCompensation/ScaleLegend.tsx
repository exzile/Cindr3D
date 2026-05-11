import { deviationColor } from '../../heightMap/utils';

/** Discrete-step deviation legend rendered next to the dashboard mini heatmap. */
export function ScaleLegend({ min, max }: { min: number; max: number }) {
  const steps = 5;
  return (
    <div className="bc-legend">
      {Array.from({ length: steps }, (_, i) => {
        const t   = i / (steps - 1);
        const val = min + t * (max - min);
        return (
          <div key={i} className="bc-legend-step">
            <div className="bc-legend-swatch" style={{ background: deviationColor(val, min, max) }} />
            <span className="bc-legend-label">{val >= 0 ? '+' : ''}{val.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );
}
