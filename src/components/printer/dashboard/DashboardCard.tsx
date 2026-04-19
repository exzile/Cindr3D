import type { ReactNode, DragEvent, MouseEvent } from 'react';
import { GripVertical, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  id: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  colSpan: number;
  rowSpan: number;
  editMode: boolean;
  dropEdge: 'before' | 'after' | null;
  isDragging: boolean;
  canShiftLeft: boolean;
  canShiftRight: boolean;
  onDragStart: (id: string) => void;
  onDragOver: (e: DragEvent, id: string) => void;
  onDrop: (id: string) => void;
  onDragEnd: () => void;
  onResizeStart: (id: string, e: MouseEvent) => void;
  onResizeStartY: (id: string, e: MouseEvent) => void;
  onResizeStartCorner: (id: string, e: MouseEvent) => void;
  onShiftLeft: (id: string) => void;
  onShiftRight: (id: string) => void;
}

export default function DashboardCard({
  id,
  title,
  icon,
  children,
  colSpan,
  rowSpan,
  editMode,
  dropEdge,
  isDragging,
  canShiftLeft,
  canShiftRight,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onResizeStart,
  onResizeStartY,
  onResizeStartCorner,
  onShiftLeft,
  onShiftRight,
}: Props) {
  const cls = [
    'dc-wrapper',
    editMode              ? 'is-edit'        : '',
    dropEdge === 'before' ? 'is-drop-before' : '',
    dropEdge === 'after'  ? 'is-drop-after'  : '',
    isDragging            ? 'is-dragging'    : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      style={{ gridColumn: `span ${colSpan}`, gridRow: `span ${rowSpan}` }}
      draggable={editMode}
      onDragStart={editMode ? () => onDragStart(id) : undefined}
      onDragEnd={editMode ? onDragEnd : undefined}
      onDragOver={editMode ? (e) => onDragOver(e, id) : undefined}
      onDrop={editMode ? (e) => { e.stopPropagation(); onDrop(id); } : undefined}
      data-id={id}
    >
      <div className="dc-header">
        {editMode && (
          <div className="dc-grip" title="Drag to reorder">
            <GripVertical size={14} />
          </div>
        )}
        <div className="dc-title">
          {icon}
          {title}
        </div>
        {editMode && (canShiftLeft || canShiftRight) && (
          <div className="dc-shift-btns" onMouseDown={(e) => e.stopPropagation()}>
            <button
              className="dc-shift-btn"
              disabled={!canShiftLeft}
              title="Shift left one column"
              onClick={(e) => { e.stopPropagation(); onShiftLeft(id); }}
            >
              <ChevronLeft size={11} />
            </button>
            <button
              className="dc-shift-btn"
              disabled={!canShiftRight}
              title="Shift right one column"
              onClick={(e) => { e.stopPropagation(); onShiftRight(id); }}
            >
              <ChevronRight size={11} />
            </button>
          </div>
        )}
      </div>

      <div className="dc-body" draggable={false}>{children}</div>

      {editMode && (
        <>
          <div
            className="dc-resize-handle"
            title="Drag to resize width"
            onMouseDown={(e) => onResizeStart(id, e)}
          />
          <div
            className="dc-resize-handle-y"
            title="Drag to resize height"
            onMouseDown={(e) => onResizeStartY(id, e)}
          />
          <div
            className="dc-resize-corner"
            title="Drag to resize width and height"
            onMouseDown={(e) => onResizeStartCorner(id, e)}
          />
        </>
      )}
    </div>
  );
}
