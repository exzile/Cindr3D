import { useCADStore } from '../../../store/cadStore';
import { useDraggablePanel } from './useDraggablePanel';
import './SketchToolPanel.css';

/** Floating panel for SKETCH-1.4 Offset Curves. Offset fires on canvas click. */
export default function SketchOffsetPanel() {
  const {
    dragHandleProps,
    isDragging,
    panelEventProps,
    panelRef,
    panelStyle,
  } = useDraggablePanel();
  const activeTool = useCADStore((s) => s.activeTool);
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  const distance = useCADStore((s) => s.sketchOffsetDistance);
  const setDistance = useCADStore((s) => s.setSketchOffsetDistance);

  if (activeTool !== 'sketch-offset') return null;

  return (
    <div
      ref={panelRef}
      className={`sketch-tool-panel${isDragging ? ' is-dragging' : ''}`}
      style={panelStyle}
      {...panelEventProps}
    >
      <div className="sketch-tool-panel__header" {...dragHandleProps}>
        <span className="sketch-tool-panel__dot" />
        <span className="sketch-tool-panel__title">SKETCH OFFSET</span>
      </div>

      <div className="sketch-tool-panel__row">
        <span>Distance</span>
        <input
          type="number"
          step={0.5}
          min={0.001}
          value={distance}
          className="sketch-tool-panel__input"
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v > 0) setDistance(v);
          }}
        />
      </div>

      <div className="sketch-tool-panel__hint">
        Click near a line, arc, or circle to create an offset copy on the clicked side.
      </div>

      <div className="sketch-tool-panel__footer">
        <button className="sketch-tool-panel__btn" onClick={() => setActiveTool('select')}>Done</button>
      </div>
    </div>
  );
}
