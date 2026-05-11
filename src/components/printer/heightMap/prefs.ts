/** localStorage persistence + demo data for the heightmap panel. */

import type { DuetHeightMap as HeightMapData } from '../../../types/duet';

export const HM_PREFS_KEY = 'designcad:heightmap-prefs';

export interface HeightMapPrefs {
  viewMode:        '3d' | '2d';
  diverging:       boolean;
  mirrorX:         boolean;
  sidebarOpen:     boolean;
  showProbePoints: boolean;
  probePointScale: number;
  selectedCsv:     string;
  probeXMin:        number;
  probeXMax:        number;
  probeYMin:        number;
  probeYMax:        number;
  probePoints:      number;
  /** Whether the user has explicitly unlocked the probe grid (overriding config.g). */
  probeGridUnlocked: boolean;
}

export const HM_PREFS_DEFAULTS: HeightMapPrefs = {
  viewMode:        '3d',
  diverging:       false,
  mirrorX:         false,
  sidebarOpen:     true,
  showProbePoints: true,
  probePointScale: 1,
  selectedCsv:     '0:/sys/heightmap.csv',
  probeXMin:        0,
  probeXMax:        235,
  probeYMin:        0,
  probeYMax:        235,
  probePoints:      9,
  probeGridUnlocked: false,
};

export function loadHeightMapPrefs(): HeightMapPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(HM_PREFS_KEY) ?? '{}') as Partial<HeightMapPrefs>;
    return {
      viewMode:        raw.viewMode === '2d' ? '2d' : '3d',
      diverging:       raw.diverging       ?? HM_PREFS_DEFAULTS.diverging,
      mirrorX:         raw.mirrorX         ?? HM_PREFS_DEFAULTS.mirrorX,
      sidebarOpen:     raw.sidebarOpen     ?? HM_PREFS_DEFAULTS.sidebarOpen,
      showProbePoints: raw.showProbePoints ?? HM_PREFS_DEFAULTS.showProbePoints,
      probePointScale: typeof raw.probePointScale === 'number'
        ? raw.probePointScale
        : HM_PREFS_DEFAULTS.probePointScale,
      selectedCsv: typeof raw.selectedCsv === 'string' && raw.selectedCsv
        ? raw.selectedCsv
        : HM_PREFS_DEFAULTS.selectedCsv,
      probeXMin:        typeof raw.probeXMin   === 'number' ? raw.probeXMin   : HM_PREFS_DEFAULTS.probeXMin,
      probeXMax:        typeof raw.probeXMax   === 'number' ? raw.probeXMax   : HM_PREFS_DEFAULTS.probeXMax,
      probeYMin:        typeof raw.probeYMin   === 'number' ? raw.probeYMin   : HM_PREFS_DEFAULTS.probeYMin,
      probeYMax:        typeof raw.probeYMax   === 'number' ? raw.probeYMax   : HM_PREFS_DEFAULTS.probeYMax,
      probePoints:      typeof raw.probePoints === 'number' ? raw.probePoints : HM_PREFS_DEFAULTS.probePoints,
      probeGridUnlocked: raw.probeGridUnlocked === true,
    };
  } catch {
    return { ...HM_PREFS_DEFAULTS };
  }
}

export const DEMO_HEIGHT_MAP: HeightMapData = {
  xMin: 0, xMax: 235, xSpacing: 29.375,
  yMin: 0, yMax: 235, ySpacing: 29.375,
  radius: -1,
  numX: 9, numY: 9,
  points: [
    [ 0.042,  0.033,  0.018,  0.004, -0.008, -0.016, -0.021, -0.014,  0.031],
    [ 0.035,  0.027,  0.011, -0.002, -0.019, -0.028, -0.038, -0.022,  0.014],
    [ 0.021,  0.012, -0.004, -0.018, -0.031, -0.039, -0.047, -0.030, -0.006],
    [ 0.008, -0.001, -0.013, -0.027, -0.039, -0.048, -0.055, -0.037, -0.013],
    [-0.003, -0.011, -0.023, -0.036, -0.048, -0.057, -0.062, -0.044, -0.018],
    [-0.008, -0.015, -0.026, -0.038, -0.049, -0.055, -0.057, -0.040, -0.014],
    [-0.005, -0.012, -0.021, -0.031, -0.037, -0.044, -0.051, -0.035, -0.011],
    [ 0.009,  0.002, -0.008, -0.015, -0.021, -0.028, -0.038, -0.024,  0.003],
    [ 0.023,  0.015,  0.004, -0.004, -0.015, -0.019, -0.026, -0.012,  0.016],
  ],
};
