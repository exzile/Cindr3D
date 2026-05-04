import { useEffect, useRef } from 'react';
import { useCADStore } from '../../../store/cadStore';
import '../sketch/SketchPalette.css';

export default function DimensionEditorOverlay() {
  const sketchDimEditId   = useCADStore((s) => s.sketchDimEditId);
  const sketchDimEditIsNew = useCADStore((s) => s.sketchDimEditIsNew);
  const sketchDimEditValue = useCADStore((s) => s.sketchDimEditValue);
  const sketchDimEditScreenX = useCADStore((s) => s.sketchDimEditScreenX);
  const sketchDimEditScreenY = useCADStore((s) => s.sketchDimEditScreenY);
  const sketchDimEditTypeahead = useCADStore((s) => s.sketchDimEditTypeahead);
  const setSketchDimEditValue = useCADStore((s) => s.setSketchDimEditValue);
  const setSketchDimEditTypeahead = useCADStore((s) => s.setSketchDimEditTypeahead);
  const commitSketchDimEdit = useCADStore((s) => s.commitSketchDimEdit);
  const cancelSketchDimEdit = useCADStore((s) => s.cancelSketchDimEdit);
  const parameters = useCADStore((s) => s.parameters) ?? [];

  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
  }, []);

  if (!sketchDimEditId) return null;

  const commit = (val: string) => {
    if (blurTimerRef.current) { clearTimeout(blurTimerRef.current); blurTimerRef.current = null; }
    commitSketchDimEdit(val);
  };
  const cancel = () => {
    if (blurTimerRef.current) { clearTimeout(blurTimerRef.current); blurTimerRef.current = null; }
    cancelSketchDimEdit();
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: sketchDimEditScreenX,
        top: sketchDimEditScreenY,
        transform: 'translate(-50%, -50%)',
        zIndex: 99999,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ position: 'relative' }}>
        <div className="sketch-inline-dimension-editor">
          <button
            type="button"
            className="sketch-inline-dimension-action sketch-inline-dimension-action--cancel"
            title={sketchDimEditIsNew ? 'Cancel dimension' : 'Cancel edit'}
            onPointerDown={(e) => e.preventDefault()}
            onClick={cancel}
          >
            &#10005;
          </button>
          <input
            autoFocus
            className="sketch-inline-dimension-input"
            value={sketchDimEditValue}
            style={{ outline: '2px solid #2563eb', textAlign: 'center' }}
            onChange={(e) => {
              const v = e.target.value;
              setSketchDimEditValue(v);
              const t = v.trim().toLowerCase();
              setSketchDimEditTypeahead(t ? parameters.filter((p) => p.name.toLowerCase().includes(t)) : []);
            }}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onDoubleClick={(e) => e.stopPropagation()}
            onBlur={() => {
              const idAtBlur = useCADStore.getState().sketchDimEditId;
              blurTimerRef.current = setTimeout(() => {
                const state = useCADStore.getState();
                if (state.sketchDimEditTypeahead.length === 0 && state.sketchDimEditId === idAtBlur) {
                  commit(state.sketchDimEditValue);
                }
              }, 150);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(sketchDimEditValue); }
              if (e.key === 'Escape') {
                e.preventDefault();
                if (sketchDimEditTypeahead.length > 0) { setSketchDimEditTypeahead([]); return; }
                cancel();
              }
            }}
          />
          <button
            type="button"
            className="sketch-inline-dimension-action sketch-inline-dimension-action--confirm"
            title={sketchDimEditIsNew ? 'Confirm dimension' : 'Apply edit'}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => commit(sketchDimEditValue)}
          >
            &#10003;
          </button>
        </div>
        {sketchDimEditTypeahead.length > 0 && (
          <ul className="sketch-dim-typeahead">
            {sketchDimEditTypeahead.map((p) => (
              <li
                key={p.id}
                className="sketch-dim-typeahead-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSketchDimEditValue(p.name);
                  setSketchDimEditTypeahead([]);
                }}
              >
                <span className="sketch-dim-typeahead-name">{p.name}</span>
                <span className="sketch-dim-typeahead-val">{p.value.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
