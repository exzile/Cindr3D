import * as THREE from 'three';
import polygonClipping, { type MultiPolygon as PCMultiPolygon, type Ring as PCRing } from 'polygon-clipping';

import type { PrintProfile } from '../../../types/slicer';
import type { Contour, GeneratedPerimeters, InfillRegion } from '../types';

interface PerimeterDeps {
  offsetContour: (contour: THREE.Vector2[], offset: number) => THREE.Vector2[];
  signedArea: (points: THREE.Vector2[]) => number;
  multiPolygonToRegions: (mp: PCMultiPolygon) => InfillRegion[];
}

function toRing(pts: THREE.Vector2[]): PCRing {
  const ring: PCRing = pts.map((p) => [p.x, p.y] as [number, number]);
  if (ring.length > 0) {
    const f = ring[0];
    const l = ring[ring.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
  }
  return ring;
}

function fromRing(ring: PCRing): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    pts.push(new THREE.Vector2(ring[i][0], ring[i][1]));
  }
  return pts;
}

export function closeContourGaps(
  contours: Contour[],
  r: number,
  deps: Pick<PerimeterDeps, 'offsetContour' | 'signedArea'>,
): Contour[] {
  if (r <= 0 || contours.length === 0) return contours;
  const significantHoleArea = Math.max(1e-3, Math.PI * Math.pow(r * 4, 2));

  const inflated: PCMultiPolygon = [];
  for (const c of contours) {
    const grown = deps.offsetContour(c.points, c.isOuter ? -r : +r);
    if (grown.length >= 3) inflated.push([toRing(grown)]);
  }
  if (inflated.length === 0) return contours;

  let unioned: PCMultiPolygon;
  try {
    unioned = inflated.length === 1 ? inflated : polygonClipping.union(inflated[0], ...inflated.slice(1));
  } catch {
    return contours;
  }
  if (unioned.length === 0) return contours;

  const result: Contour[] = [];
  for (const poly of unioned) {
    for (let i = 0; i < poly.length; i++) {
      const isOuter = i === 0;
      const ringPts = fromRing(poly[i]);
      const shrunk = deps.offsetContour(ringPts, isOuter ? +r : -r);
      if (shrunk.length >= 3) {
        result.push({
          points: shrunk,
          area: deps.signedArea(shrunk),
          isOuter,
        });
      }
    }
  }

  const originalHoleArea = contours
    .filter((c) => !c.isOuter)
    .map((c) => Math.abs(c.area))
    .filter((area) => area >= significantHoleArea)
    .reduce((sum, area) => sum + area, 0);
  if (originalHoleArea > 0) {
    const resultHoleArea = result
      .filter((c) => !c.isOuter)
      .map((c) => Math.abs(c.area))
      .reduce((sum, area) => sum + area, 0);
    if (resultHoleArea < originalHoleArea * 0.5) return contours;
  }

  return result.length > 0 ? result : contours;
}

export function filterPerimetersByMinOdd(
  p: GeneratedPerimeters,
  minOdd: number,
  defaultWallLineWidth: number,
): GeneratedPerimeters {
  if (minOdd <= 0) return p;
  const keep: boolean[] = p.walls.map((w) => {
    if (w.length < 3) return false;
    let miX = Infinity;
    let maX = -Infinity;
    let miY = Infinity;
    let maY = -Infinity;
    for (const pt of w) {
      if (pt.x < miX) miX = pt.x;
      if (pt.x > maX) maX = pt.x;
      if (pt.y < miY) miY = pt.y;
      if (pt.y > maY) maY = pt.y;
    }
    return Math.min(maX - miX, maY - miY) >= 2 * minOdd;
  });

  const walls: THREE.Vector2[][] = [];
  const lineWidths: number[] = [];
  let outerCount = 0;
  for (let i = 0; i < p.walls.length; i++) {
    if (!keep[i]) continue;
    walls.push(p.walls[i]);
    lineWidths.push(p.lineWidths[i] ?? defaultWallLineWidth);
    if (i < p.outerCount) outerCount++;
  }
  return { walls, lineWidths, outerCount, innermostHoles: p.innermostHoles, infillRegions: p.infillRegions };
}

export function generatePerimetersEx(
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][],
  wallCount: number,
  lineWidth: number,
  outerWallInset: number,
  printProfile: PrintProfile,
  deps: PerimeterDeps,
): GeneratedPerimeters {
  const computeDepth = (offset: number): { result: PCMultiPolygon; holesAtDepth: THREE.Vector2[][] } | null => {
    const outerShrunk = deps.offsetContour(outerContour, offset);
    if (outerShrunk.length < 3) return null;

    const holesExpanded = holeContours
      .map((h) => deps.offsetContour(h, offset))
      .filter((h) => h.length >= 3);

    let result: PCMultiPolygon = [[toRing(outerShrunk)]];
    if (holesExpanded.length > 0) {
      const holeMPs: PCMultiPolygon[] = holesExpanded.map((h) => [[toRing([...h].reverse())]]);
      try {
        result = polygonClipping.difference(result, ...holeMPs);
      } catch {
        result = [[toRing(outerShrunk)]];
      }
    }

    if (result.length === 0) return null;

    const holesAtDepth: THREE.Vector2[][] = [];
    for (const poly of result) {
      for (let i = 1; i < poly.length; i++) {
        const loop = fromRing(poly[i]);
        if (loop.length >= 3) holesAtDepth.push(loop);
      }
    }

    return { result, holesAtDepth };
  };

  const outerLoops: THREE.Vector2[][] = [];
  const holeLoops: THREE.Vector2[][] = [];
  const outerLineWidths: number[] = [];
  const holeLineWidths: number[] = [];
  let lastInnermostHoles: THREE.Vector2[][] = [];
  let lastInfillRegions: InfillRegion[] = [];

  for (let w = 0; w < wallCount; w++) {
    const nominalOffset = w * lineWidth + lineWidth / 2 + (w === 0 ? outerWallInset : 0);
    const nominalDepth = computeDepth(nominalOffset);

    if (!nominalDepth) {
      if (w === 0 && (printProfile.thinWallDetection ?? false)) {
        const minLW = printProfile.minWallLineWidth ?? lineWidth * 0.5;
        const minOffset = outerWallInset + Math.max(0, minLW / 2);
        if (minOffset < nominalOffset) {
          let lo = minOffset;
          let hi = nominalOffset;
          let best: ReturnType<typeof computeDepth> = null;
          const minTrial = computeDepth(minOffset);
          if (minTrial) {
            best = minTrial;
            lo = minOffset;
            for (let iter = 0; iter < 18; iter++) {
              const mid = (lo + hi) / 2;
              const trial = computeDepth(mid);
              if (trial) { lo = mid; best = trial; } else { hi = mid; }
            }
            const widened = Math.max(minLW, 2 * Math.max(0, lo - outerWallInset));
            for (const poly of best.result) {
              if (poly.length > 0) {
                const loop = fromRing(poly[0]);
                if (loop.length >= 3) {
                  outerLoops.push(loop);
                  outerLineWidths.push(widened);
                }
              }
              for (let i = 1; i < poly.length; i++) {
                const loop = fromRing(poly[i]);
                if (loop.length >= 3) {
                  holeLoops.push(loop);
                  holeLineWidths.push(widened);
                }
              }
            }
            if (best.holesAtDepth.length > 0) lastInnermostHoles = best.holesAtDepth;
            lastInfillRegions = deps.multiPolygonToRegions(best.result);
          }
        }
      }
      break;
    }

    let result = nominalDepth.result;
    let thisDepthHoles = nominalDepth.holesAtDepth;
    let depthLineWidth = lineWidth;

    const nextOffset = (w + 1) * lineWidth + lineWidth / 2 + (w === 0 ? outerWallInset : 0);
    const nextDepth = computeDepth(nextOffset);

    if ((printProfile.thinWallDetection ?? false) && nextDepth === null) {
      let lo = nominalOffset;
      let hi = nextOffset;
      let best = nominalDepth;
      for (let iter = 0; iter < 18; iter++) {
        const mid = (lo + hi) / 2;
        const trial = computeDepth(mid);
        if (trial) {
          lo = mid;
          best = trial;
        } else {
          hi = mid;
        }
      }

      const previousMaterialEdge = outerWallInset + w * lineWidth;
      const widened = Math.max(
        printProfile.minWallLineWidth ?? lineWidth * 0.5,
        2 * Math.max(0, lo - previousMaterialEdge),
      );
      if (widened > depthLineWidth + 1e-6) {
        depthLineWidth = widened;
        result = best.result;
        thisDepthHoles = best.holesAtDepth;
      }
    }

    for (const poly of result) {
      if (poly.length > 0) {
        const loop = fromRing(poly[0]);
        if (loop.length >= 3) {
          outerLoops.push(loop);
          outerLineWidths.push(depthLineWidth);
        }
      }
      for (let i = 1; i < poly.length; i++) {
        const loop = fromRing(poly[i]);
        if (loop.length >= 3) {
          holeLoops.push(loop);
          holeLineWidths.push(depthLineWidth);
        }
      }
    }
    if (thisDepthHoles.length > 0) lastInnermostHoles = thisDepthHoles;
    lastInfillRegions = deps.multiPolygonToRegions(result);
  }

  return {
    walls: [...outerLoops, ...holeLoops],
    lineWidths: [...outerLineWidths, ...holeLineWidths],
    outerCount: outerLoops.length,
    innermostHoles: lastInnermostHoles,
    infillRegions: lastInfillRegions,
  };
}
