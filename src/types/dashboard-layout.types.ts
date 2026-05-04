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

// Spacer placeholder — encodes its column span in the ID, e.g. '__spacer_6'
export type SpacerId = `__spacer_${number}`;
export type LayoutItem = PanelId | SpacerId;

// Valid column spans in a 12-column grid
export type ColSpan = 3 | 4 | 6 | 8 | 12;
