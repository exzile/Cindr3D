import type {
  MaterialProfile,
  PrinterProfile,
} from '../../../types/slicer';
import { resolveGCodeTemplate } from './runtime';
import { dedupeEndGCode } from './startEnd';

export interface FinalizedGCodeStats {
  estimatedTime: number;
  filamentWeight: number;
  filamentCost: number;
}

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
  if (endGCode) gcode.push(endGCode);
}

export function finalizeGCodeStats(
  gcode: string[],
  totalTime: number,
  totalExtruded: number,
  printer: PrinterProfile,
  material: MaterialProfile,
): FinalizedGCodeStats {
  const filamentCrossSection = Math.PI * (printer.filamentDiameter / 2) ** 2;
  const filamentVolumeMm3 = totalExtruded * filamentCrossSection;
  const filamentVolumeCm3 = filamentVolumeMm3 / 1000;
  const filamentWeight = filamentVolumeCm3 * material.density;
  const filamentCost = (filamentWeight / 1000) * material.costPerKg;

  const estimatedTime = totalTime * (printer.printTimeEstimationFactor ?? 1.0);
  const hours = Math.floor(estimatedTime / 3600);
  const minutes = Math.floor((estimatedTime % 3600) / 60);
  gcode[1] = `; Estimated print time: ${hours}h ${minutes}m`;
  gcode[2] = `; Filament used: ${totalExtruded.toFixed(1)}mm (${filamentWeight.toFixed(1)}g)`;

  return {
    estimatedTime,
    filamentWeight,
    filamentCost,
  };
}
