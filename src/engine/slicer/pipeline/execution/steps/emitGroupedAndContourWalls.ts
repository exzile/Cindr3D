import * as THREE from 'three';

function reorderOuterLoop(pp: any, pipeline: any, emitter: any, loop: any[], lineWidth: number, li: number) {
  const seamIdx = pipeline.findSeamPosition(loop, pp, li, emitter.currentX, emitter.currentY);
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
  return pipeline.simplifyClosedContour(reordered, Math.max(0.015, lineWidth * 0.05));
}

function emitOuterLoop(params: any) {
  const { pp, li, layerZ, layerH, isFirstLayer, outerWallSpeed, gcode, emitter, moves } = params;
  const reordered = reorderOuterLoop(pp, params.pipeline, emitter, params.loop, params.lineWidth, li);
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
    let segLW = params.lineWidth, segSpeed = outerWallSpeed;
    if (scarfRemaining > 0) {
      const done = scarfLen - scarfRemaining;
      const tRaw = done / scarfLen;
      const t = Math.min(1, scarfStepLen > 0 ? Math.floor(done / scarfStepLen) * scarfStepLen / scarfLen : tRaw);
      segLW = params.lineWidth * t;
      const speedRatio = pp.scarfSeamStartSpeedRatio ?? 1.0;
      segSpeed = outerWallSpeed * (speedRatio + (1.0 - speedRatio) * t);
      scarfRemaining = Math.max(0, scarfRemaining - from.distanceTo(to));
    }
    layerTime += emitter.extrudeTo(to.x, to.y, segSpeed, segLW, layerH).time;
    moves.push({ type: 'wall-outer', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed: segSpeed, extrusion: emitter.calculateExtrusion(from.distanceTo(to), segLW, layerH), lineWidth: segLW });
  }
  if (reordered.length > 2) {
    const lastPt = reordered[reordered.length - 1], firstPt = reordered[0], segLen = lastPt.distanceTo(firstPt);
    const coastVol = params.allowCoasting ? (pp.coastingEnabled ? (pp.coastingVolume ?? 0) : 0) : 0;
    const minCoastVol = pp.minVolumeBeforeCoasting ?? 0;
    const loopVol = minCoastVol > 0 ? (() => {
      let perim = segLen;
      for (let ri = 1; ri < reordered.length - 1; ri++) perim += reordered[ri].distanceTo(reordered[ri + 1]);
      return perim * pp.wallLineWidth * layerH;
    })() : Infinity;
    const coastDist = coastVol > 0 && loopVol >= minCoastVol ? coastVol / (params.lineWidth * layerH) : 0;
    if (coastDist > 0 && segLen > coastDist + 1e-3) {
      const t = 1 - coastDist / segLen;
      const midX = lastPt.x + (firstPt.x - lastPt.x) * t, midY = lastPt.y + (firstPt.y - lastPt.y) * t;
      layerTime += emitter.extrudeTo(midX, midY, outerWallSpeed, params.lineWidth, layerH).time;
      moves.push({ type: 'wall-outer', from: { x: lastPt.x, y: lastPt.y }, to: { x: midX, y: midY }, speed: outerWallSpeed, extrusion: emitter.calculateExtrusion(segLen * t, params.lineWidth, layerH), lineWidth: params.lineWidth });
      const coastSpeed = outerWallSpeed * ((pp.coastingSpeed ?? 90) / 100);
      gcode.push(`G0 X${firstPt.x.toFixed(3)} Y${firstPt.y.toFixed(3)} F${(coastSpeed * 60).toFixed(0)} ; Coast`);
      emitter.currentX = firstPt.x; emitter.currentY = firstPt.y;
    } else {
      layerTime += emitter.extrudeTo(firstPt.x, firstPt.y, outerWallSpeed, params.lineWidth, layerH).time;
      moves.push({ type: 'wall-outer', from: { x: lastPt.x, y: lastPt.y }, to: { x: firstPt.x, y: firstPt.y }, speed: outerWallSpeed, extrusion: emitter.calculateExtrusion(segLen, params.lineWidth, layerH), lineWidth: params.lineWidth });
    }
  }
  return layerTime;
}

export function emitGroupedAndContourWalls(pipeline: any, run: any, layer: any) {
  const { pp, emitter, gcode } = run;
  const { li, layerZ, layerH, isFirstLayer, outerWallSpeed, innerWallSpeed, workContours, holesByOuterContour, moves } = layer;
  const groupOW = pp.groupOuterWalls ?? false;
  const perContour: any[] = [];

  if (groupOW) {
    for (const contour of workContours) {
      if (!contour.isOuter) continue;
      const containedHoles = holesByOuterContour.get(contour) ?? [];
      const perimeters = pipeline.filterPerimetersByMinOdd(
        pipeline.generatePerimetersEx(contour.points, containedHoles, pp.wallCount, pp.wallLineWidth, pp.outerWallInset ?? 0),
        pp.minOddWallLineWidth ?? 0,
      );
      perContour.push({ contour, exWalls: perimeters, wallSets: perimeters.walls, wallLineWidths: perimeters.lineWidths, outerWallCount: perimeters.outerCount, infillHoles: perimeters.innermostHoles });
    }
    for (const item of perContour) {
      const outerWall = item.wallSets[0];
      if (!outerWall || outerWall.length < 2) continue;
      layer.layerTime += emitOuterLoop({ pipeline, pp, li, layerZ, layerH, isFirstLayer, outerWallSpeed, gcode, emitter, moves, loop: outerWall, lineWidth: item.wallLineWidths[0] ?? pp.wallLineWidth, comment: 'Outer wall (grouped)', allowCoasting: false });
    }
  }

  for (const contour of workContours) {
    if (!contour.isOuter) continue;
    const containedHoles = holesByOuterContour.get(contour) ?? [];
    const exWalls = pipeline.filterPerimetersByMinOdd(
      pipeline.generatePerimetersEx(contour.points, containedHoles, pp.wallCount, pp.wallLineWidth, pp.outerWallInset ?? 0),
      pp.minOddWallLineWidth ?? 0,
    );
    const wallSets = exWalls.walls;
    const wallLineWidths = exWalls.lineWidths;
    const outerWallCount = exWalls.outerCount;
    const infillHoles = exWalls.innermostHoles;
    const contourData = { contour, exWalls, wallSets, wallLineWidths, outerWallCount, infillHoles };
    perContour.push(contourData);

    if (!groupOW && wallSets.length > 0 && pp.outerWallFirst) {
      if (isFirstLayer && pp.initialLayerOuterWallFlow != null) emitter.currentLayerFlow = pp.initialLayerOuterWallFlow / 100;
      layer.layerTime += emitOuterLoop({ pipeline, pp, li, layerZ, layerH, isFirstLayer, outerWallSpeed, gcode, emitter, moves, loop: wallSets[0], lineWidth: wallLineWidths[0] ?? pp.wallLineWidth, allowCoasting: true });
    }

    emitter.currentLayerFlow = isFirstLayer && (pp.initialLayerFlow ?? 0) > 0 ? (pp.initialLayerFlow / 100) : 1.0;
    const innerLW = pp.innerWallLineWidth ?? pp.wallLineWidth;
    if (isFirstLayer && pp.initialLayerInnerWallFlow != null) emitter.currentLayerFlow = pp.initialLayerInnerWallFlow / 100;
    for (let wi = 1; wi < wallSets.length; wi++) {
      const innerWallLineWidth = wallLineWidths[wi] ?? innerLW;
      const innerWall = pipeline.simplifyClosedContour(wallSets[wi], Math.max(0.015, innerWallLineWidth * 0.05));
      if (innerWall.length < 2) continue;
      emitter.setAccel(isFirstLayer ? pp.accelerationInitialLayer : (pp.accelerationInnerWall ?? pp.accelerationWall), pp.accelerationPrint);
      emitter.setJerk(isFirstLayer ? pp.jerkInitialLayer : (pp.jerkInnerWall ?? pp.jerkWall), pp.jerkPrint);
      emitter.travelTo(innerWall[0].x, innerWall[0].y, moves);
      gcode.push(`; Inner wall ${wi}`);
      for (let pi = 1; pi < innerWall.length; pi++) {
        const from = innerWall[pi - 1], to = innerWall[pi];
        layer.layerTime += emitter.extrudeTo(to.x, to.y, innerWallSpeed, innerWallLineWidth, layerH).time;
        moves.push({ type: 'wall-inner', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed: innerWallSpeed, extrusion: emitter.calculateExtrusion(from.distanceTo(to), innerWallLineWidth, layerH), lineWidth: innerWallLineWidth });
      }
      if (innerWall.length > 2) {
        const lastPt = innerWall[innerWall.length - 1], firstPt = innerWall[0];
        layer.layerTime += emitter.extrudeTo(firstPt.x, firstPt.y, innerWallSpeed, innerWallLineWidth, layerH).time;
        moves.push({ type: 'wall-inner', from: { x: lastPt.x, y: lastPt.y }, to: { x: firstPt.x, y: firstPt.y }, speed: innerWallSpeed, extrusion: emitter.calculateExtrusion(lastPt.distanceTo(firstPt), innerWallLineWidth, layerH), lineWidth: innerWallLineWidth });
      }
    }

    emitter.currentLayerFlow = isFirstLayer && (pp.initialLayerFlow ?? 0) > 0 ? (pp.initialLayerFlow / 100) : 1.0;
    if (!groupOW && wallSets.length > 0 && !pp.outerWallFirst) {
      if (isFirstLayer && pp.initialLayerOuterWallFlow != null) emitter.currentLayerFlow = pp.initialLayerOuterWallFlow / 100;
      layer.layerTime += emitOuterLoop({ pipeline, pp, li, layerZ, layerH, isFirstLayer, outerWallSpeed, gcode, emitter, moves, loop: wallSets[0], lineWidth: wallLineWidths[0] ?? pp.wallLineWidth, allowCoasting: true });
      emitter.currentLayerFlow = isFirstLayer && (pp.initialLayerFlow ?? 0) > 0 ? (pp.initialLayerFlow / 100) : 1.0;
    }
  }

  return perContour.filter((item) => item.contour?.isOuter);
}
