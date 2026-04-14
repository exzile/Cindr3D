import type React from 'react';
import { useCADStore } from '../../store/cadStore';

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

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 48,
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#12122a',
    border: '1px solid #333366',
    borderRadius: 8,
    padding: '12px 16px',
    minWidth: 240,
    zIndex: 200,
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    color: '#e0e0ff',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8, gap: 8,
  };

  const inputStyle: React.CSSProperties = {
    width: 80, background: '#1e1e3a', border: '1px solid #333366',
    borderRadius: 4, color: '#e0e0ff', padding: '3px 6px', fontSize: 12,
  };

  const btnStyle = (primary: boolean): React.CSSProperties => ({
    flex: 1, padding: '6px 0', borderRadius: 4, border: 'none',
    cursor: 'pointer', fontWeight: 600, fontSize: 12,
    background: primary ? '#0078d7' : '#333355',
    color: '#fff',
  });

  const title = isMove
    ? (activeTool === 'sketch-copy' ? 'COPY' : 'MOVE')
    : isScale ? 'SCALE' : 'ROTATE';

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#44aaff', display: 'inline-block' }} />
        <span style={{ fontWeight: 700, letterSpacing: 1, fontSize: 11, color: '#aaaacc' }}>
          SKETCH {title}
        </span>
      </div>

      {isMove && (
        <>
          <div style={rowStyle}>
            <span>Δ X (along t1)</span>
            <input type="number" step={1} value={moveDx} style={inputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setMove({ dx: v }); }} />
          </div>
          <div style={rowStyle}>
            <span>Δ Y (along t2)</span>
            <input type="number" step={1} value={moveDy} style={inputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setMove({ dy: v }); }} />
          </div>
          <div style={{ ...rowStyle, marginBottom: 12 }}>
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
        <div style={rowStyle}>
          <span>Scale factor</span>
          <input type="number" min={0.001} step={0.1} value={scaleFactor} style={inputStyle}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setScaleFactor(v); }} />
        </div>
      )}

      {isRotate && (
        <div style={rowStyle}>
          <span>Angle (°)</span>
          <input type="number" step={5} value={rotateAngle} style={inputStyle}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setRotateAngle(v); }} />
        </div>
      )}

      {(isScale || isRotate) && (
        <div style={{ fontSize: 11, color: '#666688', marginBottom: 8 }}>
          Pivot: centroid of all sketch entities
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button style={btnStyle(false)} onClick={cancel}>Cancel</button>
        <button style={btnStyle(true)} onClick={commit}>OK</button>
      </div>
    </div>
  );
}
