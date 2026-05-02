import type {
  MaterialProfile,
  PrinterProfile,
} from '../../../types/slicer';
import type { FinalizedGCodeStats } from '../../../types/slicer-gcode-footer.types';
import { resolveGCodeTemplate } from './runtime';
import { dedupeEndGCode } from './startEnd';

export function appendEndGCode(
  gcode: string[],
  printer: PrinterProfile,
  material: MaterialProfile,
): void {
  gcode.push('');
  gcode.push('; ----- End G-code -----');
  const rawEndGCode = resolveGCodeTemplate(printer.endGCode, {
    nozzleTemp: material.nozzleTemp,
    bedTemp: material.bedTemp,
  });
  const endTemplateHasPrintMacro = /^\s*END_PRINT\b/m.test(rawEndGCode);
  if (!endTemplateHasPrintMacro) {
    gcode.push('M73 P100 ; Print complete');
    gcode.push('M107 ; Fan off');
    if (material.finalPrintingTemperature !== undefined) {
      gcode.push(`M104 S${material.finalPrintingTemperature} ; Cooldown nozzle`);
    }
  }
  const endGCode = dedupeEndGCode(rawEndGCode, {
    slicerTurnsFanOff: !endTemplateHasPrintMacro,
    slicerSetsFinalNozzleTemp: !endTemplateHasPrintMacro && material.finalPrintingTemperature !== undefined,
  });
  if (endGCode) {
    // OrcaSlicer ;TYPE:Custom marker on the user's custom end-gcode
    // block, paralleling the startup-side wrap. Lets external preview
    // tools skip / classify cooldown + park moves separately from
    // print body extrusions.
    gcode.push(';TYPE:Custom');
    gcode.push(endGCode);
  }
}

export function finalizeGCodeStats(
  gcode: string[],
  totalTime: number,
  totalExtruded: number,
  printer: PrinterProfile,
  material: MaterialProfile,
  layerTimes?: number[],
  modelHeight?: number,
): FinalizedGCodeStats {
  const filamentCrossSection = Math.PI * (printer.filamentDiameter / 2) ** 2;
  const filamentVolumeMm3 = totalExtruded * filamentCrossSection;
  const filamentVolumeCm3 = filamentVolumeMm3 / 1000;
  const filamentWeight = filamentVolumeCm3 * material.density;
  const filamentCost = (filamentWeight / 1000) * material.costPerKg;

  const timeFactor = printer.printTimeEstimationFactor ?? 1.0;
  const estimatedTime = totalTime * timeFactor;
  const hours = Math.floor(estimatedTime / 3600);
  const minutes = Math.floor((estimatedTime % 3600) / 60);
  const timeIndex = gcode.findIndex((line) => line.includes('PRINT_TIME_PLACEHOLDER'));
  const filamentIndex = gcode.findIndex((line) => line.includes('FILAMENT_USED_PLACEHOLDER'));
  if (timeIndex >= 0) {
    gcode[timeIndex] = `; Estimated print time: ${hours}h ${minutes}m`;
  }
  if (filamentIndex >= 0) {
    gcode[filamentIndex] = `; Filament used: ${totalExtruded.toFixed(1)}mm (${filamentWeight.toFixed(1)}g)`;
  }
  // Patch HEADER_BLOCK metadata placeholders. Each fires once at
  // header emit time and gets resolved here once layer count + model
  // dimensions are known.
  if (layerTimes && layerTimes.length > 0) {
    const totalLayersIndex = gcode.findIndex((line) => line.includes('TOTAL_LAYERS_PLACEHOLDER'));
    if (totalLayersIndex >= 0) {
      gcode[totalLayersIndex] = `; total layer number: ${layerTimes.length}`;
    }
  }
  if (modelHeight !== undefined) {
    const maxZIndex = gcode.findIndex((line) => line.includes('MAX_Z_HEIGHT_PLACEHOLDER'));
    if (maxZIndex >= 0) {
      gcode[maxZIndex] = `; max_z_height: ${modelHeight.toFixed(2)}`;
    }
  }

  // Patch M73 ETA placeholders. Each layer's M73 has a unique
  // `R{M73_REMAINING_MIN_PLACEHOLDER_<li>}` token; we resolve it from
  // the cumulative layer-time table, then rewrite the line. Patcher
  // is a no-op when `layerTimes` is missing (e.g. legacy callers /
  // tests that don't track per-layer time).
  if (layerTimes && layerTimes.length > 0) {
    const cumulative: number[] = new Array(layerTimes.length);
    let acc = 0;
    for (let i = 0; i < layerTimes.length; i++) {
      acc += layerTimes[i];
      cumulative[i] = acc;
    }
    const totalEstimatedSec = estimatedTime;
    const placeholderRe = /R\{M73_REMAINING_MIN_PLACEHOLDER_(\d+)\}/;
    for (let i = 0; i < gcode.length; i++) {
      const match = gcode[i].match(placeholderRe);
      if (!match) continue;
      const li = Number(match[1]);
      const elapsed = (cumulative[li - 1] ?? 0) * timeFactor;
      const remainingSec = Math.max(0, totalEstimatedSec - elapsed);
      const remainingMin = Math.ceil(remainingSec / 60);
      gcode[i] = gcode[i].replace(placeholderRe, `R${remainingMin}`);
    }
  }

  return {
    estimatedTime,
    filamentWeight,
    filamentCost,
  };
}
