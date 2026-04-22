import type { MaterialProfile, PrintProfile, PrinterProfile } from '../../types/slicer';
import {
  bandValueAtLayer,
  buildCalibrationFooter,
  buildCalibrationHeader,
  makeBands,
  RelativeExtrusionWriter,
} from './common';

export function generateRetractionTowerGCode(
  printer: PrinterProfile,
  material: MaterialProfile,
  print: PrintProfile,
): string {
  const layerHeight = print.layerHeight;
  const layersPerBand = Math.max(1, Math.round(8 / Math.max(layerHeight, 0.05)));
  const retractBands = makeBands([0.2, 0.4, 0.8, 1.2, 1.6, 2.0], layersPerBand);
  const totalLayers = retractBands.length * layersPerBand;
  const feedPrint = print.outerWallSpeed * 60;
  const feedTravel = print.travelSpeed * 60;
  const feedRetract = (material.retractionRetractSpeed ?? material.retractionSpeed) * 60;
  const feedPrime = (material.retractionPrimeSpeed ?? material.retractionSpeed) * 60;
  const zHop = Math.max(material.retractionZHop ?? 0, 0);

  const lines = buildCalibrationHeader('Retraction Tower', { printer, material, print }, [
    'One retraction-heavy travel per layer.',
    `Bands every ${layersPerBand} layers from 0.2mm to 2.0mm.`,
  ]);
  const writer = new RelativeExtrusionWriter(lines, { printer, material, print });

  const towerMin = { x: 90, y: 90 };
  const towerMax = { x: 110, y: 110 };
  const spikeX = 126;
  const spikeY = 100;
  let current = { x: towerMin.x, y: towerMin.y };

  lines.push(`M104 S${material.nozzleTempFirstLayer ?? material.nozzleTemp}`);
  lines.push(`M140 S${material.bedTempFirstLayer ?? material.bedTemp}`);
  lines.push('G92 E0');
  writer.travel(current.x, current.y, feedTravel);

  for (let layer = 0; layer < totalLayers; layer++) {
    const z = print.firstLayerHeight + layer * layerHeight;
    const activeRetract = bandValueAtLayer(retractBands, layer);
    const activeLayerHeight = layer === 0 ? print.firstLayerHeight : layerHeight;

    lines.push(`; layer ${layer + 1}/${totalLayers} retraction=${activeRetract.toFixed(2)}mm`);
    writer.moveZ(z, feedTravel);

    const corners = [
      { x: towerMax.x, y: towerMin.y },
      { x: towerMax.x, y: towerMax.y },
      { x: towerMin.x, y: towerMax.y },
      { x: towerMin.x, y: towerMin.y },
    ];
    for (const next of corners) {
      writer.extrudeTo(current, next, print.outerWallLineWidth ?? print.lineWidth, activeLayerHeight, feedPrint);
      current = next;
    }

    writer.extrudeAmount(-activeRetract, feedRetract);
    if (zHop > 0) writer.moveZ(z + zHop, feedTravel);
    writer.travel(spikeX, spikeY, feedTravel);
    if (zHop > 0) writer.moveZ(z, feedTravel);
    writer.extrudeAmount(activeRetract, feedPrime);

    const spikeStart = { x: spikeX - 6, y: spikeY };
    const spikeEnd = { x: spikeX + 6, y: spikeY };
    writer.travel(spikeStart.x, spikeStart.y, feedTravel);
    current = spikeStart;
    writer.extrudeTo(current, spikeEnd, print.lineWidth, activeLayerHeight, feedPrint);
    current = spikeEnd;

    writer.extrudeAmount(-activeRetract, feedRetract);
    if (zHop > 0) writer.moveZ(z + zHop, feedTravel);
    writer.travel(towerMin.x, towerMin.y, feedTravel);
    if (zHop > 0) writer.moveZ(z, feedTravel);
    writer.extrudeAmount(activeRetract, feedPrime);
    current = { x: towerMin.x, y: towerMin.y };
  }

  lines.push(...buildCalibrationFooter({ printer, material, print }));
  return `${lines.join('\n')}\n`;
}
