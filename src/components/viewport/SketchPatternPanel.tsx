import type React from 'react';
import { useCADStore } from '../../store/cadStore';

/**
 * Floating panel for sketch rectangular pattern (D22) and circular pattern (D23).
 * Appears when activeTool is 'sketch-rect-pattern' or 'sketch-circ-pattern'.
 * Mirrors the ExtrudePanel style.
 */
export default function SketchPatternPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const setActiveTool = useCADStore((s) => s.setActiveTool);

  // Rect pattern state
  const countX = useCADStore((s) => s.sketchRectPatternCountX);
  const countY = useCADStore((s) => s.sketchRectPatternCountY);
  const spacingX = useCADStore((s) => s.sketchRectPatternSpacingX);
  const spacingY = useCADStore((s) => s.sketchRectPatternSpacingY);
  const setRect = useCADStore((s) => s.setSketchRectPattern);
  const commitRect = useCADStore((s) => s.commitSketchRectPattern);

  // Circ pattern state
  const circCount = useCADStore((s) => s.sketchCircPatternCount);
  const circAngle = useCADStore((s) => s.sketchCircPatternAngle);
  const setCirc = useCADStore((s) => s.setSketchCircPattern);
  const commitCirc = useCADStore((s) => s.commitSketchCircPattern);

  const isRect = activeTool === 'sketch-rect-pattern';
  const isCirc = activeTool === 'sketch-circ-pattern';

  if (!isRect && !isCirc) return null;

  const cancel = () => setActiveTool('select');
  const commit = () => {
    if (isRect) commitRect();
    else commitCirc();
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
    minWidth: 260,
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
    width: 72, background: '#1e1e3a', border: '1px solid #333366',
    borderRadius: 4, color: '#e0e0ff', padding: '3px 6px', fontSize: 12,
  };

  const btnStyle = (primary: boolean): React.CSSProperties => ({
    flex: 1, padding: '6px 0', borderRadius: 4, border: 'none',
    cursor: 'pointer', fontWeight: 600, fontSize: 12,
    background: primary ? '#0078d7' : '#333355',
    color: '#fff',
  });

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#44aaff', display: 'inline-block' }} />
        <span style={{ fontWeight: 700, letterSpacing: 1, fontSize: 11, color: '#aaaacc' }}>
          {isRect ? 'RECTANGULAR PATTERN' : 'CIRCULAR PATTERN'}
        </span>
      </div>

      {isRect && (
        <>
          <div style={rowStyle}>
            <span>Count X</span>
            <input type="number" min={1} max={50} step={1} value={countX} style={inputStyle}
              onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setRect({ countX: v }); }} />
          </div>
          <div style={rowStyle}>
            <span>Count Y</span>
            <input type="number" min={1} max={50} step={1} value={countY} style={inputStyle}
              onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setRect({ countY: v }); }} />
          </div>
          <div style={rowStyle}>
            <span>Spacing X</span>
            <input type="number" min={0.1} step={1} value={spacingX} style={inputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setRect({ spacingX: v }); }} />
          </div>
          <div style={rowStyle}>
            <span>Spacing Y</span>
            <input type="number" min={0.1} step={1} value={spacingY} style={inputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setRect({ spacingY: v }); }} />
          </div>
        </>
      )}

      {isCirc && (
        <>
          <div style={rowStyle}>
            <span>Count</span>
            <input type="number" min={2} max={128} step={1} value={circCount} style={inputStyle}
              onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 2) setCirc({ count: v }); }} />
          </div>
          <div style={rowStyle}>
            <span>Angle (°)</span>
            <input type="number" min={1} max={360} step={5} value={circAngle} style={inputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setCirc({ angle: v }); }} />
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button style={btnStyle(false)} onClick={cancel}>Cancel</button>
        <button style={btnStyle(true)} onClick={commit}>OK</button>
      </div>
    </div>
  );
}
