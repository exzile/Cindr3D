// Aggregated slice-result statistics — powers the per-feature breakdown,
// filament-cost estimate, filament-per-layer sparkline, and the print-
// issues panel. All accessors take the raw `SliceResult` plus the active
// material/printer profiles so we don't re-fetch them per render.

import type { SliceLayer, SliceMove, SliceResult } from '../../../../types/slicer';

export type FeatureType =
  | 'wall-outer' | 'wall-inner' | 'gap-fill' | 'infill' | 'top-bottom'
  | 'support' | 'support-tree' | 'skirt' | 'brim' | 'raft' | 'bridge' | 'ironing';

export interface PerFeatureStats {
  /** Total filament length in mm of source filament (the SliceMove.extrusion sum). */
  filamentMm: number;
  /** Total move length in mm (sum of segment lengths in XY). */
  pathMm: number;
  /** Approximate time for this feature group: pathMm / averageSpeedMmPerS. */
  timeSec: number;
  /** Move count. */
  moves: number;
}

export interface SliceStats {
  /** Per-feature breakdown (only types that actually have moves). */
  byFeature: Partial<Record<FeatureType, PerFeatureStats>>;
  /** Total over all extrusion features. */
  totalFilamentMm: number;
  totalFilamentG: number;
  totalFilamentMm3: number;
  totalExtrudeMm: number;
  totalTravelMm: number;
  totalPrintTimeSec: number;
  /** Per-layer arrays (parallel to `sliceResult.layers`) for sparklines. */
  perLayerFilamentMm: number[];
  perLayerTravelMm: number[];
  perLayerExtrudeMm: number[];
  /** Cost in dollars assuming the supplied per-kg price. Zero when no price. */
  estimatedCostUsd: number;
}

interface MaterialFilamentInfo {
  diameterMm: number;
  densityGPerCm3: number;
  costPerKg?: number;
}

export function computeSliceStats(
  result: SliceResult,
  filament: MaterialFilamentInfo,
): SliceStats {
  const filamentArea = Math.PI * Math.pow(filament.diameterMm / 2, 2); // mm²
  const byFeature: Partial<Record<FeatureType, PerFeatureStats>> = {};
  const perLayerFilamentMm: number[] = [];
  const perLayerTravelMm: number[] = [];
  const perLayerExtrudeMm: number[] = [];
  let totalFilamentMm = 0;
  let totalExtrudeMm = 0;
  let totalTravelMm = 0;
  let totalPrintTimeSec = 0;

  for (const layer of result.layers) {
    let layerFilament = 0;
    let layerTravel = 0;
    let layerExtrude = 0;
    for (const m of layer.moves) {
      const len = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
      if (m.type === 'travel') {
        layerTravel += len;
        continue;
      }
      layerExtrude += len;
      if (m.extrusion > 0) layerFilament += m.extrusion;
      const f = byFeature[m.type as FeatureType] ?? {
        filamentMm: 0, pathMm: 0, timeSec: 0, moves: 0,
      };
      f.pathMm += len;
      f.filamentMm += Math.max(0, m.extrusion);
      f.timeSec += m.speed > 0 ? len / m.speed : 0;
      f.moves += 1;
      byFeature[m.type as FeatureType] = f;
    }
    perLayerFilamentMm.push(layerFilament);
    perLayerTravelMm.push(layerTravel);
    perLayerExtrudeMm.push(layerExtrude);
    totalFilamentMm += layerFilament;
    totalExtrudeMm += layerExtrude;
    totalTravelMm += layerTravel;
    totalPrintTimeSec += layer.layerTime;
  }

  const totalFilamentMm3 = totalFilamentMm * filamentArea;
  const totalFilamentG = (totalFilamentMm3 / 1000) * filament.densityGPerCm3; // mm³ → cm³ → g
  const estimatedCostUsd = filament.costPerKg
    ? (totalFilamentG / 1000) * filament.costPerKg
    : 0;

  return {
    byFeature,
    totalFilamentMm,
    totalFilamentG,
    totalFilamentMm3,
    totalExtrudeMm,
    totalTravelMm,
    totalPrintTimeSec,
    perLayerFilamentMm,
    perLayerTravelMm,
    perLayerExtrudeMm,
    estimatedCostUsd,
  };
}

/** Format a duration in seconds → "Xh Ym Zs" / "Ym Zs" / "Zs". */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(0)}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

// ----------------------------------------------------------------------
// Print issues — quality flags detected from the slice result.
// ----------------------------------------------------------------------

export type IssueSeverity = 'warning' | 'info';

export interface PrintIssue {
  kind:
    | 'long-bridge'
    | 'steep-overhang'
    | 'thin-wall'
    | 'slow-layer'
    | 'fast-layer'
    | 'small-first-layer-contact'
    | 'high-travel-ratio';
  layerIndex: number;
  z: number;
  severity: IssueSeverity;
  /** Human-readable summary. */
  message: string;
  /** Optional XY representative point on the offending layer (for the
   *  3D risk heatmap to highlight that location). */
  hint?: { x: number; y: number };
}

interface IssueDetectionConfig {
  /** Maximum bridge segment length before warning, mm. */
  bridgeWarnMm: number;
  /** Min Arachne wall width below which we flag the local segment. */
  thinWallMm: number;
  /** Min first-layer contact area (sum of perimeter-bounded area). */
  smallFirstLayerMm2: number;
  /** Layers > median × this → flag. */
  slowLayerRatio: number;
  /** Travel ratio above which a layer is flagged for inefficiency. */
  highTravelRatio: number;
}

const DEFAULT_DETECTION_CONFIG: IssueDetectionConfig = {
  bridgeWarnMm: 8,
  thinWallMm: 0.25,
  smallFirstLayerMm2: 50,
  slowLayerRatio: 2.0,
  highTravelRatio: 0.45,
};

export function detectPrintIssues(
  result: SliceResult,
  stats: SliceStats,
  config: Partial<IssueDetectionConfig> = {},
): PrintIssue[] {
  const cfg = { ...DEFAULT_DETECTION_CONFIG, ...config };
  const issues: PrintIssue[] = [];

  // Slow / fast layer detection — median across layers ≥ 10 to avoid
  // false positives at start and end of small prints.
  if (result.layers.length >= 10) {
    const times = result.layers.map((l) => l.layerTime).filter((t) => t > 0).sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? 0;
    if (median > 0) {
      for (let li = 0; li < result.layers.length; li++) {
        const layer = result.layers[li];
        if (layer.layerTime > median * cfg.slowLayerRatio) {
          issues.push({
            kind: 'slow-layer',
            layerIndex: li, z: layer.z, severity: 'info',
            message: `Layer ${li} took ${formatDuration(layer.layerTime)} — `
              + `${(layer.layerTime / median).toFixed(1)}× median (${formatDuration(median)}). `
              + 'Cooling fans should keep up, but watch for warping.',
          });
        }
      }
    }
  }

  // Long bridges.
  for (let li = 0; li < result.layers.length; li++) {
    const layer = result.layers[li];
    for (const m of layer.moves) {
      if (m.type !== 'bridge') continue;
      const len = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
      if (len > cfg.bridgeWarnMm) {
        issues.push({
          kind: 'long-bridge',
          layerIndex: li, z: layer.z, severity: 'warning',
          message: `Bridge segment ${len.toFixed(1)}mm at layer ${li} `
            + `(threshold ${cfg.bridgeWarnMm}mm). May sag without supports.`,
          hint: { x: (m.from.x + m.to.x) / 2, y: (m.from.y + m.to.y) / 2 },
        });
        break; // one issue per layer is enough; UI can drill deeper
      }
    }
  }

  // Thin Arachne walls.
  for (let li = 0; li < result.layers.length; li++) {
    const layer = result.layers[li];
    let thinFound = false;
    let thinPt: { x: number; y: number } | undefined;
    for (const m of layer.moves) {
      if (m.type !== 'wall-outer' && m.type !== 'wall-inner') continue;
      if (m.lineWidth > 0 && m.lineWidth < cfg.thinWallMm) {
        thinFound = true;
        thinPt = { x: m.from.x, y: m.from.y };
        break;
      }
    }
    if (thinFound) {
      issues.push({
        kind: 'thin-wall',
        layerIndex: li, z: layer.z, severity: 'warning',
        message: `Wall thinner than ${cfg.thinWallMm}mm at layer ${li} — `
          + 'Arachne emitted a sub-min-width tail. Check feature size.',
        hint: thinPt,
      });
    }
  }

  // Small first-layer footprint.
  if (result.layers.length > 0) {
    const layer0 = result.layers[0];
    const outers = layer0.moves.filter((m) => m.type === 'wall-outer');
    if (outers.length > 0) {
      // Bbox is a quick proxy for footprint; not exact but catches truly tiny first layers.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const m of outers) {
        minX = Math.min(minX, m.from.x, m.to.x);
        maxX = Math.max(maxX, m.from.x, m.to.x);
        minY = Math.min(minY, m.from.y, m.to.y);
        maxY = Math.max(maxY, m.from.y, m.to.y);
      }
      const bboxArea = (maxX - minX) * (maxY - minY);
      if (bboxArea > 0 && bboxArea < cfg.smallFirstLayerMm2) {
        issues.push({
          kind: 'small-first-layer-contact',
          layerIndex: 0, z: layer0.z, severity: 'warning',
          message: `First layer footprint ≈ ${bboxArea.toFixed(0)}mm² — `
            + 'small contact area, adhesion may fail. Consider a brim.',
        });
      }
    }
  }

  // High travel ratio per layer (flag layers spending > 45% of path on travel).
  for (let li = 0; li < result.layers.length; li++) {
    const ext = stats.perLayerExtrudeMm[li];
    const trv = stats.perLayerTravelMm[li];
    const total = ext + trv;
    if (total < 5) continue; // ignore tiny layers
    const ratio = trv / total;
    if (ratio > cfg.highTravelRatio) {
      issues.push({
        kind: 'high-travel-ratio',
        layerIndex: li, z: result.layers[li].z, severity: 'info',
        message: `Layer ${li} is ${(ratio * 100).toFixed(0)}% travel — `
          + 'fragmented infill or many islands. Check seam alignment / combing.',
      });
    }
  }

  return issues;
}

// ----------------------------------------------------------------------
// Z-seam point extraction — wall-outer chain starts.
// ----------------------------------------------------------------------

export function extractZSeamPoints(layer: SliceLayer): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  let prev: SliceMove | null = null;
  for (const m of layer.moves) {
    if (m.type !== 'wall-outer') { prev = null; continue; }
    if (prev === null) {
      // First wall-outer move after a non-wall-outer move = chain start.
      pts.push({ x: m.from.x, y: m.from.y });
    }
    prev = m;
  }
  return pts;
}
