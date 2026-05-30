import {
  AlertTriangle,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Palette,
  Trash2,
  Unlock,
  Wrench,
} from "lucide-react";
import type * as React from "react";
import type { PlateObject } from "../../../../../types/slicer";

interface ObjectRowProps {
  dragRowId: string | null;
  duplicatePlateObject: (id: string) => void;
  inSelection: boolean;
  isAnchor: boolean;
  issues?: string[];
  object: PlateObject;
  onColorPick: (id: string) => void;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragStart: (event: React.DragEvent, id: string) => void;
  onDrop: (event: React.DragEvent, id: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, id: string) => void;
  onRowClick: (event: React.MouseEvent, id: string) => void;
  onRemove: (id: string) => void;
  onToggleHidden: (id: string, hidden: boolean) => void;
  onToggleLocked: (id: string, locked: boolean) => void;
  tooltip: string;
}

export function ObjectRow({
  dragRowId,
  duplicatePlateObject,
  inSelection,
  isAnchor,
  issues,
  object,
  onColorPick,
  onContextMenu,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onKeyDown,
  onRowClick,
  onRemove,
  onToggleHidden,
  onToggleLocked,
  tooltip,
}: ObjectRowProps) {
  const width = object.boundingBox.max.x - object.boundingBox.min.x;
  const depth = object.boundingBox.max.y - object.boundingBox.min.y;
  const height = object.boundingBox.max.z - object.boundingBox.min.z;
  const initials = object.name.slice(0, 2).toUpperCase();
  const isModifier =
    object.modifierMeshRole && object.modifierMeshRole !== "normal";

  return (
    <div
      role="option"
      tabIndex={0}
      aria-selected={inSelection}
      aria-label={`${object.name}, ${width.toFixed(1)} by ${depth.toFixed(1)} by ${height.toFixed(1)} millimeters${issues ? `, ${issues.length} issue${issues.length === 1 ? "" : "s"}` : ""}`}
      data-plate-row-id={object.id}
      draggable
      onDragStart={(event) => onDragStart(event, object.id)}
      onDragOver={onDragOver}
      onDrop={(event) => onDrop(event, object.id)}
      onDragEnd={onDragEnd}
      onClick={(event) => onRowClick(event, object.id)}
      onKeyDown={(event) => onKeyDown(event, object.id)}
      onContextMenu={(event) => onContextMenu(event, object.id)}
      className={`slicer-workspace-objects-panel__row${isAnchor ? " is-selected" : ""}${inSelection && !isAnchor ? " is-multi" : ""}${dragRowId === object.id ? " is-dragging" : ""}`}
      title={[tooltip, issues?.join("\n")].filter(Boolean).join("\n\n")}
    >
      <div
        className="slicer-workspace-objects-panel__thumb"
        aria-hidden
        style={object.color ? { color: object.color } : undefined}
      >
        <svg
          viewBox="0 0 28 28"
          width="28"
          height="28"
          className="slicer-workspace-objects-panel__thumb-svg"
        >
          <polygon
            points="14,4 24,9 24,19 14,24 4,19 4,9"
            className="slicer-workspace-objects-panel__thumb-hex"
            style={
              object.color ? { fill: object.color, opacity: 0.45 } : undefined
            }
          />
          <polyline
            points="14,4 14,14"
            className="slicer-workspace-objects-panel__thumb-edge"
          />
          <polyline
            points="14,14 24,9"
            className="slicer-workspace-objects-panel__thumb-edge"
          />
          <polyline
            points="14,14 4,9"
            className="slicer-workspace-objects-panel__thumb-edge"
          />
          <text
            x="14"
            y="17"
            textAnchor="middle"
            className="slicer-workspace-objects-panel__thumb-text"
          >
            {initials}
          </text>
        </svg>
      </div>
      <div className="slicer-workspace-objects-panel__row-info">
        <div
          className="slicer-workspace-objects-panel__name"
          title={object.name}
        >
          {issues && (
            <AlertTriangle
              size={10}
              style={{
                color: "var(--warning, #d68a00)",
                marginRight: 3,
                verticalAlign: "middle",
              }}
            />
          )}
          {isModifier && (
            <Wrench
              size={10}
              style={{
                color: "var(--accent)",
                marginRight: 3,
                verticalAlign: "middle",
              }}
            />
          )}
          {object.name}
        </div>
        <div className="slicer-workspace-objects-panel__size">
          {width.toFixed(1)} x {depth.toFixed(1)} x {height.toFixed(1)} mm
        </div>
        {object.sourceMetadata && (
          <div
            className="slicer-workspace-objects-panel__source"
            title={object.sourceMetadata.url}
          >
            Source:{" "}
            {object.sourceMetadata.sourceSite === "direct"
              ? "URL"
              : object.sourceMetadata.sourceSite}
          </div>
        )}
      </div>
      <div className="slicer-workspace-objects-panel__row-icons">
        <button
          type="button"
          title={object.hidden ? "Show object" : "Hide object"}
          aria-label={`${object.hidden ? "Show" : "Hide"} ${object.name}`}
          className={`slicer-workspace-objects-panel__icon-btn${object.hidden ? " is-active" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleHidden(object.id, !object.hidden);
          }}
        >
          {object.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
        <button
          type="button"
          title={object.locked ? "Unlock object" : "Lock object"}
          aria-label={`${object.locked ? "Unlock" : "Lock"} ${object.name}`}
          className={`slicer-workspace-objects-panel__icon-btn${object.locked ? " is-active" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleLocked(object.id, !object.locked);
          }}
        >
          {object.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
        <button
          type="button"
          title="Set object color"
          aria-label={`Set color for ${object.name}`}
          className="slicer-workspace-objects-panel__icon-btn"
          onClick={(event) => {
            event.stopPropagation();
            onColorPick(object.id);
          }}
          style={object.color ? { color: object.color } : undefined}
        >
          <Palette size={12} />
        </button>
        <button
          type="button"
          title={`Duplicate ${object.name} (Ctrl+D)`}
          aria-label={`Duplicate ${object.name}`}
          className="slicer-workspace-objects-panel__icon-btn"
          onClick={(event) => {
            event.stopPropagation();
            duplicatePlateObject(object.id);
          }}
        >
          <Copy size={12} />
        </button>
        <button
          type="button"
          title={`Remove ${object.name} (Del)`}
          aria-label={`Remove ${object.name}`}
          className="slicer-workspace-objects-panel__icon-btn"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(object.id);
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
