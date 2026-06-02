import { X, Check } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export default function RuledSurfacePanel() {
  const activeTool          = useCADStore((s) => s.activeTool);
  const sketches            = useCADStore((s) => s.sketches);
  const ruledMode           = useCADStore((s) => s.ruledMode);
  const setRuledMode        = useCADStore((s) => s.setRuledMode);
  const sketchAId           = useCADStore((s) => s.ruledSketchAId);
  const setSketchAId        = useCADStore((s) => s.setRuledSketchAId);
  const sketchBId           = useCADStore((s) => s.ruledSketchBId);
  const setSketchBId        = useCADStore((s) => s.setRuledSketchBId);
  const alignmentMode       = useCADStore((s) => s.ruledAlignmentMode);
  const setAlignmentMode    = useCADStore((s) => s.setRuledAlignmentMode);
  const alignmentDistance   = useCADStore((s) => s.ruledAlignmentDistance);
  const setAlignmentDistance = useCADStore((s) => s.setRuledAlignmentDistance);
  const extendDistance      = useCADStore((s) => s.ruledExtendDistance);
  const setExtendDistance   = useCADStore((s) => s.setRuledExtendDistance);
  const extendAxis          = useCADStore((s) => s.ruledExtendAxis);
  const setExtendAxis       = useCADStore((s) => s.setRuledExtendAxis);
  const commitRuledSurface  = useCADStore((s) => s.commitRuledSurface);
  const cancelRuledSurfaceTool = useCADStore((s) => s.cancelRuledSurfaceTool);

  if (activeTool !== 'ruled-surface') return null;

  const available = sketches.filter((s) => s.entities.length > 0);
  const canCommit = ruledMode === 'two-curves'
    ? (!!sketchAId && !!sketchBId && sketchAId !== sketchBId)
    : !!sketchAId;

  return (
    <div className="tool-panel">
      <div className="tp-header">
        <div className="tp-header-icon" style={{ background: '#60a5fa' }} />
        <span className="tp-header-title">RULED SURFACE</span>
        <button className="tp-close" onClick={cancelRuledSurfaceTool} title="Cancel"><X size={14} /></button>
      </div>

      <div className="tp-body">
        <div className="tp-section">
          <div className="tp-section-title">Mode</div>
          <div className="tp-row">
            <span className="tp-label">Type</span>
            <select className="tp-select" value={ruledMode}
              onChange={(e) => setRuledMode(e.target.value as 'two-curves' | 'extend-edge')}>
              <option value="two-curves">Two Curves</option>
              <option value="extend-edge">Extend Edge</option>
            </select>
          </div>
        </div>

        <div className="tp-divider" />

        {ruledMode === 'two-curves' ? (
          <>
            <div className="tp-section">
              <div className="tp-section-title">Curves</div>
              <div className="tp-row">
                <span className="tp-label">Curve A</span>
                <select className="tp-select" value={sketchAId ?? ''}
                  onChange={(e) => setSketchAId(e.target.value || null)}>
                  <option value="" disabled>Select sketch</option>
                  {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="tp-row">
                <span className="tp-label">Curve B</span>
                <select className="tp-select" value={sketchBId ?? ''}
                  onChange={(e) => setSketchBId(e.target.value || null)}>
                  <option value="" disabled>Select sketch</option>
                  {available.filter((s) => s.id !== sketchAId)
                    .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            <div className="tp-divider" />

            <div className="tp-section">
              <div className="tp-section-title">Alignment</div>
              <div className="tp-row">
                <span className="tp-label">Mode</span>
                <select className="tp-select" value={alignmentMode}
                  onChange={(e) => setAlignmentMode(e.target.value as 'direction' | 'tangent' | 'normal')}>
                  <option value="direction">Direction</option>
                  <option value="tangent">Tangent</option>
                  <option value="normal">Normal</option>
                </select>
              </div>
              {alignmentMode !== 'direction' && (
                <div className="tp-row">
                  <span className="tp-label">Offset (mm)</span>
                  <input className="tp-input" type="number" value={alignmentDistance} step={0.5}
                    onChange={(e) => setAlignmentDistance(parseFloat(e.target.value) || 0)} />
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="tp-section">
              <div className="tp-section-title">Edge / Curve</div>
              <div className="tp-row">
                <span className="tp-label">Sketch</span>
                <select className="tp-select" value={sketchAId ?? ''}
                  onChange={(e) => setSketchAId(e.target.value || null)}>
                  <option value="" disabled>Select sketch</option>
                  {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            <div className="tp-divider" />

            <div className="tp-section">
              <div className="tp-section-title">Extension</div>
              <div className="tp-row">
                <span className="tp-label">Distance (mm)</span>
                <input className="tp-input" type="number" value={extendDistance} min={0.001} step={1}
                  onChange={(e) => setExtendDistance(Math.max(0.001, parseFloat(e.target.value) || 10))} />
              </div>
              <div className="tp-row">
                <span className="tp-label">Direction</span>
                <select className="tp-select" value={extendAxis}
                  onChange={(e) => setExtendAxis(e.target.value as 'X' | 'Y' | 'Z')}>
                  <option value="X">Along X</option>
                  <option value="Y">Along Y</option>
                  <option value="Z">Along Z</option>
                </select>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="tp-actions">
        <button className="tp-btn tp-btn-cancel" onClick={cancelRuledSurfaceTool}><X size={13} /> Cancel</button>
        <button className="tp-btn tp-btn-ok" onClick={commitRuledSurface} disabled={!canCommit}><Check size={13} /> OK</button>
      </div>
    </div>
  );
}
