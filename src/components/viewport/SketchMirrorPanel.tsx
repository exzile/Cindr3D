import type React from 'react';
import { useCADStore } from '../../store/cadStore';

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

  const btnStyle = (primary: boolean): React.CSSProperties => ({
    flex: 1, padding: '6px 0', borderRadius: 4, border: 'none',
    cursor: 'pointer', fontWeight: 600, fontSize: 12,
    background: primary ? '#0078d7' : '#333355',
    color: '#fff',
  });

  const axisOptions: { value: typeof mirrorAxis; label: string }[] = [
    { value: 'horizontal', label: 'Horizontal (mirror over t1 axis)' },
    { value: 'vertical', label: 'Vertical (mirror over t2 axis)' },
    { value: 'diagonal', label: 'Diagonal (swap t1 ↔ t2)' },
  ];

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#44aaff', display: 'inline-block' }} />
        <span style={{ fontWeight: 700, letterSpacing: 1, fontSize: 11, color: '#aaaacc' }}>SKETCH MIRROR</span>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#aaaacc', marginBottom: 6 }}>Mirror axis (through centroid)</div>
        {axisOptions.map((opt) => (
          <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, cursor: 'pointer' }}>
            <input type="radio" name="mirror-axis" value={opt.value}
              checked={mirrorAxis === opt.value}
              onChange={() => setMirrorAxis(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </div>

      <div style={{ fontSize: 11, color: '#666688', marginBottom: 8 }}>
        Creates mirrored copies of all entities.
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button style={btnStyle(false)} onClick={cancel}>Cancel</button>
        <button style={btnStyle(true)} onClick={commit}>OK</button>
      </div>
    </div>
  );
}
