import { useCADStore } from '../../store/cadStore';
import './SketchToolPanel.css';

/** Floating panel for D21 Sketch Mirror. */
export default function SketchMirrorPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  const mirrorAxis = useCADStore((s) => s.sketchMirrorAxis);
  const setMirrorAxis = useCADStore((s) => s.setSketchMirrorAxis);
  const commitMirror = useCADStore((s) => s.commitSketchMirror);

  if (activeTool !== 'sketch-mirror') return null;

  const cancel = () => setActiveTool('select');
  const commit = () => { commitMirror(); setActiveTool('select'); };

  const axisOptions: { value: typeof mirrorAxis; label: string }[] = [
    { value: 'horizontal', label: 'Horizontal (mirror over t1 axis)' },
    { value: 'vertical', label: 'Vertical (mirror over t2 axis)' },
    { value: 'diagonal', label: 'Diagonal (swap t1 ↔ t2)' },
  ];

  return (
    <div className="sketch-tool-panel">
      <div className="sketch-tool-panel__header">
        <span className="sketch-tool-panel__dot" />
        <span className="sketch-tool-panel__title">SKETCH MIRROR</span>
      </div>

      <div className="sketch-tool-panel__axis-section">
        <div className="sketch-tool-panel__axis-label">Mirror axis (through centroid)</div>
        {axisOptions.map((opt) => (
          <label key={opt.value} className="sketch-tool-panel__radio-label">
            <input type="radio" name="mirror-axis" value={opt.value}
              checked={mirrorAxis === opt.value}
              onChange={() => setMirrorAxis(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </div>

      <div className="sketch-tool-panel__hint">
        Creates mirrored copies of all entities.
      </div>

      <div className="sketch-tool-panel__footer">
        <button className="sketch-tool-panel__btn" onClick={cancel}>Cancel</button>
        <button className="sketch-tool-panel__btn sketch-tool-panel__btn--primary" onClick={commit}>OK</button>
      </div>
    </div>
  );
}
