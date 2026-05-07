import type { MaterialProfile, PrintProfile, PrinterProfile } from '../../types/slicer';
import {
  bandValueAtLayer,
  buildCalibrationFooter,
  buildCalibrationHeader,
  formatNumber,
  makeBands,
  RelativeExtrusionWriter,
} from './common';

/**
 * Max volumetric speed (MVS) tower G-code generator.
 *
 * Prints a hollow square tube tower where the outer-wall feedrate increases every
 * `bandHeightMm` mm so that the target volumetric speed increments by 2 mm³/s per
 * band.  The operator looks for the height band where surface quality degrades
 * (under-extrusion, layer separation, or audible grinding) and uses the band
 * below as the max volumetric speed for the material profile.
 *
 * Klipper note: For Klipper firmware a `TUNING_TOWER` command is also prepended
 * so that the velocity limit tracks the tower height automatically when the G-code
 * is run via the Klipper API.  The manual feedrate steps that follow are still
 * present and correct for non-TUNING_TOWER use; Klipper ignores them because
 * `TUNING_TOWER` takes precedence.
 *
 * Shape: 30×30 mm footprint, single outer perimeter (1.2 mm line width), open
 * top.  Dimensions chosen to keep the test short (~60 min) while providing clear
 * surface quality bands.
 *
 * @param startVolMmCubed  Starting vol speed in mm³/s (default 5)
 * @param stepVolMmCubed   Vol speed increment per band in mm³/s (default 2)
 * @param bandCount        Number of speed bands (default 10 → up to 23 mm³/s)
 * @param bandHeightMm     Physical height of each band in mm (default 5)
 */
export function generateMaxVolumetricSpeedGCode(
  printer: PrinterProfile,
  material: MaterialProfile,
  print: PrintProfile,
  startVolMmCubed = 5,
  stepVolMmCubed  = 2,
  bandCount       = 10,
  bandHeightMm    = 5,
): string {
  const ctx = { printer, material, print };

  const layerHeight   = Math.max(print.layerHeight, 0.05);
  const firstLayerH   = Math.min(Math.max(print.firstLayerHeight, 0.05), layerHeight * 2);
  const lineWidth     = print.outerWallLineWidth ?? print.lineWidth ?? printer.nozzleDiameter;
  const feedTravel    = print.travelSpeed * 60;
  // Base print feedrate (mm/min) — used only for the first layer (adhesion speed)
  const feedFirstLayer = Math.min(print.firstLayerSpeed, print.outerWallSpeed) * 60;

  // Cross-sectional area of a single extrusion line (mm²)
  const lineCrossSection = lineWidth * layerHeight;

  // Build vol-speed bands
  const volSpeeds = Array.from({ length: bandCount }, (_, i) =>
    startVolMmCubed + i * stepVolMmCubed,
  );

  const layersPerBand = Math.max(1, Math.round(bandHeightMm / layerHeight));
  const totalLayers   = totalLayerCount(firstLayerH, layerHeight, bandHeightMm, bandCount);
  const bands         = makeBands(volSpeeds, layersPerBand);

  // Tower footprint: 30×30 mm square tube with 1.2 mm walls (single outer wall)
  const min = { x: 85, y: 85 };
  const max = { x: 115, y: 115 };

  // -------------------------------------------------------------------------
  // Build output
  // -------------------------------------------------------------------------
  const endVol   = startVolMmCubed + (bandCount - 1) * stepVolMmCubed;
  const lines    = buildCalibrationHeader('Max Volumetric Speed Tower', ctx, [
    `Volumetric speed increases from ${startVolMmCubed} to ${endVol} mm³/s in ${stepVolMmCubed} mm³/s steps.`,
    `Each ${bandHeightMm} mm band = one speed step.  Find the band where quality fails.`,
    `Line width: ${formatNumber(lineWidth)} mm  |  Layer height: ${formatNumber(layerHeight)} mm`,
  ]);
  const writer = new RelativeExtrusionWriter(lines, ctx);

  // Klipper TUNING_TOWER for automatic velocity stepping
  if (printer.gcodeFlavorType === 'klipper') {
    // Compute velocity (mm/s) from vol speed: v = vol / crossSection
    const startVelocity = startVolMmCubed / lineCrossSection;
    const stepVelocity  = stepVolMmCubed  / lineCrossSection;
    // TUNING_TOWER steps every bandHeightMm mm
    lines.push('; Klipper TUNING_TOWER — velocity steps every band');
    lines.push(
      `TUNING_TOWER COMMAND=SET_VELOCITY_LIMIT PARAMETER=VELOCITY` +
      ` START=${formatNumber(startVelocity, 2)}` +
      ` STEP_DELTA=${formatNumber(stepVelocity, 2)}` +
      ` STEP_HEIGHT=${formatNumber(bandHeightMm)}`,
    );
  }

  lines.push('G92 E0 ; reset extruder');

  let current        = { x: min.x, y: min.y };
  let activeVolSpeed = -1; // force first emit

  writer.travel(min.x, min.y, feedTravel);

  for (let layer = 0; layer < totalLayers; layer++) {
    const z               = layer === 0 ? firstLayerH : firstLayerH + layer * layerHeight;
    const activeLayerH    = layer === 0 ? firstLayerH : layerHeight;
    const targetVol       = bandValueAtLayer(bands, layer);
    // Feedrate (mm/min) for this band — first layer uses adhesion speed
    const feedPrint       = layer === 0
      ? feedFirstLayer
      : (targetVol / lineCrossSection) * 60;

    writer.moveZ(z, feedTravel);

    if (targetVol !== activeVolSpeed) {
      activeVolSpeed = targetVol;
      const targetFeedMmS = targetVol / lineCrossSection;
      lines.push(
        `; === vol speed ${formatNumber(targetVol, 0)} mm³/s → F${formatNumber(targetFeedMmS, 1)} mm/s ===`,
      );
      // Non-Klipper firmware: manually emit feedrate for non-TUNING_TOWER path
      if (printer.gcodeFlavorType !== 'klipper') {
        // M220 sets a speed-factor override — easier than changing G1 feedrate mid-print
        // Alternatively we rely on G1 Fxxx being set per move (handled by feedPrint above)
        lines.push(`; feedrate will be set via G1 F${formatNumber(feedPrint, 0)} on print moves`);
      }
    }

    lines.push(`; layer ${layer + 1}/${totalLayers}`);

    const path = [
      { x: max.x, y: min.y },
      { x: max.x, y: max.y },
      { x: min.x, y: max.y },
      { x: min.x, y: min.y },
    ];
    for (const next of path) {
      writer.extrudeTo(current, next, lineWidth, activeLayerH, feedPrint);
      current = next;
    }
  }

  // Restore velocity limit on Klipper
  if (printer.gcodeFlavorType === 'klipper') {
    lines.push(`SET_VELOCITY_LIMIT VELOCITY=${formatNumber(printer.maxSpeed, 0)} ; restore`);
  }

  lines.push(...buildCalibrationFooter(ctx));
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Total layer count for a tower of `bandCount × bandHeightMm` total height,
 * accounting for the first-layer height being different from subsequent layers.
 */
function totalLayerCount(
  firstLayerH: number,
  layerH: number,
  bandHeightMm: number,
  bandCount: number,
): number {
  const targetHeight = bandHeightMm * bandCount;
  if (targetHeight <= firstLayerH) return 1;
  return 1 + Math.ceil((targetHeight - firstLayerH) / layerH);
}
