import type * as THREE from 'three';
import type { Ring as PCRing } from 'polygon-clipping';
import type { SliceMove } from '../../../../../types/slicer';
import { applyLayerStartControls } from '../../layerControls';
import { buildLayerTopology } from '../layerTopology';
import {
  applyCuttingMeshSubtraction,
  buildModifierRegionsForLayer,
} from '../../modifierMeshes';
import type {
  SlicerExecutionPipeline,
  SliceGeometryRun,
  SliceLayerGeometryState,
  SliceLayerState,
  SliceRun,
} from './types';

interface PrepareLayerGeometryOptions {
  reportProgress?: boolean;
  yieldToUI?: boolean;
}

const ACTIVE_TRIANGLE_Z_EPSILON = 1e-7;
const activeTrianglesByRun = new WeakMap<SliceGeometryRun, SliceGeometryRun['triangles'][]>();
type ActiveLayerSubsetRun = SliceGeometryRun & { activeLayerIndices?: number[] };

/**
 * Cura's "Top Surface Skin Layers" / "Bottom Surface Skin Layers": when
 * `topSurfaceSkinLayers > 0`, only the topmost N solid layers receive
 * the ultra-quality top-surface treatment (special line width, pattern,
 * expansion, flow). Solid-top layers below those still emit as solid
 * skin but use the regular top/bottom settings.
 *
 * Default (count = 0 or undefined) returns `false` for every layer —
 * matching Cura's default of "no special top-surface treatment."
 *
 * The bottom-surface counterpart is symmetric: when `count > 0` only
 * the bottommost N layers are flagged.
 */
export function isTopSurfaceLayerForCounts(
  li: number,
  totalLayers: number,
  topSurfaceSkinLayers: number | undefined,
): boolean {
  const n = topSurfaceSkinLayers ?? 0;
  if (n <= 0 || totalLayers <= 0) return false;
  return li >= totalLayers - n;
}

export function isBottomSurfaceLayerForCounts(
  li: number,
  bottomSurfaceSkinLayers: number | undefined,
): boolean {
  const n = bottomSurfaceSkinLayers ?? 0;
  if (n <= 0) return false;
  return li < n;
}

function lowerBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function activeTrianglesForLayer(run: SliceGeometryRun, li: number): SliceGeometryRun['triangles'] {
  let layers = activeTrianglesByRun.get(run);
  if (!layers) {
    layers = Array.from({ length: run.totalLayers }, () => [] as SliceGeometryRun['triangles']);
    const modelMinZ = run.modelBBox.min.z;
    const activeLayerIndices = (run as ActiveLayerSubsetRun).activeLayerIndices
      ?.filter((layerIndex) => layerIndex >= 0 && layerIndex < run.totalLayers);

    if (activeLayerIndices && activeLayerIndices.length > 0) {
      for (const tri of run.triangles) {
        const minZ = Math.min(tri.v0.z, tri.v1.z, tri.v2.z) - modelMinZ;
        const maxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z) - modelMinZ;
        for (const layerIndex of activeLayerIndices) {
          const layerZ = run.layerZs[layerIndex];
          if (layerZ < minZ - ACTIVE_TRIANGLE_Z_EPSILON || layerZ > maxZ + ACTIVE_TRIANGLE_Z_EPSILON) continue;
          layers[layerIndex].push(tri);
        }
      }
    } else {
      for (const tri of run.triangles) {
        const minZ = Math.min(tri.v0.z, tri.v1.z, tri.v2.z) - modelMinZ;
        const maxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z) - modelMinZ;
        const firstLayer = lowerBound(run.layerZs, minZ - ACTIVE_TRIANGLE_Z_EPSILON);
        const lastLayer = upperBound(run.layerZs, maxZ + ACTIVE_TRIANGLE_Z_EPSILON);
        for (let layerIndex = firstLayer; layerIndex < lastLayer; layerIndex++) {
          layers[layerIndex].push(tri);
        }
      }
    }
    activeTrianglesByRun.set(run, layers);
  }
  return layers[li] ?? [];
}

export async function prepareLayerGeometryState(
  pipeline: unknown,
  run: SliceGeometryRun,
  li: number,
  options: PrepareLayerGeometryOptions = {},
): Promise<SliceLayerGeometryState | null> {
  const slicer = pipeline as SlicerExecutionPipeline;
  const { pp, mat, triangles, modelBBox, offsetX, offsetY, offsetZ, layerZs, totalLayers, solidBottom, solidTop } = run;
  if (slicer.cancelled) throw new Error('Slicing cancelled by user.');

  const layerZ = layerZs[li];
  const sliceZ = modelBBox.min.z + layerZ;
  const isFirstLayer = li === 0;
  const layerH = li === 0 ? layerZs[0] : layerZs[li] - layerZs[li - 1];

  if (options.reportProgress ?? true) {
    slicer.reportProgress('slicing', (li / totalLayers) * 80, li, totalLayers, `Slicing layer ${li + 1}/${totalLayers}...`);
  }
  if (options.yieldToUI ?? true) await slicer.yieldToUI();

  // Reset the per-layer bridge flag at the start of every layer so the
  // counter logic in finalizeLayer sees a clean slate. emitContourInfill
  // sets it back to true if it actually emits a bridge move. Resetting
  // here (rather than in finalizeLayer) protects against future code
  // paths that bail between emit and finalize.
  run.layerHadBridge = false;

  const layerTriangles = activeTrianglesForLayer(run, li);
  const segments = slicer.sliceTrianglesAtZ(layerTriangles, sliceZ, offsetX, offsetY, offsetZ);
  const rawContours = slicer.connectSegments(segments);
  if (rawContours.length === 0) return null;

  let allContours = slicer.classifyContours(rawContours);
  const closingR = pp.slicingClosingRadius ?? 0;
  if (closingR > 0 && allContours.length > 0) allContours = slicer.closeContourGaps(allContours, closingR);

  const minCirc = pp.minimumPolygonCircumference ?? 0;
  const smallHoleThresh = pp.smallHoleMaxSize ?? 0;
  let contours = allContours.filter((c) => {
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

  // Modifier-mesh composition. Slice every modifier mesh at this layer
  // and apply role-specific 2D booleans:
  //   • cutting_mesh subtracts its cross-section from printable contours.
  //   • support_mesh / anti_overhang_mesh / infill_mesh contribute
  //     regions consumed by downstream support emission and (eventually)
  //     per-region infill overrides.
  // The result is stored on the layer state so finalizeLayer's support
  // step and emitContourInfill can read it.
  const modifierRegions = buildModifierRegionsForLayer(
    slicer,
    run.modifierMeshes,
    sliceZ,
    offsetX,
    offsetY,
    offsetZ,
  );
  if (modifierRegions?.cuttingMP) {
    contours = applyCuttingMeshSubtraction(contours, modifierRegions.cuttingMP, slicer);
    if (contours.length === 0) return null;
  }

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
      const expanded = slicer.offsetContour(c.points, hhe);
      if (expanded.length >= 3) c.points = expanded;
    }
  }

  // Horizontal expansion (Cura's `xy_offset`) — grows or shrinks the material
  // uniformly. Positive values inflate outers and contract holes (the hole
  // is negative space, so shrinking it equals growing the surrounding
  // material). `initialLayerHorizontalExpansion` overrides on layer 0;
  // `elephantFootCompensation` further shrinks the outer on layer 0 only.
  //
  // SIGN CONVENTION (matches `offsetContour` in `geometry/pathGeometry.ts`):
  // a positive offset shifts each edge along its (-dy, dx) inward normal.
  // For a CCW outer that direction points TOWARD the polygon interior
  // (positive offset shrinks the outer); for a CW hole it points INTO the
  // surrounding material (positive offset grows the hole). To grow material
  // everywhere we therefore pass `-xyOffset` to BOTH outer and hole. The
  // (positive) elephant-foot value is added to `outerOffset` so it shrinks
  // the first-layer outer.
  const baseXY = pp.horizontalExpansion ?? 0;
  const xyOffset = isFirstLayer
    ? (pp.initialLayerHorizontalExpansion ?? baseXY)
    : baseXY;
  const elephantFoot = isFirstLayer ? (pp.elephantFootCompensation ?? 0) : 0;
  const outerOffset = -xyOffset + elephantFoot;
  const holeOffset = -xyOffset;
  if (outerOffset !== 0 || holeOffset !== 0) {
    for (const c of contours) {
      const offset = c.isOuter ? outerOffset : holeOffset;
      if (offset === 0) continue;
      const expanded = slicer.offsetContour(c.points, offset);
      if (expanded.length >= 3) c.points = expanded;
    }
  }

  const isSolidBottom = li < Math.max(solidBottom, pp.initialBottomLayers ?? 0);
  let isSolidTop = li >= totalLayers - solidTop;
  let isSolid = isSolidBottom || isSolidTop;

  // Cura "Mold Mode" — print a mold around the model instead of the model
  // itself. For each outer contour:
  //   • Mold's outer boundary = original outer expanded outward by mold
  //     width (`minMoldWidth`).
  //   • Above the basin floor, the original outer becomes a HOLE in the
  //     mold so the model's footprint stays empty (the cavity for casting).
  //   • The basin floor (the solid-bottom layers) keeps the mold filled
  //     across the model's footprint so the cast has a solid base.
  //   • Original holes in the model are dropped — they become solid mold
  //     material since they were empty inside the model.
  // After replacement, the layer prints as the mold, so all subsequent
  // logic (skin, infill, walls) operates on the mold geometry.
  if ((pp.moldEnabled ?? false) && contours.length > 0) {
    const moldWidth = Math.max(0.5, pp.minMoldWidth ?? 5);
    const moldContours: typeof contours = [];
    for (const c of contours) {
      if (!c.isOuter) continue;
      // Negative offset = grow outer outward (see SIGN CONVENTION above).
      const inflated = slicer.offsetContour(c.points, -moldWidth);
      if (inflated.length < 3) continue;
      moldContours.push({ points: inflated, area: slicer.signedArea(inflated), isOuter: true });
      if (!isSolidBottom) {
        // Above the floor, model footprint becomes a hole in the mold so
        // the cavity opens upward. Reverse winding so it's a proper hole
        // (CW inside the CCW outer).
        const holePoints = [...c.points].reverse();
        moldContours.push({ points: holePoints, area: -Math.abs(c.area), isOuter: false });
      }
    }
    contours.length = 0;
    contours.push(...moldContours);
    // The mold is open at the top — suppress the solid-top skin band
    // (would otherwise close the mold roof and trap the cast inside).
    if (isSolidTop) {
      isSolidTop = false;
      isSolid = isSolidBottom;
    }
  }
  const isTopSurfaceLayer = isTopSurfaceLayerForCounts(li, totalLayers, pp.topSurfaceSkinLayers);
  const isBottomSurfaceLayer = isBottomSurfaceLayerForCounts(li, pp.bottomSurfaceSkinLayers);

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
    isTopSurfaceLayer,
    isBottomSurfaceLayer,
    outerWallSpeed,
    innerWallSpeed: ramp(pp.wallSpeed),
    infillSpeed: ramp(pp.infillSpeed),
    topBottomSpeed: isFirstLayer ? pp.firstLayerSpeed : isSolidBottom ? ramp(pp.bottomSpeed ?? pp.topSpeed) : ramp(pp.topSpeed),
    contours,
    printZ: layerZ - zOverlap,
    modifierRegions,
  };
}

export function emitLayerStartState(
  pipeline: unknown,
  run: SliceRun,
  geometryState: SliceLayerGeometryState,
): SliceLayerState {
  const slicer = pipeline as SlicerExecutionPipeline;
  const { pp, mat, printer, emitter, gcode, sliceLayers } = run;
  const { li, layerZ, layerH, isFirstLayer, contours, printZ } = geometryState;
  const moves: SliceMove[] = [];
  let layerTime = 0;

  emitter.currentLayerTravelSpeed = (li === 0 && (pp.initialLayerTravelSpeed ?? 0) > 0) ? pp.initialLayerTravelSpeed! : pp.travelSpeed;
  const initialLayerFlow = pp.initialLayerFlow ?? 0;
  emitter.currentLayerFlow = isFirstLayer && initialLayerFlow > 0 ? initialLayerFlow / 100 : 1.0;

  // Pass this layer's hole contours to the emitter for avoidCrossingPerimeters
  // routing. Each hole becomes an obstacle that travel moves detour around
  // instead of cutting straight through (which previously made infill→infill
  // travels appear as long lines crossing wall geometry in the preview).
  const layerHoles = contours.filter((c) => !c.isOuter).map((c) => c.points);
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
    const adhesionMoves = slicer.generateAdhesion(contours, pp, layerH, run.offsetX, run.offsetY);
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
    // Lookup the next layer's material from the cache populated by the
    // pre-pass in `runSlicePipeline.ts`. Empty for the topmost layer or
    // when the cache isn't populated (worker contexts, fallback paths).
    nextLayerMaterial: run.layerMaterialCache[geometryState.li + 1],
    // Filter out tessellation-noise slivers from `topSkinRegion`. Curved
    // walls (cones, spheres) produce thin shaving-like differences along
    // the wall in `current − next` even when no real feature-top exists
    // there; without this filter those slivers become spurious solid-skin
    // bumps on the wall. Threshold = 1.5 × nominal infill line width
    // (matches the same metric used elsewhere in the skin pipeline).
    topSkinSliverThickness: pp.infillLineWidth * 1.5,
    isFirstLayer,
    pointInContour: (point: THREE.Vector2, contour: THREE.Vector2[]) => slicer.pointInContour(point, contour),
    pointInRing: (x: number, y: number, ring: PCRing) => slicer.pointInRing(x, y, ring),
  });

  return {
    ...geometryState,
    moves,
    layerTime,
    ...topology,
  };
}

export async function prepareLayerState(
  pipeline: unknown,
  run: SliceRun,
  li: number,
  options: PrepareLayerGeometryOptions = {},
): Promise<SliceLayerState | null> {
  const geometryState = await prepareLayerGeometryState(pipeline, run, li, options);
  if (!geometryState) return null;
  return emitLayerStartState(pipeline, run, geometryState);
}
