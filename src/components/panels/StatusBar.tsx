import { useCADStore } from '../../store/cadStore';

export default function StatusBar() {
  const statusMessage = useCADStore((s) => s.statusMessage);
  const activeTool = useCADStore((s) => s.activeTool);
  const viewMode = useCADStore((s) => s.viewMode);
  const units = useCADStore((s) => s.units);
  const setUnits = useCADStore((s) => s.setUnits);
  const snapEnabled = useCADStore((s) => s.snapEnabled);
  const activeSketch = useCADStore((s) => s.activeSketch);
  const selectionFilter = useCADStore((s) => s.selectionFilter);

  return (
    <div className="status-bar">
      <div className="status-left">
        <span className="status-message">{statusMessage}</span>
      </div>
      <div className="status-right">
        {activeSketch && (
          <span className="status-badge sketch-badge">
            Sketch: {activeSketch.plane}
          </span>
        )}
        <span className="status-badge">
          {viewMode === 'sketch' ? 'Sketch Mode' : '3D Mode'}
        </span>
        <span className="status-badge">
          Tool: {activeTool}
        </span>
        <span className={`status-badge ${snapEnabled ? 'active' : ''}`}>
          Snap: {snapEnabled ? 'ON' : 'OFF'}
        </span>
        <span className="status-badge" title="Selection filter">
          Filter: {Object.entries(selectionFilter).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}
        </span>
        <select
          className="status-units"
          value={units}
          onChange={(e) => setUnits(e.target.value as 'mm' | 'cm' | 'in')}
        >
          <option value="mm">mm</option>
          <option value="cm">cm</option>
          <option value="in">in</option>
        </select>
      </div>
    </div>
  );
}
