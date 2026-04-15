import { useCADStore } from '../../store/cadStore';
import './SketchToolPanel.css';

/**
 * Floating panel for sketch transform operations:
 *   - 'sketch-move'   → D24 Move / Copy
 *   - 'sketch-copy'   → D24 Copy variant
 *   - 'sketch-scale'  → D25 Sketch Scale
 *   - 'sketch-rotate' → D26 Sketch Rotate
 * Appears when activeTool is any of the above.
 */
export default function SketchTransformPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const setActiveTool = useCADStore((s) => s.setActiveTool);

  // Move / Copy state
  const moveDx = useCADStore((s) => s.sketchMoveDx);
  const moveDy = useCADStore((s) => s.sketchMoveDy);
  const setMove = useCADStore((s) => s.setSketchMove);
  const commitMove = useCADStore((s) => s.commitSketchMove);

  // Scale state
  const scaleFactor = useCADStore((s) => s.sketchScaleFactor);
  const setScaleFactor = useCADStore((s) => s.setSketchScaleFactor);
  const commitScale = useCADStore((s) => s.commitSketchScale);

  // Rotate state
  const rotateAngle = useCADStore((s) => s.sketchRotateAngle);
  const setRotateAngle = useCADStore((s) => s.setSketchRotateAngle);
  const commitRotate = useCADStore((s) => s.commitSketchRotate);

  const isMove = activeTool === 'sketch-move' || activeTool === 'sketch-copy';
  const isScale = activeTool === 'sketch-scale';
  const isRotate = activeTool === 'sketch-rotate';

  if (!isMove && !isScale && !isRotate) return null;

  const cancel = () => setActiveTool('select');

  const commit = () => {
    if (isMove) { setMove({ copy: activeTool === 'sketch-copy' }); commitMove(); }
    else if (isScale) commitScale();
    else commitRotate();
    setActiveTool('select');
  };

  const title = isMove
    ? (activeTool === 'sketch-copy' ? 'COPY' : 'MOVE')
    : isScale ? 'SCALE' : 'ROTATE';

  return (
    <div className="sketch-tool-panel">
      <div className="sketch-tool-panel__header">
        <span className="sketch-tool-panel__dot" />
        <span className="sketch-tool-panel__title">SKETCH {title}</span>
      </div>

      {isMove && (
        <>
          <div className="sketch-tool-panel__row">
            <span>Δ X (along t1)</span>
            <input type="number" step={1} value={moveDx} className="sketch-tool-panel__input"
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setMove({ dx: v }); }} />
          </div>
          <div className="sketch-tool-panel__row">
            <span>Δ Y (along t2)</span>
            <input type="number" step={1} value={moveDy} className="sketch-tool-panel__input"
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setMove({ dy: v }); }} />
          </div>
          <div className="sketch-tool-panel__row sketch-tool-panel__row--last">
            <span>Copy entities</span>
            <input type="checkbox" checked={activeTool === 'sketch-copy'}
              onChange={() => {
                setActiveTool(activeTool === 'sketch-copy' ? 'sketch-move' : 'sketch-copy');
              }}
            />
          </div>
        </>
      )}

      {isScale && (
        <div className="sketch-tool-panel__row">
          <span>Scale factor</span>
          <input type="number" min={0.001} step={0.1} value={scaleFactor} className="sketch-tool-panel__input"
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setScaleFactor(v); }} />
        </div>
      )}

      {isRotate && (
        <div className="sketch-tool-panel__row">
          <span>Angle (°)</span>
          <input type="number" step={5} value={rotateAngle} className="sketch-tool-panel__input"
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setRotateAngle(v); }} />
        </div>
      )}

      {(isScale || isRotate) && (
        <div className="sketch-tool-panel__hint">
          Pivot: centroid of all sketch entities
        </div>
      )}

      <div className="sketch-tool-panel__footer">
        <button className="sketch-tool-panel__btn" onClick={cancel}>Cancel</button>
        <button className="sketch-tool-panel__btn sketch-tool-panel__btn--primary" onClick={commit}>OK</button>
      </div>
    </div>
  );
}
