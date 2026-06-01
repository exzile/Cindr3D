import * as opentype from 'opentype.js';

// ─── Font cache (per URL) ─────────────────────────────────────────────────────
const DEFAULT_FONT_URL = '/fonts/Roboto-Regular.ttf';
const fontCache = new Map<string, opentype.Font>();
const fontPromises = new Map<string, Promise<opentype.Font>>();

/** Load (and cache) any font face by URL. Concurrent callers share one fetch. */
export async function loadFont(url: string): Promise<opentype.Font> {
  const cached = fontCache.get(url);
  if (cached) return cached;
  const inflight = fontPromises.get(url);
  if (inflight) return inflight;
  const promise = new Promise<opentype.Font>((resolve, reject) => {
    opentype.load(url, (err, font) => {
      if (err || !font) {
        reject(err ?? new Error(`Font failed to load: ${url}`));
      } else {
        fontCache.set(url, font);
        resolve(font);
      }
    });
  });
  fontPromises.set(url, promise);
  return promise;
}

/** Back-compat: the default Roboto Regular face. */
export async function loadDefaultFont(): Promise<opentype.Font> {
  return loadFont(DEFAULT_FONT_URL);
}

// ─── Bezier samplers ─────────────────────────────────────────────────────────
function sampleQuad(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  t: number,
): [number, number] {
  const mt = 1 - t;
  return [
    mt * mt * x0 + 2 * mt * t * x1 + t * t * x2,
    mt * mt * y0 + 2 * mt * t * y1 + t * t * y2,
  ];
}

function sampleCubic(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  t: number,
): [number, number] {
  const mt = 1 - t;
  return [
    mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
    mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
  ];
}

// ─── Public types ─────────────────────────────────────────────────────────────
export type { TextSegment, TextFormatOptions } from '../types/sketch-text.types';
import type { TextSegment, TextFormatOptions } from '../types/sketch-text.types';

function commandsToSegments(commands: opentype.PathCommand[], samples: number): TextSegment[] {
  const segs: TextSegment[] = [];
  let cx = 0, cy = 0, startX = 0, startY = 0;
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M': cx = cmd.x; cy = cmd.y; startX = cmd.x; startY = cmd.y; break;
      case 'L': segs.push({ x1: cx, y1: cy, x2: cmd.x, y2: cmd.y }); cx = cmd.x; cy = cmd.y; break;
      case 'Q': {
        for (let i = 1; i <= samples; i++) {
          const t = i / samples;
          const [nx, ny] = sampleQuad(cx, cy, cmd.x1, cmd.y1, cmd.x, cmd.y, t);
          segs.push({ x1: cx, y1: cy, x2: nx, y2: ny }); cx = nx; cy = ny;
        }
        break;
      }
      case 'C': {
        for (let i = 1; i <= samples; i++) {
          const t = i / samples;
          const [nx, ny] = sampleCubic(cx, cy, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y, t);
          segs.push({ x1: cx, y1: cy, x2: nx, y2: ny }); cx = nx; cy = ny;
        }
        break;
      }
      case 'Z': {
        if (Math.abs(cx - startX) > 0.01 || Math.abs(cy - startY) > 0.01) {
          segs.push({ x1: cx, y1: cy, x2: startX, y2: startY });
        }
        cx = startX; cy = startY; break;
      }
    }
  }
  return segs;
}

/**
 * Convert a font + text string into flat polyline segments.
 *
 * opentype.js uses Y-down (origin at baseline, ascenders go negative).
 * The sketch plane is Y-up, so Y is negated during the final transform.
 *
 * @param font      loaded opentype.Font
 * @param text      string to render
 * @param anchorX   sketch-plane X of the text anchor
 * @param anchorY   sketch-plane Y of the text anchor
 * @param fontSize  character cap-height in sketch units (mm)
 * @param samples   bezier linearization quality (default 8)
 * @param format    formatting options: italic, bold, charSpacing, flipH, flipV, hAlign, vAlign
 */
export function fontPathToSegments(
  font: opentype.Font,
  text: string,
  anchorX: number,
  anchorY: number,
  fontSize: number,
  samples = 8,
  format: TextFormatOptions = {},
): TextSegment[] {
  const scale = fontSize / font.unitsPerEm;
  const charSpacing = format.charSpacing ?? 0;

  // Per-character layout so we can inject extra inter-character spacing
  let penX = 0;
  const rawSegs: TextSegment[] = [];

  for (const char of text) {
    const glyph = font.charToGlyph(char);
    const path = glyph.getPath(penX, 0, fontSize);
    rawSegs.push(...commandsToSegments(path.commands as opentype.PathCommand[], samples));
    penX += (glyph.advanceWidth ?? 0) * scale + charSpacing;
  }

  // Total rendered width (remove trailing extra spacing)
  const totalWidth = penX - (text.length > 0 ? charSpacing : 0);

  // Ascender height for vertical alignment (opentype Y-down: ascender is negative)
  const ascenderHeight = Math.abs(font.ascender * scale);

  // Horizontal alignment offset
  let hOff = 0;
  if (format.hAlign === 'center') hOff = -totalWidth / 2;
  else if (format.hAlign === 'right') hOff = -totalWidth;

  // Vertical alignment offset (in opentype Y-down space, so positive = move down)
  let vOff = 0;
  if (format.vAlign === 'middle') vOff = ascenderHeight / 2;
  else if (format.vAlign === 'top') vOff = ascenderHeight;

  const ITALIC_SHEAR = 0.25;
  // Shear only when the font resolver asked for synthetic italic. When a real
  // italic face is loaded, `shear` is false so glyphs aren't double-slanted.
  // Falls back to `italic` for legacy callers that don't pass `shear`.
  const applyShear = format.shear ?? format.italic ?? false;

  return rawSegs.map((s) => {
    let ax1 = s.x1 + hOff;
    let ay1 = s.y1 + vOff;
    let ax2 = s.x2 + hOff;
    let ay2 = s.y2 + vOff;

    // Flip in opentype space before Y-flip
    if (format.flipH) { ax1 = -ax1 + hOff * 2; ax2 = -ax2 + hOff * 2; }
    if (format.flipV) { ay1 = -ay1 + vOff * 2; ay2 = -ay2 + vOff * 2; }

    // Y-down → Y-up
    const fy1 = -ay1;
    const fy2 = -ay2;

    return {
      x1: anchorX + ax1 + (applyShear ? fy1 * ITALIC_SHEAR : 0),
      y1: anchorY + fy1,
      x2: anchorX + ax2 + (applyShear ? fy2 * ITALIC_SHEAR : 0),
      y2: anchorY + fy2,
    };
  });
}

// ─── Contour extraction (for extrudable closed profiles) ──────────────────────

export interface ContourPoint2D { x: number; y: number; }

/**
 * Decompose a glyph's path commands into closed contours (one per M…Z run),
 * each a list of sampled points in opentype space. The closing point is
 * appended so each contour's first ≈ last (a closed loop).
 */
function commandsToContours(commands: opentype.PathCommand[], samples: number): ContourPoint2D[][] {
  const contours: ContourPoint2D[][] = [];
  let current: ContourPoint2D[] | null = null;
  let cx = 0, cy = 0, startX = 0, startY = 0;
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        if (current && current.length > 1) contours.push(current);
        current = [{ x: cmd.x, y: cmd.y }];
        cx = cmd.x; cy = cmd.y; startX = cmd.x; startY = cmd.y;
        break;
      case 'L':
        current?.push({ x: cmd.x, y: cmd.y }); cx = cmd.x; cy = cmd.y;
        break;
      case 'Q':
        for (let i = 1; i <= samples; i++) {
          const t = i / samples;
          const [nx, ny] = sampleQuad(cx, cy, cmd.x1, cmd.y1, cmd.x, cmd.y, t);
          current?.push({ x: nx, y: ny }); cx = nx; cy = ny;
        }
        break;
      case 'C':
        for (let i = 1; i <= samples; i++) {
          const t = i / samples;
          const [nx, ny] = sampleCubic(cx, cy, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y, t);
          current?.push({ x: nx, y: ny }); cx = nx; cy = ny;
        }
        break;
      case 'Z':
        // Close the loop back to the contour start.
        current?.push({ x: startX, y: startY }); cx = startX; cy = startY;
        break;
    }
  }
  if (current && current.length > 1) contours.push(current);
  return contours;
}

/**
 * Convert a font + text string into closed 2D contours (Y-up sketch space,
 * origin at 0). One contour per glyph outline / counter, honoring the same
 * layout/format transforms as {@link fontPathToSegments}. Used to build
 * extrudable closed sketch profiles (each contour → one closed entity).
 */
export function fontPathToContours(
  font: opentype.Font,
  text: string,
  fontSize: number,
  samples = 8,
  format: TextFormatOptions = {},
): ContourPoint2D[][] {
  const scale = fontSize / font.unitsPerEm;
  const charSpacing = format.charSpacing ?? 0;

  let penX = 0;
  const rawContours: ContourPoint2D[][] = [];
  for (const char of text) {
    const glyph = font.charToGlyph(char);
    const path = glyph.getPath(penX, 0, fontSize);
    rawContours.push(...commandsToContours(path.commands as opentype.PathCommand[], samples));
    penX += (glyph.advanceWidth ?? 0) * scale + charSpacing;
  }

  const totalWidth = penX - (text.length > 0 ? charSpacing : 0);
  const ascenderHeight = Math.abs(font.ascender * scale);

  let hOff = 0;
  if (format.hAlign === 'center') hOff = -totalWidth / 2;
  else if (format.hAlign === 'right') hOff = -totalWidth;

  let vOff = 0;
  if (format.vAlign === 'middle') vOff = ascenderHeight / 2;
  else if (format.vAlign === 'top') vOff = ascenderHeight;

  const ITALIC_SHEAR = 0.25;
  const applyShear = format.shear ?? format.italic ?? false;

  return rawContours.map((contour) =>
    contour.map((p) => {
      let ax = p.x + hOff;
      let ay = p.y + vOff;
      if (format.flipH) ax = -ax + hOff * 2;
      if (format.flipV) ay = -ay + vOff * 2;
      const fy = -ay; // Y-down → Y-up
      return { x: ax + (applyShear ? fy * ITALIC_SHEAR : 0), y: fy };
    }),
  );
}
