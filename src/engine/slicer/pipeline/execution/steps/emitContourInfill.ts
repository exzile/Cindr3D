import * as THREE from 'three';
import polygonClipping, { type MultiPolygon as PCMultiPolygon, type Ring as PCRing } from 'polygon-clipping';

export function emitContourInfill(pipeline: any, run: any, layer: any, contoursData: any[]) {
  const { pp, mat, triangles, offsetX, offsetY, emitter, gcode } = run;
  const { li, layerH, isFirstLayer, isSolid, isSolidBottom, isSolidTop, infillSpeed, topBottomSpeed, hasBridgeRegions, isInBridgeRegion, moves } = layer;

  for (const item of contoursData) {
    const { contour, exWalls, wallSets, wallLineWidths, outerWallCount, infillHoles } = item;
    const adaptiveOuterFilled = outerWallCount === 1 && (wallLineWidths[0] ?? pp.wallLineWidth) > pp.wallLineWidth + 1e-6;
    const innermostWall = adaptiveOuterFilled ? [] : outerWallCount > 0 ? wallSets[outerWallCount - 1] : contour.points;
    const infillRegions = adaptiveOuterFilled ? [] : (exWalls.infillRegions.length > 0 ? exWalls.infillRegions : (innermostWall.length >= 3 ? [{ contour: innermostWall, holes: infillHoles }] : []));
    if (infillRegions.length === 0) continue;

    let infillLines: { from: THREE.Vector2; to: THREE.Vector2 }[] = [];
    let infillMoveType: any = 'infill';
    let speed = infillSpeed;
    let lineWidth = pp.infillLineWidth;

    if (isFirstLayer && isSolid && pp.initialLayerBottomFlow != null) emitter.currentLayerFlow = pp.initialLayerBottomFlow / 100;

    if (isSolid) {
      const skinOverlap = ((pp.skinOverlapPercent ?? 0) / 100) * pp.infillLineWidth;
      const totalExpand = skinOverlap + (isSolidTop ? (pp.topSkinExpandDistance ?? 0) : 0) + (isSolidBottom ? (pp.bottomSkinExpandDistance ?? 0) : 0);
      for (const region of infillRegions) {
        let skinContour = totalExpand > 0 ? pipeline.offsetContour(region.contour, -totalExpand) : region.contour;
        const srw = pp.skinRemovalWidth ?? 0;
        if (srw > 0 && skinContour.length >= 3) {
          const eroded = pipeline.offsetContour(skinContour, srw);
          if (eroded.length >= 3) {
            const dilated = pipeline.offsetContour(eroded, -srw);
            if (dilated.length >= 3) skinContour = dilated;
          } else skinContour = [];
        }
        const skinInput = skinContour.length >= 3 ? skinContour : region.contour;
        if (skinInput.length < 3) continue;
        const skinPattern = (li === 0 && pp.bottomPatternInitialLayer) ? pp.bottomPatternInitialLayer : (pp.topBottomPattern === 'concentric' ? 'concentric' : 'lines');
        if (pp.topBottomLineDirections && pp.topBottomLineDirections.length > 0) {
          const angleDeg = pp.topBottomLineDirections[li % pp.topBottomLineDirections.length];
          infillLines.push(...pipeline.generateScanLines(skinInput, 100, pp.infillLineWidth, (angleDeg * Math.PI) / 180, 0, region.holes));
        } else {
          infillLines.push(...pipeline.generateLinearInfill(skinInput, 100, pp.infillLineWidth, li, skinPattern, region.holes));
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
      if ((pp.infillOverhangAngle ?? 0) > 0) {
        const thr = (pp.infillOverhangAngle * Math.PI) / 180;
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
          try { overhangShadowMP = shadowTris.length === 1 ? shadowTris : polygonClipping.union(shadowTris[0], ...shadowTris.slice(1)); } catch { overhangShadowMP = []; }
        }
      }
      const infillOverlapMm = ((pp.infillOverlap ?? 10) / 100) * pp.infillLineWidth;
      for (const baseRegion of infillRegions) {
        const infillRegion = infillOverlapMm > 0 ? pipeline.offsetContour(baseRegion.contour, -infillOverlapMm) : baseRegion.contour;
        const minInfFill = pp.minInfillArea ?? 0;
        const infillRegionOk = minInfFill <= 0 || (() => { const b = pipeline.contourBBox(infillRegion); return (b.maxX - b.minX) * (b.maxY - b.minY) >= minInfFill; })();
        if (!infillRegionOk) continue;
        const genPattern = (region: THREE.Vector2[], density: number, holes: THREE.Vector2[][]) => {
          if (pp.infillLineDirections && pp.infillLineDirections.length > 0) {
            const angleDeg = pp.infillLineDirections[li % pp.infillLineDirections.length];
            const spacing = pp.infillLineWidth / (density / 100);
            const phase = pp.randomInfillStart ? Math.abs(Math.sin(li * 127.1 + 43.7)) * spacing : 0;
            return pipeline.generateScanLines(region, density, pp.infillLineWidth, (angleDeg * Math.PI) / 180, phase, holes);
          }
          return pipeline.generateLinearInfill(region, density, pp.infillLineWidth, li, pp.infillPattern, holes);
        };
        if (overhangShadowMP.length === 0) {
          infillLines.push(...genPattern(infillRegion, effectiveDensity, baseRegion.holes));
        } else {
          const infillRegionMP: PCMultiPolygon = [[pipeline.contourToClosedPCRing(infillRegion), ...baseRegion.holes.map((hole: any) => pipeline.contourToClosedPCRing(hole))]];
          let boostedMP: PCMultiPolygon = [];
          let normalMP: PCMultiPolygon = infillRegionMP;
          try {
            boostedMP = polygonClipping.intersection(infillRegionMP, overhangShadowMP);
            normalMP = polygonClipping.difference(infillRegionMP, overhangShadowMP);
          } catch { boostedMP = []; normalMP = infillRegionMP; }
          const boostedDensity = Math.min(100, effectiveDensity * 1.5);
          for (const region of pipeline.multiPolygonToRegions(boostedMP)) infillLines.push(...genPattern(region.contour, boostedDensity, region.holes));
          for (const region of pipeline.multiPolygonToRegions(normalMP)) infillLines.push(...genPattern(region.contour, effectiveDensity, region.holes));
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
        const loop = ew === 0 ? baseLoop : pipeline.offsetContour(baseLoop, ew * pp.infillLineWidth);
        if (loop.length < 3) break;
        emitter.travelTo(loop[0].x, loop[0].y, moves);
        for (let pi = 1; pi < loop.length; pi++) {
          const from = loop[pi - 1], to = loop[pi];
          layer.layerTime += emitter.extrudeTo(to.x, to.y, topBottomSpeed, pp.infillLineWidth, layerH).time;
          moves.push({ type: 'top-bottom', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed: topBottomSpeed, extrusion: emitter.calculateExtrusion(from.distanceTo(to), pp.infillLineWidth, layerH), lineWidth: pp.infillLineWidth });
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
    const sorted = (!isSolid && (pp.infillTravelOptimization ?? false)) ? pipeline.sortInfillLinesNN(infillLines, emitter.currentX, emitter.currentY) : pipeline.sortInfillLines(infillLines);
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
      let thisMoveType: any = infillMoveType, thisSpeed = speed, thisLineWidth = lineWidth, thisFlowScale = 1.0;
      if (hasBridgeRegions && infillMoveType === 'top-bottom') {
        const midX = (effFrom.x + effTo.x) / 2, midY = (effFrom.y + effTo.y) / 2;
        if (isInBridgeRegion(midX, midY)) {
          thisMoveType = 'bridge';
          thisSpeed = pp.bridgeSkinSpeed ?? speed;
          thisFlowScale = (pp.bridgeSkinFlow ?? 100) / 100;
        }
      }
      const needBridgeFan = pp.enableBridgeFan && thisMoveType === 'bridge' && !run.bridgeFanActive;
      const needFanRestore = !needBridgeFan && thisMoveType !== 'bridge' && run.bridgeFanActive;
      if (needBridgeFan) {
        gcode.push(`M106 S${emitter.fanSpeedArg(pp.bridgeFanSpeed ?? 100)} ; Bridge fan`);
        run.bridgeFanActive = true;
      } else if (needFanRestore) {
        gcode.push(`M106 S${emitter.fanSpeedArg(mat.fanSpeedMin ?? 100)} ; Restore fan after bridge`);
        run.bridgeFanActive = false;
      }
      const fromDist = Math.hypot(effFrom.x - emitter.currentX, effFrom.y - emitter.currentY);
      const canConnectInfill = connect && idx > 0 && fromDist < connectTol && pipeline.segmentInsideMaterial(new THREE.Vector2(emitter.currentX, emitter.currentY), effFrom, innermostWall, infillHoles);
      if (canConnectInfill) layer.layerTime += emitter.extrudeTo(effFrom.x, effFrom.y, thisSpeed, thisLineWidth, layerH).time;
      else emitter.travelTo(effFrom.x, effFrom.y, moves);
      const flowSaved = emitter.currentLayerFlow;
      emitter.currentLayerFlow = flowSaved * thisFlowScale;
      layer.layerTime += emitter.extrudeTo(effTo.x, effTo.y, thisSpeed, thisLineWidth, layerH).time;
      moves.push({ type: thisMoveType, from: { x: effFrom.x, y: effFrom.y }, to: { x: effTo.x, y: effTo.y }, speed: thisSpeed, extrusion: emitter.calculateExtrusion(effFrom.distanceTo(effTo), thisLineWidth, layerH), lineWidth: thisLineWidth });
      emitter.currentLayerFlow = flowSaved;
      if ((pp.infillWipeDistance ?? 0) > 0 && len > 0) {
        const wx = effTo.x + ux * pp.infillWipeDistance, wy = effTo.y + uy * pp.infillWipeDistance;
        gcode.push(`G0 X${wx.toFixed(3)} Y${wy.toFixed(3)} F${(speed * 60).toFixed(0)} ; Infill wipe`);
        emitter.currentX = wx; emitter.currentY = wy;
      }
    }
  }
}
