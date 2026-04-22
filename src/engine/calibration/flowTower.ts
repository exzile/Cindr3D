import type { MaterialProfile, PrintProfile, PrinterProfile } from '../../types/slicer';
import {
  bandValueAtLayer,
  buildCalibrationFooter,
  buildCalibrationHeader,
  makeBands,
  RelativeExtrusionWriter,
} from './common';

export function generateFlowTowerGCode(
  printer: PrinterProfile,
  material: MaterialProfile,
  print: PrintProfile,
): string {
  const layerHeight = print.layerHeight;
  const layersPerBand = Math.max(1, Math.round(8 / Math.max(layerHeight, 0.05)));
  const flowPercents = [90, 95, 100, 105, 110];
  const flowBands = makeBands(flowPercents, layersPerBand);
  const totalLayers = flowBands.length * layersPerBand;
  const feedPrint = print.outerWallSpeed * 60;
  const feedTravel = print.travelSpeed * 60;

  const lines = buildCalibrationHeader('Flow Tower', { printer, material, print }, [
    'Flow multiplier changes every band with M221.',
    `Bands every ${layersPerBand} layers from ${flowPercents[0]}% to ${flowPercents[flowPercents.length - 1]}%.`,
  ]);
  const writer = new RelativeExtrusionWriter(lines, { printer, material, print });

  const min = { x: 200, y: 80 };
  const max = { x: 220, y: 100 };
  let current = { x: min.x, y: min.y };
  let activeFlow = flowPercents[0];

  lines.push(`M221 S${activeFlow}`);
  lines.push('G92 E0');
  writer.travel(current.x, current.y, feedTravel);

  for (let layer = 0; layer < totalLayers; layer++) {
    const z = print.firstLayerHeight + layer * layerHeight;
    const targetFlow = bandValueAtLayer(flowBands, layer);
    const activeLayerHeight = layer === 0 ? print.firstLayerHeight : layerHeight;

    if (targetFlow !== activeFlow) {
      lines.push(`; switch flow to ${targetFlow}%`);
      lines.push(`M221 S${targetFlow}`);
      activeFlow = targetFlow;
    }

    writer.moveZ(z, feedTravel);
    lines.push(`; layer ${layer + 1}/${totalLayers} flow=${targetFlow}%`);
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

  lines.push('M221 S100');
  lines.push(...buildCalibrationFooter({ printer, material, print }));
  return `${lines.join('\n')}\n`;
}
