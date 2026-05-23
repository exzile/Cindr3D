import {
  AlignEndHorizontal,
  ArrowDownToLine,
  CircleDot,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Maximize2,
  Palette,
  RotateCw,
  Scissors,
  Trash2,
  Unlock,
} from "lucide-react";
import type { PlateObject } from "../../../../../types/slicer";
import type { ContextMenuItem } from "../../ContextMenu";
import type { GeometryTool } from "../../GeometryToolsModal";

export const MODIFIER_LABELS: Record<string, string> = {
  normal: "Normal printable",
  cutting_mesh: "Cutting mesh",
  infill_mesh: "Infill mesh",
  support_mesh: "Support mesh",
  anti_overhang_mesh: "Anti-overhang mesh",
};

interface BuildObjectContextMenuItemsOptions {
  id: string;
  object: PlateObject | undefined;
  duplicatePlateObject: (id: string) => void;
  updatePlateObject: (id: string, patch: Partial<PlateObject>) => void;
  layFlatPlateObject: (id: string) => void;
  autoOrientPlateObject: (id: string) => void;
  dropToBedPlateObject: (id: string) => void;
  centerPlateObject: (id: string) => void;
  resolveOverlapForObject: (id: string) => void;
  openColorPicker: (id: string) => void;
  removeFromPlate: (id: string) => void;
  setActiveTool: (tool: { tool: GeometryTool; id: string }) => void;
}

export function buildObjectContextMenuItems({
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
}: BuildObjectContextMenuItemsOptions): ContextMenuItem[] {
  if (!obj) return [];
  const role = obj.modifierMeshRole ?? "normal";
  return [
    {
      label: "Duplicate",
      shortcut: "Ctrl+D",
      icon: <Copy size={12} />,
      onClick: () => duplicatePlateObject(id),
    },
    {
      label: obj.hidden ? "Show" : "Hide",
      icon: obj.hidden ? <Eye size={12} /> : <EyeOff size={12} />,
      onClick: () => updatePlateObject(id, { hidden: !obj.hidden }),
    },
    {
      label: obj.locked ? "Unlock" : "Lock",
      icon: obj.locked ? <Unlock size={12} /> : <Lock size={12} />,
      onClick: () => updatePlateObject(id, { locked: !obj.locked }),
    },
    { separator: true } as ContextMenuItem,
    {
      label: "Lay Flat",
      shortcut: "F",
      icon: <AlignEndHorizontal size={12} />,
      onClick: () => layFlatPlateObject(id),
    },
    {
      label: "Auto-orient",
      icon: <RotateCw size={12} />,
      onClick: () => autoOrientPlateObject(id),
    },
    {
      label: "Drop to Bed",
      shortcut: "B",
      icon: <ArrowDownToLine size={12} />,
      onClick: () => dropToBedPlateObject(id),
    },
    { label: "Center", onClick: () => centerPlateObject(id) },
    { label: "Resolve overlap", onClick: () => resolveOverlapForObject(id) },
    { separator: true } as ContextMenuItem,
    {
      label: "Scale to size...",
      icon: <Maximize2 size={12} />,
      onClick: () => setActiveTool({ tool: "scale-to-size", id }),
    },
    {
      label: "Hollow...",
      icon: <CircleDot size={12} />,
      onClick: () => setActiveTool({ tool: "hollow", id }),
    },
    {
      label: "Cut by plane...",
      icon: <Scissors size={12} />,
      onClick: () => setActiveTool({ tool: "cut", id }),
    },
    { separator: true } as ContextMenuItem,
    {
      label: `Role: ${MODIFIER_LABELS[role]} ->`,
      disabled: true,
      onClick: () => undefined,
    },
    {
      label: "Normal printable",
      onClick: () => updatePlateObject(id, { modifierMeshRole: "normal" }),
      disabled: role === "normal",
    },
    {
      label: "Cutting mesh",
      onClick: () =>
        updatePlateObject(id, { modifierMeshRole: "cutting_mesh" }),
      disabled: role === "cutting_mesh",
    },
    {
      label: "Infill mesh",
      onClick: () => updatePlateObject(id, { modifierMeshRole: "infill_mesh" }),
      disabled: role === "infill_mesh",
    },
    {
      label: "Support mesh",
      onClick: () =>
        updatePlateObject(id, { modifierMeshRole: "support_mesh" }),
      disabled: role === "support_mesh",
    },
    {
      label: "Anti-overhang mesh",
      onClick: () =>
        updatePlateObject(id, { modifierMeshRole: "anti_overhang_mesh" }),
      disabled: role === "anti_overhang_mesh",
    },
    { separator: true } as ContextMenuItem,
    {
      label: "Set color...",
      icon: <Palette size={12} />,
      onClick: () => openColorPicker(id),
    },
    {
      label: "Delete",
      shortcut: "Del",
      icon: <Trash2 size={12} />,
      danger: true,
      onClick: () => removeFromPlate(id),
    },
  ];
}
