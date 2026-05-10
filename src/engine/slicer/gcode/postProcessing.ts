import type { PrintProfile } from '../../../types/slicer';
import type { LayerProcessor } from '../../../types/slicer/profiles/print';

function parseReplaceCommand(line: string): { pattern: RegExp; replacement: string } | null {
  const match = line.match(/^replace:\/(.+)\/([gimsuy]*)=>([\s\S]*)$/);
  if (!match) return null;
  try {
    return { pattern: new RegExp(match[1], match[2]), replacement: match[3] };
  } catch {
    return null;
  }
}

// ── Layer-aware processor engine ──────────────────────────────────────────────

/**
 * Apply all enabled `LayerProcessor` entries to the pre-join gcode line array.
 *
 * Must be called BEFORE `run.gcode.join('\n')` so individual lines can be
 * scanned and modified.  Returns a new array (callers should reassign).
 *
 * Layer boundary detection relies on the markers emitted by prepareLayerState:
 *   ;LAYER_CHANGE   — first line of each new layer block
 *   ;Z:<mm>         — Z height for this layer (always follows LAYER_CHANGE)
 *   ;AFTER_LAYER_CHANGE — last header line; injections go immediately after
 */
export function applyLayerProcessors(
  lines: string[],
  processors: LayerProcessor[],
): string[] {
  const active = processors.filter((p) => p.enabled);
  if (active.length === 0) return lines;

  // ── Separate pass: search-replace (operates on the full string) ───────────
  const searchReplace = active.filter((p) => p.kind === 'search-replace');

  // ── Separate pass: print-from-height (filters entire layer blocks) ────────
  const printFromHeight = active.find((p) => p.kind === 'print-from-height' && typeof p.printFromZ === 'number');

  // ── Separate pass: tuning-tower (needs Z at every layer) ─────────────────
  const tuningTower = active.filter((p) => p.kind === 'tuning-tower');

  // ── Trigger-based processors (inject at a specific Z / layer) ────────────
  const triggerKinds = new Set<LayerProcessor['kind']>([
    'change-at-z', 'pause-at-z', 'filament-change', 'custom-gcode-at-z',
  ]);
  const triggerProcessors = active.filter((p) => triggerKinds.has(p.kind));

  // ── Timelapse (inject at every layer change) ──────────────────────────────
  const timelapse = active.filter((p) => p.kind === 'timelapse');

  // Track which trigger processors have already fired (fire once per Z/layer)
  const fired = new Set<string>();

  // ── Single-pass line walker ───────────────────────────────────────────────
  let currentZ = 0;
  let currentLayer = -1;           // -1 = before first layer
  let inSkippedBlock = false;      // for print-from-height
  const out: string[] = [];
  const printFromZ = printFromHeight?.printFromZ ?? -Infinity;

  for (const line of lines) {
    const trimmed = line.trimStart();

    // ── Detect layer change markers ────────────────────────────────────────
    if (trimmed === ';LAYER_CHANGE') {
      currentLayer++;
      // Layer started — we'll check the Z on the next line.
      if (!inSkippedBlock) out.push(line);
      continue;
    }

    if (trimmed.startsWith(';Z:')) {
      const z = parseFloat(trimmed.slice(3));
      if (!isNaN(z)) currentZ = z;

      // print-from-height: decide whether to skip this block
      inSkippedBlock = currentZ < printFromZ;
      if (!inSkippedBlock) out.push(line);
      continue;
    }

    // Skip lines in a print-from-height-excluded block (pass comments through)
    if (inSkippedBlock) {
      // Always keep `;AFTER_LAYER_CHANGE` so the slicer layer count stays sane
      if (trimmed === ';AFTER_LAYER_CHANGE') {
        out.push(line);
        inSkippedBlock = false;
      }
      // Pass other comments through but discard moves/extrusions
      else if (trimmed.startsWith(';')) {
        out.push(line);
      }
      continue;
    }

    // ── After-layer-change injection point ────────────────────────────────
    if (trimmed === ';AFTER_LAYER_CHANGE') {
      out.push(line);

      // — Timelapse: every layer —
      for (const p of timelapse) {
        const startLayer = p.timelapseStartLayer ?? 0;
        if (currentLayer >= startLayer) {
          const cmd = p.timelapseCommand?.trim() || 'M240';
          out.push(`; [post-processor] timelapse layer ${currentLayer}`);
          for (const c of cmd.split(/\r?\n/)) {
            if (c.trim()) out.push(c.trim());
          }
        }
      }

      // — Tuning tower: every layer in range —
      for (const p of tuningTower) {
        const { tuningStartZ = 0, tuningEndZ = 0, tuningStartValue, tuningEndValue,
                tuningStepSize = 0, tuningParameter = 'temperature' } = p;
        if (tuningStartValue === undefined || tuningEndValue === undefined) continue;
        if (currentZ < tuningStartZ || currentZ > tuningEndZ) continue;
        // Only inject when we've crossed a step boundary
        const stepKey = `${p.id}-step-${tuningStepSize > 0 ? Math.floor((currentZ - tuningStartZ) / tuningStepSize) : currentLayer}`;
        if (fired.has(stepKey)) continue;
        fired.add(stepKey);

        const t = tuningEndZ > tuningStartZ
          ? Math.min(1, Math.max(0, (currentZ - tuningStartZ) / (tuningEndZ - tuningStartZ)))
          : 0;
        // Pass the raw interpolated float — buildTuningCommand handles
        // rounding / formatting per parameter type (e.g. toFixed(4) for PA).
        const value = tuningStartValue + t * (tuningEndValue - tuningStartValue);
        out.push(`; [post-processor] tuning-tower ${tuningParameter}=${value.toFixed(4)} at Z${currentZ.toFixed(2)}`);
        out.push(...buildTuningCommand(tuningParameter, value));
      }

      // — Trigger-based: fire once at the right Z / layer —
      for (const p of triggerProcessors) {
        const key = p.id;
        if (fired.has(key)) continue;
        const shouldFire = p.triggerMode === 'layer'
          ? currentLayer === (p.triggerLayer ?? 0)
          : currentZ >= (p.triggerZ ?? 0);
        if (!shouldFire) continue;
        fired.add(key);
        out.push(...buildTriggerGcode(p, currentZ, currentLayer));
      }

      continue;
    }

    out.push(line);
  }

  // ── search-replace: applied to the final string, return split back ────────
  if (searchReplace.length === 0) return out;

  let joined = out.join('\n');
  for (const p of searchReplace) {
    if (!p.searchPattern) continue;
    try {
      const flags = p.searchFlags ?? 'g';
      const re = new RegExp(p.searchPattern, flags);
      joined = joined.replace(re, p.replaceWith ?? '');
    } catch {
      // malformed regex — skip silently
    }
  }
  return joined.split('\n');
}

// ── Gcode builder helpers ─────────────────────────────────────────────────────

function buildTuningCommand(param: string, value: number): string[] {
  switch (param) {
    case 'temperature':     return [`M104 S${Math.round(value)}`];
    case 'bed-temperature': return [`M140 S${Math.round(value)}`];
    case 'fan':             return [`M106 S${Math.min(255, Math.max(0, Math.round(value)))}`];
    case 'speed':           return [`M220 S${Math.round(value)}`];
    case 'flow':            return [`M221 S${Math.round(value)}`];
    // Pressure advance: value is stored as a float (e.g. 0.045).
    // Injects Klipper command; Marlin M900 equivalent is included as a comment.
    case 'pressure-advance': {
      const pa = value.toFixed(4);
      return [
        `SET_PRESSURE_ADVANCE ADVANCE=${pa}`,
        `; M900 K${pa}  ; Marlin / RepRapFirmware equivalent`,
      ];
    }
    default:                return [];
  }
}

function buildTriggerGcode(p: LayerProcessor, z: number, layer: number): string[] {
  const cmds: string[] = [];
  cmds.push(`; [post-processor] ${p.kind} at Z${z.toFixed(2)} layer ${layer}`);

  if (p.kind === 'change-at-z') {
    if (p.changeTemperature    && p.changeTemperatureValue    != null) cmds.push(`M104 S${p.changeTemperatureValue}`);
    if (p.changeBedTemperature && p.changeBedTemperatureValue != null) cmds.push(`M140 S${p.changeBedTemperatureValue}`);
    if (p.changeFanSpeed       && p.changeFanSpeedValue       != null) cmds.push(`M106 S${p.changeFanSpeedValue}`);
    if (p.changePrintSpeed     && p.changePrintSpeedValue     != null) cmds.push(`M220 S${p.changePrintSpeedValue}`);
    if (p.changeFlowRate       && p.changeFlowRateValue       != null) cmds.push(`M221 S${p.changeFlowRateValue}`);
    return cmds;
  }

  if (p.kind === 'pause-at-z') {
    if (p.displayText) cmds.push(`M117 ${p.displayText}`);
    if (p.parkX != null && p.parkY != null) {
      cmds.push('G91', 'G1 Z5 F300', 'G90', `G0 X${p.parkX} Y${p.parkY} F6000`);
    }
    cmds.push(p.pauseCommand ?? 'M0');
    return cmds;
  }

  if (p.kind === 'filament-change') {
    if (p.displayText) cmds.push(`M117 ${p.displayText}`);
    cmds.push('M600');
    return cmds;
  }

  if (p.kind === 'custom-gcode-at-z') {
    const block = p.customGcode?.trim() ?? '';
    for (const ln of block.split(/\r?\n/)) {
      if (ln.trim()) cmds.push(ln.trim());
    }
    return cmds;
  }

  return cmds;
}

// ── Simple script-based processor (existing) ─────────────────────────────────

export function applyPostProcessingScripts(gcode: string, print: PrintProfile): string {
  const scripts = (print.postProcessingScripts ?? []).map((script) => script.trim()).filter(Boolean);
  if (scripts.length === 0) return gcode;

  let output = gcode;
  const appended: string[] = [];
  const prepended: string[] = [];

  for (const script of scripts) {
    for (const rawLine of script.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith(';')) continue;
      if (line.startsWith('prepend:')) {
        prepended.push(line.slice('prepend:'.length).trim());
        continue;
      }
      if (line.startsWith('append:')) {
        appended.push(line.slice('append:'.length).trim());
        continue;
      }
      const replace = parseReplaceCommand(line);
      if (replace) {
        output = output.replace(replace.pattern, replace.replacement);
        continue;
      }
      appended.push(line);
    }
  }

  if (prepended.length > 0) output = `${prepended.join('\n')}\n${output}`;
  if (appended.length > 0) output = `${output.trimEnd()}\n${appended.join('\n')}\n`;
  return output;
}
