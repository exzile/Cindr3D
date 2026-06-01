import { useCADStore } from '../../../store/cadStore';
import './SketchToolPanel.css';

const FIXED_AXES = [
  { value: 'horizontal', label: 'Horizontal (t1 axis through centroid)' },
  { value: 'vertical', label: 'Vertical (t2 axis through centroid)' },
  { value: 'diagonal', label: 'Diagonal (swap t1 ↔ t2)' },
] as const;

/** Floating panel for D21 Sketch Mirror. Supports 3 fixed axes and a picked sketch line (SKETCH-1.3). */
export default function SketchMirrorPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  const mirrorAxis = useCADStore((s) => s.sketchMirrorAxis);
  const setMirrorAxis = useCADStore((s) => s.setSketchMirrorAxis);
  const commitMirror = useCADStore((s) => s.commitSketchMirror);
  const activeSketch = useCADStore((s) => s.activeSketch);

  if (activeTool !== 'sketch-mirror') return null;

  const lineEntities = activeSketch?.entities.filter(
    (e) => e.type === 'line' || e.type === 'construction-line' || e.type === 'centerline',
  ) ?? [];

  const isFixed = mirrorAxis === 'horizontal' || mirrorAxis === 'vertical' || mirrorAxis === 'diagonal';
  const isPickedLine = !isFixed && mirrorAxis !== '';

  const cancel = () => setActiveTool('select');
  const commit = () => { commitMirror(); setActiveTool('select'); };

  return (
    <div className="sketch-tool-panel">
      <div className="sketch-tool-panel__header">
        <span className="sketch-tool-panel__dot" />
        <span className="sketch-tool-panel__title">SKETCH MIRROR</span>
      </div>

      <div className="sketch-tool-panel__axis-section">
        <div className="sketch-tool-panel__axis-label">Mirror axis</div>
        {FIXED_AXES.map((opt) => (
          <label key={opt.value} className="sketch-tool-panel__radio-label">
            <input type="radio" name="mirror-axis" value={opt.value}
              checked={mirrorAxis === opt.value}
              onChange={() => setMirrorAxis(opt.value)}
            />
            {opt.label}
          </label>
        ))}

        {lineEntities.length > 0 && (
          <>
            <div className="sketch-tool-panel__axis-label" style={{ marginTop: 6 }}>
              Pick sketch line
            </div>
            <select
              className="sketch-tool-panel__input"
              style={{ width: '100%', marginTop: 2 }}
              value={isPickedLine ? mirrorAxis : ''}
              onChange={(e) => setMirrorAxis(e.target.value || 'vertical')}
            >
              <option value="">— none (use axis above) —</option>
              {lineEntities.map((e, i) => (
                <option key={e.id} value={e.id}>
                  Line {i + 1}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="sketch-tool-panel__hint">
        {isPickedLine
          ? 'Mirrors all other entities across the selected line.'
          : 'Creates mirrored copies of all entities through the centroid.'}
      </div>

      <div className="sketch-tool-panel__footer">
        <button className="sketch-tool-panel__btn" onClick={cancel}>Cancel</button>
        <button className="sketch-tool-panel__btn sketch-tool-panel__btn--primary" onClick={commit}>OK</button>
      </div>
    </div>
  );
}
