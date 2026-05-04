/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react';
import {
  Wrench,
  Thermometer,
  Move,
  Package,
  Wind,
  Gauge,
  Cpu,
  Zap,
  Layers,
  RotateCcw,
  Grid,
  MapPin,
  LayoutGrid,
  Sliders,
  Star,
  FlaskConical,
  Camera,
  Box,
} from 'lucide-react';
import type {
  ColSpan,
  LayoutItem,
  PanelId,
} from '../../../store/dashboardLayoutStore';
import {
  DEFAULT_COLSPANS,
  isSpacerId,
  spacerSpan,
} from '../../../store/dashboardLayoutStore';
import DuetCustomButtons from '../DuetCustomButtons';
import TemperaturePanel from '../dashboard/TemperaturePanel';
import AxisMovementPanel from '../dashboard/AxisMovementPanel';
import ExtruderControlPanel from '../dashboard/ExtruderControlPanel';
import SpeedFlowPanel from '../dashboard/SpeedFlowPanel';
import FanControlPanel from '../dashboard/FanControlPanel';
import SystemInfoPanel from '../dashboard/SystemInfoPanel';
import AtxPowerPanel from '../dashboard/AtxPowerPanel';
import MacroPanel from '../dashboard/MacroPanel';
import ToolSelectorPanel from '../dashboard/ToolSelectorPanel';
import ToolOffsetsPanel from '../dashboard/ToolOffsetsPanel';
import PressureAdvancePanel from '../dashboard/PressureAdvancePanel';
import InputShaperPanel from '../dashboard/InputShaperPanel';
import WorkplaceCoordinatesPanel from '../dashboard/WorkplaceCoordinatesPanel';
import BedCompensationPanel from '../dashboard/BedCompensationPanel';
import RestorePointsPanel from '../dashboard/RestorePointsPanel';
import FilamentSensorPanel from '../dashboard/FilamentSensorPanel';
import CameraDashboardPanel from '../dashboard/CameraDashboardPanel';
import ObjectCancelPanel from '../dashboard/ObjectCancelPanel';
import MeshPreviewPanel from '../dashboard/MeshPreviewPanel';

export interface PanelDef {
  id: PanelId;
  title: string;
  icon: ReactNode;
  component: ReactNode;
}

export const PANEL_DEFS: PanelDef[] = [
  { id: 'camera', title: 'Camera', icon: <Camera size={12} />, component: <CameraDashboardPanel compact /> },
  { id: 'tools', title: 'Tools', icon: <Wrench size={12} />, component: <ToolSelectorPanel /> },
  { id: 'tool-offsets', title: 'Tool Offsets', icon: <Sliders size={12} />, component: <ToolOffsetsPanel /> },
  { id: 'workplace', title: 'Workplace Coordinates', icon: <MapPin size={12} />, component: <WorkplaceCoordinatesPanel /> },
  { id: 'bed-compensation', title: 'Bed Compensation', icon: <Grid size={12} />, component: <BedCompensationPanel /> },
  { id: 'restore-points', title: 'Restore Points', icon: <RotateCcw size={12} />, component: <RestorePointsPanel /> },
  { id: 'temperature', title: 'Temperature', icon: <Thermometer size={12} />, component: <TemperaturePanel /> },
  { id: 'speed-flow', title: 'Speed & Flow', icon: <Gauge size={12} />, component: <SpeedFlowPanel /> },
  { id: 'fans', title: 'Fans', icon: <Wind size={12} />, component: <FanControlPanel /> },
  { id: 'pressure-advance', title: 'Pressure Advance', icon: <Zap size={12} />, component: <PressureAdvancePanel /> },
  { id: 'input-shaper', title: 'Input Shaper', icon: <Layers size={12} />, component: <InputShaperPanel /> },
  { id: 'axes', title: 'Axis Movement', icon: <Move size={12} />, component: <AxisMovementPanel /> },
  { id: 'extruder', title: 'Extruder', icon: <Package size={12} />, component: <ExtruderControlPanel /> },
  { id: 'atx-power', title: 'ATX Power', icon: <Zap size={12} />, component: <AtxPowerPanel /> },
  { id: 'macros', title: 'Macros', icon: <LayoutGrid size={12} />, component: <MacroPanel /> },
  { id: 'custom-buttons', title: 'Custom Buttons', icon: <Star size={12} />, component: <DuetCustomButtons /> },
  { id: 'system-info', title: 'System Info', icon: <Cpu size={12} />, component: <SystemInfoPanel /> },
  { id: 'filament-sensors', title: 'Filament Sensors', icon: <FlaskConical size={12} />, component: <FilamentSensorPanel /> },
  { id: 'object-cancel', title: 'Object Cancellation', icon: <Layers size={12} />, component: <ObjectCancelPanel /> },
  { id: 'mesh-preview', title: 'Print Preview', icon: <Box size={12} />, component: <MeshPreviewPanel /> },
];

export const PANEL_MAP = Object.fromEntries(
  PANEL_DEFS.map((panel) => [panel.id, panel]),
) as Record<PanelId, PanelDef>;

export function itemSpan(id: LayoutItem, colSpans: Record<string, ColSpan>): number {
  if (isSpacerId(id)) return spacerSpan(id);
  return (colSpans[id] ?? DEFAULT_COLSPANS[id]) as number;
}

export function computePanelColStarts(
  order: LayoutItem[],
  colSpans: Record<string, ColSpan>,
  hidden: Record<string, boolean>,
): Map<string, number> {
  const cols = 12;
  let cursor = 0;
  const starts = new Map<string, number>();

  for (const id of order) {
    if (!isSpacerId(id) && hidden[id]) continue;
    const span = itemSpan(id, colSpans);
    if (cursor + span > cols) cursor = 0;
    starts.set(id, cursor + 1);
    cursor += span;
    if (cursor >= cols) cursor = 0;
  }

  return starts;
}

export function computeRowGaps(
  order: LayoutItem[],
  colSpans: Record<string, ColSpan>,
  hidden: Record<string, boolean>,
): { span: number; insertAfterIndex: number; colStart: number }[] {
  const cols = 12;
  let cursor = 0;
  let lastVisibleIdx = -1;
  const gaps: { span: number; insertAfterIndex: number; colStart: number }[] = [];

  for (let i = 0; i < order.length; i += 1) {
    const id = order[i];
    if (!isSpacerId(id) && hidden[id]) continue;
    const span = itemSpan(id, colSpans);

    if (cursor + span > cols) {
      if (cursor > 0) {
        gaps.push({ span: cols - cursor, insertAfterIndex: lastVisibleIdx, colStart: cursor + 1 });
      }
      cursor = span >= cols ? 0 : span;
    } else {
      cursor += span;
      if (cursor >= cols) cursor = 0;
    }

    lastVisibleIdx = i;
  }

  if (cursor > 0) {
    gaps.push({ span: cols - cursor, insertAfterIndex: lastVisibleIdx, colStart: cursor + 1 });
  } else if (lastVisibleIdx >= 0) {
    gaps.push({ span: cols, insertAfterIndex: lastVisibleIdx, colStart: 1 });
  }

  return gaps;
}

export function SpacerBlock({
  span,
  onDelete,
}: {
  span: number;
  onDelete: () => void;
}) {
  return (
    <div className="dc-spacer-block" style={{ gridColumn: `span ${span}` }}>
      <span className="dc-spacer-label">{span} col space</span>
      <button className="dc-spacer-delete" onClick={onDelete} title="Remove spacer">
        ×
      </button>
    </div>
  );
}
