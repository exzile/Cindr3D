import * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon, Ring as PCRing } from 'polygon-clipping';
import { booleanMultiPolygonClipper2Sync } from '../../../geometry/clipper2Boolean';
import type { ContourWallData, SlicerExecutionPipeline, SliceLayerState, SliceRun } from './types';
import type { SliceMove } from '../../../../../types/slicer';

// ARACHNE-9.4A.4: worker awaits Clipper2 load before slicing — see SlicerWorker.ts.
function requireMP(result: PCMultiPolygon | null, op: string): PCMultiPolygon {
  if (result === null) throw new Error(`emitContourInfill.${op}: Clipper2 WASM not loaded`);
  return result;
}

function representativeLineWidth(lineWidth: number | number[] | undefined, fallback: number): number {
  if (Array.isArray(lineWidth)) {
    if (lineWidth.length === 0) return fallback;
    return lineWidth.reduce((sum, width) => sum + width, 0) / lineWidth.length;
  }
  return lineWidth ?? fallback;
}

function offsetContourFast(pipeline: SlicerExecutionPipeline, contour: THREE.Vector2[], offset: number): THREE.Vector2[] {
  return typeof pipeline.offsetContourFast === 'function'
    ? pipeline.offsetContourFast(contour, offset)
    : pipeline.offsetContour(contour, offset);
}

function unionMultiPolygon(mp: PCMultiPolygon): PCMultiPolygon {
  if (mp.length <= 1) return mp;
  return requireMP(booleanMultiPolygonClipper2Sync(mp, [], 'union'), 'union');
}

function intersectMultiPolygon(a: PCMultiPolygon, b: PCMultiPolygon): PCMultiPolygon {
  return requireMP(booleanMultiPolygonClipper2Sync(a, b, 'intersection'), 'intersection');
}

function differenceMultiPolygon(a: PCMultiPolygon, b: PCMultiPolygon): PCMultiPolygon {
  return requireMP(booleanMultiPolygonClipper2Sync(a, b, 'difference'), 'difference');
}

function offsetByAreaIntent(
  pipeline: SlicerExecutionPipeline,
  contour: THREE.Vector2[],
  distance: number,
  intent: 'shrink' | 'grow',
): THREE.Vector2[] {
  // Hot path: this fires for every infill region's outer + every hole
  // on every solid layer, so an extra Clipper2 round-trip per call
  // multiplies into hundreds of WASM crossings on a typical print.
  // Previous implementation tried BOTH `+distance` and `-distance` and
  // picked the result by area afterward, paying for two offset ops to
  // resolve a single sign question.
  //
  // We can derive the correct sign deterministically from the contour's
  // winding. `pipeline.offsetContourFast` already does winding-aware
  // sign-flipping internally so that `+distance` always means "inset
  // toward solid" — a CCW outer shrinks (smaller |area|), a CW hole
  // expands its enclosed-area magnitude (visually shrinks the hole).
  // So:
  //   intent=shrink (smaller |area| wanted) → call(+distance) on CCW,
  //                                            call(-distance) on CW.
  //   intent=grow                            → opposite sign per case.
  //
  // Encoding both axes: dirSign = signedAreaPos ? +1 : -1, and
  //   shrink → +dirSign * distance
  //   grow   → -dirSign * distance.
  // One WASM call. If the result degenerates (length < 3) we fall back
  // to the other direction — same edge-case behaviour as before, just
  // without paying for both calls in the common path.
  let signed2 = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    signed2 += a.x * b.y - b.x * a.y;
  }
  const dirSign = signed2 >= 0 ? 1 : -1;
  const primarySign = intent === 'shrink' ? dirSign : -dirSign;
  const primary = offsetContourFast(pipeline, contour, primarySign * distance);
  if (primary.length >= 3) return primary;
  // Rare degenerate fallback: original tried both directions, so do
  // the same here to preserve behaviour parity for the test suite.
  return offsetContourFast(pipeline, contour, -primarySign * distance);
}

function insetFillCenterlineRegion(
  pipeline: SlicerExecutionPipeline,
  contour: THREE.Vector2[],
  holes: THREE.Vector2[][],
  lineWidth: number,
): { contour: THREE.Vector2[]; holes: THREE.Vector2[][] } | null {
  const inset = lineWidth * 0.5;
  const safeContour = offsetByAreaIntent(pipeline, contour, inset, 'shrink');
  if (safeContour.length < 3) return null;
  const safeHoles = holes
    .map((hole) => offsetByAreaIntent(pipeline, hole, inset, 'grow'))
    .filter((hole) => hole.length >= 3);
  return { contour: safeContour, holes: safeHoles };
}

/** Profile fields read by `pickBridgeFanSpeed` — typed locally so the
 *  helper has zero dependency on the full `PrintProfile` shape. */
export interface BridgeFanProfile {
  bridgeFanSpeed?: number;
  bridgeFanSpeed2?: number;
  bridgeFanSpeed3?: number;
  bridgeEnableMoreLayers?: boolean;
  bridgeHasMultipleLayers?: boolean;
}

/**
 * Pick the fan speed % for a bridge move based on how many consecutive
 * layers (incl. this one) have had bridges so far. Mirrors Cura's
 * `bridge_fan_speed` / `bridge_fan_speed_2` / `bridge_fan_speed_3`
 * cascade gated by `bridge_enable_more_layers`.
 *
 * `priorConsecutive` is the value of `run.consecutiveBridgeLayers` BEFORE
 * `finalizeLayer` runs for the current layer — i.e. the count of bridge
 * layers that have already finished. The current layer is `priorConsecutive + 1`.
 *
 * Default fan speed (100 %) is returned when nothing in the profile says
 * otherwise. Each tier falls back through `bridgeFanSpeed2 → bridgeFanSpeed`
 * etc. so partially-configured profiles still produce a sane value.
 */
export function pickBridgeFanSpeed(
  pp: BridgeFanProfile,
  priorConsecutive: number,
): number {
  const moreLayers = pp.bridgeEnableMoreLayers ?? pp.bridgeHasMultipleLayers ?? false;
  const consecutive = (priorConsecutive ?? 0) + 1;
  if (!moreLayers || consecutive <= 1) return pp.bridgeFanSpeed ?? 100;
  if (consecutive === 2) return pp.bridgeFanSpeed2 ?? pp.bridgeFanSpeed ?? 100;
  return pp.bridgeFanSpeed3 ?? pp.bridgeFanSpeed2 ?? pp.bridgeFanSpeed ?? 100;
}

type InfillMoveType = Extract<SliceMove['type'], 'infill' | 'top-bottom' | 'bridge'>;

export function skinRemovalWidthForLayer(
  pp: Pick<SliceRun['pp'], 'skinRemovalWidth' | 'topSkinRemovalWidth' | 'bottomSkinRemovalWidth'>,
  isSolidTop: boolean,
  isSolidBottom: boolean,
): number {
  if (isSolidTop) return pp.topSkinRemovalWidth ?? pp.skinRemovalWidth ?? 0;
  if (isSolidBottom) return pp.bottomSkinRemovalWidth ?? pp.skinRemovalWidth ?? 0;
  return pp.skinRemovalWidth ?? 0;
}

export function emitContourInfill(
  pipeline: unknown,
  run: SliceRun,
  layer: SliceLayerState,
  contoursData: ContourWallData[],
): void {
  const slicer = pipeline as SlicerExecutionPipeline;
  const { pp, mat, triangles, offsetX, offsetY, emitter, gcode } = run;
  const { li, layerH, isFirstLayer, isSolid, isSolidBottom, isSolidTop, infillSpeed, topBottomSpeed, hasBridgeRegions, isInBridgeRegion, moves } = layer;

  for (const item of contoursData) {
    const { contour, exWalls, wallSets, wallLineWidths, outerWallCount, infillHoles } = item;
    const adaptiveOuterFilled = outerWallCount === 1 && representativeLineWidth(wallLineWidths[0], pp.wallLineWidth) > pp.wallLineWidth + 1e-6;
    const innermostWall = adaptiveOuterFilled ? [] : outerWallCount > 0 ? wallSets[outerWallCount - 1] : contour.points;
    const infillRegions = adaptiveOuterFilled ? [] : (exWalls.infillRegions.length > 0 ? exWalls.infillRegions : (innermostWall.length >= 3 ? [{ contour: innermostWall, holes: infillHoles }] : []));
    if (infillRegions.length === 0) continue;

    let infillLines: { from: THREE.Vector2; to: THREE.Vector2 }[] = [];
    let infillMoveType: InfillMoveType = 'infill';
    let speed = infillSpeed;
    const lineWidth = isSolidTop
      ? (pp.topSurfaceSkinLineWidth ?? pp.topBottomLineWidth ?? pp.infillLineWidth)
      : pp.infillLineWidth;

    if (isFirstLayer && isSolid && pp.initialLayerBottomFlow != null) emitter.currentLayerFlow = pp.initialLayerBottomFlow / 100;

    if (isSolid) {
      // Skin/wall bonding: the scanline centerline boundary needs to
      // sit slightly INSIDE the wall stroke band so the bead's printed
      // edge touches the inner-wall ring instead of leaving a visible
      // gap in the preview (and a real gap in the print). We push the
      // skin region outward by `skinOverlapPercent` × lineWidth (Cura
      // / Orca call this `infill_wall_overlap` / `skin_overlap`).
      //
      // On the FIRST layer we previously forced this to zero, fearing
      // that any creep onto the walls would print as visible blob on
      // the bed. Result: the bottom skin floats unattached to walls
      // (visible white gap between the blue scanlines and the green
      // inner-wall ring). With our stroke-subtract pipeline the body
      // is already inset by halfWidth + a 25% safety pad, so the skin
      // centerline sits well clear of the actual bead — applying the
      // normal overlap on layer 0 closes the gap without bulging onto
      // the bed beyond the wall's footprint. Default `skinOverlapPercent`
      // of 23% (Orca's standard) gives ~0.10 mm overlap at lineWidth
      // 0.45 mm — enough to bond, not enough to print past the wall.
      const skinOverlap = ((pp.skinOverlapPercent ?? 23) / 100) * lineWidth;
      const topSurfaceExpand = pp.topSurfaceSkinExpansion ?? pp.topSkinExpandDistance ?? 0;
      const totalExpand = skinOverlap + (isSolidTop ? topSurfaceExpand : 0) + (isSolidBottom ? (pp.bottomSkinExpandDistance ?? 0) : 0);
      for (const region of infillRegions) {
        let skinContour = totalExpand > 0 ? offsetContourFast(slicer, region.contour, -totalExpand) : region.contour;
        const srw = skinRemovalWidthForLayer(pp, isSolidTop, isSolidBottom);
        if (srw > 0 && skinContour.length >= 3) {
          const eroded = offsetContourFast(slicer, skinContour, srw);
          if (eroded.length >= 3) {
            const dilated = offsetContourFast(slicer, eroded, -srw);
            if (dilated.length >= 3) skinContour = dilated;
          } else skinContour = [];
        }
        const skinInput = skinContour.length >= 3 ? skinContour : region.contour;
        if (skinInput.length < 3) continue;
        const safeSkinInput = insetFillCenterlineRegion(slicer, skinInput, region.holes, lineWidth);
        if (!safeSkinInput) continue;
        const skinPattern = isSolidTop
          ? (pp.topSurfaceSkinPattern ?? pp.topBottomPattern ?? 'lines')
          : (li === 0 && pp.bottomPatternInitialLayer)
            ? pp.bottomPatternInitialLayer
            : (pp.topBottomPattern === 'concentric' ? 'concentric' : 'lines');
        if (pp.topBottomLineDirections && pp.topBottomLineDirections.length > 0) {
          const angleDeg = pp.topBottomLineDirections[li % pp.topBottomLineDirections.length];
          infillLines.push(...slicer.generateScanLines(safeSkinInput.contour, 100, lineWidth, (angleDeg * Math.PI) / 180, 0, safeSkinInput.holes));
        } else {
          infillLines.push(...slicer.generateLinearInfill(safeSkinInput.contour, 100, lineWidth, li, skinPattern, safeSkinInput.holes));
        }
      }
      infillMoveType = 'top-bottom';
      speed = topBottomSpeed;
    } else if (pp.infillDensity > 0 || (pp.infillLineDistance ?? 0) > 0) {
      let effectiveDensity = (pp.infillLineDistance ?? 0) > 0 ? Math.min(100, Math.max(0.1, (pp.infillLineWidth / (pp.infillLineDistance ?? 1)) * 100)) : pp.infillDensity;
      const gSteps = pp.gradualInfillSteps ?? 0;
      if (gSteps > 0) {
        const stepH = pp.gradualInfillStepHeight ?? 1.5;
        const stepLayers = Math.max(1, Math.round(stepH / pp.layerHeight));
        const firstTopSolid = run.totalLayers - run.solidTop;
        const distFromTopSolid = firstTopSolid - li;
        if (distFromTopSolid > 0) {
          const stepIdx = Math.ceil(distFromTopSolid / stepLayers);
          if (stepIdx >= 1 && stepIdx <= gSteps) effectiveDensity = Math.min(100, effectiveDensity * Math.pow(2, gSteps - stepIdx + 1));
        }
      }
      let overhangShadowMP: PCMultiPolygon = [];
      const infillOverhangAngle = pp.infillOverhangAngle ?? 0;
      if (infillOverhangAngle > 0) {
        const thr = (infillOverhangAngle * Math.PI) / 180;
        const shadowTris: PCMultiPolygon = [];
        for (const tri of triangles) {
          const dotUp = tri.normal.z;
          if (dotUp >= 0) continue;
          const a = Math.acos(Math.max(0, Math.min(1, Math.abs(dotUp))));
          if (a <= thr) continue;
          const tMaxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
          if (tMaxZ < layer.sliceZ - pp.layerHeight) continue;
          const ring: PCRing = [[tri.v0.x + offsetX, tri.v0.y + offsetY], [tri.v1.x + offsetX, tri.v1.y + offsetY], [tri.v2.x + offsetX, tri.v2.y + offsetY], [tri.v0.x + offsetX, tri.v0.y + offsetY]];
          shadowTris.push([ring]);
        }
        if (shadowTris.length > 0) {
          try { overhangShadowMP = unionMultiPolygon(shadowTris); } catch { overhangShadowMP = []; }
        }
      }
      const infillOverlapMm = ((pp.infillOverlap ?? 10) / 100) * lineWidth;
      for (const baseRegion of infillRegions) {
        const infillRegion = infillOverlapMm > 0 ? offsetContourFast(slicer, baseRegion.contour, -infillOverlapMm) : baseRegion.contour;
        const safeInfillRegion = insetFillCenterlineRegion(slicer, infillRegion, baseRegion.holes, lineWidth);
        if (!safeInfillRegion) continue;
        const minInfFill = pp.minInfillArea ?? 0;
        const infillRegionOk = minInfFill <= 0 || (() => { const b = slicer.contourBBox(safeInfillRegion.contour); return (b.maxX - b.minX) * (b.maxY - b.minY) >= minInfFill; })();
        if (!infillRegionOk) continue;
        const genPattern = (region: THREE.Vector2[], density: number, holes: THREE.Vector2[][]) => {
          if (pp.infillLineDirections && pp.infillLineDirections.length > 0) {
            const angleDeg = pp.infillLineDirections[li % pp.infillLineDirections.length];
            const spacing = lineWidth / (density / 100);
            const phase = pp.randomInfillStart ? Math.abs(Math.sin(li * 127.1 + 43.7)) * spacing : 0;
            return slicer.generateScanLines(region, density, lineWidth, (angleDeg * Math.PI) / 180, phase, holes);
          }
          return slicer.generateLinearInfill(region, density, lineWidth, li, pp.infillPattern, holes);
        };
        if (overhangShadowMP.length === 0) {
          infillLines.push(...genPattern(safeInfillRegion.contour, effectiveDensity, safeInfillRegion.holes));
        } else {
          const infillRegionMP: PCMultiPolygon = [[slicer.contourToClosedPCRing(safeInfillRegion.contour), ...safeInfillRegion.holes.map((hole) => slicer.contourToClosedPCRing(hole))]];
          let boostedMP: PCMultiPolygon = [];
          let normalMP: PCMultiPolygon = infillRegionMP;
          try {
            boostedMP = intersectMultiPolygon(infillRegionMP, overhangShadowMP);
            normalMP = differenceMultiPolygon(infillRegionMP, overhangShadowMP);
          } catch { boostedMP = []; normalMP = infillRegionMP; }
          const boostedDensity = Math.min(100, effectiveDensity * 1.5);
          for (const region of slicer.multiPolygonToRegions(boostedMP)) infillLines.push(...genPattern(region.contour, boostedDensity, region.holes));
          for (const region of slicer.multiPolygonToRegions(normalMP)) infillLines.push(...genPattern(region.contour, effectiveDensity, region.holes));
        }
      }
      const infillMult = Math.max(1, Math.round(pp.multiplyInfill ?? 1));
      if (infillMult > 1 && infillLines.length > 0) {
        const base = [...infillLines];
        for (let m = 1; m < infillMult; m++) infillLines = [...infillLines, ...base];
      }
    }

    if (!isSolid && (pp.infillLayerThickness ?? 0) > 0) {
      const thickMul = Math.max(1, Math.round((pp.infillLayerThickness ?? 0) / pp.layerHeight));
      if (thickMul > 1 && li % thickMul !== 0) infillLines = [];
    }

    if (isSolid && (pp.extraSkinWallCount ?? 0) > 0) {
      gcode.push(`; Extra skin walls (${pp.extraSkinWallCount})`);
      for (let ew = 0; ew < (pp.extraSkinWallCount ?? 0); ew++) {
        const baseLoop = (item.outerWallCount > 0 ? item.wallSets[item.outerWallCount - 1] : contour.points);
        const loop = ew === 0 ? baseLoop : offsetContourFast(slicer, baseLoop, ew * pp.infillLineWidth);
        if (loop.length < 3) break;
        emitter.travelTo(loop[0].x, loop[0].y, moves);
        for (let pi = 1; pi < loop.length; pi++) {
          const from = loop[pi - 1], to = loop[pi];
          layer.layerTime += emitter.extrudeTo(to.x, to.y, topBottomSpeed, lineWidth, layerH).time;
          moves.push({ type: 'top-bottom', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed: topBottomSpeed, extrusion: emitter.calculateExtrusion(from.distanceTo(to), lineWidth, layerH), lineWidth });
        }
      }
    }

    if (infillLines.length === 0) continue;
    if (isSolid) {
      emitter.setAccel(isFirstLayer ? pp.accelerationInitialLayer : pp.accelerationTopBottom, pp.accelerationPrint);
      emitter.setJerk(isFirstLayer ? pp.jerkInitialLayer : pp.jerkTopBottom, pp.jerkPrint);
    } else {
      emitter.setAccel(isFirstLayer ? pp.accelerationInitialLayer : pp.accelerationInfill, pp.accelerationPrint);
      emitter.setJerk(isFirstLayer ? pp.jerkInitialLayer : pp.jerkInfill, pp.jerkPrint);
    }
    gcode.push(`; ${isSolid ? 'Solid fill' : 'Infill'}`);
    const sorted = (!isSolid && (pp.infillTravelOptimization ?? false)) ? slicer.sortInfillLinesNN(infillLines, emitter.currentX, emitter.currentY) : slicer.sortInfillLines(infillLines);
    const connect = (pp.connectInfillLines ?? false) && infillRegions.length <= 1;
    const connectTol = lineWidth * 1.5;
    const startExt = pp.infillStartMoveInwardsLength ?? 0;
    const endExt = pp.infillEndMoveInwardsLength ?? 0;
    for (let idx = 0; idx < sorted.length; idx++) {
      const line = sorted[idx];
      const dx = line.to.x - line.from.x, dy = line.to.y - line.from.y, len = Math.sqrt(dx * dx + dy * dy);
      const ux = len > 0 ? dx / len : 0, uy = len > 0 ? dy / len : 0;
      const effFrom = startExt > 0 && len > 0 ? new THREE.Vector2(line.from.x - ux * startExt, line.from.y - uy * startExt) : line.from;
      const effTo = endExt > 0 && len > 0 ? new THREE.Vector2(line.to.x + ux * endExt, line.to.y + uy * endExt) : line.to;
      let thisMoveType: InfillMoveType = infillMoveType;
      let thisSpeed = speed;
      const thisLineWidth = lineWidth;
      let thisFlowScale = isSolidTop ? (pp.topSurfaceSkinFlow ?? 100) / 100 : 1.0;
      const bridgeSettingsOn = pp.enableBridgeSettings !== false;
      if (hasBridgeRegions && bridgeSettingsOn && infillMoveType === 'top-bottom') {
        const midX = (effFrom.x + effTo.x) / 2, midY = (effFrom.y + effTo.y) / 2;
        if (isInBridgeRegion(midX, midY)) {
          thisMoveType = 'bridge';
          thisSpeed = pp.bridgeSkinSpeed ?? speed;
          thisFlowScale = (pp.bridgeSkinFlow ?? 100) / 100;
          run.layerHadBridge = true;
        }
      }
      const bridgeFanSpeed = pickBridgeFanSpeed(pp, run.consecutiveBridgeLayers ?? 0);
      const needBridgeFan = pp.enableBridgeFan && thisMoveType === 'bridge' && !run.bridgeFanActive;
      const needFanRestore = !needBridgeFan && thisMoveType !== 'bridge' && run.bridgeFanActive;
      if (needBridgeFan) {
        gcode.push(`M106 S${emitter.fanSpeedArg(bridgeFanSpeed)} ; Bridge fan`);
        run.bridgeFanActive = true;
      } else if (needFanRestore) {
        gcode.push(`M106 S${emitter.fanSpeedArg(mat.fanSpeedMin ?? 100)} ; Restore fan after bridge`);
        run.bridgeFanActive = false;
      }
      const fromDist = Math.hypot(effFrom.x - emitter.currentX, effFrom.y - emitter.currentY);
      const canConnectInfill = connect && idx > 0 && fromDist < connectTol && slicer.segmentInsideMaterial(new THREE.Vector2(emitter.currentX, emitter.currentY), effFrom, innermostWall, infillHoles);
      if (canConnectInfill) layer.layerTime += emitter.extrudeTo(effFrom.x, effFrom.y, thisSpeed, thisLineWidth, layerH).time;
      else emitter.travelTo(effFrom.x, effFrom.y, moves);
      const flowSaved = emitter.currentLayerFlow;
      emitter.currentLayerFlow = flowSaved * thisFlowScale;
      layer.layerTime += emitter.extrudeTo(effTo.x, effTo.y, thisSpeed, thisLineWidth, layerH).time;
      moves.push({ type: thisMoveType, from: { x: effFrom.x, y: effFrom.y }, to: { x: effTo.x, y: effTo.y }, speed: thisSpeed, extrusion: emitter.calculateExtrusion(effFrom.distanceTo(effTo), thisLineWidth, layerH), lineWidth: thisLineWidth });
      emitter.currentLayerFlow = flowSaved;
      const infillWipeDistance = pp.infillWipeDistance ?? 0;
      if (infillWipeDistance > 0 && len > 0) {
        const wx = effTo.x + ux * infillWipeDistance, wy = effTo.y + uy * infillWipeDistance;
        gcode.push(`G0 X${wx.toFixed(3)} Y${wy.toFixed(3)} F${(speed * 60).toFixed(0)} ; Infill wipe`);
        emitter.currentX = wx; emitter.currentY = wy;
      }
    }
  }
}
