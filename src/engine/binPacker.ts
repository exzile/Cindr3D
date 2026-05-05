// Simple 2D rectangle bin packer (MaxRects, BSSF heuristic). Used by the
// slicer's auto-arrange to fit objects more densely than the previous
// row-major strip layout.

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PackInput {
  id: string;
  w: number;
  h: number;
  /** Existing position, used as fallback if the rect doesn't fit anywhere. */
  fallback: { x: number; y: number };
}

export interface PackResult {
  id: string;
  x: number;
  y: number;
  rotated: boolean;
}

export interface PackPlacementCandidate {
  input: PackInput;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
}

export interface PackOptions {
  scorePlacement?: (candidate: PackPlacementCandidate) => number;
}

export function packRectangles(
  bedW: number,
  bedH: number,
  inputs: PackInput[],
  margin = 4,
  options: PackOptions = {},
): PackResult[] {
  // Sort by longest edge desc — classic shelf/maxrects warmup.
  const items = [...inputs].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
  let free: Rect[] = [{ x: 0, y: 0, w: bedW, h: bedH }];
  const out: PackResult[] = [];

  for (const it of items) {
    const targetW = it.w + margin;
    const targetH = it.h + margin;
    let bestRect: Rect | null = null;
    let bestRot = false;
    let bestScore = Infinity;

    for (const fr of free) {
      // Try original orientation.
      if (fr.w >= targetW && fr.h >= targetH) {
        const score = Math.min(fr.w - targetW, fr.h - targetH) +
          Math.max(0, options.scorePlacement?.({ input: it, x: fr.x, y: fr.y, w: targetW, h: targetH, rotated: false }) ?? 0);
        if (score < bestScore) {
          bestScore = score;
          bestRect = fr;
          bestRot = false;
        }
      }
      // Try rotated 90°.
      if (fr.w >= targetH && fr.h >= targetW) {
        const score = Math.min(fr.w - targetH, fr.h - targetW) +
          Math.max(0, options.scorePlacement?.({ input: it, x: fr.x, y: fr.y, w: targetH, h: targetW, rotated: true }) ?? 0);
        if (score < bestScore) {
          bestScore = score;
          bestRect = fr;
          bestRot = true;
        }
      }
    }

    if (!bestRect) {
      // Doesn't fit — leave at fallback so the caller can detect overflow.
      out.push({ id: it.id, x: it.fallback.x, y: it.fallback.y, rotated: false });
      continue;
    }

    const placedW = bestRot ? targetH : targetW;
    const placedH = bestRot ? targetW : targetH;
    out.push({ id: it.id, x: bestRect.x, y: bestRect.y, rotated: bestRot });

    // Split the chosen free rect into the two leftover strips.
    const newFree: Rect[] = [];
    for (const fr of free) {
      if (fr === bestRect) {
        // Right strip
        if (fr.w - placedW > 0) {
          newFree.push({ x: fr.x + placedW, y: fr.y, w: fr.w - placedW, h: placedH });
        }
        // Bottom strip
        if (fr.h - placedH > 0) {
          newFree.push({ x: fr.x, y: fr.y + placedH, w: fr.w, h: fr.h - placedH });
        }
      } else {
        newFree.push(fr);
      }
    }
    // Prune contained rects so the free list doesn't blow up.
    free = newFree.filter((r, i) =>
      !newFree.some((o, j) =>
        i !== j && o.x <= r.x && o.y <= r.y
        && o.x + o.w >= r.x + r.w && o.y + o.h >= r.y + r.h));
  }

  return out;
}
