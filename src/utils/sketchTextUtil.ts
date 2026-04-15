import * as opentype from 'opentype.js';

// ─── Font cache ──────────────────────────────────────────────────────────────
let cachedFont: opentype.Font | null = null;
let loadPromise: Promise<opentype.Font> | null = null;

export async function loadDefaultFont(): Promise<opentype.Font> {
  if (cachedFont) return cachedFont;
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<opentype.Font>((resolve, reject) => {
    opentype.load('/fonts/Roboto-Regular.ttf', (err, font) => {
      if (err || !font) {
        reject(err ?? new Error('Font failed to load'));
      } else {
        cachedFont = font;
        resolve(font);
      }
    });
  });
  return loadPromise;
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
export interface TextSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Convert a font + text string into flat polyline segments.
 *
 * opentype.js uses a Y-down coordinate system (origin at baseline, ascenders go
 * negative). The sketch plane uses Y-up, so we negate all Y values here.
 *
 * @param font     loaded opentype.Font
 * @param text     string to render
 * @param anchorX  sketch-plane X of the text anchor (baseline left)
 * @param anchorY  sketch-plane Y of the text anchor (baseline)
 * @param fontSize character height in sketch units (model-space mm)
 * @param samples  number of linear segments per bezier curve (default 8)
 */
export function fontPathToSegments(
  font: opentype.Font,
  text: string,
  anchorX: number,
  anchorY: number,
  fontSize: number,
  samples = 8,
): TextSegment[] {
  // opentype renders at (0,0) in its own space; we translate afterwards
  const path = font.getPath(text, 0, 0, fontSize);
  const segments: TextSegment[] = [];

  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M': {
        cx = cmd.x;
        cy = cmd.y;
        startX = cmd.x;
        startY = cmd.y;
        break;
      }
      case 'L': {
        segments.push({ x1: cx, y1: cy, x2: cmd.x, y2: cmd.y });
        cx = cmd.x;
        cy = cmd.y;
        break;
      }
      case 'Q': {
        for (let i = 1; i <= samples; i++) {
          const t = i / samples;
          const [nx, ny] = sampleQuad(cx, cy, cmd.x1, cmd.y1, cmd.x, cmd.y, t);
          segments.push({ x1: cx, y1: cy, x2: nx, y2: ny });
          cx = nx;
          cy = ny;
        }
        break;
      }
      case 'C': {
        for (let i = 1; i <= samples; i++) {
          const t = i / samples;
          const [nx, ny] = sampleCubic(cx, cy, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y, t);
          segments.push({ x1: cx, y1: cy, x2: nx, y2: ny });
          cx = nx;
          cy = ny;
        }
        break;
      }
      case 'Z': {
        if (Math.abs(cx - startX) > 0.01 || Math.abs(cy - startY) > 0.01) {
          segments.push({ x1: cx, y1: cy, x2: startX, y2: startY });
        }
        cx = startX;
        cy = startY;
        break;
      }
    }
  }

  // Translate to anchor and flip Y (opentype Y-down → sketch Y-up)
  return segments.map((s) => ({
    x1: anchorX + s.x1,
    y1: anchorY - s.y1,
    x2: anchorX + s.x2,
    y2: anchorY - s.y2,
  }));
}
