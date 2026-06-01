import {
  Undo2, Redo2, Ruler, PenTool, Eye, EyeOff, MousePointer2,
  ScanEye, CheckSquare, Trash2,
} from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import { ContextMenuShell } from '../../ui/ContextMenuShell';
import type { ViewportCtxState } from '../../../types/viewport-context-menu.types';

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
  const replaceSketchEntities = useCADStore((s) => s.replaceSketchEntities);
  const selectedEntityIds = useCADStore((s) => s.selectedEntityIds);
  const setSelectedEntityIds = useCADStore((s) => s.setSelectedEntityIds);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const setCameraNavMode = useCADStore((s) => s.setCameraNavMode);
  const showAllBodies = useComponentStore((s) => s.showAllBodies);

  type Item =
    | { kind: 'sep' }
    | { kind: 'heading'; label: string }
    | {
        kind: 'item';
        label: string;
        shortcut?: string;
        icon?: React.ReactNode;
        disabled?: boolean;
        danger?: boolean;
        toggled?: boolean;
        tone?: 'organize' | 'create' | 'edit' | 'display' | 'locate' | 'danger';
        onClick: () => void;
      };

  const items: Item[] = [];

  // ── Sketch-mode actions ──────────────────────────────────────────────
  if (activeSketch) {
    const selectedSketchEntityIds = new Set(selectedEntityIds);
    const selectedSketchEntityCount = activeSketch.entities.filter((entity) => selectedSketchEntityIds.has(entity.id)).length;

    items.push({ kind: 'heading', label: 'Sketch' });
    items.push({
      kind: 'item',
      label: 'Finish Sketch',
      icon: <CheckSquare size={13} />,
      shortcut: 'Enter',
      tone: 'create',
      onClick: () => { finishSketch(); onClose(); },
    });
    items.push({
      kind: 'item',
      label: selectedSketchEntityCount === 1 ? 'Delete Sketch Entity' : 'Delete Sketch Entities',
      icon: <Trash2 size={13} />,
      shortcut: 'Del',
      danger: true,
      tone: 'danger',
      disabled: selectedSketchEntityCount === 0,
      onClick: () => {
        const state = useCADStore.getState();
        const sketch = state.activeSketch;
        if (!sketch) {
          onClose();
          return;
        }
        const ids = new Set(state.selectedEntityIds);
        const nextEntities = sketch.entities.filter((entity) => !ids.has(entity.id));
        const removedCount = sketch.entities.length - nextEntities.length;
        if (removedCount > 0) {
          state.pushUndo();
          setSelectedEntityIds([]);
          replaceSketchEntities(nextEntities);
          setStatusMessage(`Deleted ${removedCount} sketch entit${removedCount === 1 ? 'y' : 'ies'}`);
        }
        onClose();
      },
    });
    items.push({ kind: 'sep' });
  }

  // ── Edit history ─────────────────────────────────────────────────────
  items.push({ kind: 'heading', label: 'History' });
  items.push({
    kind: 'item',
    label: 'Undo',
    icon: <Undo2 size={13} />,
    shortcut: 'Ctrl+Z',
    tone: 'edit',
    disabled: undoStack.length === 0,
    onClick: () => { undo(); onClose(); },
  });
  items.push({
    kind: 'item',
    label: 'Redo',
    icon: <Redo2 size={13} />,
    shortcut: 'Ctrl+Y',
    tone: 'edit',
    disabled: redoStack.length === 0,
    onClick: () => { redo(); onClose(); },
  });

  items.push({ kind: 'sep' });

  // ── Tools ────────────────────────────────────────────────────────────
  items.push({ kind: 'heading', label: 'Tools' });
  items.push({
    kind: 'item',
    label: 'Select',
    icon: <MousePointer2 size={13} />,
    shortcut: 'S',
    tone: 'locate',
    toggled: activeTool === 'select',
    onClick: () => { setActiveTool('select'); onClose(); },
  });
  if (!activeSketch) {
    items.push({
      kind: 'item',
      label: activeTool === 'measure' ? 'Exit Measure' : 'Measure',
      icon: <Ruler size={13} />,
      shortcut: 'M',
      tone: 'locate',
      toggled: activeTool === 'measure',
      onClick: () => {
        setActiveTool(activeTool === 'measure' ? 'select' : 'measure');
        onClose();
      },
    });
  }

  items.push({ kind: 'sep' });

  // ── Sketch shortcut ──────────────────────────────────────────────────
  if (!activeSketch) {
    items.push({ kind: 'heading', label: 'Create' });
    items.push({
      kind: 'item',
      label: 'New Sketch',
      icon: <PenTool size={13} />,
      tone: 'create',
      onClick: () => {
        setActiveTool('sketch-plane');
        setStatusMessage('Click a face or plane to start a sketch');
        onClose();
      },
    });
    items.push({ kind: 'sep' });
  }

  // ── Visibility ───────────────────────────────────────────────────────
  items.push({ kind: 'heading', label: 'Visibility' });
  items.push({
    kind: 'item',
    label: 'Show All Bodies',
    icon: <Eye size={13} />,
    tone: 'display',
    onClick: () => { showAllBodies(); onClose(); },
  });
  items.push({
    kind: 'item',
    label: 'Look At Selection',
    icon: <ScanEye size={13} />,
    tone: 'locate',
    onClick: () => {
      // NAV-27: engage look-at mode — click a face to orient camera toward it
      setCameraNavMode('look-at');
      setStatusMessage('Look At — click a face to orient the camera toward it');
      onClose();
    },
  });
  items.push({
    kind: 'item',
    label: 'Isolate',
    icon: <EyeOff size={13} />,
    tone: 'display',
    onClick: () => {
      setStatusMessage('Isolate — click a body in the tree to isolate it');
      onClose();
    },
  });

  return (
    <ContextMenuShell x={menu.x} y={menu.y} onClose={onClose}>
      <div className="sketch-ctx-title">
        <span className="sketch-ctx-title-icon sketch-ctx-title-icon-canvas"><MousePointer2 size={14} /></span>
        <span className="sketch-ctx-title-copy">
          <span className="sketch-ctx-title-name">{activeSketch ? 'Sketch Canvas' : 'Design Canvas'}</span>
          <span className="sketch-ctx-title-kind">Viewport</span>
        </span>
      </div>
      {items.map((item, i) =>
        item.kind === 'sep' ? (
          <div key={i} className="sketch-ctx-sep" />
        ) : item.kind === 'heading' ? (
          <div key={i} className="sketch-ctx-heading">{item.label}</div>
        ) : (
          <button
            key={i}
            className={[
              'sketch-ctx-item',
              item.tone ? 'sketch-ctx-has-tone' : '',
              item.disabled ? 'disabled' : '',
              item.danger ? 'danger' : '',
              item.danger ? 'sketch-ctx-danger-zone' : '',
              item.toggled ? 'toggled-on' : '',
              item.tone ? `sketch-ctx-tone-${item.tone}` : '',
            ].filter(Boolean).join(' ')}
            role="menuitem"
            onClick={item.disabled ? undefined : item.onClick}
            disabled={item.disabled}
          >
            <span className="sketch-ctx-icon">{item.icon}</span>
            <span className="sketch-ctx-label">{item.label}</span>
            {item.shortcut && <span className="sketch-ctx-shortcut">{item.shortcut}</span>}
          </button>
        )
      )}
    </ContextMenuShell>
  );
}
