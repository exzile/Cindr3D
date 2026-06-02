import { X, Check } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export default function RuledSurfacePanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);
  const sketchAId = useCADStore((s) => s.ruledSketchAId);
  const setSketchAId = useCADStore((s) => s.setRuledSketchAId);
  const sketchBId = useCADStore((s) => s.ruledSketchBId);
  const setSketchBId = useCADStore((s) => s.setRuledSketchBId);
  const alignmentMode = useCADStore((s) => s.ruledAlignmentMode);
  const setAlignmentMode = useCADStore((s) => s.setRuledAlignmentMode);
  const alignmentDistance = useCADStore((s) => s.ruledAlignmentDistance);
  const setAlignmentDistance = useCADStore((s) => s.setRuledAlignmentDistance);
  const commitRuledSurface = useCADStore((s) => s.commitRuledSurface);
  const cancelRuledSurfaceTool = useCADStore((s) => s.cancelRuledSurfaceTool);

  if (activeTool !== 'ruled-surface') return null;

  const available = sketches.filter((s) => s.entities.length > 0);
  const canCommit = !!sketchAId && !!sketchBId && sketchAId !== sketchBId;

  return (
    <div className="extrude-panel">
      <div className="sketch-palette-header">
        <span className="sketch-palette-dot" style={{ background: '#60a5fa' }} />
        <span className="sketch-palette-title">RULED SURFACE</span>
        <button className="sketch-palette-close" onClick={cancelRuledSurfaceTool} title="Cancel">
          <X size={12} />
        </button>
      </div>

      <div className="sketch-palette-body">
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Curve A</span>
          <select
            className="measure-select"
            value={sketchAId ?? ''}
            onChange={(e) => setSketchAId(e.target.value || null)}
          >
            <option value="" disabled>Select sketch</option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Curve B</span>
          <select
            className="measure-select"
            value={sketchBId ?? ''}
            onChange={(e) => setSketchBId(e.target.value || null)}
          >
            <option value="" disabled>Select sketch</option>
            {available
              .filter((s) => s.id !== sketchAId)
              .map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
          </select>
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Alignment</span>
          <select
            className="measure-select"
            value={alignmentMode}
            onChange={(e) => setAlignmentMode(e.target.value as 'direction' | 'tangent' | 'normal')}
          >
            <option value="direction">Direction</option>
            <option value="tangent">Tangent</option>
            <option value="normal">Normal</option>
          </select>
        </div>

        {alignmentMode !== 'direction' && (
          <div className="sketch-palette-row">
            <span className="sketch-palette-label">Offset (mm)</span>
            <input
              type="number"
              className="measure-select"
              style={{ width: '80px' }}
              value={alignmentDistance}
              step={0.5}
              onChange={(e) => setAlignmentDistance(parseFloat(e.target.value) || 0)}
            />
          </div>
        )}

        <div className="extrude-panel-actions">
          <button className="btn btn-secondary" onClick={cancelRuledSurfaceTool}>
            <X size={14} /> Cancel
          </button>
          <button className="btn btn-primary" onClick={commitRuledSurface} disabled={!canCommit}>
            <Check size={14} /> OK
          </button>
        </div>
      </div>
    </div>
  );
}
