import type { MaterialProfile, PrintProfile, PrinterProfile } from '../../types/slicer';
import {
  buildCalibrationFooter,
  buildCalibrationHeader,
  formatNumber,
  pressureAdvanceCommand,
  RelativeExtrusionWriter,
} from './common';

function speed(print: PrintProfile, key: keyof PrintProfile, fallback: number): number {
  const value = print[key];
  return typeof value === 'number' ? value * 60 : fallback * 60;
}

function drawRect(
  writer: RelativeExtrusionWriter,
  current: { x: number; y: number },
  min: { x: number; y: number },
  max: { x: number; y: number },
  width: number,
  height: number,
  feedrate: number,
): { x: number; y: number } {
  const path = [
    { x: max.x, y: min.y },
    { x: max.x, y: max.y },
    { x: min.x, y: max.y },
    { x: min.x, y: min.y },
  ];
  let cursor = current;
  for (const next of path) {
    writer.extrudeTo(cursor, next, width, height, feedrate);
    cursor = next;
  }
  return cursor;
}

export function generateCalibrationCubeGCode(
  printer: PrinterProfile,
  material: MaterialProfile,
  print: PrintProfile,
): string {
  const ctx = { printer, material, print };
  const layerHeight = Math.max(print.layerHeight, 0.05);
  const totalLayers = Math.max(1, Math.round(20 / layerHeight));
  const feedPrint = speed(print, 'outerWallSpeed', print.printSpeed);
  const feedTravel = speed(print, 'travelSpeed', 150);
  const lineWidth = print.outerWallLineWidth ?? print.lineWidth ?? 0.4;
  const min = { x: 20, y: 20 };
  const max = { x: 40, y: 40 };

  const lines = buildCalibrationHeader('20mm Calibration Cube', ctx, [
    'Measure X/Y/Z after printing and adjust steps/mm or horizontal expansion.',
    `Nominal size: 20 x 20 x ${formatNumber(totalLayers * layerHeight, 2)}mm.`,
  ]);
  const writer = new RelativeExtrusionWriter(lines, ctx);
  let current = { ...min };

  lines.push('G92 E0');
  writer.travel(current.x, current.y, feedTravel);

  for (let layer = 0; layer < totalLayers; layer += 1) {
    const activeLayerHeight = layer === 0 ? print.firstLayerHeight : layerHeight;
    const z = print.firstLayerHeight + layer * layerHeight;
    writer.moveZ(z, feedTravel);
    lines.push(`; layer ${layer + 1}/${totalLayers}`);

    for (let wall = 0; wall < Math.max(1, print.wallCount ?? 2); wall += 1) {
      const inset = wall * lineWidth;
      current = drawRect(
        writer,
        current,
        { x: min.x + inset, y: min.y + inset },
        { x: max.x - inset, y: max.y - inset },
        lineWidth,
        activeLayerHeight,
        feedPrint,
      );
    }
  }

  lines.push(...buildCalibrationFooter(ctx));
  return `${lines.join('\n')}\n`;
}

export function generateFirstLayerTestGCode(
  printer: PrinterProfile,
  material: MaterialProfile,
  print: PrintProfile,
): string {
  const ctx = { printer, material, print };
  const feedPrint = speed(print, 'firstLayerSpeed', 25);
  const feedTravel = speed(print, 'travelSpeed', 150);
  const height = print.firstLayerHeight;
  const width = print.initialLayerLineWidthFactor
    ? (print.lineWidth ?? 0.4) * (print.initialLayerLineWidthFactor / 100)
    : print.lineWidth ?? 0.4;
  const lines = buildCalibrationHeader('First Layer Test', ctx, [
    'Five pads expose bed offset, mesh, temperature, and first-layer flow issues.',
  ]);
  const writer = new RelativeExtrusionWriter(lines, ctx, print.initialLayerFlow ? print.initialLayerFlow / 100 : 1);
  const pads = [
    { x: 25, y: 25 },
    { x: 95, y: 25 },
    { x: 165, y: 25 },
    { x: 25, y: 95 },
    { x: 165, y: 95 },
  ];

  lines.push('G92 E0');
  for (const pad of pads) {
    let current = { x: pad.x, y: pad.y };
    writer.travel(current.x, current.y, feedTravel);
    writer.moveZ(height, feedTravel);
    for (let pass = 0; pass < 9; pass += 1) {
      const y = pad.y + pass * width * 1.15;
      writer.travel(pad.x, y, feedTravel);
      writer.extrudeTo({ x: pad.x, y }, { x: pad.x + 35, y }, width, height, feedPrint);
      current = { x: pad.x + 35, y };
    }
    lines.push(`; pad finished near X${formatNumber(current.x)} Y${formatNumber(current.y)}`);
  }

  lines.push(...buildCalibrationFooter(ctx));
  return `${lines.join('\n')}\n`;
}

export function generateDimensionalAccuracyGCode(
  printer: PrinterProfile,
  material: MaterialProfile,
  print: PrintProfile,
): string {
  const ctx = { printer, material, print };
  const layerHeight = Math.max(print.layerHeight, 0.05);
  const totalLayers = Math.max(1, Math.round(10 / layerHeight));
  const feedPrint = speed(print, 'outerWallSpeed', print.printSpeed);
  const feedTravel = speed(print, 'travelSpeed', 150);
  const lineWidth = print.outerWallLineWidth ?? print.lineWidth ?? 0.4;
  const lines = buildCalibrationHeader('Dimensional Accuracy Gauge', ctx, [
    'Includes 20mm, 40mm, and 60mm reference squares for XY scale checks.',
  ]);
  const writer = new RelativeExtrusionWriter(lines, ctx);
  const squares = [
    { min: { x: 20, y: 55 }, max: { x: 40, y: 75 } },
    { min: { x: 60, y: 45 }, max: { x: 100, y: 85 } },
    { min: { x: 120, y: 35 }, max: { x: 180, y: 95 } },
  ];
  let current = { x: squares[0].min.x, y: squares[0].min.y };

  lines.push('G92 E0');
  for (let layer = 0; layer < totalLayers; layer += 1) {
    const activeLayerHeight = layer === 0 ? print.firstLayerHeight : layerHeight;
    writer.moveZ(print.firstLayerHeight + layer * layerHeight, feedTravel);
    lines.push(`; layer ${layer + 1}/${totalLayers}`);
    for (const square of squares) {
      writer.travel(square.min.x, square.min.y, feedTravel);
      current = drawRect(writer, square.min, square.min, square.max, lineWidth, activeLayerHeight, feedPrint);
    }
  }

  lines.push(`; final cursor X${formatNumber(current.x)} Y${formatNumber(current.y)}`);
  lines.push(...buildCalibrationFooter(ctx));
  return `${lines.join('\n')}\n`;
}

export function generateInputShaperTowerGCode(
  printer: PrinterProfile,
  material: MaterialProfile,
  print: PrintProfile,
): string {
  const ctx = { printer, material, print };
  const layerHeight = Math.max(print.layerHeight, 0.05);
  const layersPerBand = Math.max(1, Math.round(6 / layerHeight));
  const accelerations = [1000, 2000, 3000, 4000, 5000, 6000];
  const totalLayers = layersPerBand * accelerations.length;
  const feedPrint = speed(print, 'outerWallSpeed', print.printSpeed);
  const feedTravel = speed(print, 'travelSpeed', 150);
  const lineWidth = print.outerWallLineWidth ?? print.lineWidth ?? 0.4;
  const lines = buildCalibrationHeader('Input Shaper Acceleration Tower', ctx, [
    'Acceleration changes by band. Pick the highest band without ringing.',
  ]);
  const writer = new RelativeExtrusionWriter(lines, ctx);
  const min = { x: 70, y: 120 };
  const max = { x: 110, y: 145 };
  let current = { ...min };
  let activeAcceleration = accelerations[0];

  lines.push(`M204 P${activeAcceleration} T${activeAcceleration}`);
  lines.push('G92 E0');
  writer.travel(current.x, current.y, feedTravel);

  for (let layer = 0; layer < totalLayers; layer += 1) {
    const band = Math.min(accelerations.length - 1, Math.floor(layer / layersPerBand));
    const nextAcceleration = accelerations[band];
    if (nextAcceleration !== activeAcceleration) {
      activeAcceleration = nextAcceleration;
      lines.push(`; switch acceleration to ${activeAcceleration} mm/s^2`);
      lines.push(`M204 P${activeAcceleration} T${activeAcceleration}`);
    }
    const activeLayerHeight = layer === 0 ? print.firstLayerHeight : layerHeight;
    writer.moveZ(print.firstLayerHeight + layer * layerHeight, feedTravel);
    current = drawRect(writer, current, min, max, lineWidth, activeLayerHeight, feedPrint);
  }

  if (print.accelerationPrint) lines.push(`M204 P${formatNumber(print.accelerationPrint, 0)}`);
  lines.push(...buildCalibrationFooter(ctx));
  return `${lines.join('\n')}\n`;
}

export function generatePressureAdvanceTowerGCode(
  printer: PrinterProfile,
  material: MaterialProfile,
  print: PrintProfile,
): string {
  const ctx = { printer, material, print };
  const layerHeight = Math.max(print.layerHeight, 0.05);
  const layersPerBand = Math.max(1, Math.round(6 / layerHeight));
  const values = [0, 0.02, 0.04, 0.06, 0.08, 0.1];
  const totalLayers = layersPerBand * values.length;
  const feedPrint = speed(print, 'outerWallSpeed', print.printSpeed);
  const feedTravel = speed(print, 'travelSpeed', 150);
  const lineWidth = print.outerWallLineWidth ?? print.lineWidth ?? 0.4;
  const lines = buildCalibrationHeader('Pressure Advance Tower', ctx, [
    'Pressure advance changes by band. Choose the sharpest corner with no bulge or gap.',
  ]);
  const writer = new RelativeExtrusionWriter(lines, ctx);
  const min = { x: 130, y: 120 };
  const max = { x: 170, y: 145 };
  let current = { ...min };
  let activeValue = values[0];

  lines.push(pressureAdvanceCommand(printer, activeValue));
  lines.push('G92 E0');
  writer.travel(current.x, current.y, feedTravel);

  for (let layer = 0; layer < totalLayers; layer += 1) {
    const band = Math.min(values.length - 1, Math.floor(layer / layersPerBand));
    const nextValue = values[band];
    if (nextValue !== activeValue) {
      activeValue = nextValue;
      lines.push(`; switch pressure advance to ${activeValue}`);
      lines.push(pressureAdvanceCommand(printer, activeValue));
    }
    const activeLayerHeight = layer === 0 ? print.firstLayerHeight : layerHeight;
    writer.moveZ(print.firstLayerHeight + layer * layerHeight, feedTravel);
    current = drawRect(writer, current, min, max, lineWidth, activeLayerHeight, feedPrint);
  }

  lines.push(pressureAdvanceCommand(printer, 0));
  lines.push(...buildCalibrationFooter(ctx));
  return `${lines.join('\n')}\n`;
}
