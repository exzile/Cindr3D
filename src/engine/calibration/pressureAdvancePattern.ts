import type { MaterialProfile, PrintProfile, PrinterProfile } from '../../types/slicer';
import {
  buildCalibrationFooter,
  buildCalibrationHeader,
  formatNumber,
  pressureAdvanceCommand,
  RelativeExtrusionWriter,
} from './common';

function pressureAdvanceValues(printer: PrinterProfile, material: MaterialProfile): number[] {
  const center = Math.max(0, material.linearAdvanceFactor ?? 0);
  if (center > 0) {
    const step = printer.gcodeFlavorType === 'marlin' ? 0.04 : 0.01;
    const start = Math.max(0, center - step * 4);
    return Array.from({ length: 9 }, (_, i) => Number((start + i * step).toFixed(4)));
  }
  const step = printer.gcodeFlavorType === 'marlin' ? 0.04 : 0.015;
  return Array.from({ length: 9 }, (_, i) => Number((i * step).toFixed(4)));
}

export function generatePressureAdvancePatternGCode(
  printer: PrinterProfile,
  material: MaterialProfile,
  print: PrintProfile,
): string {
  const values = pressureAdvanceValues(printer, material);
  const lineWidth = print.outerWallLineWidth ?? print.lineWidth;
  const layerHeight = print.firstLayerHeight ?? print.layerHeight;
  const feedTravel = print.travelSpeed * 60;
  const feedSlow = Math.max(12, print.outerWallSpeed * 0.45) * 60;
  const feedFast = Math.min(printer.maxSpeed, Math.max(print.printSpeed, print.outerWallSpeed * 2.4)) * 60;
  const feedPrime = (material.retractionPrimeSpeed ?? material.retractionSpeed) * 60;
  const feedRetract = (material.retractionRetractSpeed ?? material.retractionSpeed) * 60;
  const retract = Math.max(0, material.retractionDistance ?? 0);

  const lines = buildCalibrationHeader('Pressure / Linear Advance Pattern', { printer, material, print }, [
    'Each row uses a different pressure-advance value.',
    `Rows: ${values.map((v) => formatNumber(v, 4)).join(', ')}.`,
    'Look for the row with the most even line width before and after corners and speed changes.',
  ]);
  const writer = new RelativeExtrusionWriter(lines, { printer, material, print });

  lines.push(`M104 S${material.nozzleTempFirstLayer ?? material.nozzleTemp}`);
  lines.push(`M140 S${material.bedTempFirstLayer ?? material.bedTemp}`);
  lines.push('G92 E0');
  writer.moveZ(layerHeight, feedTravel);

  const x0 = 70;
  const x1 = 155;
  const cornerX = 175;
  const rowSpacing = Math.max(6, lineWidth * 12);
  const y0 = 55;
  // eslint-disable-next-line no-useless-assignment
  let current = { x: x0, y: y0 };

  for (let row = 0; row < values.length; row++) {
    const y = y0 + row * rowSpacing;
    const k = values[row];

    lines.push(`; pressure advance row ${row + 1}/${values.length} K=${formatNumber(k, 4)}`);
    lines.push(`${pressureAdvanceCommand(printer, k)} ; pressure / linear advance`);

    if (retract > 0 && row > 0) writer.extrudeAmount(-retract, feedRetract);
    writer.travel(x0, y, feedTravel);
    if (retract > 0 && row > 0) writer.extrudeAmount(retract, feedPrime);
    current = { x: x0, y };

    const path = [
      { x: x0 + 18, y, feed: feedSlow },
      { x: x0 + 42, y, feed: feedFast },
      { x: x0 + 58, y, feed: feedSlow },
      { x: x0 + 82, y, feed: feedFast },
      { x: x1, y, feed: feedSlow },
      { x: cornerX, y, feed: feedFast },
      { x: cornerX, y: y + rowSpacing * 0.42, feed: feedFast },
      { x: x1, y: y + rowSpacing * 0.42, feed: feedSlow },
      { x: x0 + 52, y: y + rowSpacing * 0.42, feed: feedFast },
      { x: x0, y: y + rowSpacing * 0.42, feed: feedSlow },
    ];

    for (const next of path) {
      writer.extrudeTo(current, next, lineWidth, layerHeight, next.feed);
      current = next;
    }
  }

  const restoreValue = material.linearAdvanceEnabled ? material.linearAdvanceFactor ?? 0 : 0;
  lines.push(`${pressureAdvanceCommand(printer, restoreValue)} ; restore pressure / linear advance`);
  lines.push(...buildCalibrationFooter({ printer, material, print }));
  return `${lines.join('\n')}\n`;
}
