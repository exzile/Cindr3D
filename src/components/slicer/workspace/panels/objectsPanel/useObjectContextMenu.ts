import { useCallback, useEffect, useState } from "react";
import type { PlateObject } from "../../../../../types/slicer";
import type { ContextMenuItem } from "../../ContextMenu";
import type { GeometryTool } from "../../GeometryToolsModal";
import { buildObjectContextMenuItems } from "./objectContextMenu";

interface ObjectContextMenuState {
  id: string;
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface UseObjectContextMenuOptions {
  centerPlateObject: (id: string) => void;
  dropToBedPlateObject: (id: string) => void;
  duplicatePlateObject: (id: string) => void;
  layFlatPlateObject: (id: string) => void;
  autoOrientPlateObject: (id: string) => void;
  openColorPicker: (id: string) => void;
  plateObjects: PlateObject[];
  removeFromPlate: (id: string) => void;
  resolveOverlapForObject: (id: string) => void;
  setActiveTool: (tool: { tool: GeometryTool; id: string }) => void;
  updatePlateObject: (id: string, patch: Partial<PlateObject>) => void;
}

export function useObjectContextMenu({
  centerPlateObject,
  dropToBedPlateObject,
  duplicatePlateObject,
  layFlatPlateObject,
  autoOrientPlateObject,
  openColorPicker,
  plateObjects,
  removeFromPlate,
  resolveOverlapForObject,
  setActiveTool,
  updatePlateObject,
}: UseObjectContextMenuOptions) {
  const [contextMenu, setContextMenu] = useState<ObjectContextMenuState | null>(
    null,
  );

  const buildContextMenuItems = useCallback(
    (id: string): ContextMenuItem[] => {
      const obj = plateObjects.find((item) => item.id === id);
      return buildObjectContextMenuItems({
        id,
        object: obj,
        duplicatePlateObject,
        updatePlateObject,
        layFlatPlateObject,
        autoOrientPlateObject,
        dropToBedPlateObject,
        centerPlateObject,
        resolveOverlapForObject,
        openColorPicker,
        removeFromPlate,
        setActiveTool,
      });
    },
    [
      centerPlateObject,
      dropToBedPlateObject,
      duplicatePlateObject,
      layFlatPlateObject,
      autoOrientPlateObject,
      openColorPicker,
      plateObjects,
      removeFromPlate,
      resolveOverlapForObject,
      setActiveTool,
      updatePlateObject,
    ],
  );

  const openContextMenu = useCallback(
    (id: string, x: number, y: number) => {
      setContextMenu({ id, x, y, items: buildContextMenuItems(id) });
    },
    [buildContextMenuItems],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<{ id: string; x: number; y: number }>
      ).detail;
      openContextMenu(detail.id, detail.x, detail.y);
    };
    window.addEventListener("slicer:object-context-menu", handler);
    return () =>
      window.removeEventListener("slicer:object-context-menu", handler);
  }, [openContextMenu]);

  return {
    contextMenu,
    openContextMenu,
    setContextMenu,
  };
}
