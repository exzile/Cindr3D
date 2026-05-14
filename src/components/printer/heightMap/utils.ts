import * as THREE from 'three';
import type { DuetHeightMap as HeightMapData } from '../../../types/duet';

export interface ProbeOffset {
  xOffset: number;
  yOffset: number;
}

/**
 * Adjust a 1-D axis range so the probe tip stays inside the bed when the
 * probe is mounted with an XY offset from the nozzle (RRF G31 / Marlin M851).
 *
 *   safe_min = axisMin + max(0, -offset)  — probe LEFT/FRONT of nozzle: push min inward
 *   safe_max = axisMax + min(0, -offset)  — probe RIGHT/BACK of nozzle: pull max inward
 *
 * `offset` is the probe-tip-minus-nozzle delta along this axis.
 */
export function safeAxisRange(
  axisMin: number,
  axisMax: number,
  offset: number,
): { min: number; max: number } {
  return {
    min: axisMin + Math.max(0, -offset),
    max: axisMax + Math.min(0, -offset),
  };
}

/**
 * Parse a probe XY offset from a firmware config file.
 *
 * Returns the FIRST G31 / M851 hit — older RRF configs put per-tool offsets on
 * subsequent G31 lines and we want T0's offset for grid-bound checks.
 *
 * Handles:
 *   G31 X<n> Y<n>  — RRF (Duet), Smoothieware
 *   M851 X<n> Y<n> — Marlin, Repetier, some Smoothieware variants
 *
 * Returns null if no probe offset line with X or Y is found.
 */
export function parseProbeOffset(configText: string): ProbeOffset | null {
  for (const raw of configText.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const isG31 = /^G31\b/i.test(line);
    const isM851 = /^M851\b/i.test(line);
    if (!isG31 && !isM851) continue;
    const xm = line.match(/X(-?\d+(?:\.\d+)?)/i);
    const ym = line.match(/Y(-?\d+(?:\.\d+)?)/i);
    if (!xm && !ym) continue;
    return { xOffset: xm ? parseFloat(xm[1]) : 0, yOffset: ym ? parseFloat(ym[1]) : 0 };
  }
  return null;
}

export interface ParsedM557 {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  numPoints: number;
  rawLine: string;
}

/**
 * Parse an M557 probe-grid declaration from a firmware config file.
 *
 * Returns the LAST M557 — RRF config conventions place the operative M557 at
 * the end of config.g, after any conditional setup blocks, so a late
 * definition overrides earlier ones.
 *
 * Handles X<min>:<max> Y<min>:<max> with either P<count> (Duet/RRF) or
 * S<spacing> (older configs derive a count from the span).
 */
export function parseM557(configText: string): ParsedM557 | null {
  let result: ParsedM557 | null = null;
  for (const raw of configText.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!/^M557\b/i.test(line)) continue;
    const xm = line.match(/X(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)/i);
    const ym = line.match(/Y(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)/i);
    if (!xm || !ym) continue;
    const xMin = parseFloat(xm[1]);
    const xMax = parseFloat(xm[2]);
    const yMin = parseFloat(ym[1]);
    const yMax = parseFloat(ym[2]);
    if (xMax <= xMin || yMax <= yMin) continue;

    const pm = line.match(/P(\d+(?:\.\d+)?)/i);
    const sm = line.match(/S(\d+(?:\.\d+)?)/i);
    const span = Math.max(xMax - xMin, yMax - yMin);
    const numPoints = pm
      ? Math.max(2, Math.round(parseFloat(pm[1])))
      : sm ? Math.max(2, Math.round(span / parseFloat(sm[1])) + 1) : 9;

    result = { xMin, xMax, yMin, yMax, numPoints, rawLine: raw.trim() };
  }
  return result;
}

export interface HeightMapStats {
  min: number;
  max: number;
  mean: number;
  rms: number;
  probePoints: number;
  gridDimensions: string;
}

function deviationRGB(value: number, minVal: number, maxVal: number): [number, number, number] {
  const range = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.001);
  const t = Math.max(-1, Math.min(1, value / range));
  if (t < 0) {
    const f = 1 + t;
    return [Math.round(34 * f), Math.round(100 * (1 - f) + 197 * f), Math.round(255 * (1 - f) + 94 * f)];
  }
  const f = t;
  return [Math.round(34 * (1 - f) + 239 * f), Math.round(197 * (1 - f) + 68 * f), Math.round(94 * (1 - f) + 68 * f)];
}

function divergingRGB(value: number, minVal: number, maxVal: number): [number, number, number] {
  const range = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.001);
  const t = Math.max(-1, Math.min(1, value / range));
  if (t < 0) {
    const f = -t;
    return [Math.round(255 * (1 - f) + 59 * f), Math.round(255 * (1 - f) + 130 * f), Math.round(255 * (1 - f) + 246 * f)];
  }
  const f = t;
  return [Math.round(255 * (1 - f) + 239 * f), Math.round(255 * (1 - f) + 68 * f), Math.round(255 * (1 - f) + 68 * f)];
}

export function deviationColor(value: number, minVal: number, maxVal: number): string {
  const [r, g, b] = deviationRGB(value, minVal, maxVal);
  return `rgb(${r},${g},${b})`;
}

export function deviationColorThree(value: number, minVal: number, maxVal: number): THREE.Color {
  const [r, g, b] = deviationRGB(value, minVal, maxVal);
  return new THREE.Color(r / 255, g / 255, b / 255);
}

export function divergingColor(value: number, minVal: number, maxVal: number): string {
  const [r, g, b] = divergingRGB(value, minVal, maxVal);
  return `rgb(${r},${g},${b})`;
}

export function divergingColorThree(value: number, minVal: number, maxVal: number): THREE.Color {
  const [r, g, b] = divergingRGB(value, minVal, maxVal);
  return new THREE.Color(r / 255, g / 255, b / 255);
}

export function computeMeshRmsDiff(a: HeightMapData, b: HeightMapData): number {
  if (a.numX !== b.numX || a.numY !== b.numY) return Infinity;
  let sumSquares = 0;
  let count = 0;
  for (let y = 0; y < a.numY; y++) {
    for (let x = 0; x < a.numX; x++) {
      const av = a.points[y]?.[x];
      const bv = b.points[y]?.[x];
      if (av !== undefined && bv !== undefined && !isNaN(av) && !isNaN(bv)) {
        const diff = bv - av;
        sumSquares += diff * diff;
        count++;
      }
    }
  }
  if (count === 0) return Infinity;
  return Math.sqrt(sumSquares / count);
}

export function computeDiffMap(map1: HeightMapData, map2: HeightMapData): HeightMapData | null {
  if (map1.numX !== map2.numX || map1.numY !== map2.numY) return null;
  const points = Array.from({ length: map1.numY }, (_, y) =>
    Array.from({ length: map1.numX }, (_, x) => (map2.points[y]?.[x] ?? 0) - (map1.points[y]?.[x] ?? 0)),
  );
  return { ...map1, points };
}

export function computeStats(hm: HeightMapData): HeightMapStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 0; y < hm.numY; y++) {
    for (let x = 0; x < hm.numX; x++) {
      const value = hm.points[y]?.[x];
      if (value !== undefined && !isNaN(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
        sum += value;
        sumSquares += value * value;
        count++;
      }
    }
  }
  if (count === 0) return { min: 0, max: 0, mean: 0, rms: 0, probePoints: 0, gridDimensions: `${hm.numX} x ${hm.numY}` };
  return {
    min,
    max,
    mean: sum / count,
    rms: Math.sqrt(sumSquares / count),
    probePoints: count,
    gridDimensions: `${hm.numX} x ${hm.numY}`,
  };
}

export function exportHeightMapCSV(hm: HeightMapData): void {
  const lines = [
    `RepRapFirmware height map file v2 generated at ${new Date().toISOString()}`,
    'xmin,xmax,ymin,ymax,radius,xspacing,yspacing,num_x,num_y',
    `${hm.xMin},${hm.xMax},${hm.yMin},${hm.yMax},${hm.radius},${hm.xSpacing.toFixed(2)},${hm.ySpacing.toFixed(2)},${hm.numX},${hm.numY}`,
    ...Array.from({ length: hm.numY }, (_, y) =>
      Array.from({ length: hm.numX }, (_, x) => {
        const value = hm.points[y]?.[x];
        return value !== undefined && !isNaN(value) ? value.toFixed(3) : '0';
      }).join(','),
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'heightmap.csv';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
