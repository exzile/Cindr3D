import { applyLayerStartControls } from '../../layerControls';
import { buildLayerTopology } from '../layerTopology';

export async function prepareLayerGeometryState(pipeline: any, run: any, li: number) {
  const { pp, mat, triangles, modelBBox, offsetX, offsetY, offsetZ, layerZs, totalLayers, solidBottom, solidTop } = run;
  if (pipeline.cancelled) throw new Error('Slicing cancelled by user.');

  const layerZ = layerZs[li];
  const sliceZ = modelBBox.min.z + layerZ;
  const isFirstLayer = li === 0;
  const layerH = li === 0 ? layerZs[0] : layerZs[li] - layerZs[li - 1];

  pipeline.reportProgress('slicing', (li / totalLayers) * 80, li, totalLayers, `Slicing layer ${li + 1}/${totalLayers}...`);
  await pipeline.yieldToUI();

  // Reset the per-layer bridge flag at the start of every layer so the
  // counter logic in finalizeLayer sees a clean slate. emitContourInfill
  // sets it back to true if it actually emits a bridge move. Resetting
  // here (rather than in finalizeLayer) protects against future code
  // paths that bail between emit and finalize.
  run.layerHadBridge = false;

  const segments = pipeline.sliceTrianglesAtZ(triangles, sliceZ, offsetX, offsetY, offsetZ);
  const rawContours = pipeline.connectSegments(segments);
  if (rawContours.length === 0) return null;

  let allContours = pipeline.classifyContours(rawContours);
  const closingR = pp.slicingClosingRadius ?? 0;
  if (closingR > 0 && allContours.length > 0) allContours = pipeline.closeContourGaps(allContours, closingR);

  const minCirc = pp.minimumPolygonCircumference ?? 0;
  const smallHoleThresh = pp.smallHoleMaxSize ?? 0;
  const contours = allContours.filter((c: any) => {
    if (minCirc > 0) {
      let perim = 0;
      for (let i = 0; i < c.points.length; i++) perim += c.points[i].distanceTo(c.points[(i + 1) % c.points.length]);
      if (perim < minCirc) return false;
    }
    if (smallHoleThresh > 0 && !c.isOuter) {
      const approxDiam = 2 * Math.sqrt(Math.abs(c.area) / Math.PI);
      if (approxDiam < smallHoleThresh) return false;
    }
    return true;
  });

  if ((mat.shrinkageCompensationXY ?? 0) !== 0) {
    const scale = 1 + (mat.shrinkageCompensationXY ?? 0) / 100;
    for (const contour of contours) {
      for (const pt of contour.points) {
        pt.x = run.bedCenterX + (pt.x - run.bedCenterX) * scale;
        pt.y = run.bedCenterY + (pt.y - run.bedCenterY) * scale;
      }
    }
  }

  const hhe = pp.holeHorizontalExpansion ?? 0;
  if (hhe !== 0) {
    const maxD = pp.holeHorizontalExpansionMaxDiameter ?? Infinity;
    for (const c of contours) {
      if (c.isOuter) continue;
      if (maxD < Infinity) {
        const approxDiam = 2 * Math.sqrt(Math.abs(c.area) / Math.PI);
        if (approxDiam > maxD) continue;
      }
      const expanded = pipeline.offsetContour(c.points, hhe);
      if (expanded.length >= 3) c.points = expanded;
    }
  }

  // Horizontal expansion (Cura's `xy_offset`) — grows or shrinks the material
  // uniformly. Positive values inflate outers and contract holes (the hole
  // is negative space, so shrinking it equals growing the surrounding
  // material). `initialLayerHorizontalExpansion` overrides on layer 0;
  // `elephantFootCompensation` further shrinks the outer on layer 0 only.
  const baseXY = pp.horizontalExpansion ?? 0;
  const xyOffset = isFirstLayer
    ? (pp.initialLayerHorizontalExpansion ?? baseXY)
    : baseXY;
  const elephantFoot = isFirstLayer ? (pp.elephantFootCompensation ?? 0) : 0;
  const outerOffset = xyOffset - elephantFoot;
  const holeOffset = -xyOffset;
  if (outerOffset !== 0 || holeOffset !== 0) {
    for (const c of contours) {
      const offset = c.isOuter ? outerOffset : holeOffset;
      if (offset === 0) continue;
      const expanded = pipeline.offsetContour(c.points, offset);
      if (expanded.length >= 3) c.points = expanded;
    }
  }

  const isSolidBottom = li < Math.max(solidBottom, pp.initialBottomLayers ?? 0);
  const isSolidTop = li >= totalLayers - solidTop;
  const isSolid = isSolidBottom || isSolidTop;

  const slowerLayers = pp.numberOfSlowerLayers ?? 0;
  const ramp = (base: number): number => {
    if (isFirstLayer) return pp.firstLayerSpeed;
    if (slowerLayers > 0 && li < slowerLayers) return pp.firstLayerSpeed + (base - pp.firstLayerSpeed) * (li / slowerLayers);
    return base;
  };

  let outerWallSpeed = ramp(pp.outerWallSpeed);
  if (pp.overhangingWallSpeed !== undefined && !isFirstLayer) {
    const thr = ((pp.overhangingWallAngle ?? 45) * Math.PI) / 180;
    let hasOverhang = false;
    for (const tri of triangles) {
      const dotUp = tri.normal.z;
      if (dotUp >= 0) continue;
      const a = Math.acos(Math.max(0, Math.min(1, Math.abs(dotUp))));
      const tMinZ = Math.min(tri.v0.z, tri.v1.z, tri.v2.z);
      const tMaxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
      if (sliceZ < tMinZ || sliceZ > tMaxZ + pp.layerHeight) continue;
      if (a > thr) { hasOverhang = true; break; }
    }
    if (hasOverhang) outerWallSpeed *= (pp.overhangingWallSpeed ?? 100) / 100;
  }

  const zOverlap = isFirstLayer ? (pp.initialLayerZOverlap ?? 0) : 0;

  return {
    li,
    layerZ,
    sliceZ,
    isFirstLayer,
    layerH,
    isSolidBottom,
    isSolidTop,
    isSolid,
    outerWallSpeed,
    innerWallSpeed: ramp(pp.wallSpeed),
    infillSpeed: ramp(pp.infillSpeed),
    topBottomSpeed: isFirstLayer ? pp.firstLayerSpeed : isSolidBottom ? ramp(pp.bottomSpeed ?? pp.topSpeed) : ramp(pp.topSpeed),
    contours,
    printZ: layerZ - zOverlap,
  };
}

export function emitLayerStartState(pipeline: any, run: any, geometryState: any) {
  const { pp, mat, printer, emitter, gcode, sliceLayers } = run;
  const { li, layerZ, layerH, isFirstLayer, contours, printZ } = geometryState;
  const moves: any[] = [];
  let layerTime = 0;

  emitter.currentLayerTravelSpeed = (li === 0 && (pp.initialLayerTravelSpeed ?? 0) > 0) ? pp.initialLayerTravelSpeed! : pp.travelSpeed;
  emitter.currentLayerFlow = isFirstLayer && (pp.initialLayerFlow ?? 0) > 0 ? pp.initialLayerFlow / 100 : 1.0;

  // Pass this layer's hole contours to the emitter for avoidCrossingPerimeters
  // routing. Each hole becomes an obstacle that travel moves detour around
  // instead of cutting straight through (which previously made infill→infill
  // travels appear as long lines crossing wall geometry in the preview).
  const layerHoles = contours.filter((c: any) => !c.isOuter).map((c: any) => c.points);
  emitter.setLayerObstacles(layerHoles);

  gcode.push('');
  gcode.push(`; ----- Layer ${li}, Z=${printZ.toFixed(3)} -----`);
  gcode.push(`G1 Z${printZ.toFixed(3)} F${(pp.travelSpeed * 60).toFixed(0)}`);
  emitter.currentZ = printZ;
  if ((pp.layerStartX != null || pp.layerStartY != null) && !isFirstLayer) {
    emitter.travelTo(pp.layerStartX ?? emitter.currentX, pp.layerStartY ?? emitter.currentY, moves);
  }

  applyLayerStartControls({
    gcode,
    layerIndex: li,
    totalLayers: run.totalLayers,
    layerZ,
    previousLayerTime: sliceLayers.length > 0 ? sliceLayers[sliceLayers.length - 1].layerTime : Infinity,
    printer,
    material: mat,
    print: pp,
    flags: run.layerControlFlags,
  });

  if (li === 0) {
    emitter.setAccel(pp.accelerationSkirtBrim ?? pp.accelerationInitialLayer, pp.accelerationPrint);
    emitter.setJerk(pp.jerkSkirtBrim ?? pp.jerkInitialLayer, pp.jerkPrint);
    if (pp.adhesionType === 'raft') {
      emitter.setAccel(pp.raftPrintAcceleration ?? pp.accelerationSkirtBrim ?? pp.accelerationInitialLayer, pp.accelerationPrint);
      emitter.setJerk(pp.raftPrintJerk ?? pp.jerkSkirtBrim ?? pp.jerkInitialLayer, pp.jerkPrint);
      if ((pp.raftFanSpeed ?? 0) > 0) gcode.push(`M106 S${emitter.fanSpeedArg(pp.raftFanSpeed!)} ; Raft fan`);
    }
    const adhesionMoves = pipeline.generateAdhesion(contours, pp, layerH, run.offsetX, run.offsetY);
    for (const am of adhesionMoves) {
      emitter.travelTo(am.from.x, am.from.y, moves);
      layerTime += emitter.extrudeTo(am.to.x, am.to.y, am.speed, am.lineWidth, am.layerHeight ?? layerH).time;
      moves.push(am);
    }
  }

  if (pp.draftShieldEnabled) {
    const shieldActive = pp.draftShieldLimitation !== 'limited' || layerZ <= (pp.draftShieldHeight ?? Infinity);
    if (shieldActive) {
      let dsMinX = Infinity, dsMaxX = -Infinity, dsMinY = Infinity, dsMaxY = -Infinity;
      for (const c of contours) {
        for (const p of c.points) {
          if (p.x < dsMinX) dsMinX = p.x; if (p.x > dsMaxX) dsMaxX = p.x;
          if (p.y < dsMinY) dsMinY = p.y; if (p.y > dsMaxY) dsMaxY = p.y;
        }
      }
      const sd = pp.draftShieldDistance ?? 10;
      const slw = pp.wallLineWidth;
      const shieldPts = [
        { x: dsMinX - sd - slw / 2, y: dsMinY - sd - slw / 2 },
        { x: dsMaxX + sd + slw / 2, y: dsMinY - sd - slw / 2 },
        { x: dsMaxX + sd + slw / 2, y: dsMaxY + sd + slw / 2 },
        { x: dsMinX - sd - slw / 2, y: dsMaxY + sd + slw / 2 },
        { x: dsMinX - sd - slw / 2, y: dsMinY - sd - slw / 2 },
      ];
      const shieldSpeed = pp.skirtBrimSpeed ?? pp.travelSpeed;
      emitter.travelTo(shieldPts[0].x, shieldPts[0].y, moves);
      gcode.push('; Draft shield');
      for (let si = 1; si < shieldPts.length; si++) layerTime += emitter.extrudeTo(shieldPts[si].x, shieldPts[si].y, shieldSpeed, slw, layerH).time;
    }
  }

  const topology = buildLayerTopology({
    contours,
    optimizeWallOrder: pp.optimizeWallOrder ?? false,
    currentX: emitter.currentX,
    currentY: emitter.currentY,
    previousLayerMaterial: run.prevLayerMaterial,
    isFirstLayer,
    pointInContour: (point: any, contour: any) => pipeline.pointInContour(point, contour),
    pointInRing: (x: number, y: number, ring: any) => pipeline.pointInRing(x, y, ring),
  });

  return {
    ...geometryState,
    moves,
    layerTime,
    ...topology,
  };
}

export async function prepareLayerState(pipeline: any, run: any, li: number) {
  const geometryState = await prepareLayerGeometryState(pipeline, run, li);
  if (!geometryState) return null;
  return emitLayerStartState(pipeline, run, geometryState);
}
