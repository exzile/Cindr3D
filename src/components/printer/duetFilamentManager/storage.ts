export const FILAMENT_COLORS_KEY = 'dzign3d-filament-colors';
export const FILAMENT_PROPS_KEY = 'dzign3d-filament-props';
export const FILAMENT_SPOOLS_KEY = 'dzign3d-filament-spools';

export const MATERIAL_TYPES = ['PLA', 'ABS', 'PETG', 'TPU', 'Nylon', 'ASA', 'PC', 'HIPS', 'PVA', 'Other'] as const;

export interface FilamentProps {
  diameter: number;
  material: string;
}

export interface SpoolData {
  spoolWeight: number;
  usedWeight: number;
}

export const DEFAULT_LOAD_MACRO = `; Filament load macro
; Called by M701 when this filament is loaded
M104 S200           ; heat to printing temperature (adjust as needed)
M116                ; wait for temperatures
M83                 ; relative extrusion
G1 E50 F300         ; load filament
G4 S3               ; wait 3 seconds
M82                 ; absolute extrusion
`;

export const DEFAULT_UNLOAD_MACRO = `; Filament unload macro
; Called by M702 when this filament is unloaded
M104 S200           ; heat to printing temperature (adjust as needed)
M116                ; wait for temperatures
M83                 ; relative extrusion
G1 E5 F300          ; prime slightly
G4 S2               ; wait
G1 E-80 F1800       ; retract to unload
G1 E-20 F300        ; slow final retract
M82                 ; absolute extrusion
M104 S0             ; cool down
`;

export function loadFilamentColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FILAMENT_COLORS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function saveFilamentColor(name: string, color: string) {
  const colors = loadFilamentColors();
  colors[name] = color;
  try {
    localStorage.setItem(FILAMENT_COLORS_KEY, JSON.stringify(colors));
  } catch {}
}

export function loadFilamentProps(): Record<string, FilamentProps> {
  try {
    const raw = localStorage.getItem(FILAMENT_PROPS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function saveFilamentProps(name: string, props: FilamentProps) {
  const all = loadFilamentProps();
  all[name] = props;
  try {
    localStorage.setItem(FILAMENT_PROPS_KEY, JSON.stringify(all));
  } catch {}
}

export function loadSpoolData(): Record<string, SpoolData> {
  try {
    const raw = localStorage.getItem(FILAMENT_SPOOLS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function saveSpoolEntry(name: string, data: SpoolData) {
  const all = loadSpoolData();
  all[name] = data;
  try {
    localStorage.setItem(FILAMENT_SPOOLS_KEY, JSON.stringify(all));
  } catch {}
}
