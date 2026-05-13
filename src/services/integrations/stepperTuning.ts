import type { PrinterBoardType } from '../../types/duet';
import type { StepperAxisTuning, StepperMode } from '../../store/stepperTuningStore';

export function buildStepperTuningCommands(
  boardType: PrinterBoardType | undefined,
  axis: string,
  tuning: StepperAxisTuning,
): string[] {
  const letter = axis.toUpperCase();
  if (boardType === 'klipper') {
    const stepper = letter === 'E'
      ? `extruder${tuning.driverIndex > 0 ? tuning.driverIndex : ''}`
      : `stepper_${letter.toLowerCase()}`;
    return [
      `SET_TMC_CURRENT STEPPER=${stepper} CURRENT=${(tuning.currentMa / 1000).toFixed(2)}`,
      `SET_TMC_FIELD STEPPER=${stepper} FIELD=en_spreadCycle VALUE=${tuning.mode === 'spreadcycle' ? 1 : 0}`,
    ];
  }

  const modeCommand = boardType === 'marlin'
    ? `M569 S${tuning.mode === 'stealthchop' ? 1 : 0} ${letter}`
    : `M569 P${tuning.driverIndex} S${tuning.mode === 'stealthchop' ? 1 : 0}`;

  return [
    `M906 ${letter}${tuning.currentMa}`,
    `M350 ${letter}${tuning.microsteps}`,
    modeCommand,
  ];
}

// ─── Config parser ────────────────────────────────────────────────────────────
// Extracts M906 (current), M350 (microsteps), M584 (driver map), and M569
// (mode) from a config.g / config-override.g text blob. Returns partial tuning
// keyed by uppercase axis letter. Only fields actually present in the file are
// populated so callers can merge with stored or default values.

const ALL_AXIS_LETTERS = ['X', 'Y', 'Z', 'E', 'U', 'V', 'W', 'A', 'B', 'C'] as const;

function extractLineParams(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tok of line.split(/\s+/).slice(1)) {
    if (tok.startsWith(';')) break;
    const letter = tok[0]?.toUpperCase();
    if (letter && /[A-Z]/.test(letter)) out[letter] = tok.slice(1);
  }
  return out;
}

function lineNum(p: Record<string, string>, key: string): number | undefined {
  const v = parseFloat(p[key] ?? '');
  return isNaN(v) ? undefined : v;
}

export function parseStepperConfigFromGCode(
  configText: string,
): Record<string, Partial<StepperAxisTuning>> {
  const lines = configText
    .split(/\r?\n/)
    .map((l) => l.replace(/;.*$/, '').trim())
    .filter((l) => /^[Mm]\d+/.test(l));

  // ── Pass 1: driver → axis map from M584 ──────────────────────────────────
  const driverToAxis: Record<number, string> = {};

  for (const line of lines) {
    if (!line.toUpperCase().startsWith('M584')) continue;
    const p = extractLineParams(line);
    for (const letter of ALL_AXIS_LETTERS) {
      const idx = lineNum(p, letter);
      if (idx !== undefined) driverToAxis[idx] = letter;
    }
  }

  // Fall back to standard sequential driver assignment when M584 is absent
  if (Object.keys(driverToAxis).length === 0) {
    Object.assign(driverToAxis, { 0: 'X', 1: 'Y', 2: 'Z', 3: 'E' });
  }

  // ── Pass 2: current (M906), microsteps (M350), mode (M569) ───────────────
  const result: Record<string, Partial<StepperAxisTuning>> = {};
  const driverModes: Record<number, StepperMode> = {};

  for (const line of lines) {
    const upper = line.toUpperCase();
    const p = extractLineParams(line);

    // M906 — motor currents in mA: M906 X800 Y800 Z800 E500 I30
    if (upper.startsWith('M906')) {
      for (const letter of ALL_AXIS_LETTERS) {
        const ma = lineNum(p, letter);
        if (ma !== undefined && ma > 0) {
          (result[letter] ??= {}).currentMa = ma;
        }
      }
    }

    // M350 — microsteps: M350 X16 Y16 Z16 E16 I1
    if (upper.startsWith('M350')) {
      for (const letter of ALL_AXIS_LETTERS) {
        const ms = lineNum(p, letter);
        if (ms !== undefined && ms > 0) {
          (result[letter] ??= {}).microsteps = ms;
        }
      }
    }

    // M569 — driver mode: M569 P<driver> S<1=stealthchop|0=spreadcycle>
    if (upper.startsWith('M569')) {
      const driverIdx = lineNum(p, 'P');
      const s = lineNum(p, 'S');
      if (driverIdx !== undefined && s !== undefined) {
        driverModes[driverIdx] = s === 1 ? 'stealthchop' : 'spreadcycle';
      }
    }
  }

  // ── Attach driver indices and modes to axes ───────────────────────────────
  for (const [idxStr, axisLetter] of Object.entries(driverToAxis)) {
    const idx = Number(idxStr);
    const entry = (result[axisLetter] ??= {});

    // Driver index from M584 (or default ordering)
    entry.driverIndex = idx;

    // Mode from the matching M569 P<n> line
    if (driverModes[idx] !== undefined) {
      entry.mode = driverModes[idx];
    }
  }

  return result;
}

export function buildStepperWiggleCommands(axis: string, distanceMm = 1, feedrate = 1200): string[] {
  const letter = axis.toUpperCase();
  const distance = Math.max(0.01, Math.min(10, Math.abs(distanceMm)));
  return [
    'G91',
    `G1 ${letter}${distance} F${feedrate}`,
    `G1 ${letter}-${distance} F${feedrate}`,
    'G90',
  ];
}
