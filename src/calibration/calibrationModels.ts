import dimensionalAccuracyUrl from '../../assets/calibration-models/dimensional-accuracy.stl?url';
import firmwareHealthUrl from '../../assets/calibration-models/firmware-health.stl?url';
import firstLayerUrl from '../../assets/calibration-models/first-layer.stl?url';
import flowRateUrl from '../../assets/calibration-models/flow-rate.stl?url';
import inputShaperUrl from '../../assets/calibration-models/input-shaper.stl?url';
import maxVolumetricSpeedUrl from '../../assets/calibration-models/max-volumetric-speed.stl?url';
import pressureAdvanceUrl from '../../assets/calibration-models/pressure-advance.stl?url';
import retractionUrl from '../../assets/calibration-models/retraction.stl?url';
import temperatureTowerUrl from '../../assets/calibration-models/temperature-tower.stl?url';

export type CalibrationModelEntry = {
  id: string;
  testType: string;
  filename: string;
  baseDimMm: number;
  baseNozzleDiameter: number;
  baseLayerHeight: number;
  description: string;
};

export type CalibrationModelScale = {
  nozzleScale: number;
  layerScale: number;
  uniformScale: number;
};

// ── Model attributions ────────────────────────────────────────────────────────
// firmware-health    : Voron Design Cube v7 — VoronDesign/Voron-2 (GPL v3)
// input-shaper       : Klipper ringing_tower.stl — Klipper3d/klipper (GPL v3)
// pressure-advance   : Klipper square_tower.stl  — Klipper3d/klipper (GPL v3)
// dimensional-accuracy: CaliStar 100×2mm — dirtdigger/fleur_de_cali (GPL v3)
// temperature-tower  : Teaching Tech Temperature Tower v2 — teachingtechyt.github.io/calibration.html
// All others         : Original geometry generated for DesignCAD

const calibrationModels: CalibrationModelEntry[] = [
  {
    id: 'firmware-health',
    testType: 'firmware-health',
    filename: 'firmware-health.stl',
    baseDimMm: 30,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    // Voron Design Cube v7: 30×30×30mm with flat walls and sharp corners
    // that clearly show ringing, layer quality, and dimensional accuracy
    description: 'Voron Design Cube v7 (30mm). Flat walls reveal ringing, layer adhesion, extrusion quality, and surface finish in a single ~10 min print.',
  },
  {
    id: 'first-layer',
    testType: 'first-layer',
    filename: 'first-layer.stl',
    baseDimMm: 120,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    // 120×120×0.3mm flat patch — single layer at 0.2mm height.
    // Large enough to sample mesh levelling variation across the plate.
    description: 'Single-layer 120×120mm patch. Peel off and inspect squish uniformly across the plate; adjust Z offset until the surface is smooth with no gaps or ridges.',
  },
  {
    id: 'flow-rate',
    testType: 'flow-rate',
    filename: 'flow-rate.stl',
    baseDimMm: 30,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    // 30×30×3mm flat cube — Ellis top-surface extrusion multiplier method.
    // Print several copies at 1% EM increments; pick the smoothest top surface.
    description: '30×30×3mm flat cube (Ellis EM method). Print multiple copies at different flow-rate modifiers and choose the one with the smoothest top surface by touch.',
  },
  {
    id: 'temperature-tower',
    testType: 'temperature-tower',
    filename: 'temperature-tower.stl',
    baseDimMm: 41,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    // Teaching Tech Temperature Tower v2 — 5-band compact tower, 41 mm tall.
    // 60×10×41 mm; 1 mm solid base then 5 bands (each 7.5 mm geometry + 0.5 mm gap).
    // Band boundaries: Z 1, 9, 17, 25, 33 mm.
    // M104 injected 1 mm before each band: Z 0, 8, 16, 24, 32 mm (10°C per band for PLA).
    // Source: https://teachingtechyt.github.io/calibration.html
    description: 'Teaching Tech tower v2 (5 bands, 41mm). Each ~8mm band tests overhangs, bridging, and layer adhesion — the post-processor steps temperature 10°C per band automatically (e.g. 220→180°C for PLA).',
  },
  {
    id: 'retraction',
    testType: 'retraction',
    filename: 'retraction.stl',
    baseDimMm: 60,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    // Two ⌀5mm posts, 40mm apart on a 60×10mm base — classic stringing test.
    // Travel moves between the posts expose stringing. Iterate retraction distance
    // and speed until strings disappear.
    description: 'Two-post stringing test (60mm base). Travel moves between the ⌀5mm posts expose stringing; reduce retraction distance until strings disappear, then find the minimum that works.',
  },
  {
    id: 'pressure-advance',
    testType: 'pressure-advance',
    filename: 'pressure-advance.stl',
    baseDimMm: 66,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    // Klipper square_tower.stl: 66×66×50mm hollow square tower.
    // Official Klipper PA tower method — print with SET_VELOCITY_LIMIT
    // SQUARE_CORNER_VELOCITY=1 and PRESSURE_ADVANCE_SMOOTH_TIME=0.040
    description: 'Klipper square_tower (66×66×50mm). Print with increasing PA values per height band using Klipper\'s TUNING_TOWER command; clean 90° corners indicate the correct value.',
  },
  {
    id: 'input-shaper',
    testType: 'input-shaper',
    filename: 'input-shaper.stl',
    baseDimMm: 120,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    // Klipper ringing_tower.stl: 120×120×60mm L-shape.
    // One wall tests X-axis ringing; the perpendicular wall tests Y-axis ringing.
    // Print at 80–100mm/s external perimeter, 1–2 perimeters, 0 top/bottom layers.
    description: 'Klipper ringing tower (120×120×60mm L-shape). One wall isolates X-axis ringing; the other Y-axis. Count the bands and use the Klipper resonance frequency formula to find the correct shaper frequency.',
  },
  {
    id: 'dimensional-accuracy',
    testType: 'dimensional-accuracy',
    filename: 'dimensional-accuracy.stl',
    baseDimMm: 108,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    // CaliStar 100×2mm (dirtdigger/fleur_de_cali): star-shaped, 108mm tip-to-tip, 4mm tall.
    // Measure paired inner + outer dimensions on each axis; the paired approach
    // cancels elephant-foot and over-extrusion errors that fool a plain 20mm cube.
    description: 'CaliStar 100×2mm (108mm tip-to-tip). Measure paired inner+outer dimensions on X and Y; the star geometry cancels elephant-foot distortion. Feed results into the companion spreadsheet to get XY scale correction values.',
  },
  {
    id: 'max-volumetric-speed',
    testType: 'max-volumetric-speed',
    filename: 'max-volumetric-speed.stl',
    baseDimMm: 40,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    // 40×40×80mm hollow square tube — print in vase/spiralise mode.
    // Ramp print speed from 30 mm/s to 150 mm/s over the 80mm height using
    // TUNING_TOWER or a custom slicer script; the layer where walls go rough
    // marks max reliable volumetric flow.
    description: '40×40×80mm open-top tube (vase mode). Ramp print speed from slow to fast over the 80mm height; the layer where walls become rough or gaps appear marks the maximum reliable volumetric speed for this filament.',
  },
];

const modelUrls: Record<string, string> = {
  'dimensional-accuracy.stl': dimensionalAccuracyUrl,
  'firmware-health.stl': firmwareHealthUrl,
  'first-layer.stl': firstLayerUrl,
  'flow-rate.stl': flowRateUrl,
  'input-shaper.stl': inputShaperUrl,
  'max-volumetric-speed.stl': maxVolumetricSpeedUrl,
  'pressure-advance.stl': pressureAdvanceUrl,
  'retraction.stl': retractionUrl,
  'temperature-tower.stl': temperatureTowerUrl,
};

/** Keyed by the bare id (no extension) for easy lookup from PRESETS. */
export const CALIBRATION_STL_URLS: Record<string, string> = {
  'dimensional-accuracy': dimensionalAccuracyUrl,
  'firmware-health': firmwareHealthUrl,
  'first-layer': firstLayerUrl,
  'flow-rate': flowRateUrl,
  'input-shaper': inputShaperUrl,
  'max-volumetric-speed': maxVolumetricSpeedUrl,
  'pressure-advance': pressureAdvanceUrl,
  'retraction': retractionUrl,
  'temperature-tower': temperatureTowerUrl,
};

export function getCalibrationModels(): CalibrationModelEntry[] {
  return calibrationModels.map((entry) => ({ ...entry }));
}

export function getModelScale(
  entry: CalibrationModelEntry,
  nozzleDiameter: number,
  layerHeight: number,
): CalibrationModelScale {
  const nozzleScale = nozzleDiameter / entry.baseNozzleDiameter;
  const layerScale = layerHeight / entry.baseLayerHeight;

  return {
    nozzleScale,
    layerScale,
    uniformScale: Math.sqrt(nozzleScale * layerScale),
  };
}

export function getModelUrl(entry: CalibrationModelEntry): string {
  const url = modelUrls[entry.filename];
  if (!url) {
    throw new Error(`Missing calibration model URL for ${entry.filename}`);
  }

  return url;
}
