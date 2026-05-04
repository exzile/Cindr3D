export type PanelId =
  | 'camera'
  | 'tools'
  | 'tool-offsets'
  | 'workplace'
  | 'bed-compensation'
  | 'restore-points'
  | 'temperature'
  | 'speed-flow'
  | 'fans'
  | 'pressure-advance'
  | 'input-shaper'
  | 'axes'
  | 'extruder'
  | 'atx-power'
  | 'macros'
  | 'custom-buttons'
  | 'system-info'
  | 'filament-sensors'
  | 'object-cancel'
  | 'mesh-preview';

export interface DashboardLayoutItem {
  i: PanelId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardConfig {
  id: string;
  name: string;
  layouts: Record<PanelId, DashboardLayoutItem>;
  hidden: Record<string, boolean>;
}
