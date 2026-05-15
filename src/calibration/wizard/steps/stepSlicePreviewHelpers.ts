/**
 * Pure helpers for the calibration wizard's slice-preview step:
 *   • Known model footprints (XY size in mm) per calibration test
 *   • Tuning-tower step computation + value formatting
 *   • Human-readable labels + value formatters for the preset-override list
 *
 * Extracted from StepSlicePreview.tsx so the React component stays focused on
 * slicing state, scene composition, and tooltip plumbing.
 */
import type { LayerProcessor } from '../../types/slicer/profiles/print';

/** A stable empty array — the fallback when layerProcessors is undefined. */
export const EMPTY_PROCESSORS: LayerProcessor[] = [];

/** Known XY footprint [W, D] of each calibration model in mm (unscaled). */
export const MODEL_FOOTPRINTS: Readonly<Record<string, [number, number]>> = {
  'firmware-health':      [ 30,  30],
  'first-layer':          [120, 120],
  'flow-rate':            [ 30,  30],
  'temperature-tower':    [ 60,  10],
  'retraction':           [ 60,  10],
  'pressure-advance':     [ 66,  66],
  'input-shaper':         [120, 120],
  'dimensional-accuracy': [108, 108],
  'max-volumetric-speed': [ 40,  40],
};

/** Returns up to maxSteps (Z, value) pairs for a tuning-tower processor. */
export function computeTuningSteps(
  proc: LayerProcessor,
  maxSteps = 18,
): Array<{ z: number; value: number }> {
  const {
    tuningStartZ    = 0, tuningEndZ    = 0,
    tuningStartValue = 0, tuningEndValue = 0,
    tuningStepSize  = 0,
  } = proc;
  if (tuningStepSize <= 0 || tuningEndZ <= tuningStartZ) return [];
  const range = tuningEndZ - tuningStartZ;
  const out: Array<{ z: number; value: number }> = [];
  for (let z = tuningStartZ; z <= tuningEndZ + 0.001 && out.length < maxSteps; z += tuningStepSize) {
    const t = Math.min(1, (z - tuningStartZ) / range);
    out.push({
      z: parseFloat(z.toFixed(2)),
      value: tuningStartValue + t * (tuningEndValue - tuningStartValue),
    });
  }
  return out;
}

/** Format a step value for display, based on the tuning parameter type. */
export function fmtStepValue(param: string | undefined, value: number): string {
  switch (param) {
    case 'temperature':
    case 'bed-temperature': return `${Math.round(value)}°`;
    case 'fan':             return `${Math.round(value)}`;
    case 'speed':
    case 'flow':            return `${Math.round(value)}%`;
    case 'pressure-advance': return value.toFixed(3);
    default:                return `${Math.round(value)}`;
  }
}

/** Human-readable labels for keys touched by calibration presets. */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  layerHeight:            'Layer height',
  firstLayerHeight:       'First layer height',
  topLayers:              'Top layers',
  bottomLayers:           'Bottom layers',
  adaptiveLayersEnabled:  'Adaptive layers',
  wallCount:              'Wall count',
  lineWidth:              'Line width',
  outerWallFirst:         'Outer wall first',
  infillDensity:          'Infill density',
  infillPattern:          'Infill pattern',
  infillOverlap:          'Infill overlap',
  topBottomPattern:       'Top/bottom pattern',
  printSpeed:             'Print speed',
  outerWallSpeed:         'Outer wall speed',
  firstLayerSpeed:        'First layer speed',
  infillSpeed:            'Infill speed',
  travelSpeed:            'Travel speed',
  coolingFanEnabled:      'Fan',
  fanSpeedMin:            'Fan min',
  fanSpeedMax:            'Fan max',
  fanFullLayer:           'Full fan at layer',
  fanDisableFirstLayers:  'Fan off first N layers',
  minLayerTime:           'Min layer time',
  supportEnabled:         'Supports',
  supportType:            'Support type',
  adhesionType:           'Adhesion',
  brimWidth:              'Brim width',
  ironingEnabled:         'Ironing',
  spiralizeContour:       'Spiral / vase',
  combingMode:            'Combing',
  zSeamAlignment:         'Z-seam',
  layerProcessors:        'Post-processing',
  nozzleTemp:             'Nozzle temp',
  bedTemp:                'Bed temp',
  retractionDistance:     'Retraction',
  retractionSpeed:        'Retract speed',
  retractionZHop:         'Z-hop',
  flowRate:               'Flow rate',
};

/** Format a preset value for the overrides list. */
export function fmtPresetValue(key: string, value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'boolean')  return value ? 'On' : 'Off';
  if (Array.isArray(value))        return `${value.length} script${value.length !== 1 ? 's' : ''}`;
  if (key === 'flowRate' && typeof value === 'number') return `${Math.round(value * 100)} %`;
  return String(value);
}

export interface PlaneHoverInfo {
  z: number;
  value: number;
  prevValue: number | null;
  param: string | undefined;
}
