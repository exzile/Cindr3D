import type { DuetHeightMap } from '../../types/duet';
import { errorMessage } from '../../utils/errorHandling';

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Split on either line-ending style and trim trailing whitespace per line. */
function splitLines(csv: string): string[] {
  return csv.trim().split(/\r?\n/).map((l) => l.trimEnd());
}

/** Return the first N lines as a readable snippet for error messages. */
function rawSnippet(lines: string[], count = 6): string {
  return lines.slice(0, count).map((l, i) => `[${i}] ${l.slice(0, 150)}`).join('\n');
}

// ── Public entry-point ────────────────────────────────────────────────────────

/**
 * Parse a heightmap / bed-mesh file from any supported firmware.
 *
 * Detection order (first match wins):
 *   1. JSON object / array   → Marlin mesh.json (multiple schema variants)
 *   2. [bed_mesh]            → Klipper bed_mesh config section
 *   3. #Autocalibration      → Smoothieware heightmap.csv
 *   4. Marlin G29-T keywords → Marlin serial text dump (MBL / UBL / bilinear)
 *   5. axis0 / xmin header   → RepRapFirmware v1, v2-legacy, v2-new (Duet)
 *   6. bare number grid      → last-resort: any CSV with no recognised metadata
 */
export function parseHeightMapCsv(csv: string): DuetHeightMap {
  const body = csv.trim();
  const lines = splitLines(body);

  // ── 1. JSON ──────────────────────────────────────────────────────────────
  if (body.startsWith('{') || body.startsWith('[')) {
    return parseMarlinJson(body);
  }

  // ── 2. Klipper ───────────────────────────────────────────────────────────
  if (lines.some((l) => l.trim().toLowerCase() === '[bed_mesh]')) {
    return parseKlipperBedMesh(lines);
  }

  // ── 3. Smoothieware ──────────────────────────────────────────────────────
  const firstLine = lines[0]?.trim() ?? '';
  if (
    /^#\s*autocalibration/i.test(firstLine) ||
    lines.some((l) => /^#\s*x_size\s*:/i.test(l.trim()))
  ) {
    return parseSmoothiewireHeightMap(lines);
  }

  // ── 4. Marlin G29 T text dump ────────────────────────────────────────────
  if (
    lines.some((l) =>
      /unified bed leveling|mesh bed leveling|bilinear leveling/i.test(l),
    )
  ) {
    return parseMarlinTextDump(lines);
  }

  // ── 5. RepRapFirmware ────────────────────────────────────────────────────
  // Falls through to a bare-number-grid fallback if no RRF header is found.
  return parseRrfHeightMap(lines);
}

// ── RepRapFirmware parser ─────────────────────────────────────────────────────

/**
 * Three known RRF column-header / param-row layouts
 *
 * Legacy v1  (RRF < 3, 8 params):
 *   ; RepRapFirmware height map file v1 generated at …
 *   xmin,xmax,ymin,ymax,radius,spacing,numX,numY
 *   -100.0,100.0,-100.0,100.0,-1.0,10.0,21,21
 *
 * Legacy v2  (RRF 3.x first generation, 9 params):
 *   ; RepRapFirmware height map file v2 generated at …
 *   xmin,xmax,ymin,ymax,radius,xspacing,yspacing,numX,numY
 *   -100.0,100.0,-100.0,100.0,-1.0,10.0,10.0,21,21
 *
 * New v2  (RRF 3.x later revisions, axis-prefixed, 11 columns):
 *   RepRapFirmware height map file v2 generated at …, min error …
 *   axis0,axis1,min0,max0,min1,max1,radius,spacing0,spacing1,num0,num1
 *   X,Y,0.00,500.00,0.00,440.00,-1.00,71.42,62.85,8,8
 *
 * Falls back to a bare-number grid if no RRF header is present at all.
 */
function parseRrfHeightMap(lines: string[]): DuetHeightMap {
  let headerIdx = -1;
  let paramIdx  = -1;
  let isNewFmt  = false;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;

    if (
      t.startsWith(';') ||
      /^reprapfirmware\b/i.test(t) ||
      /^height map\b/i.test(t)
    ) continue;

    if (t.includes(',')) {
      const tl = t.toLowerCase();
      if (tl.includes('xmin')) {
        headerIdx = i; isNewFmt = false; continue;
      }
      if (tl.includes('axis0') || tl.includes('min0')) {
        headerIdx = i; isNewFmt = true; continue;
      }
    }

    if (t.includes(',')) {
      const first = t.split(',')[0].trim();
      if (!isNaN(parseFloat(first))) { paramIdx = i; break; }
      if (isNewFmt && headerIdx !== -1 && /^[a-zA-Z]/.test(first)) { paramIdx = i; break; }
    }
  }

  // ── Bare-number grid fallback ─────────────────────────────────────────────
  // No RRF header was recognised — try to treat the whole file as a plain grid
  // of comma- or space-separated floats.
  if (paramIdx === -1) {
    return parseBareNumberGrid(lines);
  }

  const paramParts = lines[paramIdx].trim().split(',').map((p) => p.trim());
  const rawColCount = headerIdx !== -1
    ? lines[headerIdx].trim().split(',').length
    : paramParts.length;

  let xMin: number, xMax: number, yMin: number, yMax: number,
      radius: number, xSpacing: number, ySpacing: number,
      numX: number, numY: number;

  if (isNewFmt) {
    const np = paramParts.slice(2).map(Number);
    [xMin, xMax, yMin, yMax, radius, xSpacing, ySpacing] = np;
    numX = Math.round(np[7]);
    numY = Math.round(np[8]);
  } else if (rawColCount >= 9) {
    [xMin, xMax, yMin, yMax, radius, xSpacing, ySpacing] = paramParts.slice(0, 7).map(Number);
    numX = Math.round(Number(paramParts[7]));
    numY = Math.round(Number(paramParts[8]));
  } else {
    [xMin, xMax, yMin, yMax, radius] = paramParts.slice(0, 5).map(Number);
    const spacing = Number(paramParts[5]);
    xSpacing = spacing; ySpacing = spacing;
    numX = Math.round(Number(paramParts[6]));
    numY = Math.round(Number(paramParts[7]));
  }

  validateGrid(numX, numY, xSpacing, ySpacing, rawColCount, lines[paramIdx]);
  const points = parseDataRows(lines, paramIdx + 1);
  return { xMin, xMax, xSpacing, yMin, yMax, ySpacing, radius, numX, numY, points };
}

// ── Klipper bed_mesh parser ───────────────────────────────────────────────────

/**
 * Klipper printer.cfg / bed_mesh.cfg  [bed_mesh] section.
 *
 *   [bed_mesh]
 *   version = 1
 *   points =
 *     -0.025, -0.008, …
 *   x_count = 5
 *   y_count = 5
 *   min_x = 10.0   max_x = 290.0
 *   min_y = 10.0   max_y = 290.0
 */
function parseKlipperBedMesh(lines: string[]): DuetHeightMap {
  const kv: Record<string, string> = {};
  const points: number[][] = [];
  let inSection = false, inPoints = false;

  for (const raw of lines) {
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    if (t.startsWith('[')) { inSection = t.toLowerCase() === '[bed_mesh]'; inPoints = false; continue; }
    if (!inSection) continue;
    if (/^points\s*=\s*$/.test(t)) { inPoints = true; continue; }
    if (inPoints) {
      if (/^\s/.test(raw) && t.includes(',')) {
        points.push(t.split(',').map((p) => { const v = parseFloat(p.trim()); return isNaN(v) ? 0 : v; }));
        continue;
      }
      inPoints = false;
    }
    const eq = t.indexOf('=');
    if (eq > 0) kv[t.slice(0, eq).trim().toLowerCase()] = t.slice(eq + 1).trim();
  }

  const numX    = parseInt(kv['x_count'] ?? '0', 10);
  const numY    = parseInt(kv['y_count'] ?? '0', 10);
  const xMin    = parseFloat(kv['min_x'] ?? '0');
  const xMax    = parseFloat(kv['max_x'] ?? '0');
  const yMin    = parseFloat(kv['min_y'] ?? '0');
  const yMax    = parseFloat(kv['max_y'] ?? '0');
  const xSpacing = numX > 1 ? (xMax - xMin) / (numX - 1) : 0;
  const ySpacing = numY > 1 ? (yMax - yMin) / (numY - 1) : 0;

  if (!numX || !numY) throw new Error(`Klipper bed_mesh: missing x_count / y_count.\n${rawSnippet(lines)}`);
  if (!points.length)  throw new Error(`Klipper bed_mesh: no point rows found.\n${rawSnippet(lines)}`);

  return { xMin, xMax, xSpacing, yMin, yMax, ySpacing, radius: -1, numX, numY, points };
}

// ── Marlin mesh.json parser ───────────────────────────────────────────────────

/**
 * Marlin saves the bed mesh as a JSON file on the SD card in some builds.
 * Several field-name variants exist across firmware forks; we try all of them.
 *
 * Common schemas encountered in the wild:
 *
 *   Schema A — simple { points, x_start, x_end, y_start, y_end }
 *   Schema B — { num_x, num_y, x_min, x_max, y_min, y_max, values: [[…]] }
 *   Schema C — { mesh: { z: [[…]], xmin, xmax, ymin, ymax, xspacing, yspacing } }
 *   Schema D — { grid: [[…]], mesh_min_x, mesh_max_x, mesh_min_y, mesh_max_y }
 *
 * If the outer object looks like a Klipper saved-variables file
 * ({ "bed_mesh mesh_default": { points: [[…]], … } }) we unwrap the inner object.
 */
function parseMarlinJson(body: string): DuetHeightMap {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Height map JSON parse error: ${errorMessage(e, 'Unknown error')}`);
  }

  // Klipper saved-variables wrapper
  const klipperKey = Object.keys(json).find((k) => k.startsWith('bed_mesh'));
  if (klipperKey) json = json[klipperKey] as Record<string, unknown>;

  // ── Resolve data array ────────────────────────────────────────────────────
  const rawPoints = (
    json['points'] ?? json['grid'] ?? json['mesh'] ?? json['values'] ?? json['data'] ??
    (json['mesh'] as Record<string, unknown> | undefined)?.['z']
  ) as unknown[][] | null | undefined;

  if (!rawPoints || !Array.isArray(rawPoints)) {
    throw new Error(`Marlin mesh JSON: no point array found (tried "points", "grid", "mesh", "values", "data").\nKeys present: ${Object.keys(json).join(', ')}`);
  }

  const points: number[][] = rawPoints.map((row) =>
    (row as unknown[]).map((v) => { const n = Number(v); return isNaN(n) ? 0 : n; }),
  );
  const numX = points[0]?.length ?? 0;
  const numY = points.length;

  // ── Resolve bounds ────────────────────────────────────────────────────────
  const pick = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = json[k];
      if (v !== undefined && v !== null && !isNaN(Number(v))) return Number(v);
    }
    return null;
  };

  const xMin = pick('x_min', 'xMin', 'x_start', 'xStart', 'mesh_min_x', 'min_x') ?? 0;
  const xMax = pick('x_max', 'xMax', 'x_end',   'xEnd',   'mesh_max_x', 'max_x') ?? (numX - 1);
  const yMin = pick('y_min', 'yMin', 'y_start', 'yStart', 'mesh_min_y', 'min_y') ?? 0;
  const yMax = pick('y_max', 'yMax', 'y_end',   'yEnd',   'mesh_max_y', 'max_y') ?? (numY - 1);

  const xSpacing = pick('x_spacing', 'xSpacing', 'x_step', 'xStep') ??
    (numX > 1 ? (xMax - xMin) / (numX - 1) : 1);
  const ySpacing = pick('y_spacing', 'ySpacing', 'y_step', 'yStep') ??
    (numY > 1 ? (yMax - yMin) / (numY - 1) : 1);

  validateGrid(numX, numY, xSpacing, ySpacing, numX, JSON.stringify(json).slice(0, 100));
  return { xMin, xMax, xSpacing, yMin, yMax, ySpacing, radius: -1, numX, numY, points };
}

// ── Smoothieware heightmap.csv parser ────────────────────────────────────────

/**
 * Smoothieware saves grid compensation to "heightmap.csv".
 * Lines beginning with '#' are comments; the metadata comment has the form:
 *   #x_size:5 y_size:5 x_min:-100 x_max:100 y_min:-100 y_max:100 z_min:-0.5 z_max:0.5
 * Data rows use either space or comma as separators.
 *
 * Some firmware variants use double-slash (//) comments.
 */
function parseSmoothiewireHeightMap(lines: string[]): DuetHeightMap {
  let numX = 0, numY = 0;
  let xMin = 0, xMax = 0, yMin = 0, yMax = 0;
  const points: number[][] = [];

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;

    // Comment lines — look for the metadata block
    if (t.startsWith('#') || t.startsWith('//')) {
      // Pattern: key:value pairs, possibly with spaces around ':'
      const parsed = Object.fromEntries(
        [...t.matchAll(/(\w+)\s*:\s*([-\d.]+)/g)].map(([, k, v]) => [k.toLowerCase(), Number(v)]),
      );
      if ('x_size' in parsed) numX = Math.round(parsed['x_size']);
      if ('y_size' in parsed) numY = Math.round(parsed['y_size']);
      if ('x_min'  in parsed) xMin = parsed['x_min'];
      if ('x_max'  in parsed) xMax = parsed['x_max'];
      if ('y_min'  in parsed) yMin = parsed['y_min'];
      if ('y_max'  in parsed) yMax = parsed['y_max'];
      continue;
    }

    // Data rows: comma- or whitespace-separated floats
    const sep    = t.includes(',') ? ',' : /\s+/;
    const values = t.split(sep).map((p) => { const v = parseFloat(p.trim()); return isNaN(v) ? 0 : v; });
    if (values.length > 0) points.push(values);
  }

  // Derive missing grid counts from actual data shape
  if (numX === 0) numX = points[0]?.length ?? 0;
  if (numY === 0) numY = points.length;

  const xSpacing = numX > 1 ? (xMax - xMin) / (numX - 1) : 1;
  const ySpacing = numY > 1 ? (yMax - yMin) / (numY - 1) : 1;

  if (!numX || !numY || !points.length) {
    throw new Error(`Smoothieware heightmap: could not determine grid shape.\n${rawSnippet(lines)}`);
  }

  return { xMin, xMax, xSpacing, yMin, yMax, ySpacing, radius: -1, numX, numY, points };
}

// ── Marlin G29 T serial text-dump parser ─────────────────────────────────────

/**
 * Marlin outputs a text table when you run G29 T (or G29 V4).
 * Three sub-formats exist — MBL, bilinear, and UBL — but all share the pattern
 * of comment-prefixed metadata followed by rows whose leading token is a Y coord.
 *
 * MBL example:
 *   ; Mesh Bed Leveling:
 *   ;  x_min:-100.0 x_max:100.0 y_min:-100.0 y_max:100.0
 *   ;  x_count:5 y_count:5
 *   ;  -0.025  0.012  0.000  0.012  0.025
 *   ;  -0.018  0.007  …
 *
 * UBL / bilinear example:
 *         -90.00  -45.00   0.00  45.00  90.00     ← X-header row
 *  -90.00 | +0.025 +0.012 …                        ← Y-prefixed data rows
 */
function parseMarlinTextDump(lines: string[]): DuetHeightMap {
  let xMin: number | null = null, xMax: number | null = null;
  let yMin: number | null = null, yMax: number | null = null;
  let numX = 0, numY = 0;
  const xCoords: number[] = [];
  const yCoords: number[] = [];
  const rawRows:  number[][] = [];

  for (const raw of lines) {
    // Strip leading "; " (Marlin comments the output with semicolons)
    const t = raw.replace(/^;+\s*/, '').trim();
    if (!t) continue;

    // Key:value metadata  (x_min:-100.0 x_max:100.0 …)
    if (/\w+\s*:\s*[-\d.]/.test(t) && !/^\d/.test(t)) {
      const parsed = Object.fromEntries(
        [...t.matchAll(/(\w+)\s*:\s*([-\d.]+)/g)].map(([, k, v]) => [k.toLowerCase(), Number(v)]),
      );
      if ('x_min'   in parsed) xMin = parsed['x_min'];
      if ('x_max'   in parsed) xMax = parsed['x_max'];
      if ('y_min'   in parsed) yMin = parsed['y_min'];
      if ('y_max'   in parsed) yMax = parsed['y_max'];
      if ('x_count' in parsed) numX = Math.round(parsed['x_count']);
      if ('y_count' in parsed) numY = Math.round(parsed['y_count']);
      if ('xcount'  in parsed) numX = Math.round(parsed['xcount']);
      if ('ycount'  in parsed) numY = Math.round(parsed['ycount']);
      continue;
    }

    // UBL/bilinear X-header row — all tokens are numbers, none is a Y-coord pipe
    if (!t.includes('|') && /^[-\d\s.+]+$/.test(t.replace(/[,]/g, ' '))) {
      const nums = t.split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));
      if (nums.length >= 2) { xCoords.push(...nums); continue; }
    }

    // UBL / bilinear data row: "yval | val val val …"
    if (t.includes('|')) {
      const [yPart, dataPart] = t.split('|', 2);
      const yVal = parseFloat(yPart.trim());
      if (!isNaN(yVal)) yCoords.push(yVal);
      const vals = dataPart.trim().split(/[\s,]+/).map((p) => {
        const v = parseFloat(p.replace(/^\+/, ''));
        return isNaN(v) ? 0 : v;
      });
      if (vals.length) rawRows.push(vals);
      continue;
    }

    // MBL plain data row: just a row of floats
    if (/^[-+\d]/.test(t)) {
      const nums = t.split(/[\s,]+/).map((p) => {
        const v = parseFloat(p.replace(/^\+/, ''));
        return isNaN(v) ? 0 : v;
      }).filter((_, _index, a) => a.length > 0);
      if (nums.length >= 2) rawRows.push(nums);
    }
  }

  // Resolve bounds from collected coordinates or fall back to metadata
  if (xCoords.length >= 2) {
    if (xMin === null) xMin = Math.min(...xCoords);
    if (xMax === null) xMax = Math.max(...xCoords);
    if (!numX) numX = xCoords.length;
  }
  if (yCoords.length >= 2) {
    if (yMin === null) yMin = Math.min(...yCoords);
    if (yMax === null) yMax = Math.max(...yCoords);
    if (!numY) numY = yCoords.length;
  }

  const points = rawRows.filter((r) => r.length > 0);
  if (!numX) numX = points[0]?.length ?? 0;
  if (!numY) numY = points.length;
  xMin ??= 0; xMax ??= numX - 1;
  yMin ??= 0; yMax ??= numY - 1;

  const xSpacing = numX > 1 ? (xMax - xMin) / (numX - 1) : 1;
  const ySpacing = numY > 1 ? (yMax - yMin) / (numY - 1) : 1;

  if (!numX || !numY || !points.length) {
    throw new Error(`Marlin G29 text dump: could not parse grid.\n${rawSnippet(lines)}`);
  }

  return { xMin, xMax, xSpacing, yMin, yMax, ySpacing, radius: -1, numX, numY, points };
}

// ── Generic bare-number grid (last resort) ────────────────────────────────────

/**
 * No recognised format header was found.
 * Try to treat every non-empty, non-comment line as a row of floats.
 *
 * Bounds are inferred from first/last row/column index (unit spacing = 1 mm).
 * This lets the visualiser work with the relative grid shape even if the
 * real probe coordinates are unknown.
 */
function parseBareNumberGrid(lines: string[]): DuetHeightMap {
  const points: number[][] = [];

  for (const raw of lines) {
    const t = raw.trim();
    if (!t || t.startsWith(';') || t.startsWith('#') || t.startsWith('/')) continue;
    if (/[a-zA-Z]/.test(t)) continue; // skip any leftover label lines

    const sep  = t.includes(',') ? ',' : /\s+/;
    const vals = t.split(sep).map((p) => { const v = parseFloat(p.trim()); return isNaN(v) ? null : v; });
    const row  = vals.filter((v): v is number => v !== null);
    if (row.length > 0) points.push(row);
  }

  if (!points.length) {
    throw new Error(`Height map: could not find any numeric data rows.\n${rawSnippet(lines)}`);
  }

  const numX = points[0].length;
  const numY = points.length;

  // Consistent column count is required — silently trim/pad short rows.
  const normalised = points.map((row) => {
    if (row.length === numX) return row;
    if (row.length > numX)   return row.slice(0, numX);
    return [...row, ...Array<number>(numX - row.length).fill(0)];
  });

  return {
    xMin: 0, xMax: numX - 1, xSpacing: 1,
    yMin: 0, yMax: numY - 1, ySpacing: 1,
    radius: -1, numX, numY,
    points: normalised,
  };
}

// ── Shared validation / data-row parsing ─────────────────────────────────────

function validateGrid(
  numX: number, numY: number,
  xSpacing: number, ySpacing: number,
  colCount: number, paramLine: string,
): void {
  if (!Number.isFinite(numX) || numX <= 0 || !Number.isFinite(numY) || numY <= 0) {
    throw new Error(
      `HeightMap CSV: invalid grid dimensions numX=${numX} numY=${numY} ` +
      `(${colCount}-column header).\nParam row: "${paramLine.slice(0, 200)}"`,
    );
  }
  if (!Number.isFinite(xSpacing) || xSpacing <= 0 || !Number.isFinite(ySpacing) || ySpacing <= 0) {
    throw new Error(`HeightMap CSV: invalid spacing xSpacing=${xSpacing} ySpacing=${ySpacing}.`);
  }
}

function parseDataRows(lines: string[], startIdx: number): number[][] {
  const points: number[][] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith(';')) continue;
    if (/^[a-zA-Z]/.test(t)) continue;
    points.push(t.split(',').map((part) => { const v = parseFloat(part.trim()); return isNaN(v) ? 0 : v; }));
  }
  if (!points.length) throw new Error('HeightMap CSV: no data rows found after parameter line.');
  return points;
}
