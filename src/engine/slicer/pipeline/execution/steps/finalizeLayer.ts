import * as THREE from 'three';

export function finalizeLayer(pipeline: any, run: any, layer: any): void {
  const { pp, mat, triangles, offsetX, offsetY, emitter, gcode } = run;
  const { li, layerZ, layerH, contours, moves, sliceZ, isSolidTop } = layer;
  let { layerTime } = layer;

  emitter.currentLayerFlow = layer.isFirstLayer && (pp.initialLayerFlow ?? 0) > 0 ? (pp.initialLayerFlow / 100) : 1.0;
  if (run.bridgeFanActive) {
    gcode.push(`M106 S${emitter.fanSpeedArg(mat.fanSpeedMin ?? 100)} ; Restore fan after bridge (layer end)`);
    run.bridgeFanActive = false;
  }

  // Update the consecutive-bridge-layer counter so the next layer's
  // fan speed can pick `bridgeFanSpeed2` or `bridgeFanSpeed3`.
  // `layerHadBridge` is set inside `emitContourInfill` whenever a
  // bridge move is emitted; reset here for the next layer.
  if (run.layerHadBridge) {
    run.consecutiveBridgeLayers = (run.consecutiveBridgeLayers ?? 0) + 1;
  } else {
    run.consecutiveBridgeLayers = 0;
  }
  run.layerHadBridge = false;

  if (li === 0 && pp.supportEnabled && (pp.enableSupportBrim ?? false)) {
    const overhangAngleRad = (pp.supportAngle * Math.PI) / 180;
    let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
    for (const tri of triangles) {
      const dotUp = tri.normal.z;
      if (dotUp >= 0) continue;
      const faceAngle = Math.acos(Math.max(0, Math.min(1, Math.abs(dotUp))));
      if (faceAngle <= overhangAngleRad) continue;
      for (const p of [new THREE.Vector2(tri.v0.x + offsetX, tri.v0.y + offsetY), new THREE.Vector2(tri.v1.x + offsetX, tri.v1.y + offsetY), new THREE.Vector2(tri.v2.x + offsetX, tri.v2.y + offsetY)]) {
        if (p.x < bMinX) bMinX = p.x; if (p.x > bMaxX) bMaxX = p.x;
        if (p.y < bMinY) bMinY = p.y; if (p.y > bMaxY) bMaxY = p.y;
      }
    }
    if (bMinX < Infinity && (bMaxX - bMinX) * (bMaxY - bMinY) > (pp.minimumSupportArea ?? 0)) {
      const brimCount = pp.supportBrimLineCount ?? Math.max(1, Math.floor((pp.supportBrimWidth ?? 3) / pp.wallLineWidth));
      gcode.push(`; Support brim (${brimCount} loops)`);
      for (let bl = 0; bl < brimCount; bl++) {
        const pad = (bl + 1) * pp.wallLineWidth;
        const pts = [new THREE.Vector2(bMinX - pad, bMinY - pad), new THREE.Vector2(bMaxX + pad, bMinY - pad), new THREE.Vector2(bMaxX + pad, bMaxY + pad), new THREE.Vector2(bMinX - pad, bMaxY + pad)];
        emitter.travelTo(pts[0].x, pts[0].y, moves);
        for (let pi = 1; pi < pts.length; pi++) {
          const from = pts[pi - 1], to = pts[pi];
          const brimSpeed = pp.skirtBrimSpeed ?? pp.firstLayerSpeed;
          layerTime += emitter.extrudeTo(to.x, to.y, brimSpeed, pp.wallLineWidth, layerH).time;
          moves.push({ type: 'brim', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed: brimSpeed, extrusion: emitter.calculateExtrusion(from.distanceTo(to), pp.wallLineWidth, layerH), lineWidth: pp.wallLineWidth });
        }
        layerTime += emitter.extrudeTo(pts[0].x, pts[0].y, pp.skirtBrimSpeed ?? pp.firstLayerSpeed, pp.wallLineWidth, layerH).time;
      }
    }
  }

  const supThickMul = (pp.supportInfillLayerThickness ?? 0) > 0 ? Math.max(1, Math.round((pp.supportInfillLayerThickness ?? 0) / pp.layerHeight)) : 1;
  if (pp.supportEnabled && li > 0 && li % supThickMul === 0) {
    const support = pipeline.generateSupportForLayer(triangles, sliceZ, layerZ, li, offsetX, offsetY, run.offsetZ, run.modelHeight, contours);
    if (support.moves.length > 0) {
      emitter.setAccel(pp.accelerationSupport, pp.accelerationPrint);
      emitter.setJerk(pp.jerkSupport, pp.jerkPrint);
      if (pp.coolingFanEnabled !== false && (pp.supportFanSpeedOverride ?? 0) > 0) gcode.push(`M106 S${emitter.fanSpeedArg(pp.supportFanSpeedOverride!)} ; Support fan override`);
      gcode.push('; Support');
      const prevFlow = emitter.currentLayerFlow;
      if (support.flowOverride !== undefined) emitter.currentLayerFlow = support.flowOverride;
      const connectSup = (pp.connectSupportLines ?? false) || (pp.connectSupportZigZags ?? false);
      const connectTol = pp.wallLineWidth * 1.5;
      for (let si = 0; si < support.moves.length; si++) {
        const sm = support.moves[si];
        const fromDist = Math.hypot(sm.from.x - emitter.currentX, sm.from.y - emitter.currentY);
        if (connectSup && si > 0 && fromDist < connectTol) layerTime += emitter.extrudeTo(sm.from.x, sm.from.y, sm.speed, sm.lineWidth, layerH).time;
        else emitter.travelTo(sm.from.x, sm.from.y, moves);
        layerTime += emitter.extrudeTo(sm.to.x, sm.to.y, sm.speed, sm.lineWidth, layerH).time;
        moves.push(sm);
      }
      emitter.currentLayerFlow = prevFlow;
      if (pp.coolingFanEnabled !== false && (pp.supportFanSpeedOverride ?? 0) > 0 && li > mat.fanDisableFirstLayers) {
        const restorePct = Math.min(pp.maximumFanSpeed ?? mat.fanSpeedMax, mat.fanSpeedMax);
        gcode.push(`M106 S${emitter.fanSpeedArg(restorePct)} ; Restore fan after support`);
      }
    }
  }

  if (pp.enableOozeShield && contours.length > 0) {
    let oMinX = Infinity, oMaxX = -Infinity, oMinY = Infinity, oMaxY = -Infinity;
    for (const c of contours) {
      if (!c.isOuter) continue;
      for (const p of c.points) {
        if (p.x < oMinX) oMinX = p.x; if (p.x > oMaxX) oMaxX = p.x;
        if (p.y < oMinY) oMinY = p.y; if (p.y > oMaxY) oMaxY = p.y;
      }
    }
    if (oMinX < Infinity) {
      const d = pp.oozeShieldDistance ?? 2;
      const shield = [new THREE.Vector2(oMinX - d, oMinY - d), new THREE.Vector2(oMaxX + d, oMinY - d), new THREE.Vector2(oMaxX + d, oMaxY + d), new THREE.Vector2(oMinX - d, oMaxY + d)];
      gcode.push('; Ooze shield');
      emitter.travelTo(shield[0].x, shield[0].y, moves);
      for (let pi = 1; pi < shield.length; pi++) {
        const from = shield[pi - 1], to = shield[pi];
        layerTime += emitter.extrudeTo(to.x, to.y, pp.wallSpeed, pp.wallLineWidth, layerH).time;
        moves.push({ type: 'wall-outer', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed: pp.wallSpeed, extrusion: emitter.calculateExtrusion(from.distanceTo(to), pp.wallLineWidth, layerH), lineWidth: pp.wallLineWidth });
      }
      layerTime += emitter.extrudeTo(shield[0].x, shield[0].y, pp.wallSpeed, pp.wallLineWidth, layerH).time;
    }
  }

  const isHighestLayer = li === run.totalLayers - 1;
  const ironGate = pp.ironOnlyHighestLayer ? isHighestLayer : isSolidTop;
  if (pp.ironingEnabled && ironGate) {
    gcode.push('; Ironing');
    const ironingFlowFactor = pp.ironingFlow / 100;
    for (const contour of contours) {
      if (!contour.isOuter) continue;
      const innermost = pipeline.offsetContour(contour.points, -(pp.wallCount * pp.wallLineWidth + (pp.ironingInset ?? 0.35)));
      if (innermost.length < 3) continue;
      const ironLines = pipeline.generateLinearInfill(innermost, 100, pp.ironingSpacing, li, pp.ironingPattern ?? 'lines');
      for (const line of ironLines) {
        emitter.travelTo(line.from.x, line.from.y, moves);
        emitter.unretract();
        const dist = Math.hypot(line.to.x - emitter.currentX, line.to.y - emitter.currentY);
        const e = emitter.calculateExtrusion(dist, pp.ironingSpacing, layerH) * ironingFlowFactor;
        emitter.currentE += e; emitter.totalExtruded += e;
        gcode.push(`G1 X${line.to.x.toFixed(3)} Y${line.to.y.toFixed(3)} E${emitter.currentE.toFixed(5)} F${(pp.ironingSpeed * 60).toFixed(0)}`);
        layerTime += dist / pp.ironingSpeed;
        emitter.currentX = line.to.x; emitter.currentY = line.to.y;
        moves.push({ type: 'ironing', from: { x: line.from.x, y: line.from.y }, to: { x: line.to.x, y: line.to.y }, speed: pp.ironingSpeed, extrusion: e, lineWidth: pp.ironingSpacing });
      }
    }
  }

  if (layerTime < pp.minLayerTime && layerTime > 0) {
    const dwellTime = pp.minLayerTime - layerTime;
    if (dwellTime > 0.5) gcode.push(`G4 P${Math.round(dwellTime * 1000)} ; Min layer time dwell`);
    layerTime = pp.minLayerTime;
  }

  run.totalTime += layerTime;
  run.sliceLayers.push({ z: layerZ, layerIndex: li, moves, layerTime });
  run.prevLayerMaterial = layer.currentLayerMaterial;
}
