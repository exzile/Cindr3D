/**
 * Probe-grid preference persistence for the dashboard BedCompensationPanel.
 *
 * Shares the `designcad:heightmap-prefs` localStorage key with the full
 * heightmap panel (../../heightMap/prefs.ts) — both panels read/write the
 * same probe grid state so changes in one are visible in the other.
 */

import { HM_PREFS_KEY } from '../../heightMap/prefs';

export interface ProbeGridPrefs {
  probeXMin: number;
  probeXMax: number;
  probeYMin: number;
  probeYMax: number;
  probePoints: number;
  probeGridUnlocked: boolean;
}

export const DEFAULT_GRID_PREFS: ProbeGridPrefs = {
  probeXMin: 0,
  probeXMax: 235,
  probeYMin: 0,
  probeYMax: 235,
  probePoints: 9,
  probeGridUnlocked: false,
};

export function loadProbeGridPrefs(): ProbeGridPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(HM_PREFS_KEY) ?? '{}') as Partial<ProbeGridPrefs>;
    return {
      probeXMin: typeof raw.probeXMin === 'number' ? raw.probeXMin : DEFAULT_GRID_PREFS.probeXMin,
      probeXMax: typeof raw.probeXMax === 'number' ? raw.probeXMax : DEFAULT_GRID_PREFS.probeXMax,
      probeYMin: typeof raw.probeYMin === 'number' ? raw.probeYMin : DEFAULT_GRID_PREFS.probeYMin,
      probeYMax: typeof raw.probeYMax === 'number' ? raw.probeYMax : DEFAULT_GRID_PREFS.probeYMax,
      probePoints: typeof raw.probePoints === 'number' ? raw.probePoints : DEFAULT_GRID_PREFS.probePoints,
      probeGridUnlocked: raw.probeGridUnlocked === true,
    };
  } catch {
    return { ...DEFAULT_GRID_PREFS };
  }
}

export function saveProbeGridPrefs(prefs: ProbeGridPrefs) {
  try {
    const existing = JSON.parse(localStorage.getItem(HM_PREFS_KEY) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(HM_PREFS_KEY, JSON.stringify({ ...existing, ...prefs }));
  } catch { /* storage unavailable */ }
}
