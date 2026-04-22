export interface StartEndMachineState {
  currentX: number;
  currentY: number;
  currentZ: number;
  currentE: number;
  isRetracted: boolean;
  extrudedSinceRetract: number;
  templateUsesAbsolutePositioning: boolean;
  templateUsesAbsoluteExtrusion: boolean;
}

export interface StartGCodeDedupeOptions {
  preheatTemp: number;
  nozzleFirstLayerTemp: number;
  bedFirstLayerTemp: number;
  relativeExtrusion: boolean;
  hasHeatedBed: boolean;
  waitForNozzle: boolean;
  waitForBuildPlate: boolean;
}

export interface EndGCodeDedupeOptions {
  slicerTurnsFanOff: boolean;
  slicerSetsFinalNozzleTemp: boolean;
}

export function fanSpeedToCommandArg(
  scaleFanSpeedTo01: boolean | undefined,
  pct: number,
): string {
  return scaleFanSpeedTo01
    ? (pct / 100).toFixed(3)
    : Math.round((pct / 100) * 255).toString();
}

export function syncStateFromGCode(
  block: string,
  state: StartEndMachineState,
): void {
  const lines = block.split(/\r?\n/);
  for (const rawLine of lines) {
    const stripped = rawLine.split(';', 1)[0].trim();
    if (!stripped) continue;
    const tokens = stripped.split(/\s+/);
    if (tokens.length === 0) continue;
    const command = tokens[0].toUpperCase();
    if (command === 'G90') {
      state.templateUsesAbsolutePositioning = true;
      continue;
    }
    if (command === 'G91') {
      state.templateUsesAbsolutePositioning = false;
      continue;
    }
    if (command === 'M82') {
      state.templateUsesAbsoluteExtrusion = true;
      continue;
    }
    if (command === 'M83') {
      state.templateUsesAbsoluteExtrusion = false;
      continue;
    }

    let nextX: number | undefined;
    let nextY: number | undefined;
    let nextZ: number | undefined;
    let nextE: number | undefined;
    for (const token of tokens.slice(1)) {
      if (token.length < 2) continue;
      const axis = token[0].toUpperCase();
      const value = Number.parseFloat(token.slice(1));
      if (!Number.isFinite(value)) continue;
      if (axis === 'X') nextX = value;
      else if (axis === 'Y') nextY = value;
      else if (axis === 'Z') nextZ = value;
      else if (axis === 'E') nextE = value;
    }

    if (command === 'G92') {
      if (nextX !== undefined) state.currentX = nextX;
      if (nextY !== undefined) state.currentY = nextY;
      if (nextZ !== undefined) state.currentZ = nextZ;
      if (nextE !== undefined) state.currentE = nextE;
      continue;
    }
    if (command !== 'G0' && command !== 'G1') continue;

    if (nextX !== undefined) {
      state.currentX = state.templateUsesAbsolutePositioning
        ? nextX
        : state.currentX + nextX;
    }
    if (nextY !== undefined) {
      state.currentY = state.templateUsesAbsolutePositioning
        ? nextY
        : state.currentY + nextY;
    }
    if (nextZ !== undefined) {
      state.currentZ = state.templateUsesAbsolutePositioning
        ? nextZ
        : state.currentZ + nextZ;
    }
    if (nextE !== undefined) {
      state.currentE = state.templateUsesAbsoluteExtrusion
        ? nextE
        : state.currentE + nextE;
    }
  }
}

export function restorePostStartModes(
  gcode: string[],
  state: StartEndMachineState,
  relativeExtrusion: boolean,
): void {
  gcode.push('G90 ; Restore absolute positioning after start G-code');
  gcode.push(relativeExtrusion ? 'M83 ; Restore relative extrusion after start G-code' : 'M82 ; Restore absolute extrusion after start G-code');
  gcode.push('G92 E0 ; Reset extruder after start G-code');
  state.currentE = 0;
  state.isRetracted = false;
  state.extrudedSinceRetract = 0;
  state.templateUsesAbsolutePositioning = true;
  state.templateUsesAbsoluteExtrusion = !relativeExtrusion;
}

export function dedupeStartGCode(
  block: string,
  opts: StartGCodeDedupeOptions,
): string {
  const lines = block.split(/\r?\n/);
  const filtered: string[] = [];
  for (const line of lines) {
    const stripped = line.split(';', 1)[0].trim();
    if (!stripped) {
      filtered.push(line);
      continue;
    }

    const tokens = stripped.split(/\s+/);
    const command = tokens[0]?.toUpperCase() ?? '';
    const sval = tokens
      .map((t) => t.trim())
      .find((t) => t[0]?.toUpperCase() === 'S');
    const eToken = tokens
      .map((t) => t.trim())
      .find((t) => t[0]?.toUpperCase() === 'E');
    const sNum = sval != null ? Number.parseFloat(sval.slice(1)) : undefined;
    const eNum = eToken != null ? Number.parseFloat(eToken.slice(1)) : undefined;

    if (command === 'G90') continue;
    if (!opts.relativeExtrusion && command === 'M82') continue;
    if (opts.relativeExtrusion && command === 'M83') continue;
    if (command === 'G92' && eNum === 0 && tokens.every((t, i) => i === 0 || t[0]?.toUpperCase() === 'E')) continue;
    if (command === 'M104' && sNum !== undefined && (Math.abs(sNum - opts.preheatTemp) < 0.0001 || Math.abs(sNum - opts.nozzleFirstLayerTemp) < 0.0001)) continue;
    if (command === 'M109' && opts.waitForNozzle && sNum !== undefined && Math.abs(sNum - opts.nozzleFirstLayerTemp) < 0.0001) continue;
    if (command === 'M140' && opts.hasHeatedBed && sNum !== undefined && Math.abs(sNum - opts.bedFirstLayerTemp) < 0.0001) continue;
    if (command === 'M190' && opts.hasHeatedBed && opts.waitForBuildPlate && sNum !== undefined && Math.abs(sNum - opts.bedFirstLayerTemp) < 0.0001) continue;

    filtered.push(line);
  }
  return filtered.join('\n').trim();
}

export function dedupeEndGCode(
  block: string,
  opts: EndGCodeDedupeOptions,
): string {
  const lines = block.split(/\r?\n/);
  const filtered: string[] = [];
  for (const line of lines) {
    const stripped = line.split(';', 1)[0].trim();
    if (!stripped) {
      filtered.push(line);
      continue;
    }
    const tokens = stripped.split(/\s+/);
    const command = tokens[0]?.toUpperCase() ?? '';
    const sval = tokens
      .map((t) => t.trim())
      .find((t) => t[0]?.toUpperCase() === 'S');
    const sNum = sval != null ? Number.parseFloat(sval.slice(1)) : undefined;

    if (opts.slicerTurnsFanOff && command === 'M107') continue;
    if (opts.slicerTurnsFanOff && command === 'M106' && sNum !== undefined && Math.abs(sNum) < 0.0001) continue;
    if (opts.slicerSetsFinalNozzleTemp && command === 'M104' && sNum !== undefined) continue;

    filtered.push(line);
  }
  return filtered.join('\n').trim();
}
