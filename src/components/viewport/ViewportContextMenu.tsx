import { createPortal } from 'react-dom';
import {
  Undo2, Redo2, Ruler, PenTool, Eye, EyeOff, MousePointer2,
  ScanEye, CheckSquare,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { useComponentStore } from '../../store/componentStore';

export interface ViewportCtxState {
  x: number;
  y: number;
}

export function ViewportContextMenu({
  menu,
  onClose,
}: {
  menu: ViewportCtxState;
  onClose: () => void;
}) {
  const undo = useCADStore((s) => s.undo);
  const redo = useCADStore((s) => s.redo);
  const undoStack = useCADStore((s) => s.undoStack);
  const redoStack = useCADStore((s) => s.redoStack);
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  const activeTool = useCADStore((s) => s.activeTool);
  const activeSketch = useCADStore((s) => s.activeSketch);
  const finishSketch = useCADStore((s) => s.finishSketch);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const showAllBodies = useComponentStore((s) => s.showAllBodies);

  type Item =
    | { kind: 'sep' }
    | { kind: 'item'; label: string; shortcut?: string; icon?: React.ReactNode; disabled?: boolean; danger?: boolean; onClick: () => void };

  const items: Item[] = [];

  // ── Sketch-mode actions ──────────────────────────────────────────────
  if (activeSketch) {
    items.push({
      kind: 'item',
      label: 'Finish Sketch',
      icon: <CheckSquare size={13} />,
      shortcut: 'Enter',
      onClick: () => { finishSketch(); onClose(); },
    });
    items.push({ kind: 'sep' });
  }

  // ── Edit history ─────────────────────────────────────────────────────
  items.push({
    kind: 'item',
    label: 'Undo',
    icon: <Undo2 size={13} />,
    shortcut: 'Ctrl+Z',
    disabled: undoStack.length === 0,
    onClick: () => { undo(); onClose(); },
  });
  items.push({
    kind: 'item',
    label: 'Redo',
    icon: <Redo2 size={13} />,
    shortcut: 'Ctrl+Y',
    disabled: redoStack.length === 0,
    onClick: () => { redo(); onClose(); },
  });

  items.push({ kind: 'sep' });

  // ── Tools ────────────────────────────────────────────────────────────
  items.push({
    kind: 'item',
    label: 'Select',
    icon: <MousePointer2 size={13} />,
    shortcut: 'S',
    onClick: () => { setActiveTool('select'); onClose(); },
  });
  if (!activeSketch) {
    items.push({
      kind: 'item',
      label: activeTool === 'measure' ? 'Exit Measure' : 'Measure',
      icon: <Ruler size={13} />,
      shortcut: 'M',
      onClick: () => {
        setActiveTool(activeTool === 'measure' ? 'select' : 'measure');
        onClose();
      },
    });
  }

  items.push({ kind: 'sep' });

  // ── Sketch shortcut ──────────────────────────────────────────────────
  if (!activeSketch) {
    items.push({
      kind: 'item',
      label: 'New Sketch',
      icon: <PenTool size={13} />,
      onClick: () => {
        setActiveTool('sketch-plane');
        setStatusMessage('Click a face or plane to start a sketch');
        onClose();
      },
    });
    items.push({ kind: 'sep' });
  }

  // ── Visibility ───────────────────────────────────────────────────────
  items.push({
    kind: 'item',
    label: 'Show All Bodies',
    icon: <Eye size={13} />,
    onClick: () => { showAllBodies(); onClose(); },
  });
  items.push({
    kind: 'item',
    label: 'Look At Selection',
    icon: <ScanEye size={13} />,
    onClick: () => {
      setStatusMessage('Look At — click a face in the viewport');
      onClose();
    },
  });
  items.push({
    kind: 'item',
    label: 'Isolate',
    icon: <EyeOff size={13} />,
    onClick: () => {
      setStatusMessage('Isolate — click a body in the tree to isolate it');
      onClose();
    },
  });

  return createPortal(
    <>
      <div className="sketch-ctx-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="sketch-ctx-menu" style={{ top: menu.y, left: menu.x }}>
        {items.map((item, i) =>
          item.kind === 'sep' ? (
            <div key={i} className="sketch-ctx-sep" />
          ) : (
            <button
              key={i}
              className={`sketch-ctx-item${item.disabled ? ' disabled' : ''}${item.danger ? ' danger' : ''}`}
              onClick={item.disabled ? undefined : item.onClick}
              disabled={item.disabled}
            >
              <span className="sketch-ctx-icon">{item.icon}</span>
              <span className="sketch-ctx-label">{item.label}</span>
              {item.shortcut && <span className="sketch-ctx-shortcut">{item.shortcut}</span>}
            </button>
          )
        )}
      </div>
    </>,
    document.body,
  );
}
