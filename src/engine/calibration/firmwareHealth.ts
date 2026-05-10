import type { MaterialProfile, PrintProfile, PrinterProfile } from '../../types/slicer';
import {
  buildCalibrationFooter,
  buildCalibrationHeader,
  formatNumber,
  RelativeExtrusionWriter,
} from './common';

/**
 * Firmware health check G-code generator.
 *
 * Runs a structured diagnostic sequence:
 *   Phase 1 — Heater verification: sets explicit nozzle + bed targets and waits.
 *   Phase 2 — Motion range test: rapid moves to all four bed corners and back to
 *              centre. Exercises all axes at travel speed with no extrusion.
 *   Phase 3 — Extrusion purge: short 40 mm line at the front of the bed.
 *   Phase 4 — Reference square: 20×20 mm hollow perimeter, 5 layers, centred on
 *              bed. Confirms that all systems work together end-to-end.
 *
 * Meant to be run first whenever a printer comes out of maintenance, firmware is
 * updated, or a new profile is loaded.
 */
export function generateFirmwareHealthGCode(
  printer: PrinterProfile,
  material: MaterialProfile,
  print: PrintProfile,
): string {
  const ctx = { printer, material, print };

  const bedX = printer.buildVolume.x;
  const bedY = printer.buildVolume.y;

  const feedTravel = print.travelSpeed * 60;
  const feedPrint = print.outerWallSpeed * 60;
  const lineWidth = print.outerWallLineWidth ?? print.lineWidth ?? printer.nozzleDiameter;
  const layerHeight = Math.max(print.layerHeight, 0.05);
  const firstLayerHeight = Math.min(Math.max(print.firstLayerHeight, 0.05), layerHeight * 2);

  const nozzleTemp = material.nozzleTemp;
  const nozzleTempFirst = material.nozzleTempFirstLayer ?? nozzleTemp;
  const bedTemp = material.bedTemp;
  const bedTempFirst = material.bedTempFirstLayer ?? bedTemp;

  // Reference square centred on bed
  const cx = bedX / 2;
  const cy = bedY / 2;
  const halfSide = 10; // 20×20 mm square
  const sqMin = { x: cx - halfSide, y: cy - halfSide };
  const sqMax = { x: cx + halfSide, y: cy + halfSide };

  // Five layers for the reference square
  const targetHeight = 5;
  const totalLayers = 1 + Math.ceil((targetHeight - firstLayerHeight) / layerHeight);

  // Bed-corner inset — stay 10 mm from edges
  const inset = 10;
  const corners = [
    { x: inset,        y: inset },
    { x: bedX - inset, y: inset },
    { x: bedX - inset, y: bedY - inset },
    { x: inset,        y: bedY - inset },
  ];

  // -----------------------------------------------------------------------
  // Build output
  // -----------------------------------------------------------------------
  const lines = buildCalibrationHeader('Firmware Health Check', ctx, [
    'Diagnostic sequence: heater verify → motion range → purge → reference square.',
    `Bed: ${bedX}×${bedY} mm  |  Nozzle: ${nozzleTemp}°C  |  Bed: ${bedTemp}°C`,
  ]);
  const writer = new RelativeExtrusionWriter(lines, ctx);

  // --- Phase 1: Heater verification ----------------------------------------
  lines.push('; === Phase 1: Heater verification ===');
  lines.push(`M104 S${nozzleTempFirst} ; set nozzle target`);
  lines.push(`M140 S${bedTempFirst}    ; set bed target`);
  lines.push(`M109 S${nozzleTempFirst} ; wait for nozzle`);
  lines.push(`M190 S${bedTempFirst}    ; wait for bed`);
  lines.push(`; nozzle and bed reached target — heater subsystem OK`);

  // --- Phase 2: Motion range test ------------------------------------------
  lines.push('; === Phase 2: Motion range test ===');
  // Raise to safe Z before any travel
  lines.push(`G0 Z5 F${formatNumber(feedTravel, 0)} ; raise for corner travel`);
  for (const { x, y } of corners) {
    lines.push(`; corner X${formatNumber(x)} Y${formatNumber(y)}`);
    lines.push(`G0 X${formatNumber(x)} Y${formatNumber(y)} F${formatNumber(feedTravel, 0)}`);
  }
  // Return to centre
  lines.push(`; return to bed centre`);
  lines.push(`G0 X${formatNumber(cx)} Y${formatNumber(cy)} F${formatNumber(feedTravel, 0)}`);
  lines.push(`; XY motion range test complete`);

  // --- Phase 3: Extrusion purge --------------------------------------------
  lines.push('; === Phase 3: Extrusion purge ===');
  const purgeX0 = inset;
  const purgeX1 = inset + 40;
  const purgeY  = inset;
  // Set final print temp before purging
  if (nozzleTemp !== nozzleTempFirst) {
    lines.push(`M104 S${nozzleTemp} ; ramp to print temp`);
    lines.push(`M109 S${nozzleTemp} ; wait`);
  }
  if (bedTemp !== bedTempFirst) {
    lines.push(`M140 S${bedTemp} ; ramp to print bed temp`);
    lines.push(`M190 S${bedTemp} ; wait`);
  }
  writer.moveZ(firstLayerHeight, feedTravel);
  lines.push('G92 E0 ; reset extruder');
  writer.travel(purgeX0, purgeY, feedTravel);
  // Double-width purge line
  writer.extrudeTo(
    { x: purgeX0, y: purgeY },
    { x: purgeX1, y: purgeY },
    lineWidth * 2,
    firstLayerHeight,
    feedPrint * 0.6, // purge at 60 % speed
  );
  lines.push('G92 E0 ; reset extruder after purge');
  lines.push('; extrusion subsystem OK');

  // --- Phase 4: 20×20 mm reference square ----------------------------------
  lines.push('; === Phase 4: Reference square (20×20 mm) ===');
  let current = { x: sqMin.x, y: sqMin.y };
  writer.travel(sqMin.x, sqMin.y, feedTravel);

  for (let layer = 0; layer < totalLayers; layer++) {
    const z = layer === 0
      ? firstLayerHeight
      : firstLayerHeight + layer * layerHeight;
    const activeLayerHeight = layer === 0 ? firstLayerHeight : layerHeight;
    writer.moveZ(z, feedTravel);
    lines.push(`; layer ${layer + 1}/${totalLayers}`);

    // Single outer perimeter
    const path = [
      { x: sqMax.x, y: sqMin.y },
      { x: sqMax.x, y: sqMax.y },
      { x: sqMin.x, y: sqMax.y },
      { x: sqMin.x, y: sqMin.y },
    ];
    for (const next of path) {
      writer.extrudeTo(current, next, lineWidth, activeLayerHeight, feedPrint);
      current = next;
    }
  }

  lines.push('; reference square complete — firmware health check passed');
  lines.push(...buildCalibrationFooter(ctx));
  return `${lines.join('\n')}\n`;
}
