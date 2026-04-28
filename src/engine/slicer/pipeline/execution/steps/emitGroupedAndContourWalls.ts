import * as THREE from 'three';
import type { SliceMove } from '../../../../../types/slicer';
import type { GeneratedPerimeters } from '../../../../../types/slicer-pipeline.types';
import type { ContourWallData, SlicerExecutionPipeline, SliceLayerState, SliceRun } from './types';
import { lineWidthSpecForLayer } from './lineWidths';

type WallLineWidthSpec = number | number[];

interface EmitOuterLoopParams {
  pipeline: SlicerExecutionPipeline;
  run: SliceRun;
  layer: SliceLayerState;
  pp: SliceRun['pp'];
  li: number;
  layerZ: number;
  layerH: number;
  isFirstLayer: boolean;
  outerWallSpeed: number;
  gcode: string[];
  emitter: SliceRun['emitter'];
  moves: SliceMove[];
  loop: THREE.Vector2[];
  lineWidth: WallLineWidthSpec;
  isClosed?: boolean;
  comment?: string;
  allowCoasting?: boolean;
}

function representativeLineWidth(lineWidth: WallLineWidthSpec | undefined, fallback: number): number {
  if (Array.isArray(lineWidth)) {
    if (lineWidth.length === 0) return fallback;
    return lineWidth.reduce((sum, width) => sum + width, 0) / lineWidth.length;
  }
  return lineWidth ?? fallback;
}

function segmentLineWidth(lineWidth: WallLineWidthSpec, fromIndex: number, toIndex: number): number {
  if (!Array.isArray(lineWidth)) return lineWidth;
  const from = lineWidth[fromIndex] ?? lineWidth[toIndex] ?? lineWidth[0] ?? 0;
  const to = lineWidth[toIndex] ?? from;
  return (from + to) / 2;
}

function centroid(points: THREE.Vector2[]): THREE.Vector2 {
  const center = new THREE.Vector2();
  for (const point of points) center.add(point);
  return center.multiplyScalar(1 / Math.max(1, points.length));
}

function beginSeamLayer(run: SliceRun, li: number) {
  if (run.seamMemoryLayer === li) return;
  if (run.seamMemoryLayer !== undefined) run.previousSeamPoints = run.currentSeamPoints ?? [];
  run.currentSeamPoints = [];
  run.seamMemoryLayer = li;
}

function nearestPreviousSeam(run: SliceRun, loop: THREE.Vector2[], tolerance: number): THREE.Vector2 | null {
  const previous: THREE.Vector2[] = run.previousSeamPoints ?? [];
  if (previous.length === 0 || loop.length === 0) return null;
  const center = centroid(loop);
  let best: THREE.Vector2 | null = null;
  let bestDistance = Infinity;
  for (const point of previous) {
    const distance = point.distanceTo(center);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return bestDistance <= Math.max(tolerance * 8, 10) ? best : null;
}

function reorderOuterLoop(
  pp: SliceRun['pp'],
  pipeline: SlicerExecutionPipeline,
  run: SliceRun,
  layer: SliceLayerState,
  emitter: SliceRun['emitter'],
  loop: THREE.Vector2[],
  lineWidth: number,
  li: number,
): THREE.Vector2[] {
  const continuityTolerance = pp.zSeamContinuityDistance ?? 2;
  const seamIdx = pipeline.findSeamPosition(loop, pp, li, emitter.currentX, emitter.currentY, {
    previousSeam: nearestPreviousSeam(run, loop, continuityTolerance),
    continuityTolerance,
    userSpecifiedRadius: pp.zSeamUserSpecifiedRadius ?? 0,
    isSupported: layer.hasBridgeRegions
      ? (point: THREE.Vector2) => !layer.isInBridgeRegion(point.x, point.y)
      : undefined,
  });
  run.currentSeamPoints.push(loop[seamIdx].clone());
  let reordered = pipeline.reorderFromIndex(loop, seamIdx);
  if (pp.fluidMotionEnable && reordered.length >= 3) {
    const fmAngle = ((pp.fluidMotionAngle ?? 15) * Math.PI) / 180;
    const fmSmall = pp.fluidMotionSmallDistance ?? 0.01;
    const smoothed: THREE.Vector2[] = [];
    for (let i = 0; i < reordered.length; i++) {
      const prev = reordered[(i - 1 + reordered.length) % reordered.length];
      const curr = reordered[i];
      const next = reordered[(i + 1) % reordered.length];
      const d1 = prev.distanceTo(curr);
      const d2 = next.distanceTo(curr);
      if (d1 < fmSmall || d2 < fmSmall) { smoothed.push(curr); continue; }
      const v1 = new THREE.Vector2().subVectors(prev, curr).normalize();
      const v2 = new THREE.Vector2().subVectors(next, curr).normalize();
      const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
      if (turn > fmAngle) {
        const off = Math.min(d1, d2) * 0.25;
        smoothed.push(new THREE.Vector2(curr.x - v1.x * -off, curr.y - v1.y * -off), curr, new THREE.Vector2(curr.x - v2.x * -off, curr.y - v2.y * -off));
      } else smoothed.push(curr);
    }
    reordered = smoothed;
  }
  if ((pp.alternateWallDirections ?? false) && li % 2 === 1) reordered = [reordered[0], ...reordered.slice(1).reverse()];
  // Microscopic-noise simplification only — collapse vertices within a
  // tight chord tolerance (matches the extrude-time `circleSegments`
  // chord tolerance of ~20 µm). The old `lineWidth * 0.5` tolerance was
  // a pre-libArachne workaround for narrow-finger collapse; libArachne
  // now handles those via transition zones, and an aggressive RDP here
  // turns smooth circles (with our adaptive curveSegments) into visibly
  // polygonal walls.
  return pipeline.simplifyClosedContour(reordered, Math.max(0.005, lineWidth * 0.05));
}

function emitOuterLoop(params: EmitOuterLoopParams): number {
  const { pp, li, layerZ, layerH, isFirstLayer, outerWallSpeed, gcode, emitter, moves } = params;
  const variableLineWidth = Array.isArray(params.lineWidth);
  const isClosed = params.isClosed ?? true;
  const fallbackLineWidth = representativeLineWidth(params.lineWidth, pp.wallLineWidth);
  const reordered = variableLineWidth
    ? params.loop
    : reorderOuterLoop(pp, params.pipeline, params.run, params.layer, emitter, params.loop, fallbackLineWidth, li);
  if (reordered.length < 2) return 0;
  emitter.setAccel(isFirstLayer ? pp.accelerationInitialLayer : (pp.accelerationOuterWall ?? pp.accelerationWall), pp.accelerationPrint);
  emitter.setJerk(isFirstLayer ? pp.jerkInitialLayer : (pp.jerkOuterWall ?? pp.jerkWall), pp.jerkPrint);
  emitter.travelTo(reordered[0].x, reordered[0].y, moves);
  gcode.push(`; ${params.comment ?? 'Outer wall'}`);
  const scarfLen = pp.scarfSeamLength ?? 0;
  const scarfActive = scarfLen > 0 && (pp.scarfSeamStartHeight === undefined || layerZ >= pp.scarfSeamStartHeight);
  const scarfStepLen = pp.scarfSeamStepLength ?? 0;
  let scarfRemaining = scarfActive ? scarfLen : 0;
  let layerTime = 0;
  for (let pi = 1; pi < reordered.length; pi++) {
    const from = reordered[pi - 1], to = reordered[pi];
    let segLW = variableLineWidth ? segmentLineWidth(params.lineWidth, pi - 1, pi) : fallbackLineWidth;
    const baseSegLW = segLW;
    let segSpeed = outerWallSpeed;
    if (scarfRemaining > 0) {
      const done = scarfLen - scarfRemaining;
      const tRaw = done / scarfLen;
      const t = Math.min(1, scarfStepLen > 0 ? Math.floor(done / scarfStepLen) * scarfStepLen / scarfLen : tRaw);
      segLW = baseSegLW * t;
      const speedRatio = pp.scarfSeamStartSpeedRatio ?? 1.0;
      segSpeed = outerWallSpeed * (speedRatio + (1.0 - speedRatio) * t);
      scarfRemaining = Math.max(0, scarfRemaining - from.distanceTo(to));
    }
    layerTime += emitter.extrudeTo(to.x, to.y, segSpeed, segLW, layerH).time;
    moves.push({ type: 'wall-outer', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed: segSpeed, extrusion: emitter.calculateExtrusion(from.distanceTo(to), segLW, layerH), lineWidth: segLW });
  }
  if (isClosed && reordered.length > 2) {
    const lastPt = reordered[reordered.length - 1], firstPt = reordered[0], segLen = lastPt.distanceTo(firstPt);
    const coastVol = params.allowCoasting ? (pp.coastingEnabled ? (pp.coastingVolume ?? 0) : 0) : 0;
    const minCoastVol = pp.minVolumeBeforeCoasting ?? 0;
    const loopVol = minCoastVol > 0 ? (() => {
      let perim = segLen;
      for (let ri = 1; ri < reordered.length - 1; ri++) perim += reordered[ri].distanceTo(reordered[ri + 1]);
      return perim * fallbackLineWidth * layerH;
    })() : Infinity;
    const closingLineWidth = variableLineWidth ? segmentLineWidth(params.lineWidth, reordered.length - 1, 0) : fallbackLineWidth;
    const coastDist = coastVol > 0 && loopVol >= minCoastVol ? coastVol / (closingLineWidth * layerH) : 0;
    if (coastDist > 0 && segLen > coastDist + 1e-3) {
      const t = 1 - coastDist / segLen;
      const midX = lastPt.x + (firstPt.x - lastPt.x) * t, midY = lastPt.y + (firstPt.y - lastPt.y) * t;
      layerTime += emitter.extrudeTo(midX, midY, outerWallSpeed, closingLineWidth, layerH).time;
      moves.push({ type: 'wall-outer', from: { x: lastPt.x, y: lastPt.y }, to: { x: midX, y: midY }, speed: outerWallSpeed, extrusion: emitter.calculateExtrusion(segLen * t, closingLineWidth, layerH), lineWidth: closingLineWidth });
      const coastSpeed = outerWallSpeed * ((pp.coastingSpeed ?? 90) / 100);
      gcode.push(`G0 X${firstPt.x.toFixed(3)} Y${firstPt.y.toFixed(3)} F${(coastSpeed * 60).toFixed(0)} ; Coast`);
      emitter.currentX = firstPt.x; emitter.currentY = firstPt.y;
    } else {
      layerTime += emitter.extrudeTo(firstPt.x, firstPt.y, outerWallSpeed, closingLineWidth, layerH).time;
      moves.push({ type: 'wall-outer', from: { x: lastPt.x, y: lastPt.y }, to: { x: firstPt.x, y: firstPt.y }, speed: outerWallSpeed, extrusion: emitter.calculateExtrusion(segLen, closingLineWidth, layerH), lineWidth: closingLineWidth });
    }
  }
  return layerTime;
}

function generatedPerimetersForContour(
  slicer: SlicerExecutionPipeline,
  pp: SliceRun['pp'],
  layer: SliceLayerState,
  contour: SliceLayerState['contours'][number],
  containedHoles: THREE.Vector2[][],
  arachneContext: { sectionType: 'wall'; isTopOrBottomLayer: boolean },
): GeneratedPerimeters {
  const contourIndex = layer.contours?.indexOf(contour) ?? -1;
  const precomputed = contourIndex >= 0
    ? layer.precomputedContourWalls?.find((item) => item.contourIndex === contourIndex)
    : undefined;
  if (precomputed) return precomputed.perimeters;
  const wallLineWidth = lineWidthSpecForLayer(pp.wallLineWidth, pp, layer.isFirstLayer) as number;
  return slicer.filterPerimetersByMinOdd(
    slicer.generatePerimeters(contour.points, containedHoles, pp.wallCount, wallLineWidth, pp.outerWallInset ?? 0, arachneContext),
    pp.minOddWallLineWidth ?? 0,
  );
}

export function emitGroupedAndContourWalls(
  pipeline: unknown,
  run: SliceRun,
  layer: SliceLayerState,
): ContourWallData[] {
  const slicer = pipeline as SlicerExecutionPipeline;
  const { pp, emitter, gcode } = run;
  const { li, layerZ, layerH, isFirstLayer, outerWallSpeed, innerWallSpeed, workContours, holesByOuterContour, moves } = layer;
  const groupOW = pp.groupOuterWalls ?? false;
  const perContour: ContourWallData[] = [];
  const arachneContext = {
    sectionType: 'wall' as const,
    isTopOrBottomLayer: layer.isSolidTop || layer.isSolidBottom,
    isFirstLayer: layer.isFirstLayer,
  };
  beginSeamLayer(run, li);

  if (groupOW) {
    for (const contour of workContours) {
      if (!contour.isOuter) continue;
      const containedHoles = holesByOuterContour.get(contour) ?? [];
      const perimeters = generatedPerimetersForContour(slicer, pp, layer, contour, containedHoles, arachneContext);
      perContour.push({ contour, exWalls: perimeters, wallSets: perimeters.walls, wallLineWidths: perimeters.lineWidths, wallClosed: perimeters.wallClosed, outerWallCount: perimeters.outerCount, infillHoles: perimeters.innermostHoles });
    }
    for (const item of perContour) {
      const outerWall = item.wallSets[0];
      if (!outerWall || outerWall.length < 2) continue;
      layer.layerTime += emitOuterLoop({ pipeline: slicer, run, layer, pp, li, layerZ, layerH, isFirstLayer, outerWallSpeed, gcode, emitter, moves, loop: outerWall, lineWidth: item.wallLineWidths[0] ?? pp.wallLineWidth, isClosed: item.wallClosed?.[0] ?? true, comment: 'Outer wall (grouped)', allowCoasting: false });
    }
  }

  const contourWallData = groupOW ? perContour : workContours
    .filter((contour) => contour.isOuter)
    .map((contour): ContourWallData => {
      const containedHoles = holesByOuterContour.get(contour) ?? [];
      const exWalls = generatedPerimetersForContour(slicer, pp, layer, contour, containedHoles, arachneContext);
      return {
        contour,
        exWalls,
        wallSets: exWalls.walls,
        wallLineWidths: exWalls.lineWidths,
        wallClosed: exWalls.wallClosed,
        outerWallCount: exWalls.outerCount,
        infillHoles: exWalls.innermostHoles,
      };
    });

  for (const contourData of contourWallData) {
    const { exWalls, wallSets, wallLineWidths, wallClosed } = contourData;
    if (!groupOW) perContour.push(contourData);

    if (!groupOW && wallSets.length > 0 && pp.outerWallFirst) {
      if (isFirstLayer && pp.initialLayerOuterWallFlow != null) emitter.currentLayerFlow = pp.initialLayerOuterWallFlow / 100;
      layer.layerTime += emitOuterLoop({ pipeline: slicer, run, layer, pp, li, layerZ, layerH, isFirstLayer, outerWallSpeed, gcode, emitter, moves, loop: wallSets[0], lineWidth: wallLineWidths[0] ?? pp.wallLineWidth, isClosed: wallClosed?.[0] ?? true, allowCoasting: true });
    }

    const initialLayerFlow = pp.initialLayerFlow ?? 0;
    emitter.currentLayerFlow = isFirstLayer && initialLayerFlow > 0 ? (initialLayerFlow / 100) : 1.0;
    const innerLW = pp.innerWallLineWidth ?? pp.wallLineWidth;
    if (isFirstLayer && pp.initialLayerInnerWallFlow != null) emitter.currentLayerFlow = pp.initialLayerInnerWallFlow / 100;
    const wallDepths: number[] = exWalls.wallDepths ?? [];
    const wallSources = exWalls.wallSources;

    // Build the emission order for inner walls (everything past index 0,
    // which is the outer wall already handled separately above).
    //
    // Inset-order optimizer (Cura `InsetOrderOptimizer` parity): order
    // the inner walls by depth, NOT by libArachne's emission order.
    //   • `outerWallFirst === true` → ascending depth (depth 1, 2, 3 …):
    //     each inset is emitted before the next one further inside, so
    //     bridges over voids (e.g. the lip of a horizontal hole) anchor
    //     to the outermost inset that's already laid down.
    //   • `outerWallFirst === false` → descending depth (deepest first):
    //     surface finish improves because the outer wall is the LAST
    //     thing extruded against still-loose plastic — same trade-off
    //     Cura/Orca document under "Outside Before Inside Walls".
    //
    // Within each depth level, hole walls follow outer-contour walls
    // (preserves the existing convention) and gap-fill paths run last
    // (after all real walls, since their open-ended tip would otherwise
    // interrupt the seam-aware ordering between adjacent walls).
    const sourceWeight = (s?: 'outer' | 'hole' | 'gapfill') =>
      s === 'gapfill' ? 2 : s === 'hole' ? 1 : 0;
    const ascending = pp.outerWallFirst !== false;
    const innerOrder = Array.from({ length: wallSets.length - 1 }, (_, i) => i + 1);
    innerOrder.sort((a, b) => {
      const sa = sourceWeight(wallSources?.[a]);
      const sb = sourceWeight(wallSources?.[b]);
      // Gap-fill always last regardless of depth ordering.
      if ((sa === 2) !== (sb === 2)) return sa === 2 ? 1 : -1;
      const da = wallDepths[a] ?? 1;
      const db = wallDepths[b] ?? 1;
      if (da !== db) return ascending ? da - db : db - da;
      // Same depth: outer-source before hole-source (stable convention).
      return sa - sb;
    });

    for (const wi of innerOrder) {
      // wallDepths[wi] === 0 means this is the outermost wall of its
      // contour — for hole loops, this is the wall closest to the hole's
      // empty space, which is topologically the wall-OUTER of that hole.
      // Tag it accordingly so the preview renders it in the outer colour
      // (red) next to the empty hole, matching how OrcaSlicer / Cura render.
      const isGapFill = wallSources?.[wi] === 'gapfill';
      const isHoleOuterWall = !isGapFill && (wallDepths[wi] ?? 1) === 0;
      // Gap-fill moves get their own type so the preview colours them
      // distinctly, the bridge detector skips them (they're not real
      // walls), the seam optimizer ignores them, and stats report
      // gap-fill volume separately from wall volume.
      const moveType: 'wall-outer' | 'wall-inner' | 'gap-fill' = isGapFill
        ? 'gap-fill'
        : (isHoleOuterWall ? 'wall-outer' : 'wall-inner');
      // Gap-fill prints at the inner-wall speed — they're short, narrow,
      // and pushing them at outer-wall speed risks under-extrusion at
      // the medial-axis tips where the bead width has already tapered.
      const wallSpeed = isGapFill ? innerWallSpeed
        : isHoleOuterWall ? outerWallSpeed : innerWallSpeed;
      const wallLWSpec: WallLineWidthSpec = wallLineWidths[wi] ?? (isHoleOuterWall ? pp.wallLineWidth : innerLW);
      const wallLW = representativeLineWidth(wallLWSpec, isHoleOuterWall ? pp.wallLineWidth : innerLW);
      const isClosed = wallClosed?.[wi] ?? true;
      // Aggressive simplification (≈half the line width) acts as a poor-
      // man's Arachne for narrow regions: any perimeter "finger" or notch
      // narrower than ~lw/2 gets straightened out by RDP, so the wall no
      // longer snakes into thin breakthroughs around mounting holes. Real
      // curvature on the boundary (radius >> lw/2) is preserved because
      // those vertices deviate from the chord by more than the tolerance.
      // Walls that are intentional sharp corners (rectangles, slot ends)
      // also keep their corners — RDP only collapses points within the
      // tolerance, never adds vertices.
      //
      // NOTE: tolerance must stay consistent with the infill-region's
      // boundary geometry, since the infill is clipped to the un-simplified
      // region. If walls are smoothed more aggressively than the infill
      // region, infill lines extend into the zigzag corners where walls
      // no longer go — visible as "infill crossing walls" in the preview.
      // See note on outer-wall simplification — tight chord tolerance to
      // preserve design curves; libArachne handles narrow-finger
      // collapse separately via transition zones.
      const simplifyTol = Math.max(0.005, wallLW * 0.05);
      const wallLoop = Array.isArray(wallLWSpec) || !isClosed ? wallSets[wi] : slicer.simplifyClosedContour(wallSets[wi], simplifyTol);
      if (wallLoop.length < 2) continue;
      emitter.setAccel(
        isFirstLayer ? pp.accelerationInitialLayer
          : isHoleOuterWall ? (pp.accelerationOuterWall ?? pp.accelerationWall)
          : (pp.accelerationInnerWall ?? pp.accelerationWall),
        pp.accelerationPrint,
      );
      emitter.setJerk(
        isFirstLayer ? pp.jerkInitialLayer
          : isHoleOuterWall ? (pp.jerkOuterWall ?? pp.jerkWall)
          : (pp.jerkInnerWall ?? pp.jerkWall),
        pp.jerkPrint,
      );
      emitter.travelTo(wallLoop[0].x, wallLoop[0].y, moves);
      gcode.push(`; ${isGapFill ? 'Gap fill' : isHoleOuterWall ? 'Hole outer wall' : 'Inner wall'} ${wi}`);
      for (let pi = 1; pi < wallLoop.length; pi++) {
        const from = wallLoop[pi - 1], to = wallLoop[pi];
        const segLW = segmentLineWidth(wallLWSpec, pi - 1, pi);
        layer.layerTime += emitter.extrudeTo(to.x, to.y, wallSpeed, segLW, layerH).time;
        moves.push({ type: moveType, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed: wallSpeed, extrusion: emitter.calculateExtrusion(from.distanceTo(to), segLW, layerH), lineWidth: segLW });
      }
      if (isClosed && wallLoop.length > 2) {
        const lastPt = wallLoop[wallLoop.length - 1], firstPt = wallLoop[0];
        const segLW = segmentLineWidth(wallLWSpec, wallLoop.length - 1, 0);
        layer.layerTime += emitter.extrudeTo(firstPt.x, firstPt.y, wallSpeed, segLW, layerH).time;
        moves.push({ type: moveType, from: { x: lastPt.x, y: lastPt.y }, to: { x: firstPt.x, y: firstPt.y }, speed: wallSpeed, extrusion: emitter.calculateExtrusion(lastPt.distanceTo(firstPt), segLW, layerH), lineWidth: segLW });
      }
    }

    emitter.currentLayerFlow = isFirstLayer && initialLayerFlow > 0 ? (initialLayerFlow / 100) : 1.0;
    if (!groupOW && wallSets.length > 0 && !pp.outerWallFirst) {
      if (isFirstLayer && pp.initialLayerOuterWallFlow != null) emitter.currentLayerFlow = pp.initialLayerOuterWallFlow / 100;
      layer.layerTime += emitOuterLoop({ pipeline: slicer, run, layer, pp, li, layerZ, layerH, isFirstLayer, outerWallSpeed, gcode, emitter, moves, loop: wallSets[0], lineWidth: wallLineWidths[0] ?? pp.wallLineWidth, isClosed: wallClosed?.[0] ?? true, allowCoasting: true });
      emitter.currentLayerFlow = isFirstLayer && initialLayerFlow > 0 ? (initialLayerFlow / 100) : 1.0;
    }
  }

  return perContour.filter((item) => item.contour?.isOuter);
}
