// Catalogue of insertable G-code / RepRapFirmware commands for the Duet
// configuration editor, tagged by the kind of config file they're relevant to.
//
// "kind" is derived from the file path — e.g. bed.g is 'bed', config.g is
// 'config'. The insert dropdown filters commands down to the current file's
// kind so the user only sees commands that make sense in context.

export type ConfigFileKind =
  | 'config'
  | 'bed'
  | 'homing'
  | 'lifecycle'
  | 'toolchange'
  | 'other';

export function detectFileKind(path: string): ConfigFileKind {
  const name = path.split('/').pop() ?? '';
  if (name === 'config.g' || name === 'config-override.g') return 'config';
  if (name === 'bed.g' || name === 'deployprobe.g' || name === 'retractprobe.g') return 'bed';
  if (/^home(all|[xyz])\.g$/.test(name)) return 'homing';
  if (/^(start|stop|pause|resume|cancel)\.g$/.test(name)) return 'lifecycle';
  if (/^t(pre|post|free)\d+\.g$/.test(name)) return 'toolchange';
  return 'other';
}

export const FILE_KIND_LABEL: Record<ConfigFileKind, string> = {
  config: 'Configuration',
  bed: 'Bed / Probe',
  homing: 'Homing',
  lifecycle: 'Print Lifecycle',
  toolchange: 'Tool Change',
  other: 'General',
};

export interface CommandTemplate {
  id: string;
  label: string;
  category: string;
  /** G-code text inserted at the cursor. May span multiple lines. */
  snippet: string;
  description: string;
  /** Which file kinds this command is relevant in. */
  kinds: ConfigFileKind[];
}

// NOTE: snippets deliberately use conservative, portable defaults.
// Users are expected to tweak values after insertion — that's the point.
export const COMMANDS: CommandTemplate[] = [
  // ---------- Configuration (config.g / config-override.g) ----------
  { id: 'm208', label: 'M208 — Axis limits', category: 'Kinematics',
    snippet: 'M208 X0 Y0 Z0 S1 ; axis minima\nM208 X220 Y220 Z250 S0 ; axis maxima',
    description: 'Defines the travel limits for each axis.', kinds: ['config'] },
  { id: 'm92',  label: 'M92 — Steps per mm', category: 'Kinematics',
    snippet: 'M92 X80 Y80 Z400 E420 ; steps/mm',
    description: 'Sets steps per mm for all drives.', kinds: ['config'] },
  { id: 'm203', label: 'M203 — Max feed rates', category: 'Kinematics',
    snippet: 'M203 X12000 Y12000 Z1200 E3000 ; max speeds (mm/min)',
    description: 'Maximum feed rate per axis in mm/min.', kinds: ['config'] },
  { id: 'm201', label: 'M201 — Max accelerations', category: 'Kinematics',
    snippet: 'M201 X500 Y500 Z100 E5000 ; max accel (mm/s²)',
    description: 'Max acceleration per axis.', kinds: ['config'] },
  { id: 'm566', label: 'M566 — Instantaneous speed change', category: 'Kinematics',
    snippet: 'M566 X600 Y600 Z20 E20 ; jerk (mm/min)',
    description: 'Maximum speed change that may occur without deceleration.', kinds: ['config'] },
  { id: 'm906', label: 'M906 — Motor currents', category: 'Motors',
    snippet: 'M906 X800 Y800 Z800 E500 I30 ; motor current (mA), idle 30%',
    description: 'Sets driver current per axis.', kinds: ['config'] },
  { id: 'm84',  label: 'M84 — Idle timeout', category: 'Motors',
    snippet: 'M84 S30 ; idle timeout (s)',
    description: 'Disables motors after the given idle time.', kinds: ['config'] },
  { id: 'm558', label: 'M558 — Z probe', category: 'Probing',
    snippet: 'M558 P9 C"zprobe.in" H5 F120 T6000 ; Z probe',
    description: 'Defines Z-probe type, pin, dive height and speeds.', kinds: ['config'] },
  { id: 'g31',  label: 'G31 — Probe trigger', category: 'Probing',
    snippet: 'G31 K0 P500 X0 Y0 Z2.50 ; probe offset & trigger',
    description: 'Sets the probe trigger value and XYZ offset.', kinds: ['config'] },
  { id: 'm950-fan',  label: 'M950 — Fan', category: 'IO',
    snippet: 'M950 F0 C"fan0" Q500 ; fan 0',
    description: 'Defines a fan output.', kinds: ['config'] },
  { id: 'm950-heater', label: 'M950 — Heater', category: 'IO',
    snippet: 'M950 H0 C"bedheat" T0 ; bed heater',
    description: 'Defines a heater output.', kinds: ['config'] },
  { id: 'm307', label: 'M307 — Heater model', category: 'Heaters',
    snippet: 'M307 H0 R2.0 C500 D5 S1 V24 ; heater tuning',
    description: 'Sets or displays the heater model parameters.', kinds: ['config'] },
  { id: 'm143', label: 'M143 — Max heater temp', category: 'Heaters',
    snippet: 'M143 H1 S285 ; max nozzle temp',
    description: 'Sets a heater thermal limit.', kinds: ['config'] },
  { id: 'm563', label: 'M563 — Define tool', category: 'Tools',
    snippet: 'M563 P0 S"Extruder 1" D0 H1 F0',
    description: 'Defines a tool with drives, heaters and fans.', kinds: ['config'] },
  { id: 'g10-offset', label: 'G10 — Tool offsets / temps', category: 'Tools',
    snippet: 'G10 P0 X0 Y0 Z0 ; offsets\nG10 P0 R0 S0 ; standby & active temp',
    description: 'Sets tool offsets and default temperatures.', kinds: ['config', 'toolchange'] },
  { id: 'm564', label: 'M564 — Axis movement limits', category: 'Safety',
    snippet: 'M564 S1 H1 ; disallow moves outside axis limits; require homing',
    description: '', kinds: ['config'] },
  { id: 'm501', label: 'M501 — Read config-override', category: 'Persistence',
    snippet: 'M501 ; load config-override.g',
    description: 'Reads saved parameters from config-override.g.', kinds: ['config'] },

  // ---------- Bed leveling (bed.g, deployprobe.g, retractprobe.g) ----------
  { id: 'g30-point', label: 'G30 — Probe at point', category: 'Probing',
    snippet: 'G30 P0 X100 Y100 Z-99999 ; probe point 0',
    description: 'Probes a specific point (used for multi-point bed leveling).', kinds: ['bed'] },
  { id: 'g30-center', label: 'G30 — Probe current XY', category: 'Probing',
    snippet: 'G30 ; probe at current XY',
    description: 'Probes at the current location and sets Z=0.', kinds: ['bed', 'homing'] },
  { id: 'g32',  label: 'G32 — True bed', category: 'Bed',
    snippet: 'G32 ; adjust bed plane / leadscrews',
    description: 'Runs the bed leveling macro (true the bed).', kinds: ['bed'] },
  { id: 'g29',  label: 'G29 — Probe mesh', category: 'Mesh',
    snippet: 'G29 ; probe bed mesh',
    description: 'Probes the bed and generates a height map.', kinds: ['bed'] },
  { id: 'g29-s1', label: 'G29 S1 — Load height map', category: 'Mesh',
    snippet: 'G29 S1 ; load saved heightmap.csv',
    description: 'Loads a previously saved mesh from disk.', kinds: ['bed', 'config'] },
  { id: 'm561', label: 'M561 — Clear compensation', category: 'Bed',
    snippet: 'M561 ; clear bed compensation',
    description: 'Disables any active bed compensation.', kinds: ['bed'] },
  { id: 'm671', label: 'M671 — Leadscrew positions', category: 'Bed',
    snippet: 'M671 X-15:235 Y110:110 S5 ; leadscrew positions, max correction 5mm',
    description: 'Defines the physical location of bed leadscrews.', kinds: ['config', 'bed'] },
  { id: 'm401', label: 'M401 — Deploy probe', category: 'Probing',
    snippet: 'M401 ; deploy Z probe',
    description: '', kinds: ['bed', 'homing'] },
  { id: 'm402', label: 'M402 — Retract probe', category: 'Probing',
    snippet: 'M402 ; retract Z probe',
    description: '', kinds: ['bed', 'homing'] },

  // ---------- Homing (homeall.g / homex.g / homey.g / homez.g) ----------
  { id: 'g91', label: 'G91 — Relative motion', category: 'Motion',
    snippet: 'G91 ; relative',
    description: '', kinds: ['homing', 'lifecycle', 'toolchange', 'bed'] },
  { id: 'g90', label: 'G90 — Absolute motion', category: 'Motion',
    snippet: 'G90 ; absolute',
    description: '', kinds: ['homing', 'lifecycle', 'toolchange', 'bed', 'config'] },
  { id: 'g1-h1', label: 'G1 H1 — Move to endstop', category: 'Motion',
    snippet: 'G1 H1 X-240 F1800 ; move until endstop',
    description: 'Moves the axis until the endstop triggers.', kinds: ['homing'] },
  { id: 'g1-h2', label: 'G1 H2 — Move (ignore endstop)', category: 'Motion',
    snippet: 'G1 H2 X5 F600 ; back off 5mm',
    description: 'Moves while ignoring endstops (for backoff).', kinds: ['homing', 'bed'] },
  { id: 'g28',   label: 'G28 — Home all axes', category: 'Motion',
    snippet: 'G28 ; home all',
    description: '', kinds: ['homing', 'lifecycle'] },
  { id: 'm400',  label: 'M400 — Wait for moves', category: 'Synchronisation',
    snippet: 'M400 ; wait for moves to finish',
    description: '', kinds: ['homing', 'bed', 'toolchange', 'lifecycle'] },

  // ---------- Print lifecycle (start.g / stop.g / pause.g / resume.g / cancel.g) ----------
  { id: 'm140', label: 'M140 — Set bed temperature', category: 'Heaters',
    snippet: 'M140 S60 ; bed temp',
    description: '', kinds: ['lifecycle', 'config'] },
  { id: 'm190', label: 'M190 — Wait for bed temp', category: 'Heaters',
    snippet: 'M190 S60 ; wait for bed',
    description: '', kinds: ['lifecycle'] },
  { id: 'm104', label: 'M104 — Set nozzle temperature', category: 'Heaters',
    snippet: 'M104 S200 ; nozzle temp',
    description: '', kinds: ['lifecycle', 'toolchange'] },
  { id: 'm109', label: 'M109 — Wait for nozzle temp', category: 'Heaters',
    snippet: 'M109 S200 ; wait for nozzle',
    description: '', kinds: ['lifecycle'] },
  { id: 'm220', label: 'M220 — Feed rate factor', category: 'Feedrate',
    snippet: 'M220 S100 ; speed factor 100%',
    description: '', kinds: ['lifecycle'] },
  { id: 'm221', label: 'M221 — Flow factor', category: 'Feedrate',
    snippet: 'M221 S100 ; extrusion factor 100%',
    description: '', kinds: ['lifecycle'] },
  { id: 'm83',  label: 'M83 — Relative extrusion', category: 'Extruder',
    snippet: 'M83 ; relative extrusion',
    description: '', kinds: ['lifecycle'] },
  { id: 'm25',  label: 'M25 — Pause print', category: 'Control',
    snippet: 'M25 ; pause',
    description: '', kinds: ['lifecycle'] },
  { id: 'm24',  label: 'M24 — Resume print', category: 'Control',
    snippet: 'M24 ; resume',
    description: '', kinds: ['lifecycle'] },
  { id: 'm0',   label: 'M0 — Stop / shut down', category: 'Control',
    snippet: 'M0 ; stop',
    description: '', kinds: ['lifecycle'] },
  { id: 'm106', label: 'M106 — Set fan speed', category: 'Cooling',
    snippet: 'M106 P0 S255 ; fan 0 on',
    description: '', kinds: ['lifecycle', 'toolchange'] },
  { id: 'm107', label: 'M107 — Fan off', category: 'Cooling',
    snippet: 'M107 ; fans off',
    description: '', kinds: ['lifecycle', 'toolchange'] },

  // ---------- Tool change (tpre*.g / tpost*.g / tfree*.g) ----------
  { id: 'g1-xyz', label: 'G1 — Absolute move', category: 'Motion',
    snippet: 'G1 X0 Y0 F6000 ; park',
    description: 'Moves to a specified position.', kinds: ['toolchange', 'homing', 'bed', 'lifecycle'] },
  { id: 'g92-e', label: 'G92 E0 — Reset extruder', category: 'Extruder',
    snippet: 'G92 E0 ; reset extruder position',
    description: '', kinds: ['toolchange', 'lifecycle'] },
  { id: 'g1-e-retract', label: 'G1 E — Retract', category: 'Extruder',
    snippet: 'G1 E-4 F2400 ; retract 4mm',
    description: '', kinds: ['toolchange', 'lifecycle'] },
  { id: 'g1-e-prime',   label: 'G1 E — Prime', category: 'Extruder',
    snippet: 'G1 E4 F2400 ; unretract 4mm',
    description: '', kinds: ['toolchange', 'lifecycle'] },

  // ---------- General / any file ----------
  { id: 'm98',  label: 'M98 — Call macro', category: 'Flow',
    snippet: 'M98 P"macro.g"',
    description: 'Calls another G-code file as a macro.',
    kinds: ['config', 'bed', 'homing', 'lifecycle', 'toolchange', 'other'] },
  { id: 'm117', label: 'M117 — Display message', category: 'UX',
    snippet: 'M117 "Hello, printer"',
    description: '',
    kinds: ['config', 'bed', 'homing', 'lifecycle', 'toolchange', 'other'] },
  { id: 'g4',   label: 'G4 — Dwell', category: 'Flow',
    snippet: 'G4 P500 ; pause 500ms',
    description: '',
    kinds: ['config', 'bed', 'homing', 'lifecycle', 'toolchange', 'other'] },
  { id: 'comment', label: 'Comment block', category: 'Misc',
    snippet: '; --- section -----------------------------------------',
    description: '',
    kinds: ['config', 'bed', 'homing', 'lifecycle', 'toolchange', 'other'] },
];

export function getCommandsForKind(kind: ConfigFileKind): CommandTemplate[] {
  return COMMANDS.filter((c) => c.kinds.includes(kind));
}
