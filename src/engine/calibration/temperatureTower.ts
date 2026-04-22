import type { MaterialProfile, PrintProfile, PrinterProfile } from '../../types/slicer';
import {
  bandValueAtLayer,
  buildCalibrationFooter,
  buildCalibrationHeader,
  makeBands,
  RelativeExtrusionWriter,
} from './common';

export function generateTemperatureTowerGCode(
  printer: PrinterProfile,
  material: MaterialProfile,
  print: PrintProfile,
): string {
  const layerHeight = print.layerHeight;
  const layersPerBand = Math.max(1, Math.round(10 / Math.max(layerHeight, 0.05)));
  const temperatures = [material.nozzleTemp + 10, material.nozzleTemp + 5, material.nozzleTemp, material.nozzleTemp - 5, material.nozzleTemp - 10];
  const tempBands = makeBands(temperatures, layersPerBand);
  const totalLayers = tempBands.length * layersPerBand;
  const feedPrint = print.outerWallSpeed * 60;
  const feedTravel = print.travelSpeed * 60;

  const lines = buildCalibrationHeader('Temperature Tower', { printer, material, print }, [
    'Temperature changes every band.',
    `Bands every ${layersPerBand} layers from ${temperatures[0]}C down to ${temperatures[temperatures.length - 1]}C.`,
  ]);
  const writer = new RelativeExtrusionWriter(lines, { printer, material, print });

  const min = { x: 145, y: 80 };
  const max = { x: 165, y: 100 };
  let current = { x: min.x, y: min.y };
  let activeTemp = temperatures[0];

  lines.push(`M104 S${activeTemp}`);
  lines.push(`M109 S${activeTemp}`);
  lines.push('G92 E0');
  writer.travel(current.x, current.y, feedTravel);

  for (let layer = 0; layer < totalLayers; layer++) {
    const z = print.firstLayerHeight + layer * layerHeight;
    const targetTemp = bandValueAtLayer(tempBands, layer);
    const activeLayerHeight = layer === 0 ? print.firstLayerHeight : layerHeight;

    if (targetTemp !== activeTemp) {
      lines.push(`; switch nozzle temp to ${targetTemp}C`);
      lines.push(`M104 S${targetTemp}`);
      lines.push(`M109 S${targetTemp}`);
      activeTemp = targetTemp;
    }

    writer.moveZ(z, feedTravel);
    lines.push(`; layer ${layer + 1}/${totalLayers} temp=${targetTemp}C`);
    const path = [
      { x: max.x, y: min.y },
      { x: max.x, y: max.y },
      { x: min.x, y: max.y },
      { x: min.x, y: min.y },
    ];
    for (const next of path) {
      writer.extrudeTo(current, next, print.outerWallLineWidth ?? print.lineWidth, activeLayerHeight, feedPrint);
      current = next;
    }
  }

  lines.push(...buildCalibrationFooter({ printer, material, print }));
  return `${lines.join('\n')}\n`;
}
