/**
 * A27 — Exploded View panel.
 * Floating panel (similar to AnalysisPanel) shown when explodeActive is true.
 */
import { X } from 'lucide-react';
import { useComponentStore } from '../../store/componentStore';

export default function ExplodedViewPanel() {
  const explodeActive = useComponentStore((s) => s.explodeActive);
  const explodeFactor = useComponentStore((s) => s.explodeFactor);
  const setExplodeFactor = useComponentStore((s) => s.setExplodeFactor);
  const toggleExplode = useComponentStore((s) => s.toggleExplode);

  if (!explodeActive) return null;

  return (
    <div className="extrude-panel">
      <div className="sketch-palette-header">
        <span className="sketch-palette-dot" style={{ background: '#4caf50' }} />
        <span className="sketch-palette-title">EXPLODED VIEW</span>
        <button
          className="sketch-palette-close"
          onClick={() => {
            if (explodeActive) toggleExplode();
          }}
          title="Close"
        >
          <X size={12} />
        </button>
      </div>

      <div className="sketch-palette-body">
        <div className="dialog-field">
          <label className="dialog-label">Explode Factor</label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={explodeFactor}
            style={{ width: '100%' }}
            onChange={(e) => setExplodeFactor(parseFloat(e.target.value))}
          />
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #aaa)', textAlign: 'right', display: 'block' }}>
            {explodeFactor.toFixed(2)}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn btn-secondary"
            style={{ flex: 1, fontSize: 12 }}
            onClick={() => setExplodeFactor(0)}
          >
            Collapse
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1, fontSize: 12 }}
            onClick={() => setExplodeFactor(1)}
          >
            Explode
          </button>
        </div>
      </div>
    </div>
  );
}
