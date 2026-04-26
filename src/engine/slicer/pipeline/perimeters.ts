import * as THREE from 'three';
import polygonClipping, { type MultiPolygon as PCMultiPolygon, type Ring as PCRing } from 'polygon-clipping';

import type { PrintProfile } from '../../../types/slicer';
import type { PerimeterDeps } from '../../../types/slicer-pipeline-deps.types';
import type { Contour, GeneratedPerimeters, InfillRegion, WallLineWidth } from '../../../types/slicer-pipeline.types';
import { booleanMultiPolygonClipper2Sync } from '../geometry/clipper2Boolean';

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

function unionMultiPolygon(mp: PCMultiPolygon): PCMultiPolygon {
  const clipperResult = booleanMultiPolygonClipper2Sync(mp, [], 'union');
  if (clipperResult) return clipperResult;
  return mp.length === 1 ? mp : polygonClipping.union(mp[0], ...mp.slice(1));
}

function intersectMultiPolygon(a: PCMultiPolygon, b: PCMultiPolygon): PCMultiPolygon {
  return booleanMultiPolygonClipper2Sync(a, b, 'intersection') ?? polygonClipping.intersection(a, b);
}

function differenceMultiPolygon(a: PCMultiPolygon, clips: PCMultiPolygon[]): PCMultiPolygon {
  if (clips.length === 0) return a;
  const mergedClips = clips.length === 1 ? clips[0] : unionMultiPolygon(clips.flat());
  return booleanMultiPolygonClipper2Sync(a, mergedClips, 'difference') ?? polygonClipping.difference(a, ...clips);
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
    unioned = unionMultiPolygon(inflated);
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
  const lineWidths: WallLineWidth[] = [];
  const wallClosed: boolean[] = [];
  const wallDepths: number[] = [];
  let outerCount = 0;
  for (let i = 0; i < p.walls.length; i++) {
    if (!keep[i]) continue;
    walls.push(p.walls[i]);
    lineWidths.push(p.lineWidths[i] ?? defaultWallLineWidth);
    wallClosed.push(p.wallClosed?.[i] ?? true);
    wallDepths.push(p.wallDepths[i] ?? 0);
    if (i < p.outerCount) outerCount++;
  }
  return { walls, lineWidths, wallClosed, wallDepths, outerCount, innermostHoles: p.innermostHoles, infillRegions: p.infillRegions };
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
  // polygonClipping.difference on dense tessellated outer + hole contours
  // frequently produces hundreds of sub-mm sliver polygons at the shared
  // edges. Those slivers (a) emit degenerate-wall gcode no printer can follow
  // and (b) each become a separate infill region that gets sprayed with
  // infill dots on wall surfaces. Drop anything below roughly half a bead's
  // worth of area — real material regions are always substantially larger.
  const minPolyArea = Math.max(0.02, lineWidth * lineWidth * 0.5);
  const ringArea = (ring: PCRing): number => {
    let a2 = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      a2 += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return Math.abs(a2) / 2;
  };
  const dropTinyPolygons = (mp: PCMultiPolygon): PCMultiPolygon =>
    mp.filter((poly) => poly.length > 0 && ringArea(poly[0]) >= minPolyArea);
  const ringBBox = (ring: PCRing) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < ring.length - 1; i++) {
      const x = ring[i][0], y = ring[i][1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { minX, maxX, minY, maxY };
  };

  // Containment check: returns true if `hole` is fully inside `outer`. Used to
  // decide whether each per-hole wall loop should still be generated at this
  // depth. When a hole's offset has expanded enough to break through the
  // outer's offset boundary, there is no longer printable wall material between
  // them, and emitting a wall-inner around the hole would force the slicer
  // path to "hug" the outer wall around that hole — visually reading as the
  // green inner-wall going around the red outer-wall in the preview.
  const holeContainedInOuter = (
    hole: THREE.Vector2[],
    outer: THREE.Vector2[],
  ): boolean => {
    const holeMP: PCMultiPolygon = [[toRing(hole)]];
    const outerMP: PCMultiPolygon = [[toRing(outer)]];
    try {
      const intersection = intersectMultiPolygon(outerMP, holeMP);
      let intArea = 0;
      for (const poly of intersection) {
        if (poly.length > 0) intArea += ringArea(poly[0]);
      }
      const holeRingArea = ringArea(toRing(hole));
      // ≥ 99% of the hole is inside the outer → still a valid hole at this depth
      return holeRingArea > 1e-9 && intArea >= holeRingArea * 0.99;
    } catch {
      return false;
    }
  };

  // Pairwise overlap check between two holes — both expanded at this depth.
  const holesOverlap = (a: THREE.Vector2[], b: THREE.Vector2[]): boolean => {
    const aMP: PCMultiPolygon = [[toRing(a)]];
    const bMP: PCMultiPolygon = [[toRing(b)]];
    try {
      const intersection = intersectMultiPolygon(aMP, bMP);
      for (const poly of intersection) {
        if (poly.length > 0 && ringArea(poly[0]) > 1e-6) return true;
      }
      return false;
    } catch {
      return true;
    }
  };

  const computeDepth = (offset: number): {
    result: PCMultiPolygon;
    holesAtDepth: THREE.Vector2[][];
    /** Outer wall loops at this depth — derived from the offset outer
     *  contour after running it through polygonClipping.union, which splits
     *  self-intersecting offsets into multiple disjoint polygons. Each
     *  polygon is emitted as its own clean wall ring. This is critical at
     *  layers where the offset has pinched the outer through a "neck"
     *  (typical when a hole has broken through the outer at this depth) —
     *  unioning produces multiple separate regions that each get their
     *  own clean wall, instead of one giant snake of a perimeter. */
    cleanOuters: THREE.Vector2[][];
    /** Holes that are still fully contained inside cleanOuter at this depth,
     *  i.e. the wall material between them and the outer is still thick
     *  enough to hold a wall loop. Each is emitted as an INDEPENDENT closed
     *  loop, which is what makes the preview show one clean ring per feature
     *  instead of one giant notched chain. */
    validHoles: THREE.Vector2[][];
  } | null => {
    const outerShrunk = deps.offsetContour(outerContour, offset);
    if (outerShrunk.length < 3) return null;

    const holesExpanded = holeContours
      .map((h) => deps.offsetContour(h, offset))
      .filter((h) => h.length >= 3);

    // Validate each hole: must be fully inside outerShrunk AND not overlap
    // any already-validated hole at this depth. Holes that fail validation
    // are skipped — there's no printable material between them and the
    // outer (or another hole) to support a wall loop.
    const validHoles: THREE.Vector2[][] = [];
    for (const hole of holesExpanded) {
      if (!holeContainedInOuter(hole, outerShrunk)) continue;
      let overlaps = false;
      for (const v of validHoles) {
        if (holesOverlap(hole, v)) { overlaps = true; break; }
      }
      if (!overlaps) validHoles.push(hole);
    }

    let result: PCMultiPolygon = [[toRing(outerShrunk)]];
    if (holesExpanded.length > 0) {
      // Fast path: when expanded holes don't intersect each other or the outer
      // boundary, we can assemble the polygon directly without routing through
      // polygonClipping.difference. The library's union/difference pass
      // aggressively merges colinear points, collapsing a well-tessellated
      // circular hole offset from ~30 points to ~8 — which is exactly what
      // was producing the octagonal rings around mounting holes in the
      // preview. Use the fast path when possible; fall back to polygon-
      // clipping for overlapping / self-intersecting cases.
      const outerBbox = ringBBox(toRing(outerShrunk));
      const holeBboxes = holesExpanded.map((h) => ringBBox(toRing(h)));
      let needsClipping = false;
      for (let i = 0; i < holeBboxes.length && !needsClipping; i++) {
        const hb = holeBboxes[i];
        // Hole bbox strictly outside outer bbox → clipping needed.
        if (hb.minX < outerBbox.minX || hb.maxX > outerBbox.maxX || hb.minY < outerBbox.minY || hb.maxY > outerBbox.maxY) {
          needsClipping = true;
          break;
        }
        for (let j = i + 1; j < holeBboxes.length; j++) {
          const hb2 = holeBboxes[j];
          // Hole bboxes overlap → their rings may merge, clipping needed.
          if (hb.maxX > hb2.minX && hb2.maxX > hb.minX && hb.maxY > hb2.minY && hb2.maxY > hb.minY) {
            needsClipping = true;
            break;
          }
        }
      }

      if (!needsClipping) {
        // Assemble a single polygon with outer ring + each hole as a ring
        // (reversed to match polygon-clipping's hole orientation convention).
        const poly: PCRing[] = [toRing(outerShrunk)];
        for (const h of holesExpanded) poly.push(toRing([...h].reverse()));
        result = [poly];
      } else {
        const holeMPs: PCMultiPolygon[] = holesExpanded.map((h) => [[toRing([...h].reverse())]]);
        try {
          result = differenceMultiPolygon(result, holeMPs);
        } catch {
          result = [[toRing(outerShrunk)]];
        }
      }
    }

    result = dropTinyPolygons(result);
    if (result.length === 0) return null;

    // Derive cleanOuters from the polygon-clipping difference result. Each
    // polygon's outer ring is a NOTCHED perimeter — for layers where a hole
    // has broken through the outer, the notch correctly traces around the
    // breakthrough region instead of drawing the wall straight across the
    // hole's empty space. Filtering broken-through holes from validHoles
    // (above) PLUS using the notched perimeter here gives the correct
    // topology: no walls drawn over empty regions.
    const cleanOuters: THREE.Vector2[][] = [];
    for (const poly of result) {
      if (poly.length === 0) continue;
      const ring = fromRing(poly[0]);
      if (ring.length >= 3) cleanOuters.push(ring);
    }
    if (cleanOuters.length === 0) return null;

    const holesAtDepth: THREE.Vector2[][] = [];
    for (const poly of result) {
      for (let i = 1; i < poly.length; i++) {
        const loop = fromRing(poly[i]);
        if (loop.length >= 3) holesAtDepth.push(loop);
      }
    }

    return { result, holesAtDepth, cleanOuters, validHoles };
  };

  const outerLoops: THREE.Vector2[][] = [];
  const holeLoops: THREE.Vector2[][] = [];
  const outerLineWidths: number[] = [];
  const holeLineWidths: number[] = [];
  const outerDepths: number[] = []; // parallel to outerLoops, the offset depth (0 = wall-outer)
  const holeDepths: number[] = [];  // parallel to holeLoops, the offset depth (0 = wall-outer of that hole)
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
            // Emit each feature (outer regions + each valid hole) as its own
            // clean closed loop, NOT the merged polygon's rings — that
            // prevents the wall from "hugging" around any hole that has
            // broken through the outer at this depth. Depth-0 walls (the
            // outermost wall of each contour, both outer perimeter and each
            // hole) are tagged via wallDepths so the emit step can label
            // them as wall-outer.
            for (const ring of best.cleanOuters) {
              if (ring.length >= 3) {
                outerLoops.push(ring);
                outerLineWidths.push(widened);
                outerDepths.push(w);
              }
            }
            for (const hole of best.validHoles) {
              if (hole.length >= 3) {
                holeLoops.push(hole);
                holeLineWidths.push(widened);
                holeDepths.push(w);
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
    let cleanOuters = nominalDepth.cleanOuters;
    let validHoles = nominalDepth.validHoles;
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
        cleanOuters = best.cleanOuters;
        validHoles = best.validHoles;
      }
    }

    // Emit each feature as its own clean closed loop. The merged polygon
    // (`result`) is still used below for infill region computation, but the
    // wall loops themselves come from cleanOuters + validHoles so each
    // feature gets a topologically clean wall ring even when neighbouring
    // features have broken through each other at this depth.
    for (const ring of cleanOuters) {
      if (ring.length >= 3) {
        outerLoops.push(ring);
        outerLineWidths.push(depthLineWidth);
        outerDepths.push(w);
      }
    }
    for (const hole of validHoles) {
      if (hole.length >= 3) {
        holeLoops.push(hole);
        holeLineWidths.push(depthLineWidth);
        holeDepths.push(w);
      }
    }
    const regionsAtDepth = deps.multiPolygonToRegions(result);
    if (thisDepthHoles.length > 0) {
      lastInnermostHoles = thisDepthHoles;
      lastInfillRegions = regionsAtDepth;
    } else if (lastInfillRegions.length === 0) {
      lastInfillRegions = regionsAtDepth;
    }
  }

  return {
    walls: [...outerLoops, ...holeLoops],
    lineWidths: [...outerLineWidths, ...holeLineWidths],
    wallDepths: [...outerDepths, ...holeDepths],
    outerCount: outerLoops.length,
    innermostHoles: lastInnermostHoles,
    infillRegions: lastInfillRegions,
  };
}
