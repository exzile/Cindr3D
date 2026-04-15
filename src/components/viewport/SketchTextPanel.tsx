import { X } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';

export default function SketchTextPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const textContent = useCADStore((s) => s.sketchTextContent);
  const setTextContent = useCADStore((s) => s.setSketchTextContent);
  const textHeight = useCADStore((s) => s.sketchTextHeight);
  const setTextHeight = useCADStore((s) => s.setSketchTextHeight);
  const cancelSketchTextTool = useCADStore((s) => s.cancelSketchTextTool);

  if (activeTool !== 'sketch-text') return null;

  return (
    <div className="extrude-panel">
      <div className="sketch-palette-header">
        <span className="sketch-palette-dot" style={{ background: '#0078d7' }} />
        <span className="sketch-palette-title">SKETCH TEXT</span>
        <button className="sketch-palette-close" onClick={cancelSketchTextTool} title="Cancel">
          <X size={12} />
        </button>
      </div>

      <div className="sketch-palette-body">
        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Text</span>
          <input
            className="measure-select"
            type="text"
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="Enter text…"
            style={{ flex: 1, minWidth: 0 }}
          />
        </div>

        <div className="sketch-palette-row">
          <span className="sketch-palette-label">Height (mm)</span>
          <input
            className="measure-select"
            type="number"
            value={textHeight}
            min={0.1}
            step={1}
            onChange={(e) => setTextHeight(Math.max(0.1, Number(e.target.value)))}
            style={{ width: 70 }}
          />
        </div>

        <div className="sketch-palette-row" style={{ color: '#888', fontSize: 11 }}>
          Click on the sketch to place text
        </div>
      </div>
    </div>
  );
}
