/**
 * Parse print-progress markers from a Marlin (or compatible) serial line.
 *
 * Recognised forms (all case-insensitive):
 *
 *   M73 P<n> [R<m>]                — progress percent + remaining minutes
 *   M73 Q<n> [S<m>]                — preview percent + remaining seconds (Prusa)
 *   echo: M73 P<n> R<m>            — Marlin's echoed M73 receipt
 *   echo:Layer <n>/<total>         — Some Marlin builds report layer on LCD
 *   ; LAYER:<n>                    — Slicer comment, harmless to detect
 *
 * Parser is intentionally lenient — extra whitespace and comment prefixes
 * are tolerated. A line with no progress markers returns null.
 */

export interface MarlinProgressUpdate {
  /** 0-100, only set when an M73 P/Q value was seen on this line. */
  percent?: number;
  /** Remaining seconds. R<min> is converted to seconds; S<sec> is used as-is. */
  remainingSeconds?: number;
  /** Current layer index (0-based). */
  layer?: number;
  /** Total layer count, when reported. */
  totalLayers?: number;
}

const M73_LINE = /\bM73\b\s*([^;\n]*)/i;
const P_PARAM = /\bP\s*(\d+(?:\.\d+)?)/i;
const Q_PARAM = /\bQ\s*(\d+(?:\.\d+)?)/i;
const R_PARAM = /\bR\s*(\d+(?:\.\d+)?)/i;
const S_PARAM = /\bS\s*(\d+(?:\.\d+)?)/i;

const LAYER_LINE = /(?:^|[\s;:])layer[\s:_]*(\d+)\s*(?:[\/of]+\s*(\d+))?/i;

export function parseMarlinProgress(rawLine: string): MarlinProgressUpdate | null {
  const line = rawLine.trim();
  if (!line) return null;

  const update: MarlinProgressUpdate = {};

  const m73 = M73_LINE.exec(line);
  if (m73) {
    const args = m73[1] ?? '';
    const p = P_PARAM.exec(args) ?? Q_PARAM.exec(args);
    if (p) {
      const pct = Math.max(0, Math.min(100, Number(p[1])));
      if (Number.isFinite(pct)) update.percent = pct;
    }
    const r = R_PARAM.exec(args);
    if (r) {
      const minutes = Number(r[1]);
      if (Number.isFinite(minutes) && minutes >= 0) update.remainingSeconds = Math.round(minutes * 60);
    } else {
      const s = S_PARAM.exec(args);
      if (s) {
        const seconds = Number(s[1]);
        if (Number.isFinite(seconds) && seconds >= 0) update.remainingSeconds = Math.round(seconds);
      }
    }
  }

  const layerMatch = LAYER_LINE.exec(line);
  if (layerMatch) {
    const layer = Number(layerMatch[1]);
    if (Number.isFinite(layer) && layer >= 0) update.layer = layer;
    if (layerMatch[2] !== undefined) {
      const total = Number(layerMatch[2]);
      if (Number.isFinite(total) && total > 0) update.totalLayers = total;
    }
  }

  return Object.keys(update).length > 0 ? update : null;
}

/**
 * Estimate a current-layer index from a progress percent and a known total
 * layer count. Used when the firmware reports percent (M73 P) but no
 * explicit layer number.
 */
export function layerFromPercent(percent: number, totalLayers: number): number {
  if (!Number.isFinite(percent) || !Number.isFinite(totalLayers) || totalLayers <= 0) return 0;
  const clamped = Math.max(0, Math.min(100, percent));
  return Math.min(totalLayers - 1, Math.floor((clamped / 100) * totalLayers));
}
