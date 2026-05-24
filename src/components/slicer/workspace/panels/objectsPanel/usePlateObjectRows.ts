import { useCallback, useMemo, useState } from "react";
import type * as React from "react";
import type { PlateObject } from "../../../../../types/slicer";

interface UsePlateObjectRowsOptions {
  additionalSelectedIds: string[];
  openContextMenu: (id: string, x: number, y: number) => void;
  plateObjects: PlateObject[];
  removeFromPlate: (id: string) => void;
  reorderPlateObjects: (ids: string[]) => void;
  selectPlateObject: (id: string | null) => void;
  selectPlateObjectRange: (anchorId: string, targetId: string) => void;
  selectedId: string | null;
  togglePlateObjectInSelection: (id: string) => void;
}

export function usePlateObjectRows({
  additionalSelectedIds,
  openContextMenu,
  plateObjects,
  removeFromPlate,
  reorderPlateObjects,
  selectPlateObject,
  selectPlateObjectRange,
  selectedId,
  togglePlateObjectInSelection,
}: UsePlateObjectRowsOptions) {
  const [dragRowId, setDragRowId] = useState<string | null>(null);

  const selectedIds = useMemo(
    () => (selectedId ? [selectedId, ...additionalSelectedIds] : []),
    [selectedId, additionalSelectedIds],
  );

  const selectFromEvent = useCallback(
    (event: React.MouseEvent | React.KeyboardEvent, id: string) => {
      if (event.shiftKey && selectedId) {
        selectPlateObjectRange(selectedId, id);
      } else if (event.ctrlKey || event.metaKey) {
        togglePlateObjectInSelection(id);
      } else {
        selectPlateObject(id);
      }
    },
    [
      selectedId,
      selectPlateObject,
      selectPlateObjectRange,
      togglePlateObjectInSelection,
    ],
  );

  const focusPlateRow = useCallback(
    (index: number) => {
      const bounded = Math.max(0, Math.min(plateObjects.length - 1, index));
      const id = plateObjects[bounded]?.id;
      if (!id) return;
      const row = document.querySelector<HTMLElement>(
        `[data-plate-row-id="${CSS.escape(id)}"]`,
      );
      row?.focus();
      selectPlateObject(id);
    },
    [plateObjects, selectPlateObject],
  );

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, id: string) => {
      if (event.target !== event.currentTarget) return;
      const index = plateObjects.findIndex((obj) => obj.id === id);
      if (index < 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusPlateRow(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusPlateRow(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusPlateRow(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusPlateRow(plateObjects.length - 1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectFromEvent(event, id);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeFromPlate(id);
      } else if (
        event.key === "ContextMenu" ||
        (event.shiftKey && event.key === "F10")
      ) {
        event.preventDefault();
        if (!selectedIds.includes(id)) selectPlateObject(id);
        const rect = event.currentTarget.getBoundingClientRect();
        openContextMenu(id, rect.left + 16, rect.top + 16);
      }
    },
    [
      focusPlateRow,
      openContextMenu,
      plateObjects,
      removeFromPlate,
      selectFromEvent,
      selectedIds,
      selectPlateObject,
    ],
  );

  const handleRowDragStart = useCallback(
    (event: React.DragEvent, id: string) => {
      setDragRowId(id);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plate-object-id", id);
    },
    [],
  );

  const handleRowDragOver = useCallback(
    (event: React.DragEvent) => {
      if (dragRowId) event.preventDefault();
    },
    [dragRowId],
  );

  const handleRowDrop = useCallback(
    (event: React.DragEvent, targetId: string) => {
      event.preventDefault();
      const sourceId = dragRowId;
      setDragRowId(null);
      if (!sourceId || sourceId === targetId) return;
      const ids = plateObjects.map((obj) => obj.id);
      const fromIdx = ids.indexOf(sourceId);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      const reordered = [...ids];
      reordered.splice(fromIdx, 1);
      const insertAt = toIdx + (toIdx > fromIdx ? -1 : 0);
      reordered.splice(insertAt, 0, sourceId);
      reorderPlateObjects(reordered);
    },
    [dragRowId, plateObjects, reorderPlateObjects],
  );

  const handleRowContextMenu = useCallback(
    (event: React.MouseEvent, id: string) => {
      event.preventDefault();
      if (!selectedIds.includes(id)) selectPlateObject(id);
      openContextMenu(id, event.clientX, event.clientY);
    },
    [openContextMenu, selectedIds, selectPlateObject],
  );

  return {
    dragRowId,
    handleRowClick: selectFromEvent,
    handleRowContextMenu,
    handleRowDragOver,
    handleRowDragStart,
    handleRowDrop,
    handleRowKeyDown,
    selectedIds,
    setDragRowId,
  };
}
