/**
 * Per-calibration-test slice settings presets.
 *
 * Each preset specifies the print-profile and material-profile patches to apply
 * automatically when the user reaches the Slice Preview step.  Only the keys
 * that actually matter for the specific test are included — the rest are left
 * at the user's current values.
 *
 * The keys in `print` and `material` are used to identify which settings rows
 * should be highlighted in the UI.
 *
 * `layerProcessors` inside `print` are the post-processing scripts that should
 * run for this specific calibration test.  They are applied as part of the
 * print-profile patch and restored on undo alongside the other settings.
 */

import type { PrintProfile, MaterialProfile } from '../types/slicer';
import type { LayerProcessor } from '../types/slicer/profiles/print';

// ── Pressure-advance drive-type presets ───────────────────────────────────────
//
// Source references:
//   Klipper docs    : factor=0.0025/mm (DD) → 0–0.25 over 100 mm
//                     factor=0.025/mm (Bowden) → 0–2.5 over 100 mm
//   Ellis3DP guide  : same factors; practical landing zones ~0.02–0.07 (DD),
//                     ~0.4–1.0 (Bowden)
//   OrcaSlicer wiki : increment 0.002/mm (DD), 0.020/mm (Bowden)
//
// Our tower runs Z 3–50 mm (47 effective mm, 5 mm steps = 9 bands).
// Band width = (end - start) / 9  →  ~0.011 per band (DD), ~0.111 per band (Bowden).

export type PaDriveType = 'direct-drive' | 'bowden' | 'custom';

export type PaDrivePreset = {
  label:       string;
  description: string;
  startValue:  number;   // PA at Z=tuningStartZ
  endValue:    number;   // PA at Z=tuningEndZ
  stepSize:    number;   // mm between injection points
};

/**
 * Pre-configured PA ranges by extruder/drive type.
 * These match industry-consensus sweep widths from Klipper, Ellis, and OrcaSlicer.
 */
export const PA_DRIVE_PRESETS = {
  'direct-drive': {
    label:       'Direct drive',
    description: 'Voron, BMG, Orbiter, Prusa MK3, Bambu — typical PA 0.02–0.07',
    startValue:  0,
    endValue:    0.1,
    stepSize:    5,
  },
  'bowden': {
    label:       'Bowden',
    description: 'Bowden tube — Ender 3, CR-10, Neptune, Artillery — typical PA 0.4–1.0',
    startValue:  0,
    endValue:    1.0,
    stepSize:    5,
  },
} satisfies Record<Exclude<PaDriveType, 'custom'>, PaDrivePreset>;

/**
 * Returns the drive-type key if the given start/end/step exactly match a preset,
 * otherwise returns `'custom'`.
 */
export function detectPaDriveType(
  startValue: number,
  endValue: number,
  stepSize: number,
): PaDriveType {
  for (const [type, p] of Object.entries(PA_DRIVE_PRESETS)) {
    if (
      Math.abs(startValue - p.startValue) < 0.0001 &&
      Math.abs(endValue   - p.endValue)   < 0.0001 &&
      Math.abs(stepSize   - p.stepSize)   < 0.01
    ) {
      return type as PaDriveType;
    }
  }
  return 'custom';
}

export type CalibrationSlicePreset = {
  /** Patch applied to the active PrintProfile (may include layerProcessors). */
  print: Partial<PrintProfile>;
  /** Patch applied to the active MaterialProfile. */
  material: Partial<MaterialProfile>;
  /** Human-readable rationale shown in the banner. */
  rationale: string;
  /**
   * Per-processor description shown in the Slice Preview settings panel.
   * Keys match the `id` field of processors inside `print.layerProcessors`.
   */
  processorNotes?: Record<string, { title: string; detail: string; hint?: string }>;
};

// ── Filament + nozzle context passed to getCalibrationSlicePreset ─────────────

export type CalibrationFilament = {
  /** Filament material string, e.g. 'PLA', 'PETG', 'ABS'. Case-sensitive to match Spool.material. */
  material: string;
  /** Active nozzle diameter in mm, e.g. 0.4, 0.6, 0.8. */
  nozzleDiameterMm: number;
};

// ── Per-material configuration ────────────────────────────────────────────────

type MaterialConfig = {
  /** [tuningStartValue, tuningEndValue] for temperature-tower processors. */
  tempTowerRange: [number, number];
  /** Whether cooling fan should be active during the print. */
  fanEnabled: boolean;
  /** Fan minimum speed % (0–100). */
  fanMin: number;
  /** Fan maximum speed % (0–100). */
  fanMax: number;
  /**
   * Multiply all speed settings the preset explicitly sets (printSpeed,
   * outerWallSpeed, firstLayerSpeed, travelSpeed).
   * 1.0 = no change.  TPU needs ~0.35; engineering materials ~0.85–0.9.
   */
  speedFactor: number;
};

/**
 * Per-material adjustments layered on top of the test-specific base preset.
 * Keys are the canonical material strings used in Spool.material.
 */
const MATERIAL_CONFIGS: Record<string, MaterialConfig> = {
  'PLA':    { tempTowerRange: [220, 180], fanEnabled: true,  fanMin: 25, fanMax: 100, speedFactor: 1.00 },
  'PLA+':   { tempTowerRange: [220, 180], fanEnabled: true,  fanMin: 25, fanMax: 100, speedFactor: 1.00 },
  'PETG':   { tempTowerRange: [250, 225], fanEnabled: true,  fanMin: 15, fanMax:  50, speedFactor: 0.85 },
  'ABS':    { tempTowerRange: [255, 225], fanEnabled: false, fanMin:  0, fanMax:  15, speedFactor: 0.90 },
  'ASA':    { tempTowerRange: [260, 230], fanEnabled: false, fanMin:  0, fanMax:  20, speedFactor: 0.90 },
  'TPU':    { tempTowerRange: [230, 210], fanEnabled: true,  fanMin: 25, fanMax:  50, speedFactor: 0.35 },
  'PC':     { tempTowerRange: [290, 265], fanEnabled: false, fanMin:  0, fanMax:  15, speedFactor: 0.80 },
  'Nylon':  { tempTowerRange: [270, 245], fanEnabled: false, fanMin:  0, fanMax:  20, speedFactor: 0.85 },
};

const DEFAULT_MATERIAL_CONFIG: MaterialConfig =
  { tempTowerRange: [220, 180], fanEnabled: true, fanMin: 25, fanMax: 100, speedFactor: 1.00 };

function getMaterialConfig(material: string): MaterialConfig {
  // Normalise common aliases
  const key = material.toUpperCase();
  for (const [k, v] of Object.entries(MATERIAL_CONFIGS)) {
    if (k.toUpperCase() === key) return v;
  }
  return DEFAULT_MATERIAL_CONFIG;
}

/**
 * Apply material + nozzle overrides to a base preset.
 * Rules:
 *   - Fan: if material requires fan OFF, always disable (safety for ABS/ASA/PC).
 *          If material allows fan, respect the preset's coolingFanEnabled.
 *   - Fan speeds: always written to the material profile patch.
 *   - Speeds: multiplied only for keys the preset already sets.
 *   - Temp tower: tuningStartValue/End always replaced for temperature processors.
 *   - Layer/line widths: scaled by (nozzle / 0.4) for keys the preset explicitly sets.
 */
function applyFilamentOverrides(
  base: CalibrationSlicePreset,
  filament: CalibrationFilament,
): CalibrationSlicePreset {
  const cfg = getMaterialConfig(filament.material);
  const nozzle = filament.nozzleDiameterMm;
  const nozzleScale = nozzle / 0.4;

  const print = { ...base.print };
  const material = { ...base.material };

  // ── Fan ────────────────────────────────────────────────────────────────────
  // Only force-disable fan when the material requires it; never force-enable.
  if (!cfg.fanEnabled && 'coolingFanEnabled' in print) {
    print.coolingFanEnabled = false;
  }
  // Fan speed range is always written so the slicer uses appropriate values.
  material.fanSpeedMin = cfg.fanMin;
  material.fanSpeedMax = cfg.fanMax;

  // ── Speeds ─────────────────────────────────────────────────────────────────
  if (cfg.speedFactor !== 1.0) {
    const scale = (v: number | undefined) =>
      v !== undefined ? Math.round(v * cfg.speedFactor) : undefined;
    if (print.printSpeed      !== undefined) print.printSpeed      = scale(print.printSpeed)!;
    if (print.outerWallSpeed  !== undefined) print.outerWallSpeed  = scale(print.outerWallSpeed)!;
    if (print.firstLayerSpeed !== undefined) print.firstLayerSpeed = scale(print.firstLayerSpeed)!;
    if (print.travelSpeed     !== undefined) print.travelSpeed     = scale(print.travelSpeed)!;
  }

  // ── Temperature tower: replace ramp range ─────────────────────────────────
  if (print.layerProcessors) {
    print.layerProcessors = print.layerProcessors.map((proc) =>
      proc.kind === 'tuning-tower' && proc.tuningParameter === 'temperature'
        ? { ...proc, tuningStartValue: cfg.tempTowerRange[0], tuningEndValue: cfg.tempTowerRange[1] }
        : proc,
    );
  }

  // ── Nozzle: scale layer heights + line width where explicitly set ──────────
  if (nozzleScale !== 1.0) {
    const scaleLen = (v: number | undefined) =>
      v !== undefined ? parseFloat((v * nozzleScale).toFixed(2)) : undefined;
    if (print.layerHeight       !== undefined) print.layerHeight       = scaleLen(print.layerHeight)!;
    if (print.firstLayerHeight  !== undefined) print.firstLayerHeight  = scaleLen(print.firstLayerHeight)!;
    if (print.lineWidth         !== undefined) print.lineWidth         = scaleLen(print.lineWidth)!;
  }

  // ── Update processor notes to reflect the actual temp range ───────────────
  let processorNotes = base.processorNotes;
  if (processorNotes && print.layerProcessors) {
    processorNotes = { ...processorNotes };
    for (const proc of print.layerProcessors) {
      if (proc.kind === 'tuning-tower' && proc.tuningParameter === 'temperature' && processorNotes[proc.id]) {
        const [sv] = cfg.tempTowerRange;
        processorNotes = {
          ...processorNotes,
          [proc.id]: {
            ...processorNotes[proc.id],
            detail: `Injects M104 S### at Z 0, 8, 16, 24, 32 mm — stepping ${sv}→${sv - 8}→${sv - 16}→${sv - 24}→${sv - 32}°C (~8°C per band). Tests surface quality, stringing, bridging, and overhangs.`,
          },
        };
      }
    }
  }

  return { ...base, print, material, processorNotes };
}

const PRESETS: Record<string, CalibrationSlicePreset> = {

  // ── Flow rate (Ellis top-surface EM) — 30×30×3 mm cube ───────────────────
  //  Many top layers for a smooth surface to judge extrusion.
  //  Slow outer wall; no ironing (ironing masks EM errors).
  'flow-rate': {
    print: {
      topLayers:        5,
      bottomLayers:     4,
      wallCount:        4,
      infillDensity:    40,
      infillPattern:    'grid',
      printSpeed:       50,
      outerWallSpeed:   30,
      ironingEnabled:   false,
      coolingFanEnabled: true,
      supportEnabled:   false,
      adhesionType:     'skirt',
      spiralizeContour: false,
    },
    material: {},
    rationale: 'Optimised for top-surface quality inspection (Ellis EM method).',
  },

  // ── First layer — 120×120×0.3 mm patch ───────────────────────────────────
  //  Single layer at 0.2 mm; solid fill; slow first-layer speed; no fan.
  'first-layer': {
    print: {
      layerHeight:       0.2,
      firstLayerHeight:  0.2,
      topLayers:         0,
      bottomLayers:      1,
      wallCount:         0,
      infillDensity:     100,
      infillPattern:     'lines',
      printSpeed:        30,
      firstLayerSpeed:   20,
      coolingFanEnabled: false,
      supportEnabled:    false,
      adhesionType:      'none',
      spiralizeContour:  false,
    },
    material: {
      fanDisableFirstLayers: 5,
    },
    rationale: 'Single-layer patch: slow speed, solid fill, fan off for best first-layer adhesion.',
  },

  // ── Temperature tower — Teaching Tech v2, 41 mm tall, 5 bands ───────────
  //  60×10×41 mm tower with overhangs, bridges, and snap-off adhesion pyramids
  //  in each band. Prints in ~15–25 min; tests stringing, surface quality,
  //  bridging, and overhangs simultaneously.
  //
  //  STL band structure (parsed from geometry):
  //    Base:   Z  0.0 – 1.0 mm  (1 mm solid base)
  //    Band 1: Z  1.0 – 8.5 mm  (0.5 mm gap to next band)
  //    Band 2: Z  9.0 – 16.5 mm (0.5 mm gap)
  //    Band 3: Z 17.0 – 24.5 mm (0.5 mm gap)
  //    Band 4: Z 25.0 – 32.5 mm (0.5 mm gap)
  //    Band 5: Z 33.0 – 41.0 mm
  //
  //  M104 is injected 1 mm BEFORE each band starts so the nozzle reaches
  //  temperature by the time that band's geometry begins printing:
  //    Z  0 mm → band 1 temp  (fires during 1 mm base, band 1 starts at Z 1)
  //    Z  8 mm → band 2 temp  (fires 1 mm before band 2 starts at Z 9)
  //    Z 16 mm → band 3 temp  (fires 1 mm before band 3 starts at Z 17)
  //    Z 24 mm → band 4 temp  (fires 1 mm before band 4 starts at Z 25)
  //    Z 32 mm → band 5 temp  (fires 1 mm before band 5 starts at Z 33)
  //
  //  tuningEndZ=32 (not 40!) gives exactly 5 injection points with the 8 mm
  //  step, and makes t=0,0.25,0.5,0.75,1.0 → clean 10°C per band for PLA.
  //  Model: https://teachingtechyt.github.io/calibration.html (temperaturetowerv2.stl)
  'temperature-tower': {
    print: {
      topLayers:         3,
      bottomLayers:      3,
      wallCount:         2,
      infillDensity:     15,
      infillPattern:     'grid',
      printSpeed:        50,
      outerWallSpeed:    30,
      coolingFanEnabled: true,
      supportEnabled:    false,
      adhesionType:      'skirt',
      spiralizeContour:  false,
      layerProcessors:   [{
        id:                'calib-temp-ramp',
        enabled:           true,
        kind:              'tuning-tower',
        tuningParameter:   'temperature',
        tuningStartZ:      0,   // fires during the 1 mm base plate (nozzle ready for band 1)
        tuningEndZ:        32,  // 5 steps: 0,8,16,24,32 — stops before the Z=40 overshoot
        tuningStartValue:  220,
        tuningEndValue:    180,
        tuningStepSize:    8,   // each step fires 1 mm before the corresponding band starts
      } satisfies LayerProcessor],
    },
    material: {},
    rationale: 'Compact 5-band tower (41 mm, ~20 min) — each 8 mm band is 10°C cooler. Tests stringing, bridging, overhangs, and layer adhesion.',
    processorNotes: {
      'calib-temp-ramp': {
        title:  'Temperature ramp',
        detail: 'Injects M104 S### at Z 0, 8, 16, 24, 32 mm — stepping 220→210→200→190→180°C (10°C per band). Tests surface quality, stringing, bridging, overhangs, and layer adhesion on each band.',
        hint:   'Adjust the range for your material: PLA 220→180°C · PETG 250→220°C · ABS 260→230°C · ASA 260→230°C.',
      },
    },
  },

  // ── Retraction — two tapered cone posts ──────────────────────────────────
  //  Fast travel exposes stringing; combing off so travel crosses gaps.
  'retraction': {
    print: {
      topLayers:         5,
      bottomLayers:      5,
      wallCount:         2,
      infillDensity:     15,
      printSpeed:        60,
      travelSpeed:       150,
      coolingFanEnabled: true,
      combingMode:       'off',
      supportEnabled:    false,
      adhesionType:      'skirt',
      spiralizeContour:  false,
    },
    material: {},
    rationale: 'Fast travel (combing off) maximises stringing; adjust retraction until strings disappear.',
  },

  // ── Pressure advance — Klipper square_tower 66×66×50 mm ──────────────────
  //  No top surface; fast outer wall; SQUARE_CORNER_VELOCITY ≈ 1 mm/s in Klipper.
  //  Post-processor: tuning-tower ramps SET_PRESSURE_ADVANCE from 0.000 to 0.080
  //  in 5 mm steps.  Each 5 mm band can be inspected for clean 90° corners.
  'pressure-advance': {
    print: {
      topLayers:         0,
      bottomLayers:      3,
      wallCount:         2,
      infillDensity:     0,
      printSpeed:        100,
      outerWallSpeed:    100,
      travelSpeed:       200,
      coolingFanEnabled: true,
      combingMode:       'off',
      supportEnabled:    false,
      adhesionType:      'skirt',
      spiralizeContour:  false,
      layerProcessors:   [{
        id:                'calib-pa-ramp',
        enabled:           true,
        kind:              'tuning-tower',
        tuningParameter:   'pressure-advance',
        tuningStartZ:      3,     // skip the solid base layers
        tuningEndZ:        50,
        tuningStartValue:  0,     // 0.0000 PA  (direct-drive default)
        tuningEndValue:    0.1,   // 0.1000 PA  (direct-drive default — matches Klipper/Ellis)
        tuningStepSize:    5,     // one band per 5 mm = 9 readable bands
      } satisfies LayerProcessor],
    },
    material: {},
    rationale: 'PA ramp injected every 5 mm — find the band with the cleanest corners.',
    processorNotes: {
      'calib-pa-ramp': {
        title:  'Pressure advance ramp',
        detail: 'Injects SET_PRESSURE_ADVANCE ADVANCE=X.XXXX every 5 mm from Z 3 to 50 mm. Default range is 0.000 → 0.100 (direct drive). Switch to Bowden for a 0.000 → 1.000 sweep.',
        hint:   'Klipper firmware required. For Marlin, uncomment the M900 K line in the exported G-code.',
      },
    },
  },

  // ── Input shaper — Klipper ringing_tower 120×120×60 mm ───────────────────
  //  Very fast perimeters; fine layer height; no top/bottom to save time.
  'input-shaper': {
    print: {
      layerHeight:       0.15,
      topLayers:         0,
      bottomLayers:      3,
      wallCount:         2,
      infillDensity:     0,
      printSpeed:        80,
      outerWallSpeed:    80,
      coolingFanEnabled: true,
      supportEnabled:    false,
      adhesionType:      'skirt',
      spiralizeContour:  false,
    },
    material: {},
    rationale: 'Fast walls at fine layer height — ringing bands are clearly visible at this speed.',
  },

  // ── Dimensional accuracy — CaliStar 100×2 mm ─────────────────────────────
  //  Slow outer wall for precision; generous top/bottom; many walls.
  'dimensional-accuracy': {
    print: {
      topLayers:         5,
      bottomLayers:      5,
      wallCount:         4,
      infillDensity:     20,
      infillPattern:     'grid',
      printSpeed:        40,
      outerWallSpeed:    25,
      coolingFanEnabled: true,
      supportEnabled:    false,
      adhesionType:      'skirt',
      spiralizeContour:  false,
    },
    material: {},
    rationale: 'Slow outer wall and many perimeters for the most accurate dimensional result.',
  },

  // ── Max volumetric speed — 40×40×80 mm tube ──────────────────────────────
  //  Vase / spiralise mode is essential — single perimeter, no infill or top.
  //  Post-processor ramps M220 (feed-rate %) from 50 % to 300 % of the 80 mm/s
  //  base → 40 to 240 mm/s effective speed over the 80 mm height.
  'max-volumetric-speed': {
    print: {
      wallCount:         1,
      spiralizeContour:  true,
      infillDensity:     0,
      topLayers:         0,
      bottomLayers:      1,
      printSpeed:        80,
      coolingFanEnabled: true,
      supportEnabled:    false,
      adhesionType:      'none',
      layerProcessors:   [{
        id:                'calib-mvs-speed',
        enabled:           true,
        kind:              'tuning-tower',
        tuningParameter:   'speed',
        tuningStartZ:      1,     // skip the solid base
        tuningEndZ:        80,
        tuningStartValue:  50,    // M220 S50  → 40 mm/s at 80 mm/s base
        tuningEndValue:    300,   // M220 S300 → 240 mm/s at 80 mm/s base
        tuningStepSize:    0,     // every layer for a continuous ramp
      } satisfies LayerProcessor],
    },
    material: {},
    rationale: 'Speed ramp 40 → 240 mm/s over 80 mm — the rough layer marks maximum volumetric flow.',
    processorNotes: {
      'calib-mvs-speed': {
        title:  'Print speed ramp',
        detail: 'Injects M220 S## at every layer from Z 1 to 80 mm, ramping feed-rate from 50 % to 300 % of the 80 mm/s base speed (40 → 240 mm/s effective).',
        hint:   'Note the Z height where the wall first goes rough or gaps appear. Divide by layer height to find the layer count, then use your slicer\'s filament cross-section to compute mm³/s.',
      },
    },
  },

  // ── Firmware health — Voron Design Cube v7, 30×30×30 mm ──────────────────
  //  Balanced all-round settings to reveal ringing, layer quality, and dims.
  'firmware-health': {
    print: {
      layerHeight:       0.2,
      firstLayerHeight:  0.2,
      topLayers:         5,
      bottomLayers:      5,
      wallCount:         4,
      infillDensity:     15,
      infillPattern:     'grid',
      printSpeed:        50,
      outerWallSpeed:    30,
      coolingFanEnabled: true,
      supportEnabled:    false,
      adhesionType:      'skirt',
      spiralizeContour:  false,
    },
    material: {},
    rationale: 'All-round quality settings — reveals ringing, layer adhesion, and surface finish.',
  },
};

/**
 * Returns the slice preset for the given testType, adjusted for the active filament
 * and nozzle diameter if provided. Returns undefined if no preset exists for testType.
 */
export function getCalibrationSlicePreset(
  testType: string,
  filament?: CalibrationFilament,
): CalibrationSlicePreset | undefined {
  const base = PRESETS[testType];
  if (!base) return undefined;
  if (!filament) return base;
  return applyFilamentOverrides(base, filament);
}

/**
 * Returns the union of all auto-set key names for a given testType,
 * adjusted for the active filament if provided.
 */
export function getAutoSetKeys(testType: string, filament?: CalibrationFilament): Set<string> {
  const p = getCalibrationSlicePreset(testType, filament);
  if (!p) return new Set();
  return new Set([...Object.keys(p.print), ...Object.keys(p.material)]);
}
