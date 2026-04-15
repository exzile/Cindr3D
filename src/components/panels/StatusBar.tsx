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
  const setSelectionFilter = useCADStore((s) => s.setSelectionFilter);

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
        <select
          className="status-units"
          value={selectionFilter}
          onChange={(e) => setSelectionFilter(e.target.value as typeof selectionFilter)}
          title="Selection filter"
        >
          <option value="all">Select All</option>
          <option value="bodies">Bodies</option>
          <option value="faces">Faces</option>
          <option value="edges">Edges</option>
          <option value="sketches">Sketches</option>
        </select>
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
