// =============================================================================
// DesignCAD Slicer Engine
// Full-featured slicer: takes Three.js meshes and produces G-code
// =============================================================================

import * as THREE from 'three';
import polygonClipping, { type MultiPolygon as PCMultiPolygon, type Ring as PCRing } from 'polygon-clipping';
import type {
  PrinterProfile,
  MaterialProfile,
  PrintProfile,
  SliceResult,
  SliceProgress,
  SliceLayer,
  SliceMove,
} from '../../types/slicer';
import {
  computeAdaptiveLayerZs as computeAdaptiveLayerZsFromModule,
} from './pipeline/adaptiveLayers';
import {
  generateAdhesion as generateAdhesionFromModule,
} from './pipeline/adhesion';
import {
  contourBBox as contourBBoxFromUtils,
  lineContourIntersections as lineContourIntersectionsFromUtils,
  pointInContour as pointInContourFromUtils,
  reorderFromIndex as reorderFromIndexFromUtils,
  signedArea as signedAreaFromUtils,
} from './geometry/contourUtils';
import {
  classifyContours as classifyContoursFromSegments,
  computeBBox as computeTriangleBBox,
  connectSegments as connectSegmentLoops,
  extractTriangles as extractTrianglesFromGeometries,
  sliceTrianglesAtZ as sliceTriangleSegmentsAtZ,
} from './geometry/coreGeometry';
import {
  contourToClosedPCRing,
  generateLinearInfill as generateLinearInfillFromModule,
  generateScanLines as generateScanLinesFromModule,
  multiPolygonToRegions,
  sortInfillLines as sortInfillLinesFromModule,
  sortInfillLinesNN as sortInfillLinesNNFromModule,
} from './pipeline/infill';
import {
  generateSupportForLayer as generateSupportForLayerFromModule,
} from './pipeline/support';
import {
  closeContourGaps as closeContourGapsFromModule,
  filterPerimetersByMinOdd as filterPerimetersByMinOddFromModule,
  generatePerimetersEx as generatePerimetersExFromModule,
} from './pipeline/perimeters';
import {
  offsetContour as offsetContourFromModule,
  simplifyClosedContour as simplifyClosedContourFromModule,
} from './geometry/pathGeometry';
import {
  findSeamPosition as findSeamPositionFromModule,
} from './geometry/seams';
import {
  pointInRing as pointInRingFromModule,
  segmentInsideMaterial as segmentInsideMaterialFromModule,
} from './geometry/regionQueries';
import {
  appendEndGCode,
  finalizeGCodeStats,
} from './gcode/footer';
import {
  appendHeaderPlaceholders,
  appendStartGCode,
  type SlicerGCodeFlavor,
} from './gcode/startup';
import {
  reportProgress as reportProgressFromModule,
  yieldToUI as yieldToUIFromModule,
} from './gcode/runtime';
import {
  fanSpeedToCommandArg,
} from './gcode/startEnd';
import {
  shouldRetractOnTravel as shouldRetractOnTravelFromModule,
} from './gcode/travel';
import {
  applyLayerStartControls,
} from './pipeline/layerControls';
import type { StartEndMachineState } from './gcode/startEnd';
import type { BBox2, Contour, GeneratedPerimeters, Segment, Triangle } from './types';

export class SlicerEngine {
  private printerProfile: PrinterProfile;
  private materialProfile: MaterialProfile;
  private printProfile: PrintProfile;
  private onProgress?: (progress: SliceProgress) => void;
  private cancelled = false;

  constructor(
    printer: PrinterProfile,
    material: MaterialProfile,
    print: PrintProfile,
  ) {
    this.printerProfile = printer;
    this.materialProfile = material;
    this.printProfile = print;
  }

  /** Register a callback that receives progress updates during slicing. */
  setProgressCallback(cb: (progress: SliceProgress) => void): void {
    this.onProgress = cb;
  }

  /** Cancel an in-progress slice operation. */
  cancel(): void {
    this.cancelled = true;
  }

  // =========================================================================
  // PUBLIC: main entry point
  // =========================================================================

  async slice(
    geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
  ): Promise<SliceResult> {
    this.cancelled = false;
    const pp = this.printProfile;
    const mat = this.materialProfile;
    const printer = this.printerProfile;

    // Firmware dialect. 'duet' and 'reprap' share RepRap Firmware syntax
    // (pressure advance via M572, instantaneous-speed-change "jerk" via
    // M566 in mm/min). 'marlin' uses classic M205 jerk / M900 K linear
    // advance. 'klipper' ignores M205 / M900 and wants macro commands.
    const flavor: SlicerGCodeFlavor = printer.gcodeFlavorType ?? 'marlin';
    const isRRF = flavor === 'duet' || flavor === 'reprap';
    const isKlipper = flavor === 'klipper';

    // ----- 1. Prepare triangles -----
    this.reportProgress('preparing', 0, 0, 0, 'Extracting triangles...');
    const triangles = this.extractTriangles(geometries);
    if (triangles.length === 0) {
      throw new Error('No triangles found in provided geometry.');
    }

    // ----- 2. Compute bounding box -----
    const modelBBox = this.computeBBox(triangles);
    const modelHeight = modelBBox.max.z - modelBBox.min.z;

    // Center model on bed
    const bedCenterX = printer.originCenter ? 0 : printer.buildVolume.x / 2;
    const bedCenterY = printer.originCenter ? 0 : printer.buildVolume.y / 2;
    const modelCenterX = (modelBBox.min.x + modelBBox.max.x) / 2;
    const modelCenterY = (modelBBox.min.y + modelBBox.max.y) / 2;
    const offsetX = bedCenterX - modelCenterX;
    const offsetY = bedCenterY - modelCenterY;
    const offsetZ = -modelBBox.min.z; // place model on bed (z=0)

    // ----- 3. Compute layer heights -----
    // Cura-parity: shrinkageCompensationZ scales all Z positions up so the
    // printed part ends at the correct height after the material cools and
    // shrinks vertically. e.g., 0.3% → multiply every layerZ by 1.003.
    const zScale = 1 + (mat.shrinkageCompensationZ ?? 0) / 100;
    let layerZs: number[];
    if (pp.adaptiveLayersEnabled) {
      layerZs = this.computeAdaptiveLayerZs(
        triangles,
        modelHeight,
        pp.firstLayerHeight,
        pp.layerHeight,
        pp.adaptiveLayersMaxVariation,
        pp.adaptiveLayersVariationStep,
        zScale,
      );
    } else {
      layerZs = [];
      let z = pp.firstLayerHeight;
      while (z <= modelHeight + 0.0001) {
        layerZs.push(z * zScale);
        z += pp.layerHeight;
      }
    }
    const totalLayers = layerZs.length;
    if (totalLayers === 0) {
      throw new Error('Model too thin to slice at the given layer height.');
    }

    // Precompute which layers are top/bottom solid. Cura-parity:
    // topThickness / bottomThickness (mm) override the layer counts if set —
    // they're more intuitive than counts when layer height changes.
    const solidBottom = pp.bottomThickness && pp.bottomThickness > 0
      ? Math.max(1, Math.ceil(pp.bottomThickness / pp.layerHeight))
      : pp.bottomLayers;
    const solidTop = pp.topThickness && pp.topThickness > 0
      ? Math.max(1, Math.ceil(pp.topThickness / pp.layerHeight))
      : pp.topLayers;

    // ----- 4. Slice layer by layer -----
    const sliceLayers: SliceLayer[] = [];
    let totalExtruded = 0; // mm of filament
    let totalTime = 0; // seconds

    // Track extruder state
    let currentE = 0;
    let currentX = 0;
    let currentY = 0;
    let currentZ = 0;
    let isRetracted = false;
    let extrudedSinceRetract = 0;
    let lastExtrudeDx = 0;
    let lastExtrudeDy = 0;

    const gcode: string[] = [];

    // Relative extrusion mode (Cura: relative_extrusion). When enabled, emit
    // M83 and every G1 E-value is a delta rather than an absolute position.
    const relativeE = pp.relativeExtrusion ?? false;

    // Per-layer flow multiplier — updated at the start of each layer.
    // Cura-parity: initialLayerFlow overrides the base flowRate on the first
    // layer only, letting users print a wider/thicker first layer without
    // changing the global flow.
    let currentLayerFlow = 1.0;
    let currentLayerTravelSpeed = pp.travelSpeed;

    // Per-feature acceleration/jerk helpers — emit M204/M205 only when the
    // value changes. Both are no-ops when the respective enabled flag is off.
    let _currentAccel = -1;
    let _currentJerk = -1;
    const setAccel = (val: number | undefined, fallback: number): void => {
      if (!pp.accelerationEnabled) return;
      const v = Math.round(val ?? fallback);
      if (v === _currentAccel) return;
      gcode.push(`M204 S${v} ; Accel`);
      _currentAccel = v;
    };
    const setJerk = (val: number | undefined, fallback: number): void => {
      if (!pp.jerkEnabled) return;
      const v = Number((val ?? fallback).toFixed(2));
      if (v === _currentJerk) return;
      if (isRRF) {
        // RRF "allowable instantaneous speed change" — M566, in mm/min.
        const mmPerMin = Math.round(v * 60);
        gcode.push(`M566 X${mmPerMin} Y${mmPerMin} ; Jerk (RRF instantaneous speed change)`);
      } else if (isKlipper) {
        // Klipper has no classical jerk; it uses square corner velocity.
        gcode.push(`SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=${v} ; Jerk (Klipper SCV)`);
      } else {
        gcode.push(`M205 X${v} Y${v} ; Jerk`);
      }
      _currentJerk = v;
    };

    // Cura-parity: flowRateCompensationFactor scales all extrusion by a global
    // multiplier (default 1.0). Values > 1 over-extrude; < 1 under-extrude.
    const flowCompFactor = pp.flowRateCompensationFactor ?? 1.0;

    // Helper: calculate extrusion length for a move
    const calcExtrusion = (distance: number, lineWidth: number, layerH: number): number => {
      const filamentArea = Math.PI * (printer.filamentDiameter / 2) ** 2;
      const volumePerMm = lineWidth * layerH;
      return (volumePerMm / filamentArea) * distance * mat.flowRate * currentLayerFlow * flowCompFactor;
    };

    // Helper: convert fan percentage (0-100) to the M106 S argument.
    // scaleFanSpeedTo01: some Klipper configs expect S0.0-1.0 instead of S0-255.
    const fanSArg = (pct: number): string => fanSpeedToCommandArg(printer.scaleFanSpeedTo01, pct);
    const startEndState: StartEndMachineState = {
      get currentX(): number { return currentX; },
      set currentX(value: number) { currentX = value; },
      get currentY(): number { return currentY; },
      set currentY(value: number) { currentY = value; },
      get currentZ(): number { return currentZ; },
      set currentZ(value: number) { currentZ = value; },
      get currentE(): number { return currentE; },
      set currentE(value: number) { currentE = value; },
      get isRetracted(): boolean { return isRetracted; },
      set isRetracted(value: boolean) { isRetracted = value; },
      get extrudedSinceRetract(): number { return extrudedSinceRetract; },
      set extrudedSinceRetract(value: number) { extrudedSinceRetract = value; },
      templateUsesAbsolutePositioning: true,
      templateUsesAbsoluteExtrusion: !relativeE,
    };

    // Helper: retract
    //
    // Z-hop uses absolute positioning against a tracked currentZ. The previous
    // implementation flipped the machine into G91/G90 per retraction, which
    // broke on resumption (the un-retract's -Z move was relative to the hop
    // target, but a mid-print resume from `resurrect.g` starts in G90 with a
    // different Z). Absolute moves from a tracked Z are always correct.
    // Effective Z-hop settings — the new `zHopWhenRetracted` (Cura-parity)
    // flag lets users enable Z-hop with explicit height/speed even when the
    // material profile's `retractionZHop` is zero. We fall back to the
    // material value when the print-profile override is off.
    const hopEnabled = pp.zHopWhenRetracted ?? (mat.retractionZHop > 0);
    const hopHeight = pp.zHopWhenRetracted ? (pp.zHopHeight ?? 0.4) : mat.retractionZHop;
    const hopFeedPerMin = ((pp.zHopSpeed ?? pp.travelSpeed) * 60);
    // Extra prime after retract (Cura: retraction_extra_prime_amount).
    // Interpreted as mm of filament added on the unretract leg.
    const extraPrime = pp.retractionExtraPrimeAmount ?? 0;

    // Cura-parity: wipe-on-retract. Before the retract G-code, move the
    // nozzle a short distance along the last extrusion direction (or
    // arbitrary if no direction is tracked) to smear any oozed filament
    // against the print rather than leaving a blob. `wipeRetractionDistance`
    // controls the wipe length; `wipeRetractionExtraPrime` adds a small
    // priming amount on the un-retract to compensate for the wiped material.
    const wipeDist = pp.wipeRetractionDistance ?? 0;
    const wipeExtraPrime = pp.wipeRetractionExtraPrime ?? 0;

    const doRetract = (): void => {
      if (!isRetracted && mat.retractionDistance > 0) {
        // Wipe pass — small G0 along the last extrusion direction. Skipped
        // if no extrusion has happened yet on this print (no direction) or
        // the wipe distance is zero.
        if (wipeDist > 0) {
          const dirLen = Math.sqrt(lastExtrudeDx * lastExtrudeDx + lastExtrudeDy * lastExtrudeDy);
          if (dirLen > 1e-6) {
            const ux = lastExtrudeDx / dirLen;
            const uy = lastExtrudeDy / dirLen;
            const wx = currentX + ux * wipeDist;
            const wy = currentY + uy * wipeDist;
            gcode.push(`G0 X${wx.toFixed(3)} Y${wy.toFixed(3)} F${(pp.travelSpeed * 60).toFixed(0)} ; Wipe`);
            currentX = wx;
            currentY = wy;
          }
        }
        if (printer.firmwareRetraction) {
          gcode.push('G10 ; Firmware retract');
        } else {
          const retractF = ((mat.retractionRetractSpeed ?? mat.retractionSpeed) * 60).toFixed(0);
          if (relativeE) {
            gcode.push(`G1 E${(-mat.retractionDistance).toFixed(5)} F${retractF}`);
          } else {
            currentE -= mat.retractionDistance;
            gcode.push(`G1 E${currentE.toFixed(5)} F${retractF}`);
          }
        }
        if (hopEnabled && hopHeight > 0) {
          const hopZ = currentZ + hopHeight;
          gcode.push(`G1 Z${hopZ.toFixed(3)} F${hopFeedPerMin.toFixed(0)}`);
          currentZ = hopZ;
        }
        isRetracted = true;
        extrudedSinceRetract = 0;
      }
    };

    // Helper: unretract
    const doUnretract = (): void => {
      if (isRetracted && mat.retractionDistance > 0) {
        if (hopEnabled && hopHeight > 0) {
          const baseZ = currentZ - hopHeight;
          gcode.push(`G1 Z${baseZ.toFixed(3)} F${hopFeedPerMin.toFixed(0)}`);
          currentZ = baseZ;
        }
        if (printer.firmwareRetraction) {
          gcode.push('G11 ; Firmware unretract');
        } else {
          // Include wipeExtraPrime to compensate for material lost during wipe.
          const primeDelta = mat.retractionDistance + extraPrime + (wipeDist > 0 ? wipeExtraPrime : 0);
          const primeF = ((mat.retractionPrimeSpeed ?? mat.retractionSpeed) * 60).toFixed(0);
          if (relativeE) {
            gcode.push(`G1 E${primeDelta.toFixed(5)} F${primeF}`);
          } else {
            currentE += primeDelta;
            gcode.push(`G1 E${currentE.toFixed(5)} F${primeF}`);
          }
        }
        isRetracted = false;
      }
    };

    // Helper: travel move (with retraction)
    // Cura-parity (several knobs interact here):
    //   maxCombDistanceNoRetract   — short-travel threshold; below this we
    //                                skip retract/unretract & Z-hop
    //   retractionMinTravel (mat)  — older knob with the same intent
    //   avoidPrintedParts / avoidSupports — when true we force a retract
    //                                on EVERY travel; this approximates
    //                                the safest possible combing (always
    //                                lift & retract to avoid scraping
    //                                printed regions or support surfaces).
    //                                Real avoid-parts would reroute the
    //                                travel path, which needs a layer-
    //                                topology planner we don't have.
    //   travelAvoidDistance         — padding that TIGHTENS the comb
    //                                threshold (reduces short-travel skips
    //                                near printed edges). We apply it by
    //                                subtracting from the effective comb
    //                                distance.
    const travelTo = (x: number, y: number): void => {
      const dx = x - currentX;
      const dy = y - currentY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (this.shouldRetractOnTravel(dist, extrudedSinceRetract, pp)) doRetract();
      // Cura-parity: travelAccelerationEnabled / travelJerkEnabled gate whether
      // M204/M205 are emitted for travel segments (separate from print segments).
      if (pp.travelAccelerationEnabled ?? pp.accelerationEnabled) {
        setAccel(pp.accelerationTravel, pp.accelerationPrint);
      }
      if (pp.travelJerkEnabled ?? pp.jerkEnabled) {
        setJerk(pp.jerkTravel, pp.jerkPrint);
      }
      gcode.push(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F${(currentLayerTravelSpeed * 60).toFixed(0)}`);
      currentX = x;
      currentY = y;
    };

    // Volumetric flow rate cap (Cura: max_feedrate_z_override). When set,
    // limits any extrusion move speed so the flow rate does not exceed
    // maxFlowRate mm³/s: speedCap = maxFlowRate / (lineWidth * layerH).
    const maxFlowRate = pp.maxFlowRate ?? 0;

    // Helper: extrusion move
    const extrudeTo = (
      x: number,
      y: number,
      speed: number,
      lineWidth: number,
      layerH: number,
    ): number => {
      doUnretract();
      const dx = x - currentX;
      const dy = y - currentY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const e = calcExtrusion(dist, lineWidth, layerH);
      currentE += e;
      totalExtruded += e;
      extrudedSinceRetract += e;
      let clampedSpeed = speed;
      if (maxFlowRate > 0 && lineWidth > 0 && layerH > 0) {
        const flowSpeedCap = maxFlowRate / (lineWidth * layerH);
        if (clampedSpeed > flowSpeedCap) clampedSpeed = flowSpeedCap;
      }
      gcode.push(
        `G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${relativeE ? e.toFixed(5) : currentE.toFixed(5)} F${(clampedSpeed * 60).toFixed(0)}`,
      );
      // Record direction so the next retract can wipe along this vector.
      if (dist > 1e-6) {
        lastExtrudeDx = dx;
        lastExtrudeDy = dy;
      }
      currentX = x;
      currentY = y;
      const time = dist / clampedSpeed;
      return time;
    };

    appendHeaderPlaceholders(gcode, printer, mat, pp);

    appendStartGCode({
      gcode,
      printer,
      material: mat,
      print: pp,
      relativeExtrusion: relativeE,
      flavor,
      startEndState,
    });
    // Preheat sequence (Cura-parity):
    //   If initialPrintingTemperature is set, heat to that lower temp first
    //   (non-blocking) while the bed heats — avoids ooze during bed warmup.
    //   Then after bed reaches target, ramp nozzle to full first-layer temp.
    //   Without initialPrintingTemperature the sequence is unchanged.
      // waitForBuildPlate defaults true — use M190 (blocking). Setting false
      // uses M140 (non-blocking) and the user's start G-code handles the wait.
    // waitForNozzle defaults true — use M109 (blocking). Setting false uses M104.
      // "Linear advance" (Marlin) / "pressure advance" (RRF & Klipper) —
      // same concept, different command per firmware.
    // Per-axis machine limits (Cura: machine_max_feedrate_*/machine_max_acceleration_*).
    // Only emit when the user has explicitly set a value — leave firmware defaults otherwise.
    // Cura-parity: primeBlobEnable deposits a blob of material at the print
    // origin before the print starts, priming the nozzle and wiping ooze.
    // We approximate as an extrude-in-place move of primeBlobSize mm³.

    const layerControlFlags = {
      regularFanHeightFired: false,
      buildVolumeFanHeightFired: false,
    };

    // Track the previous layer's material footprint as a MultiPolygon so we
    // can detect BRIDGE regions: any material in the current layer that has
    // nothing supporting it below (current − previous). Extrusion paths whose
    // midpoints fall inside the bridge region get labelled 'bridge' with
    // `bridgeSkinSpeed` / `bridgeSkinFlow` and `bridgeFanSpeed` overrides.
    let prevLayerMaterial: PCMultiPolygon = [];
    // Bridge fan state — emit M106 S{bridgeFanSpeed} before bridge moves,
    // restore to the regular cooling target after. Tracking avoids redundant
    // fan commands in dense multi-region layers.
    let bridgeFanActive = false;

    // ----- Process each layer -----
    for (let li = 0; li < totalLayers; li++) {
      if (this.cancelled) {
        throw new Error('Slicing cancelled by user.');
      }
      const layerZ = layerZs[li];
      // Update per-layer travel speed (initialLayerTravelSpeed applies to layer 0 only).
      currentLayerTravelSpeed = (li === 0 && (pp.initialLayerTravelSpeed ?? 0) > 0)
        ? pp.initialLayerTravelSpeed!
        : pp.travelSpeed;
      // The slicing plane is in model space at layerZ relative to model bottom
      const sliceZ = modelBBox.min.z + layerZ;
      const isFirstLayer = li === 0;
      // Derive the ACTUAL height of this layer from the layerZs array rather
      // than using the nominal `pp.layerHeight`. Adaptive-layer mode produces
      // variable spacing; using the nominal here would miscalculate extrusion
      // volume on every non-nominal layer. For the fixed-height path this is
      // equivalent to the old formula since layerZs[i] - layerZs[i-1] ==
      // pp.layerHeight * zScale for every i > 0.
      const layerH = li === 0
        ? layerZs[0]
        : layerZs[li] - layerZs[li - 1];
      // initialLayerFlow: override global flow% on first layer only (Cura-parity).
      currentLayerFlow = (isFirstLayer && (pp.initialLayerFlow ?? 0) > 0)
        ? (pp.initialLayerFlow! / 100)
        : 1.0;

      this.reportProgress('slicing', (li / totalLayers) * 80, li, totalLayers, `Slicing layer ${li + 1}/${totalLayers}...`);

      await this.yieldToUI();

      // ----- 4a. Compute contours via triangle-plane intersection -----
      const segments = this.sliceTrianglesAtZ(triangles, sliceZ, offsetX, offsetY, offsetZ);
      const rawContours = this.connectSegments(segments);
      if (rawContours.length === 0) continue;

      // Process contours: compute areas, classify inner/outer
      let allContours = this.classifyContours(rawContours);

      // Cura/Orca-parity: closing_radius (offset2_ex(+r, -r)) seals sub-
      // millimetre gaps left by imperfect STLs (sculpting tools, CSG exports)
      // BEFORE we filter / generate walls. Without this pass, a mesh with
      // near-coincident but non-welded edges produces near-coincident open
      // polylines that drop out of connectSegments → lost geometry. With it,
      // growing every boundary by r merges anything within 2r of another
      // boundary, then shrinking by r snaps it back to the original size —
      // minus the gaps. `slicingClosingRadius` is a print-profile setting
      // (default 0.049 ≈ one nozzle-diameter step, same default as Orca).
      const closingR = this.printProfile.slicingClosingRadius ?? 0;
      if (closingR > 0 && allContours.length > 0) {
        allContours = this.closeContourGaps(allContours, closingR);
      }
      // Cura-parity: minimumPolygonCircumference drops contours whose perimeter
      // is below the threshold — typically stray loop artifacts from messy meshes.
      const minCirc = pp.minimumPolygonCircumference ?? 0;
      // smallHoleMaxSize: skip inner (hole) contours whose effective diameter is
      // below this value — prevents printing tiny holes that won't be accurate anyway.
      const smallHoleThresh = pp.smallHoleMaxSize ?? 0;
      const contours = allContours.filter((c) => {
        if (minCirc > 0) {
          let perim = 0;
          for (let i = 0; i < c.points.length; i++) {
            perim += c.points[i].distanceTo(c.points[(i + 1) % c.points.length]);
          }
          if (perim < minCirc) return false;
        }
        if (smallHoleThresh > 0 && !c.isOuter) {
          // Approximate diameter from area: d ≈ 2*sqrt(|area|/π)
          const approxDiam = 2 * Math.sqrt(Math.abs(c.area) / Math.PI);
          if (approxDiam < smallHoleThresh) return false;
        }
        return true;
      });

      // Cura-parity: shrinkage compensation scales all XY contour points
      // outward from the model center to pre-compensate for material shrinkage.
      // Scale = 1 + compensationPct/100 (e.g., 0.2% → multiply by 1.002).
      if ((mat.shrinkageCompensationXY ?? 0) !== 0) {
        const scale = 1 + (mat.shrinkageCompensationXY ?? 0) / 100;
        for (const contour of contours) {
          for (const pt of contour.points) {
            pt.x = bedCenterX + (pt.x - bedCenterX) * scale;
            pt.y = bedCenterY + (pt.y - bedCenterY) * scale;
          }
        }
      }

      // Cura-parity: `holeHorizontalExpansion` offsets inner (hole) contours
      // outward (positive = tighten hole, negative = widen) to compensate for
      // elephant-foot or drill-over-extrusion. `holeHorizontalExpansionMaxDiameter`
      // caps which holes are affected — holes larger than the diameter threshold
      // are left untouched (useful when only small precision holes need correction).
      const hhe = pp.holeHorizontalExpansion ?? 0;
      if (hhe !== 0) {
        const maxD = pp.holeHorizontalExpansionMaxDiameter ?? Infinity;
        for (const c of contours) {
          if (c.isOuter) continue;
          if (maxD < Infinity) {
            const approxDiam = 2 * Math.sqrt(Math.abs(c.area) / Math.PI);
            if (approxDiam > maxD) continue;
          }
          // Holes are normalized to CW winding, so positive offset expands the
          // cavity outward and negative offset tightens it.
          const expanded = this.offsetContour(c.points, hhe);
          if (expanded.length >= 3) c.points = expanded;
        }
      }

      // Determine if this is a solid layer (top or bottom).
      // Cura-parity note: `noSkinInZGaps` is effectively always honored by
      // our implementation — skin detection keys off absolute layer index
      // (li vs solidBottom/solidTop) rather than tracking per-island solid
      // regions across layers. Internal cavities therefore don't produce
      // skin in Z-gaps because we never see them as "solid top of a lower
      // feature". The flag becomes a no-op here but round-trips through
      // profile save/load.
      const isSolidBottom = li < Math.max(solidBottom, pp.initialBottomLayers ?? 0);
      const isSolidTop = li >= totalLayers - solidTop;
      const isSolid = isSolidBottom || isSolidTop;

      // Determine speeds
      // Outer wall speed. Cura-parity: `overhangingWallSpeed` (% of wallSpeed)
      // applies on layers that contain overhangs steeper than
      // `overhangingWallAngle`. Detecting per-segment overhang requires
      // cross-layer analysis; we approximate layer-wide: if this layer has
      // any triangle whose face-down angle exceeds the threshold, slow the
      // whole layer's outer walls. Coarser than Cura's per-path detection
      // but honors the user's intent when they enable it.
      // numberOfSlowerLayers: linearly ramp from firstLayerSpeed to full speed
      // over the first N layers. Layer 0 is always firstLayerSpeed; layer N
      // and above use the full per-feature speed.
      const slowerLayers = pp.numberOfSlowerLayers ?? 0;
      const ramp = (base: number): number => {
        if (isFirstLayer) return pp.firstLayerSpeed;
        if (slowerLayers > 0 && li < slowerLayers) {
          return pp.firstLayerSpeed + (base - pp.firstLayerSpeed) * (li / slowerLayers);
        }
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
          // Triangle overlaps this layer?
          const tMinZ = Math.min(tri.v0.z, tri.v1.z, tri.v2.z);
          const tMaxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
          if (sliceZ < tMinZ || sliceZ > tMaxZ + pp.layerHeight) continue;
          if (a > thr) { hasOverhang = true; break; }
        }
        if (hasOverhang) {
          outerWallSpeed = outerWallSpeed * ((pp.overhangingWallSpeed ?? 100) / 100);
        }
      }
      const innerWallSpeed = ramp(pp.wallSpeed);
      const infillSpeed = ramp(pp.infillSpeed);
      // bottomSpeed applies to bottom solid layers; top layers use topSpeed.
      const topBottomSpeed = isFirstLayer ? pp.firstLayerSpeed
        : isSolidBottom ? ramp(pp.bottomSpeed ?? pp.topSpeed)
        : ramp(pp.topSpeed);

      const moves: SliceMove[] = [];

      // ----- Layer header -----
      // initialLayerZOverlap: push first layer slightly into the bed for better
      // adhesion (negative Z offset on layer 0 only).
      const zOverlap = isFirstLayer ? (pp.initialLayerZOverlap ?? 0) : 0;
      const printZ = layerZ - zOverlap;
      gcode.push('');
      gcode.push(`; ----- Layer ${li}, Z=${printZ.toFixed(3)} -----`);
      gcode.push(`G1 Z${printZ.toFixed(3)} F${(pp.travelSpeed * 60).toFixed(0)}`);
      currentZ = printZ;
      // Cura-parity: layerStartX/Y moves the nozzle to a fixed position at the
      // start of every layer. Useful for parking the head at a seam-free corner
      // or a specific wipe/prime location before the first extrusion move.
      if ((pp.layerStartX != null || pp.layerStartY != null) && !isFirstLayer) {
        travelTo(pp.layerStartX ?? currentX, pp.layerStartY ?? currentY);
      }

      applyLayerStartControls({
        gcode,
        layerIndex: li,
        totalLayers,
        layerZ,
        previousLayerTime: sliceLayers.length > 0 ? sliceLayers[sliceLayers.length - 1].layerTime : Infinity,
        printer,
        material: mat,
        print: pp,
        flags: layerControlFlags,
      });


      // ----- Small layer temperature -----
      // Cura-parity: reduce nozzle temp on very short layers to avoid heat
      // buildup that would string or blob. We check the PREVIOUS layer's time
      // against pp.minLayerTime — if it was shorter than the minimum, the layer
      // was too fast and may need a cooler nozzle. We restore normal temp once
      // a layer comes in at full speed.

      // ----- Temperature changes -----
      // Switch from first-layer temps to normal temps only once, after layer 0
      // has completed. Using `li === 1` means the command is emitted as part
      // of layer-1 setup — fine — but guard against re-emitting if someone
      // later changes the comparison. Using non-blocking M104/M140 so the
      // nozzle keeps printing while the new setpoint is approached.

      // ----- Fan control -----
      // Cura-parity knobs (Phase A3):
      //   initialFanSpeed        — fan value on layer 0 (before the material's
      //                             fanDisableFirstLayers window ends)
      //   maximumFanSpeed        — caps the ramp for any layer
      //   regularMaxFanThreshold — if the previous layer printed faster than
      //                             this many seconds, we pick the maximum
      //                             fan speed instead of the ramped value
      //                             (Cura's "fast-layer" shortcut)
      //   buildVolumeFanSpeed    — auxiliary chamber fan, emitted once at
      //                             print start below (not per-layer)
        // Cura-parity: regularFanSpeedAtHeight switches the fan to regular
        // (mat.fanSpeedMin) once the nozzle passes the specified Z height.
        // Fired once — avoids re-emitting M106 on every layer above.
        // Cura-parity: buildVolumeFanSpeedAtHeight — switch the build-volume
        // fan (P2) to the regular build-volume speed once Z passes the threshold.

      // ----- Adhesion (first layer only) -----
      if (li === 0) {
        setAccel(pp.accelerationSkirtBrim ?? pp.accelerationInitialLayer, pp.accelerationPrint);
        setJerk(pp.jerkSkirtBrim ?? pp.jerkInitialLayer, pp.jerkPrint);
        if (pp.adhesionType === 'raft') {
          setAccel(pp.raftPrintAcceleration ?? pp.accelerationSkirtBrim ?? pp.accelerationInitialLayer, pp.accelerationPrint);
          setJerk(pp.raftPrintJerk ?? pp.jerkSkirtBrim ?? pp.jerkInitialLayer, pp.jerkPrint);
          if ((pp.raftFanSpeed ?? 0) > 0)
            gcode.push(`M106 S${fanSArg(pp.raftFanSpeed!)} ; Raft fan`);
        }
        const adhesionMoves = this.generateAdhesion(contours, pp, layerH, offsetX, offsetY);
        let layerTimeAdhesion = 0;
        for (const am of adhesionMoves) {
          // Travel to start
          travelTo(am.from.x, am.from.y);
          layerTimeAdhesion += extrudeTo(am.to.x, am.to.y, am.speed, am.lineWidth, am.layerHeight ?? layerH);
          moves.push(am);
        }
        totalTime += layerTimeAdhesion;
      }

      // ----- Draft shield -----
      // Emit a single-wall perimeter around the entire model bounding box on
      // every layer (or up to draftShieldHeight when limitation = 'limited').
      if (pp.draftShieldEnabled) {
        const shieldActive = (() => {
          if (pp.draftShieldLimitation !== 'limited') return true;
          return layerZ <= (pp.draftShieldHeight ?? Infinity);
        })();
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
          const sx0 = dsMinX - sd - slw / 2;
          const sx1 = dsMaxX + sd + slw / 2;
          const sy0 = dsMinY - sd - slw / 2;
          const sy1 = dsMaxY + sd + slw / 2;
          const shieldPts = [
            { x: sx0, y: sy0 }, { x: sx1, y: sy0 },
            { x: sx1, y: sy1 }, { x: sx0, y: sy1 }, { x: sx0, y: sy0 },
          ];
          const shieldSpeed = pp.skirtBrimSpeed ?? pp.travelSpeed;
          travelTo(shieldPts[0].x, shieldPts[0].y);
          gcode.push('; Draft shield');
          for (let si = 1; si < shieldPts.length; si++) {
            extrudeTo(shieldPts[si].x, shieldPts[si].y, shieldSpeed, slw, layerH);
          }
        }
      }

      let layerTime = 0;

      // Cura-parity: `optimizeWallOrder` — sort outer contours by centroid
      // distance from the current nozzle position (greedy nearest-neighbour)
      // to minimise travel between features on multi-body / multi-island layers.
      // Cura-parity: `optimizeWallOrder` — greedy nearest-neighbour tour of
      // outer contours to minimise travel on multi-island layers. Holes are
      // kept at the end (they are implicitly handled as part of their parent
      // outer contour's infill offset, not visited as top-level contours).
      const workContours = (pp.optimizeWallOrder ?? false)
        ? (() => {
            const outers = contours.filter((c) => c.isOuter);
            const holes  = contours.filter((c) => !c.isOuter);
            const centroids = outers.map((c) => ({
              cx: c.points.reduce((s, p) => s + p.x, 0) / c.points.length,
              cy: c.points.reduce((s, p) => s + p.y, 0) / c.points.length,
            }));
            const visited = new Uint8Array(outers.length);
            const ordered: Contour[] = [];
            let refX = currentX, refY = currentY;
            for (let i = 0; i < outers.length; i++) {
              let best = -1, bestD = Infinity;
              for (let j = 0; j < outers.length; j++) {
                if (visited[j]) continue;
                const d = Math.hypot(centroids[j].cx - refX, centroids[j].cy - refY);
                if (d < bestD) { bestD = d; best = j; }
              }
              visited[best] = 1;
              ordered.push(outers[best]);
              refX = centroids[best].cx;
              refY = centroids[best].cy;
            }
            return [...ordered, ...holes];
          })()
        : contours;

      // Cura-parity: `groupOuterWalls`. When enabled, emit the outer wall
      // of EVERY contour before any inner walls or infill. This makes all
      // outer-surface passes happen in one group per layer, reducing the
      // number of transitions between inner/outer features (useful for
      // fast printers with pressure-advance or to improve surface quality
      // on multi-contour layers). We pre-compute the wall sets once and
      // dispatch the emission into two phases keyed by this flag.
      const groupOW = pp.groupOuterWalls ?? false;
      const perContour: Array<{
        contour: Contour;
        wallSets: THREE.Vector2[][];
        wallLineWidths: number[];
      }> = [];
      // Precompute hole→parent-outer mapping once per layer so both the
      // groupOW pre-pass and the main loop can feed generatePerimetersEx
      // the correct set of contained holes.
      const holesByOuterIdx = new Map<Contour, THREE.Vector2[][]>();
      for (const c of workContours) {
        if (!c.isOuter) continue;
        const hs: THREE.Vector2[][] = [];
        for (const hc of contours) {
          if (hc.isOuter) continue;
          if (hc.points.length < 3) continue;
          if (this.pointInContour(hc.points[0], c.points)) hs.push(hc.points);
        }
        holesByOuterIdx.set(c, hs);
      }

      // Build the current layer's material footprint as a MultiPolygon: every
      // outer contour becomes a polygon whose first ring is the outer and
      // subsequent rings are its contained holes. Used to detect bridges
      // (current material NOT covered by previous) and stashed into
      // `prevLayerMaterial` at the end of this iteration for the next one.
      const currentLayerMaterial: PCMultiPolygon = [];
      for (const c of workContours) {
        if (!c.isOuter || c.points.length < 3) continue;
        const poly: THREE.Vector2[][] = [c.points];
        const contHoles = holesByOuterIdx.get(c) ?? [];
        for (const h of contHoles) poly.push(h);
        const pcPoly = poly.map((ring): PCRing => {
          const r: PCRing = ring.map((p) => [p.x, p.y] as [number, number]);
          if (r.length > 0) {
            const f = r[0]; const l = r[r.length - 1];
            if (f[0] !== l[0] || f[1] !== l[1]) r.push([f[0], f[1]]);
          }
          return r;
        });
        currentLayerMaterial.push(pcPoly);
      }

      // Bridge region = areas of this layer's material with NOTHING directly
      // below (current minus previous). For the first layer it's the entire
      // layer's footprint because nothing supports the first layer — we
      // suppress bridge detection there via the isFirstLayer guard.
      let bridgeMP: PCMultiPolygon = [];
      if (!isFirstLayer && currentLayerMaterial.length > 0 && prevLayerMaterial.length > 0) {
        try {
          bridgeMP = polygonClipping.difference(currentLayerMaterial, prevLayerMaterial);
        } catch { bridgeMP = []; }
      }

      // Fast point-in-bridge-region test for per-move classification. Walks
      // every polygon + every ring in the bridge MultiPolygon. Quick-rejects
      // via bounding-box. Used by the skin-emission loop below.
      const bridgeBBoxes: Array<{ minX: number; maxX: number; minY: number; maxY: number; poly: PCMultiPolygon[number] }> = [];
      for (const poly of bridgeMP) {
        let miX = Infinity, maX = -Infinity, miY = Infinity, maY = -Infinity;
        for (const ring of poly) for (const p of ring) {
          if (p[0] < miX) miX = p[0]; if (p[0] > maX) maX = p[0];
          if (p[1] < miY) miY = p[1]; if (p[1] > maY) maY = p[1];
        }
        bridgeBBoxes.push({ minX: miX, maxX: maX, minY: miY, maxY: maY, poly });
      }
      const isInBridgeRegion = (x: number, y: number): boolean => {
        for (const b of bridgeBBoxes) {
          if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
          // First ring = outer (CCW), subsequent rings = holes (CW). Point is
          // inside the polygon if inside the outer AND outside every hole.
          const outer = b.poly[0];
          if (!this.pointInRing(x, y, outer)) continue;
          let inHole = false;
          for (let i = 1; i < b.poly.length; i++) {
            if (this.pointInRing(x, y, b.poly[i])) { inHole = true; break; }
          }
          if (!inHole) return true;
        }
        return false;
      };

      if (groupOW) {
        for (const contour of workContours) {
          if (!contour.isOuter) continue;
          const containedHoles = holesByOuterIdx.get(contour) ?? [];
          const perimeters = this.filterPerimetersByMinOdd(
            this.generatePerimetersEx(
              contour.points,
              containedHoles,
              pp.wallCount,
              pp.wallLineWidth,
              pp.outerWallInset ?? 0,
            ),
            pp.minOddWallLineWidth ?? 0,
          );
          perContour.push({
            contour,
            wallSets: perimeters.walls,
            wallLineWidths: perimeters.lineWidths,
          });
        }
        // Pass 1: emit all outer walls across all contours using the same
        // seam/scarf/fluid-motion logic as the inline path. We reuse the
        // helper below and emit only outer walls here.
        for (const { wallSets, wallLineWidths } of perContour) {
          if (wallSets.length === 0) continue;
          const outerWall = wallSets[0];
          if (outerWall.length < 2) continue;
          const outerWallLineWidth = wallLineWidths[0] ?? pp.wallLineWidth;
          const seamIdx = this.findSeamPosition(outerWall, pp, li, currentX, currentY);
          let reordered = this.reorderFromIndex(outerWall, seamIdx);
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
              const ab = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
              const turn = Math.PI - ab;
              if (turn > fmAngle) {
                const off = Math.min(d1, d2) * 0.25;
                smoothed.push(new THREE.Vector2(curr.x + v1.x * off, curr.y + v1.y * off));
                smoothed.push(curr);
                smoothed.push(new THREE.Vector2(curr.x + v2.x * off, curr.y + v2.y * off));
              } else {
                smoothed.push(curr);
              }
            }
            reordered = smoothed;
          }
          if ((pp.alternateWallDirections ?? false) && li % 2 === 1) {
            reordered = [reordered[0], ...reordered.slice(1).reverse()];
          }
          reordered = this.simplifyClosedContour(reordered, Math.max(0.015, outerWallLineWidth * 0.05));
          setAccel(isFirstLayer ? pp.accelerationInitialLayer : (pp.accelerationOuterWall ?? pp.accelerationWall), pp.accelerationPrint);
          setJerk(isFirstLayer ? pp.jerkInitialLayer : (pp.jerkOuterWall ?? pp.jerkWall), pp.jerkPrint);
          travelTo(reordered[0].x, reordered[0].y);
          gcode.push(`; Outer wall (grouped)`);
          const scarfLen = pp.scarfSeamLength ?? 0;
          const scarfActive = scarfLen > 0
            && (pp.scarfSeamStartHeight === undefined || layerZ >= pp.scarfSeamStartHeight);
          const scarfStepLen = pp.scarfSeamStepLength ?? 0;
          let scarfRemaining = scarfActive ? scarfLen : 0;
          for (let pi = 1; pi < reordered.length; pi++) {
            const from = reordered[pi - 1];
            const to = reordered[pi];
            let segLW = outerWallLineWidth;
            let segSpeed = outerWallSpeed;
            if (scarfRemaining > 0) {
              const done = scarfLen - scarfRemaining;
              const tRaw = done / scarfLen;
              const t = Math.min(1, scarfStepLen > 0 ? Math.floor(done / scarfStepLen) * scarfStepLen / scarfLen : tRaw);
              segLW = outerWallLineWidth * t;
              const speedRatio = pp.scarfSeamStartSpeedRatio ?? 1.0;
              segSpeed = outerWallSpeed * (speedRatio + (1.0 - speedRatio) * t);
              scarfRemaining = Math.max(0, scarfRemaining - from.distanceTo(to));
            }
            layerTime += extrudeTo(to.x, to.y, segSpeed, segLW, layerH);
            moves.push({
              type: 'wall-outer',
              from: { x: from.x, y: from.y },
              to: { x: to.x, y: to.y },
              speed: segSpeed,
              extrusion: calcExtrusion(from.distanceTo(to), segLW, layerH),
              lineWidth: segLW,
            });
          }
          // Close loop (simple; coasting handled only in main path)
          if (reordered.length > 2) {
            const lastPt = reordered[reordered.length - 1];
            const firstPt = reordered[0];
            layerTime += extrudeTo(firstPt.x, firstPt.y, outerWallSpeed, outerWallLineWidth, layerH);
            moves.push({
              type: 'wall-outer',
              from: { x: lastPt.x, y: lastPt.y },
              to: { x: firstPt.x, y: firstPt.y },
              speed: outerWallSpeed,
              extrusion: calcExtrusion(lastPt.distanceTo(firstPt), outerWallLineWidth, layerH),
              lineWidth: outerWallLineWidth,
            });
          }
        }
      }

      // ----- For each contour, generate walls, then infill -----
      for (const contour of workContours) {
        if (!contour.isOuter) continue; // process outer contours only; inner holes handled during offset

        // Generate perimeters (walls). Hole-aware: generatePerimetersEx
        // computes wall loops for both the outer contour AND every contained
        // hole simultaneously, using polygon-clipping's difference to clip
        // against collisions in thin-wall regions. The emission order keeps
        // outer loops first (so wallSets[0] is still the outermost outer
        // wall, preserving seam/flow/fluidMotion logic) and appends hole
        // loops after. `outerCount` marks the boundary — wallSets[outerCount-1]
        // is the innermost OUTER wall, which is the infill boundary.
        const containedHoles = holesByOuterIdx.get(contour) ?? [];
        const exWalls = this.filterPerimetersByMinOdd(
          this.generatePerimetersEx(
            contour.points,
            containedHoles,
            pp.wallCount,
            pp.wallLineWidth,
            pp.outerWallInset ?? 0,
          ),
          pp.minOddWallLineWidth ?? 0,
        );
        const wallSets = exWalls.walls;
        const wallLineWidths = exWalls.lineWidths;
        const outerWallCount = exWalls.outerCount;
        // Innermost hole boundaries from the wall pass. Fed to scan-line infill
        // so pairings treat cavities as obstacles and material never extrudes
        // across a hole.
        const infillHoles = exWalls.innermostHoles;

        // Outer wall — skipped here when `groupOuterWalls` already emitted
        // them in the layer-wide pre-pass above.
        if (!groupOW && wallSets.length > 0 && pp.outerWallFirst) {
          // initialLayerOuterWallFlow: override flow on the first layer only.
          if (isFirstLayer && pp.initialLayerOuterWallFlow != null) {
            currentLayerFlow = pp.initialLayerOuterWallFlow / 100;
          }
          const outerWall = wallSets[0];
          if (outerWall.length >= 2) {
            const outerWallLineWidth = wallLineWidths[0] ?? pp.wallLineWidth;
            // Find seam position. The Cura-parity `zSeamPosition` field
            // takes precedence over our legacy `zSeamAlignment` when set
            // and unlocks 'user_specified' (X/Y) + 'back' which pp.zSeamX/Y
            // can feed. The resolveSeamMode helper below maps between the
            // two unions. `currentX/Y` feeds the 'shortest' mode so we pick
            // the point closest to wherever the nozzle just was.
            const seamIdx = this.findSeamPosition(outerWall, pp, li, currentX, currentY);
            let reordered = this.reorderFromIndex(outerWall, seamIdx);
            // Cura-parity: `fluidMotionEnable` smooths outer-wall paths by
            // inserting a midpoint at every corner sharper than
            // fluidMotionAngle. This chamfers tight turns so the
            // acceleration profile doesn't stall the nozzle. We skip
            // corners where the legs are shorter than fluidMotionSmallDistance
            // to avoid explosive point counts on fine detail.
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
                const angleBetween = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
                const turn = Math.PI - angleBetween; // 0 = straight, π = 180° turn
                if (turn > fmAngle) {
                  // Insert two midpoints chamfering the corner.
                  const off = Math.min(d1, d2) * 0.25;
                  smoothed.push(new THREE.Vector2(curr.x - v1.x * -off, curr.y - v1.y * -off));
                  smoothed.push(curr);
                  smoothed.push(new THREE.Vector2(curr.x - v2.x * -off, curr.y - v2.y * -off));
                } else {
                  smoothed.push(curr);
                }
              }
              reordered = smoothed;
            }
            // Cura-parity: alternateWallDirections reverses the traversal
            // direction on every other layer. This helps balance any
            // layer-adhesion asymmetry introduced by always sweeping one way
            // around the part (extrusion pressure, seam shadowing, etc.).
            if ((pp.alternateWallDirections ?? false) && li % 2 === 1) {
              reordered = [reordered[0], ...reordered.slice(1).reverse()];
            }
            reordered = this.simplifyClosedContour(reordered, Math.max(0.015, outerWallLineWidth * 0.05));

            setAccel(isFirstLayer ? pp.accelerationInitialLayer : (pp.accelerationOuterWall ?? pp.accelerationWall), pp.accelerationPrint);
            setJerk(isFirstLayer ? pp.jerkInitialLayer : (pp.jerkOuterWall ?? pp.jerkWall), pp.jerkPrint);
            travelTo(reordered[0].x, reordered[0].y);
            gcode.push(`; Outer wall`);
            // Cura-parity: scarf seam. When enabled AND this layer's Z is
            // above `scarfSeamStartHeight`, the first `scarfSeamLength` mm
            // of the outer wall emit with a ramped extrusion width. Cura
            // does this over multiple layers via Z-stagger; our single-
            // layer approximation tapers flow (effective line width) from
            // 0 up to 100% across scarf length. Visually still hides the
            // seam as a gradual onset.
            const scarfLen = pp.scarfSeamLength ?? 0;
            const scarfActive = scarfLen > 0
              && (pp.scarfSeamStartHeight === undefined || layerZ >= pp.scarfSeamStartHeight);
            const scarfStepLen2 = pp.scarfSeamStepLength ?? 0;
            let scarfRemaining = scarfActive ? scarfLen : 0;
            for (let pi = 1; pi < reordered.length; pi++) {
              const from = reordered[pi - 1];
              const to = reordered[pi];
              let segLW = outerWallLineWidth;
              let segSpeed = outerWallSpeed;
              if (scarfRemaining > 0) {
                // Ramp: completed distance into scarf / total scarf length.
                // scarfSeamStepLength quantises the ramp into discrete steps
                // of that length instead of a smooth continuous taper.
                const done = scarfLen - scarfRemaining;
                const tRaw = done / scarfLen;
                const t = Math.min(1, scarfStepLen2 > 0 ? Math.floor(done / scarfStepLen2) * scarfStepLen2 / scarfLen : tRaw);
                segLW = outerWallLineWidth * t;
                // scarfSeamStartSpeedRatio: ramp speed from ratio→1.0 over scarf length
                const speedRatio = pp.scarfSeamStartSpeedRatio ?? 1.0;
                segSpeed = outerWallSpeed * (speedRatio + (1.0 - speedRatio) * t);
                scarfRemaining = Math.max(0, scarfRemaining - from.distanceTo(to));
              }
              layerTime += extrudeTo(to.x, to.y, segSpeed, segLW, layerH);
              moves.push({
                type: 'wall-outer',
                from: { x: from.x, y: from.y },
                to: { x: to.x, y: to.y },
                speed: segSpeed,
                extrusion: calcExtrusion(from.distanceTo(to), segLW, layerH),
                lineWidth: segLW,
              });
            }
            // Close the loop.
            //
            // Cura-parity: coasting + scarf seam interact at the wall close.
            //   • coasting   — stop extruding before reaching seam
            //                  (coastingVolume → distance; coastingSpeed → feed)
            //   • scarf seam — progressively fade extrusion along the last
            //                  `scarfSeamLength` mm of the loop so the
            //                  seam tapers instead of stepping. Real Cura
            //                  does this over multiple layers with Z-ramp;
            //                  we approximate with a flow taper on just
            //                  this layer's close segment.
            // When both are active, coasting wins for the very end and scarf
            // applies only up to the coast-start point.
            if (reordered.length > 2) {
              const lastPt = reordered[reordered.length - 1];
              const firstPt = reordered[0];
              const segLen = lastPt.distanceTo(firstPt);
              const coastVol = pp.coastingEnabled ? (pp.coastingVolume ?? 0) : 0;
              // minVolumeBeforeCoasting: disable coasting when the total loop
              // volume is below the threshold (avoids under-extrusion on tiny perimeters).
              const minCoastVol = pp.minVolumeBeforeCoasting ?? 0;
              const loopVol = minCoastVol > 0
                ? (() => {
                    let perim = segLen;
                    for (let ri = 1; ri < reordered.length - 1; ri++) {
                      perim += reordered[ri].distanceTo(reordered[ri + 1]);
                    }
                    return perim * pp.wallLineWidth * layerH;
                  })()
                : Infinity;
              const coastDist = coastVol > 0 && loopVol >= minCoastVol
                ? coastVol / (outerWallLineWidth * layerH)
                : 0;
              if (coastDist > 0 && segLen > coastDist + 1e-3) {
                // Extrude up to the coast-start point, then travel the rest.
                const t = 1 - coastDist / segLen;
                const midX = lastPt.x + (firstPt.x - lastPt.x) * t;
                const midY = lastPt.y + (firstPt.y - lastPt.y) * t;
                layerTime += extrudeTo(midX, midY, outerWallSpeed, outerWallLineWidth, layerH);
                moves.push({
                  type: 'wall-outer',
                  from: { x: lastPt.x, y: lastPt.y },
                  to: { x: midX, y: midY },
                  speed: outerWallSpeed,
                  extrusion: calcExtrusion(segLen * t, outerWallLineWidth, layerH),
                  lineWidth: outerWallLineWidth,
                });
                // Coast — unextruded travel at (optionally) reduced speed.
                const coastSpeed = outerWallSpeed * ((pp.coastingSpeed ?? 90) / 100);
                gcode.push(`G0 X${firstPt.x.toFixed(3)} Y${firstPt.y.toFixed(3)} F${(coastSpeed * 60).toFixed(0)} ; Coast`);
                currentX = firstPt.x;
                currentY = firstPt.y;
              } else {
                layerTime += extrudeTo(firstPt.x, firstPt.y, outerWallSpeed, outerWallLineWidth, layerH);
                moves.push({
                  type: 'wall-outer',
                  from: { x: lastPt.x, y: lastPt.y },
                  to: { x: firstPt.x, y: firstPt.y },
                  speed: outerWallSpeed,
                  extrusion: calcExtrusion(segLen, outerWallLineWidth, layerH),
                  lineWidth: outerWallLineWidth,
                });
              }
            }
          }
        }

        // Restore per-layer flow (may have been overridden for outer wall above).
        currentLayerFlow = (isFirstLayer && (pp.initialLayerFlow ?? 0) > 0)
          ? (pp.initialLayerFlow! / 100) : 1.0;

        // Inner walls. Cura-parity: innerWallLineWidth lets users use a
        // different extrusion width for inner loops than outer/default walls.
        // Falls back to pp.wallLineWidth when unset so existing profiles
        // behave identically.
        const innerLW = pp.innerWallLineWidth ?? pp.wallLineWidth;
        // initialLayerInnerWallFlow: override flow for inner walls on first layer.
        if (isFirstLayer && pp.initialLayerInnerWallFlow != null) {
          currentLayerFlow = pp.initialLayerInnerWallFlow / 100;
        }
        for (let wi = 1; wi < wallSets.length; wi++) {
          const innerWallLineWidth = wallLineWidths[wi] ?? innerLW;
          const innerWall = this.simplifyClosedContour(wallSets[wi], Math.max(0.015, innerWallLineWidth * 0.05));
          if (innerWall.length < 2) continue;
          setAccel(isFirstLayer ? pp.accelerationInitialLayer : (pp.accelerationInnerWall ?? pp.accelerationWall), pp.accelerationPrint);
          setJerk(isFirstLayer ? pp.jerkInitialLayer : (pp.jerkInnerWall ?? pp.jerkWall), pp.jerkPrint);
          travelTo(innerWall[0].x, innerWall[0].y);
          gcode.push(`; Inner wall ${wi}`);
          for (let pi = 1; pi < innerWall.length; pi++) {
            const from = innerWall[pi - 1];
            const to = innerWall[pi];
            layerTime += extrudeTo(to.x, to.y, innerWallSpeed, innerWallLineWidth, layerH);
            moves.push({
              type: 'wall-inner',
              from: { x: from.x, y: from.y },
              to: { x: to.x, y: to.y },
              speed: innerWallSpeed,
              extrusion: calcExtrusion(from.distanceTo(to), innerWallLineWidth, layerH),
              lineWidth: innerWallLineWidth,
            });
          }
          // Close loop
          if (innerWall.length > 2) {
            const lastPt = innerWall[innerWall.length - 1];
            const firstPt = innerWall[0];
            layerTime += extrudeTo(firstPt.x, firstPt.y, innerWallSpeed, innerWallLineWidth, layerH);
            moves.push({
              type: 'wall-inner',
              from: { x: lastPt.x, y: lastPt.y },
              to: { x: firstPt.x, y: firstPt.y },
              speed: innerWallSpeed,
              extrusion: calcExtrusion(lastPt.distanceTo(firstPt), innerWallLineWidth, layerH),
              lineWidth: innerWallLineWidth,
            });
          }
        }

        // Restore per-layer flow before solid/infill (may have been overridden for inner walls).
        currentLayerFlow = (isFirstLayer && (pp.initialLayerFlow ?? 0) > 0)
          ? (pp.initialLayerFlow! / 100) : 1.0;

        if (!groupOW && wallSets.length > 0 && !pp.outerWallFirst) {
          if (isFirstLayer && pp.initialLayerOuterWallFlow != null) {
            currentLayerFlow = pp.initialLayerOuterWallFlow / 100;
          }
          const outerWall = wallSets[0];
          if (outerWall.length >= 2) {
            const outerWallLineWidth = wallLineWidths[0] ?? pp.wallLineWidth;
            const seamIdx = this.findSeamPosition(outerWall, pp, li, currentX, currentY);
            let reordered = this.reorderFromIndex(outerWall, seamIdx);
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
                const angleBetween = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
                const turn = Math.PI - angleBetween;
                if (turn > fmAngle) {
                  const off = Math.min(d1, d2) * 0.25;
                  smoothed.push(new THREE.Vector2(curr.x - v1.x * -off, curr.y - v1.y * -off));
                  smoothed.push(curr);
                  smoothed.push(new THREE.Vector2(curr.x - v2.x * -off, curr.y - v2.y * -off));
                } else {
                  smoothed.push(curr);
                }
              }
              reordered = smoothed;
            }
            if ((pp.alternateWallDirections ?? false) && li % 2 === 1) {
              reordered = [reordered[0], ...reordered.slice(1).reverse()];
            }
            reordered = this.simplifyClosedContour(reordered, Math.max(0.015, outerWallLineWidth * 0.05));

            setAccel(isFirstLayer ? pp.accelerationInitialLayer : (pp.accelerationOuterWall ?? pp.accelerationWall), pp.accelerationPrint);
            setJerk(isFirstLayer ? pp.jerkInitialLayer : (pp.jerkOuterWall ?? pp.jerkWall), pp.jerkPrint);
            travelTo(reordered[0].x, reordered[0].y);
            gcode.push(`; Outer wall`);
            const scarfLen = pp.scarfSeamLength ?? 0;
            const scarfActive = scarfLen > 0
              && (pp.scarfSeamStartHeight === undefined || layerZ >= pp.scarfSeamStartHeight);
            const scarfStepLen2 = pp.scarfSeamStepLength ?? 0;
            let scarfRemaining = scarfActive ? scarfLen : 0;
            for (let pi = 1; pi < reordered.length; pi++) {
              const from = reordered[pi - 1];
              const to = reordered[pi];
              let segLW = outerWallLineWidth;
              let segSpeed = outerWallSpeed;
              if (scarfRemaining > 0) {
                const done = scarfLen - scarfRemaining;
                const tRaw = done / scarfLen;
                const t = Math.min(1, scarfStepLen2 > 0 ? Math.floor(done / scarfStepLen2) * scarfStepLen2 / scarfLen : tRaw);
                segLW = outerWallLineWidth * t;
                const speedRatio = pp.scarfSeamStartSpeedRatio ?? 1.0;
                segSpeed = outerWallSpeed * (speedRatio + (1.0 - speedRatio) * t);
                scarfRemaining = Math.max(0, scarfRemaining - from.distanceTo(to));
              }
              layerTime += extrudeTo(to.x, to.y, segSpeed, segLW, layerH);
              moves.push({
                type: 'wall-outer',
                from: { x: from.x, y: from.y },
                to: { x: to.x, y: to.y },
                speed: segSpeed,
                extrusion: calcExtrusion(from.distanceTo(to), segLW, layerH),
                lineWidth: segLW,
              });
            }
            if (reordered.length > 2) {
              const lastPt = reordered[reordered.length - 1];
              const firstPt = reordered[0];
              const segLen = lastPt.distanceTo(firstPt);
              const coastVol = pp.coastingEnabled ? (pp.coastingVolume ?? 0) : 0;
              const minCoastVol = pp.minVolumeBeforeCoasting ?? 0;
              const loopVol = minCoastVol > 0
                ? (() => {
                    let perim = segLen;
                    for (let ri = 1; ri < reordered.length - 1; ri++) {
                      perim += reordered[ri].distanceTo(reordered[ri + 1]);
                    }
                    return perim * pp.wallLineWidth * layerH;
                  })()
                : Infinity;
              const coastDist = coastVol > 0 && loopVol >= minCoastVol
                ? coastVol / (outerWallLineWidth * layerH)
                : 0;
              if (coastDist > 0 && segLen > coastDist + 1e-3) {
                const t = 1 - coastDist / segLen;
                const midX = lastPt.x + (firstPt.x - lastPt.x) * t;
                const midY = lastPt.y + (firstPt.y - lastPt.y) * t;
                layerTime += extrudeTo(midX, midY, outerWallSpeed, outerWallLineWidth, layerH);
                moves.push({
                  type: 'wall-outer',
                  from: { x: lastPt.x, y: lastPt.y },
                  to: { x: midX, y: midY },
                  speed: outerWallSpeed,
                  extrusion: calcExtrusion(segLen * t, outerWallLineWidth, layerH),
                  lineWidth: outerWallLineWidth,
                });
                const coastSpeed = outerWallSpeed * ((pp.coastingSpeed ?? 90) / 100);
                gcode.push(`G0 X${firstPt.x.toFixed(3)} Y${firstPt.y.toFixed(3)} F${(coastSpeed * 60).toFixed(0)} ; Coast`);
                currentX = firstPt.x;
                currentY = firstPt.y;
              } else {
                layerTime += extrudeTo(firstPt.x, firstPt.y, outerWallSpeed, outerWallLineWidth, layerH);
                moves.push({
                  type: 'wall-outer',
                  from: { x: lastPt.x, y: lastPt.y },
                  to: { x: firstPt.x, y: firstPt.y },
                  speed: outerWallSpeed,
                  extrusion: calcExtrusion(segLen, outerWallLineWidth, layerH),
                  lineWidth: outerWallLineWidth,
                });
              }
            }
          }
          currentLayerFlow = (isFirstLayer && (pp.initialLayerFlow ?? 0) > 0)
            ? (pp.initialLayerFlow! / 100) : 1.0;
        }

        // ----- Infill / solid fill -----
        // Infill boundary is the innermost OUTER wall (wallSets slice
        // [0..outerCount)), NOT any hole wall. Using a hole wall here would
        // tell the infill to fill *inside* the cavity, which is backwards.
        const adaptiveOuterFilled = outerWallCount === 1
          && (wallLineWidths[0] ?? pp.wallLineWidth) > pp.wallLineWidth + 1e-6;
        const innermostWall = adaptiveOuterFilled
          ? []
          : outerWallCount > 0 ? wallSets[outerWallCount - 1] : contour.points;
        const infillRegions = adaptiveOuterFilled
          ? []
          : (exWalls.infillRegions.length > 0
              ? exWalls.infillRegions
              : (innermostWall.length >= 3
                  ? [{ contour: innermostWall, holes: infillHoles }]
                  : []));
        if (infillRegions.length > 0) {
          let infillLines: { from: THREE.Vector2; to: THREE.Vector2 }[] = [];
          let infillMoveType: SliceMove['type'];
          let speed: number;
          let lineWidth: number;

          // initialLayerBottomFlow: override flow for solid bottom fill on first layer.
          if (isFirstLayer && isSolid && pp.initialLayerBottomFlow != null) {
            currentLayerFlow = pp.initialLayerBottomFlow / 100;
          }

          if (isSolid) {
            // Solid top/bottom fill at 100% density.
            // Cura-parity knobs in play here:
            //   skinOverlapPercent           — overlap between skin and walls
            //   topSkinExpandDistance (mm)   — push TOP skin further outward
            //   bottomSkinExpandDistance (mm)— push BOTTOM skin further out
            // All three additively widen the skin region via offsetContour.
            // The extra top/bottom expansion helps the skin bridge over any
            // last-wall irregularities ("zipper" top surface artifacts).
            const skinOverlap = ((pp.skinOverlapPercent ?? 0) / 100) * pp.infillLineWidth;
            const topExpand = isSolidTop    ? (pp.topSkinExpandDistance    ?? 0) : 0;
            const botExpand = isSolidBottom ? (pp.bottomSkinExpandDistance ?? 0) : 0;
            const totalExpand = skinOverlap + topExpand + botExpand;
            // offsetContour convention: positive = inward for CCW polygon.
            // We want the skin to grow OUTWARD into the wall band, so we
            // pass a negative offset. The magnitude is the expansion distance.
            for (const region of infillRegions) {
              let skinContour = totalExpand > 0
                ? this.offsetContour(region.contour, -totalExpand)
                : region.contour;
            // Cura-parity: `skinRemovalWidth` removes skin "slivers" thinner
            // than this width by eroding (offset inward) then dilating
            // (offset outward) by the same amount. Thin features collapse
            // during erosion and don't return during dilation.
            const srw = pp.skinRemovalWidth ?? 0;
            if (srw > 0 && skinContour.length >= 3) {
              const eroded = this.offsetContour(skinContour, srw);
              if (eroded.length >= 3) {
                const dilated = this.offsetContour(eroded, -srw);
                if (dilated.length >= 3) skinContour = dilated;
              } else {
                // Skin collapsed entirely — treat as no-skin region.
                skinContour = [];
              }
            }
              const skinInput = skinContour.length >= 3 ? skinContour : region.contour;
              if (skinInput.length < 3) continue;
            // Cura-parity: `bottomPatternInitialLayer` overrides the
            // top/bottom pattern for the very first layer only. Useful when
            // the user wants, say, concentric for the first layer (better
            // bed adhesion) but lines for the rest.
            const skinPattern = (li === 0 && pp.bottomPatternInitialLayer)
              ? pp.bottomPatternInitialLayer
              : (pp.topBottomPattern === 'concentric' ? 'concentric' : 'lines');
            // Cura-parity: topBottomLineDirections overrides the skin fill angle
            // with an explicit list of angles (degrees), cycled per layer.
            if (pp.topBottomLineDirections && pp.topBottomLineDirections.length > 0) {
              const angleDeg = pp.topBottomLineDirections[li % pp.topBottomLineDirections.length];
                infillLines.push(...this.generateScanLines(skinInput, 100, pp.infillLineWidth, (angleDeg * Math.PI) / 180, 0, region.holes));
            } else {
                infillLines.push(...this.generateLinearInfill(skinInput, 100, pp.infillLineWidth, li, skinPattern, region.holes));
            }
            }
            infillMoveType = 'top-bottom';
            speed = topBottomSpeed;
            lineWidth = pp.infillLineWidth;
          } else if (pp.infillDensity > 0 || (pp.infillLineDistance ?? 0) > 0) {
            // Cura-parity: `infillLineDistance` (mm) is an absolute-spacing
            // override that bypasses the density%→spacing calculation. When
            // set, we translate it back to an equivalent density so the
            // pattern generators (which key off density) produce the right
            // line spacing:  spacing = lineWidth / (density/100)
            // => density = lineWidth / spacing * 100
            let effectiveDensity = (pp.infillLineDistance ?? 0) > 0
              ? Math.min(100, Math.max(0.1, (pp.infillLineWidth / (pp.infillLineDistance ?? 1)) * 100))
              : pp.infillDensity;
            // Cura-parity: `gradualInfillSteps` + `gradualInfillStepHeight`.
            // When enabled, infill density ramps up over the last N steps
            // before the solid top layers, so the part is stronger near the
            // top surface. Each "step" spans `gradualInfillStepHeight` mm
            // (or 1.5mm default) and multiplies density by 2 vs the previous
            // step, capped at 100%. Layer `li` inside step-k (k = 1..N)
            // counted down from the first solid-top layer gets density×2^k.
            const gSteps = pp.gradualInfillSteps ?? 0;
            if (gSteps > 0 && !isSolid) {
              const stepH = pp.gradualInfillStepHeight ?? 1.5;
              const stepLayers = Math.max(1, Math.round(stepH / pp.layerHeight));
              const firstTopSolid = totalLayers - solidTop;
              const distFromTopSolid = firstTopSolid - li; // layers below the top
              if (distFromTopSolid > 0) {
                const stepIdx = Math.ceil(distFromTopSolid / stepLayers);
                if (stepIdx >= 1 && stepIdx <= gSteps) {
                  const mult = Math.pow(2, gSteps - stepIdx + 1);
                  effectiveDensity = Math.min(100, effectiveDensity * mult);
                }
              }
            }
            // Cura-parity: `infillOverhangAngle` — PER-REGION density boost.
            // Triangles facing down steeper than the threshold project an XY
            // shadow; the infill directly under that shadow gets denser
            // support while the rest of the layer stays at base density.
            // The shadow is a union MultiPolygon used below to split the
            // infill scan into two density passes.
            let overhangShadowMP: PCMultiPolygon = [];
            if ((pp.infillOverhangAngle ?? 0) > 0 && !isSolid) {
              const thr = (pp.infillOverhangAngle! * Math.PI) / 180;
              const shadowTris: PCMultiPolygon = [];
              for (const tri of triangles) {
                const dotUp = tri.normal.z;
                if (dotUp >= 0) continue;
                const a = Math.acos(Math.max(0, Math.min(1, Math.abs(dotUp))));
                if (a <= thr) continue;
                const tMaxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
                // Consider triangles at or above this layer. Their XY
                // footprint below them needs denser infill. We include
                // triangles overlapping the current slice Z so the layer's
                // own walls get the boost too.
                if (tMaxZ < sliceZ - pp.layerHeight) continue;
                const ring: PCRing = [
                  [tri.v0.x + offsetX, tri.v0.y + offsetY],
                  [tri.v1.x + offsetX, tri.v1.y + offsetY],
                  [tri.v2.x + offsetX, tri.v2.y + offsetY],
                  [tri.v0.x + offsetX, tri.v0.y + offsetY],
                ];
                shadowTris.push([ring]);
              }
              if (shadowTris.length > 0) {
                try {
                  overhangShadowMP = shadowTris.length === 1
                    ? shadowTris
                    : polygonClipping.union(shadowTris[0], ...shadowTris.slice(1));
                } catch { overhangShadowMP = []; }
              }
            }
            const infillOverlapMm = ((pp.infillOverlap ?? 10) / 100) * pp.infillLineWidth;
            for (const baseRegion of infillRegions) {
              const infillRegion = infillOverlapMm > 0
                ? this.offsetContour(baseRegion.contour, -infillOverlapMm)
                : baseRegion.contour;
            // Cura-parity: minInfillArea skips infill in tiny cross-sections
            // (e.g., thin protrusions) where it would have no structural benefit.
            // We use the bbox area as a conservative upper bound — if the bbox
            // is below the threshold the polygon area must be too.
            const minInfFill = pp.minInfillArea ?? 0;
            const infillRegionOk = minInfFill <= 0 || (() => {
              const b = this.contourBBox(infillRegion);
              return (b.maxX - b.minX) * (b.maxY - b.minY) >= minInfFill;
            })();
            if (infillRegionOk) {
              // Cura-parity: infillLineDirections overrides the pattern angle
              // with an explicit list of angles (degrees), cycled per layer.
              // When set, all infill on this layer uses a single scan pass at
              // the specified angle instead of the pattern's built-in rotation.
              const genPattern = (
                region: THREE.Vector2[],
                density: number,
                holes: THREE.Vector2[][],
              ) => {
                if (pp.infillLineDirections && pp.infillLineDirections.length > 0) {
                  const angleDeg = pp.infillLineDirections[li % pp.infillLineDirections.length];
                  const spacing = pp.infillLineWidth / (density / 100);
                  const phase = pp.randomInfillStart
                    ? Math.abs(Math.sin(li * 127.1 + 43.7)) * spacing
                    : 0;
                  return this.generateScanLines(
                    region, density, pp.infillLineWidth,
                    (angleDeg * Math.PI) / 180, phase, holes,
                  );
                }
                return this.generateLinearInfill(region, density, pp.infillLineWidth, li, pp.infillPattern, holes);
              };

              if (overhangShadowMP.length === 0) {
                // No overhang on this layer — single infill pass at baseline.
                infillLines.push(...genPattern(infillRegion, effectiveDensity, baseRegion.holes));
              } else {
                // Per-region boost: split the infill region into the shadow
                // portion (1.5× density) and the rest (baseline). Each gets
                // its own scan pass; the final line list is their union.
                const infillRegionMP: PCMultiPolygon = [[
                  this.contourToClosedPCRing(infillRegion),
                  ...baseRegion.holes.map((hole) => this.contourToClosedPCRing(hole)),
                ]];
                let boostedMP: PCMultiPolygon = [];
                let normalMP: PCMultiPolygon = infillRegionMP;
                try {
                  boostedMP = polygonClipping.intersection(infillRegionMP, overhangShadowMP);
                  normalMP = polygonClipping.difference(infillRegionMP, overhangShadowMP);
                } catch { boostedMP = []; normalMP = infillRegionMP; }

                const boostedDensity = Math.min(100, effectiveDensity * 1.5);
                for (const region of this.multiPolygonToRegions(boostedMP)) {
                  infillLines.push(...genPattern(region.contour, boostedDensity, region.holes));
                }
                for (const region of this.multiPolygonToRegions(normalMP)) {
                  infillLines.push(...genPattern(region.contour, effectiveDensity, region.holes));
                }
              }
            }
            }
            // Cura-parity: multiplyInfill repeats each scan line N times to build
            // thicker infill walls. Multiplier 1 = normal (no-op). We append
            // the original line set (N-1) more times so the sorted emission loop
            // re-traces each segment in sequence.
            const infillMult = Math.max(1, Math.round(pp.multiplyInfill ?? 1));
            if (infillMult > 1 && infillLines.length > 0) {
              const base = [...infillLines];
              for (let m = 1; m < infillMult; m++) infillLines = [...infillLines, ...base];
            }
            infillMoveType = 'infill';
            speed = infillSpeed;
            lineWidth = pp.infillLineWidth;
          } else {
            infillLines = [];
            infillMoveType = 'infill';
            speed = infillSpeed;
            lineWidth = pp.infillLineWidth;
          }

          // Cura-parity: `infillLayerThickness` — print sparse infill only every
          // N layers, using thicker stripes to maintain volumetric fill. Mirrors
          // the `supportInfillLayerThickness` pattern. Solid layers are exempt.
          if (!isSolid && (pp.infillLayerThickness ?? 0) > 0) {
            const thickMul = Math.max(1, Math.round((pp.infillLayerThickness ?? 0) / pp.layerHeight));
            if (thickMul > 1 && li % thickMul !== 0) infillLines = [];
          }

          // Cura-parity: `extraSkinWallCount` emits additional perimeter
          // loops around the solid-skin region before the scan-line fill.
          // This buffers the skin so its outer edge has proper walls — helps
          // with thin top surfaces where the fill lines would otherwise be
          // unsupported.
          if (isSolid && (pp.extraSkinWallCount ?? 0) > 0) {
            const extraCount = pp.extraSkinWallCount ?? 0;
            gcode.push(`; Extra skin walls (${extraCount})`);
            for (let ew = 0; ew < extraCount; ew++) {
              // Successive skin walls step inward (toward the center) from
              // the innermost model wall. Positive offset = inward under
              // offsetContour's convention. ew=0 sits at innermostWall.
              // Extra skin walls step inward from the innermost OUTER wall,
              // not from hole walls — matches the infill-boundary semantics.
              const baseLoop = outerWallCount > 0 ? wallSets[outerWallCount - 1] : contour.points;
              const loop = ew === 0
                ? baseLoop
                : this.offsetContour(baseLoop, ew * pp.infillLineWidth);
              if (loop.length < 3) break;
              travelTo(loop[0].x, loop[0].y);
              for (let pi = 1; pi < loop.length; pi++) {
                const from = loop[pi - 1];
                const to = loop[pi];
                layerTime += extrudeTo(to.x, to.y, topBottomSpeed, pp.infillLineWidth, layerH);
                moves.push({
                  type: 'top-bottom',
                  from: { x: from.x, y: from.y },
                  to: { x: to.x, y: to.y },
                  speed: topBottomSpeed,
                  extrusion: calcExtrusion(from.distanceTo(to), pp.infillLineWidth, layerH),
                  lineWidth: pp.infillLineWidth,
                });
              }
              // close loop
              if (loop.length > 2) {
                const last = loop[loop.length - 1];
                const first = loop[0];
                layerTime += extrudeTo(first.x, first.y, topBottomSpeed, pp.infillLineWidth, layerH);
                moves.push({
                  type: 'top-bottom',
                  from: { x: last.x, y: last.y },
                  to: { x: first.x, y: first.y },
                  speed: topBottomSpeed,
                  extrusion: calcExtrusion(last.distanceTo(first), pp.infillLineWidth, layerH),
                  lineWidth: pp.infillLineWidth,
                });
              }
            }
          }

          if (infillLines.length > 0) {
            if (isSolid) {
              setAccel(isFirstLayer ? pp.accelerationInitialLayer : pp.accelerationTopBottom, pp.accelerationPrint);
              setJerk(isFirstLayer ? pp.jerkInitialLayer : pp.jerkTopBottom, pp.jerkPrint);
            } else {
              setAccel(isFirstLayer ? pp.accelerationInitialLayer : pp.accelerationInfill, pp.accelerationPrint);
              setJerk(isFirstLayer ? pp.jerkInitialLayer : pp.jerkInfill, pp.jerkPrint);
            }
            gcode.push(`; ${isSolid ? 'Solid fill' : 'Infill'}`);
            // Sort infill lines to minimize travel.
            // infillTravelOptimization: use greedy NN sort across endpoints
            // (better inter-segment travel at O(n²) cost). Default boustrophedon
            // is O(n) and better for dense solid layers; NN is better for sparse infill.
            const sorted = (!isSolid && (pp.infillTravelOptimization ?? false))
              ? this.sortInfillLinesNN(infillLines, currentX, currentY)
              : this.sortInfillLines(infillLines);
            // Cura-parity: `connectInfillLines` bridges adjacent scan lines
            // with an extrusion instead of a travel. When the snake-ordered
            // lines share an endpoint within ~lineWidth, we emit a continuous
            // zig-zag rather than a travel+extrude pair. This reduces stringing
            // and gives cleaner infill at the cost of slightly more material.
            const connect = (pp.connectInfillLines ?? false) && infillRegions.length <= 1;
            const connectTol = lineWidth * 1.5;
            // infillStartMoveInwardsLength / infillEndMoveInwardsLength: extend
            // the extruded scan line beyond its clipped endpoints so the nozzle
            // begins/ends extrusion outside the contour boundary. This primes
            // flow at start and prevents under-extrusion at the end.
            const startExt = pp.infillStartMoveInwardsLength ?? 0;
            const endExt   = pp.infillEndMoveInwardsLength   ?? 0;
            for (let idx = 0; idx < sorted.length; idx++) {
              const line = sorted[idx];
              // Compute direction vector for extension
              const dx = line.to.x - line.from.x;
              const dy = line.to.y - line.from.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              const ux = len > 0 ? dx / len : 0;
              const uy = len > 0 ? dy / len : 0;
              const effFrom = startExt > 0 && len > 0
                ? new THREE.Vector2(line.from.x - ux * startExt, line.from.y - uy * startExt)
                : line.from;
              const effTo = endExt > 0 && len > 0
                ? new THREE.Vector2(line.to.x + ux * endExt, line.to.y + uy * endExt)
                : line.to;

              // Bridge classification: only applies to top-bottom skin lines.
              // A line is a bridge if its midpoint falls in the bridgeMP (
              // current-layer material not supported by previous layer). On
              // entry/exit of a bridge run we emit a fan override (M106) so
              // unsupported skin gets maximum cooling.
              let thisMoveType: SliceMove['type'] = infillMoveType;
              let thisSpeed = speed;
              let thisLineWidth = lineWidth;
              let thisFlowScale = 1.0;
              if (bridgeMP.length > 0 && infillMoveType === 'top-bottom') {
                const midX = (effFrom.x + effTo.x) / 2;
                const midY = (effFrom.y + effTo.y) / 2;
                if (isInBridgeRegion(midX, midY)) {
                  thisMoveType = 'bridge';
                  thisSpeed = pp.bridgeSkinSpeed ?? speed;
                  thisFlowScale = (pp.bridgeSkinFlow ?? 100) / 100;
                }
              }
              const needBridgeFan = pp.enableBridgeFan && thisMoveType === 'bridge' && !bridgeFanActive;
              const needFanRestore = !needBridgeFan && thisMoveType !== 'bridge' && bridgeFanActive;
              if (needBridgeFan) {
                gcode.push(`M106 S${fanSArg(pp.bridgeFanSpeed ?? 100)} ; Bridge fan`);
                bridgeFanActive = true;
              } else if (needFanRestore) {
                gcode.push(`M106 S${fanSArg(mat.fanSpeedMin ?? 100)} ; Restore fan after bridge`);
                bridgeFanActive = false;
              }

              const fromDist = Math.hypot(effFrom.x - currentX, effFrom.y - currentY);
              const canConnectInfill = connect
                && idx > 0
                && fromDist < connectTol
                && this.segmentInsideMaterial(
                  new THREE.Vector2(currentX, currentY),
                  effFrom,
                  innermostWall,
                  infillHoles,
                );
              if (canConnectInfill) {
                // Close enough to the previous segment's end — extrude the
                // bridge instead of traveling.
                layerTime += extrudeTo(effFrom.x, effFrom.y, thisSpeed, thisLineWidth, layerH);
              } else {
                travelTo(effFrom.x, effFrom.y);
              }
              // Apply per-move flow scale (bridge skin flow) by temporarily
              // adjusting currentLayerFlow around the extrusion + extrusion
              // bookkeeping. Restored immediately to avoid leaking into the
              // next move.
              const flowSaved = currentLayerFlow;
              currentLayerFlow = flowSaved * thisFlowScale;
              layerTime += extrudeTo(effTo.x, effTo.y, thisSpeed, thisLineWidth, layerH);
              moves.push({
                type: thisMoveType,
                from: { x: effFrom.x, y: effFrom.y },
                to: { x: effTo.x, y: effTo.y },
                speed: thisSpeed,
                extrusion: calcExtrusion(
                  effFrom.distanceTo(effTo),
                  thisLineWidth,
                  layerH,
                ),
                lineWidth: thisLineWidth,
              });
              currentLayerFlow = flowSaved;
              // Cura-parity: `infillWipeDistance` — after extruding each scan
              // line, continue moving in the same direction without extruding.
              // This wipes residual pressure off the tip and reduces stringing
              // between infill lines.
              if ((pp.infillWipeDistance ?? 0) > 0 && len > 0) {
                const wx = effTo.x + ux * pp.infillWipeDistance!;
                const wy = effTo.y + uy * pp.infillWipeDistance!;
                gcode.push(`G0 X${wx.toFixed(3)} Y${wy.toFixed(3)} F${(speed * 60).toFixed(0)} ; Infill wipe`);
                currentX = wx; currentY = wy;
              }
            }
          }
        }
      }

      // Restore per-layer flow after contour loop (may have been overridden per feature).
      currentLayerFlow = (isFirstLayer && (pp.initialLayerFlow ?? 0) > 0)
        ? (pp.initialLayerFlow! / 100) : 1.0;

      // Restore fan if bridge emission left it spinning up. Prevents the high
      // bridge fan from leaking into subsequent layers' walls/infill where it
      // would hurt adhesion on vertical surfaces.
      if (bridgeFanActive) {
        gcode.push(`M106 S${fanSArg(mat.fanSpeedMin ?? 100)} ; Restore fan after bridge (layer end)`);
        bridgeFanActive = false;
      }

      // ----- Support brim (layer 0 only) -----
      // Support generation skips layer 0 intentionally (see `li > 0` gate
      // below), but Cura emits the support brim ON layer 0 around where
      // support will land in later layers. Detect the layer-1 overhang set
      // here and emit a rectangular brim around its bbox.
      if (li === 0 && pp.supportEnabled && (pp.enableSupportBrim ?? false)) {
        const overhangAngleRad = (pp.supportAngle * Math.PI) / 180;
        let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
        for (const tri of triangles) {
          const dotUp = tri.normal.z;
          if (dotUp >= 0) continue;
          const clamped = Math.max(0, Math.min(1, Math.abs(dotUp)));
          const faceAngle = Math.acos(clamped);
          if (faceAngle <= overhangAngleRad) continue;
          const projected = [
            new THREE.Vector2(tri.v0.x + offsetX, tri.v0.y + offsetY),
            new THREE.Vector2(tri.v1.x + offsetX, tri.v1.y + offsetY),
            new THREE.Vector2(tri.v2.x + offsetX, tri.v2.y + offsetY),
          ];
          for (const p of projected) {
            if (p.x < bMinX) bMinX = p.x; if (p.x > bMaxX) bMaxX = p.x;
            if (p.y < bMinY) bMinY = p.y; if (p.y > bMaxY) bMaxY = p.y;
          }
        }
        if (bMinX < Infinity && (bMaxX - bMinX) * (bMaxY - bMinY) > (pp.minimumSupportArea ?? 0)) {
          const brimCount = pp.supportBrimLineCount ?? Math.max(1, Math.floor((pp.supportBrimWidth ?? 3) / pp.wallLineWidth));
          gcode.push(`; Support brim (${brimCount} loops)`);
          for (let bl = 0; bl < brimCount; bl++) {
            const pad = (bl + 1) * pp.wallLineWidth;
            const pts = [
              new THREE.Vector2(bMinX - pad, bMinY - pad),
              new THREE.Vector2(bMaxX + pad, bMinY - pad),
              new THREE.Vector2(bMaxX + pad, bMaxY + pad),
              new THREE.Vector2(bMinX - pad, bMaxY + pad),
            ];
            travelTo(pts[0].x, pts[0].y);
            for (let pi = 1; pi < pts.length; pi++) {
              const from = pts[pi - 1];
              const to = pts[pi];
              const brimSpeed = pp.skirtBrimSpeed ?? pp.firstLayerSpeed;
              layerTime += extrudeTo(to.x, to.y, brimSpeed, pp.wallLineWidth, layerH);
              moves.push({
                type: 'brim',
                from: { x: from.x, y: from.y },
                to: { x: to.x, y: to.y },
                speed: brimSpeed,
                extrusion: calcExtrusion(from.distanceTo(to), pp.wallLineWidth, layerH),
                lineWidth: pp.wallLineWidth,
              });
            }
            layerTime += extrudeTo(pts[0].x, pts[0].y, pp.skirtBrimSpeed ?? pp.firstLayerSpeed, pp.wallLineWidth, layerH);
          }
        }
      }

      // ----- Support generation -----
      // Cura-parity: `supportInfillLayerThickness` lets the user print
      // support infill less often than every layer, using thicker (stacked)
      // stripes. When unset or zero, we fall back to 1 (every layer). The
      // guard matters — without it `undefined / layerHeight` yields NaN and
      // `li % NaN` is never true, which would disable support entirely.
      const supThickMul = (pp.supportInfillLayerThickness ?? 0) > 0
        ? Math.max(1, Math.round((pp.supportInfillLayerThickness ?? 0) / pp.layerHeight))
        : 1;
      if (pp.supportEnabled && li > 0 && li % supThickMul === 0) {
        const { moves: supportMoves, flowOverride: supFlowOverride } = this.generateSupportForLayer(
          triangles,
          sliceZ,
          layerZ,
          li,
          offsetX,
          offsetY,
          offsetZ,
          modelHeight,
          contours,
        );
        if (supportMoves.length > 0) {
          // Support brim is handled in a layer-0 pre-pass above; this block
          // only runs on layers > 0 (the `li > 0` gate).
          setAccel(pp.accelerationSupport, pp.accelerationPrint);
          setJerk(pp.jerkSupport, pp.jerkPrint);
          // Cura-parity: supportFanSpeedOverride — switch fan to a fixed % while
          // printing support (e.g. 0% to improve adhesion, or 100% to cool fast).
          if (pp.coolingFanEnabled !== false && (pp.supportFanSpeedOverride ?? 0) > 0) {
            gcode.push(`M106 S${fanSArg(pp.supportFanSpeedOverride!)} ; Support fan override`);
          }
          gcode.push('; Support');
          // Cura-parity: support roof/floor flow override — temporarily scale
          // currentLayerFlow while emitting interface-layer support moves.
          const prevFlow = currentLayerFlow;
          if (supFlowOverride !== undefined) currentLayerFlow = supFlowOverride;
          // Cura-parity: `connectSupportLines` / `connectSupportZigZags`
          // chain adjacent support segments with extrusions instead of
          // travels. Support scan lines already arrive in an arrangement
          // where adjacent endpoints tend to be close, so the same tolerance
          // logic used for infill line chaining applies cleanly.
          const connectSupL = (pp.connectSupportLines ?? false)
            || (pp.connectSupportZigZags ?? false);
          const connectTolS = pp.wallLineWidth * 1.5;
          for (let si = 0; si < supportMoves.length; si++) {
            const sm = supportMoves[si];
            const fromDist = Math.hypot(sm.from.x - currentX, sm.from.y - currentY);
            if (connectSupL && si > 0 && fromDist < connectTolS) {
              layerTime += extrudeTo(sm.from.x, sm.from.y, sm.speed, sm.lineWidth, layerH);
            } else {
              travelTo(sm.from.x, sm.from.y);
            }
            layerTime += extrudeTo(sm.to.x, sm.to.y, sm.speed, sm.lineWidth, layerH);
            moves.push(sm);
          }
          currentLayerFlow = prevFlow;
          // Restore fan after support block if override was active.
          if (pp.coolingFanEnabled !== false && (pp.supportFanSpeedOverride ?? 0) > 0 && li > mat.fanDisableFirstLayers) {
            const restorePct = Math.min(pp.maximumFanSpeed ?? mat.fanSpeedMax, mat.fanSpeedMax);
            gcode.push(`M106 S${fanSArg(restorePct)} ; Restore fan after support`);
          }
        }
      }

      // ----- Ooze Shield -----
      // Cura-parity: `enableOozeShield` emits a single-wall rectangular loop
      // around all model contours at `oozeShieldDistance` mm. The shield
      // catches drips/strings from travel moves, improving surface quality
      // on multi-part plates. We approximate with a box-shield around the
      // union of all outer contour bboxes on this layer — good enough for
      // single-part plates and reasonable for small groups of parts.
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
          const shield = [
            new THREE.Vector2(oMinX - d, oMinY - d),
            new THREE.Vector2(oMaxX + d, oMinY - d),
            new THREE.Vector2(oMaxX + d, oMaxY + d),
            new THREE.Vector2(oMinX - d, oMaxY + d),
          ];
          gcode.push('; Ooze shield');
          travelTo(shield[0].x, shield[0].y);
          for (let pi = 1; pi < shield.length; pi++) {
            const from = shield[pi - 1];
            const to = shield[pi];
            layerTime += extrudeTo(to.x, to.y, pp.wallSpeed, pp.wallLineWidth, layerH);
            moves.push({
              type: 'wall-outer',
              from: { x: from.x, y: from.y },
              to: { x: to.x, y: to.y },
              speed: pp.wallSpeed,
              extrusion: calcExtrusion(from.distanceTo(to), pp.wallLineWidth, layerH),
              lineWidth: pp.wallLineWidth,
            });
          }
          layerTime += extrudeTo(shield[0].x, shield[0].y, pp.wallSpeed, pp.wallLineWidth, layerH);
        }
      }

      // ----- Ironing -----
      // Cura-parity: `ironOnlyHighestLayer` restricts ironing to the very
      // final layer of the print (vs. every solid-top layer). This matches
      // Cura's `iron_only_highest_layer` setting — users usually want the
      // polish on the visible top only, not on internal top skins.
      const isHighestLayer = li === totalLayers - 1;
      const ironGate = pp.ironOnlyHighestLayer ? isHighestLayer : isSolidTop;
      if (pp.ironingEnabled && ironGate) {
        gcode.push('; Ironing');
        // Hoist the flow-percentage division out of the per-segment hot loop.
        const ironingFlowFactor = pp.ironingFlow / 100;
        for (const contour of contours) {
          if (!contour.isOuter) continue;
          // ironingInset pushes the ironing area further inward from the walls
          // (default 0.35 mm) to avoid over-extruding at wall junctions.
          const ironOffset = pp.wallCount * pp.wallLineWidth + (pp.ironingInset ?? 0.35);
          const innermost = this.offsetContour(contour.points, -ironOffset);
          if (innermost.length < 3) continue;
          const ironLines = this.generateLinearInfill(innermost, 100, pp.ironingSpacing, li, pp.ironingPattern ?? 'lines');
          for (const line of ironLines) {
            travelTo(line.from.x, line.from.y);
            // Ironing uses very low flow
            doUnretract();
            const dx = line.to.x - currentX;
            const dy = line.to.y - currentY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const e = calcExtrusion(dist, pp.ironingSpacing, layerH) * ironingFlowFactor;
            currentE += e;
            totalExtruded += e;
            gcode.push(
              `G1 X${line.to.x.toFixed(3)} Y${line.to.y.toFixed(3)} E${currentE.toFixed(5)} F${(pp.ironingSpeed * 60).toFixed(0)}`,
            );
            layerTime += dist / pp.ironingSpeed;
            currentX = line.to.x;
            currentY = line.to.y;
            moves.push({
              type: 'ironing',
              from: { x: line.from.x, y: line.from.y },
              to: { x: line.to.x, y: line.to.y },
              speed: pp.ironingSpeed,
              extrusion: e,
              lineWidth: pp.ironingSpacing,
            });
          }
        }
      }

      // ----- Min layer time enforcement -----
      if (layerTime < pp.minLayerTime && layerTime > 0) {
        // Slow down factor
        // We cannot retroactively change gcode speed, but we can add a dwell
        const dwellTime = pp.minLayerTime - layerTime;
        if (dwellTime > 0.5) {
          gcode.push(`G4 P${Math.round(dwellTime * 1000)} ; Min layer time dwell`);
        }
        layerTime = pp.minLayerTime;
      }

      totalTime += layerTime;

      sliceLayers.push({
        z: layerZ,
        layerIndex: li,
        moves,
        layerTime,
      });

      // Stash this layer's material footprint for the NEXT layer's bridge
      // detection pass. Overhangs show up as the difference between the next
      // layer's material and this one.
      prevLayerMaterial = currentLayerMaterial;
    }

    // ----- End G-code -----
    this.reportProgress('generating', 95, totalLayers, totalLayers, 'Writing end G-code...');
    appendEndGCode(gcode, printer, mat);
    const {
      estimatedTime,
      filamentWeight,
      filamentCost,
    } = finalizeGCodeStats(gcode, totalTime, totalExtruded, printer, mat);

    this.reportProgress('complete', 100, totalLayers, totalLayers, 'Slicing complete.');

    return {
      gcode: gcode.join('\n'),
      layerCount: totalLayers,
      printTime: estimatedTime,
      filamentUsed: totalExtruded,
      filamentWeight,
      filamentCost,
      layers: sliceLayers,
    };
  }

  // =========================================================================
  // MESH PREPARATION
  // =========================================================================

  /**
   * Collapse triangle vertices that are coincident within a sub-micron tolerance
   * to identical coordinates. CAD-exported meshes routinely produce per-face
   * duplicated vertices that differ by floating-point noise (~1e-7). Without
   * welding, neighbouring triangles don't share vertex identity, so the
   * triangle-plane slice produces endpoint pairs like (10.000, 5.000) and
   * (10.00000008, 5.00000003) — close but not equal. The downstream
   * contour-chaining pass has to heal the gap via a coarse positional hash
   * (`connectSegments` GRID=0.01) instead of exact matching.
   *
   * This is an in-place mutation of the input Triangles' `Vector3` fields.
   * Mirrors OrcaSlicer's `its_merge_vertices` in spirit, but runs on the
   * already-transformed triangle array so we don't have to rebuild indices.
   */
  private extractTriangles(
    geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
  ): Triangle[] {
    return extractTrianglesFromGeometries(geometries);
  }

  private computeBBox(triangles: Triangle[]): THREE.Box3 {
    return computeTriangleBBox(triangles);
  }

  // =========================================================================
  // SLICING: triangle-plane intersection
  // =========================================================================

  private sliceTrianglesAtZ(
    triangles: Triangle[],
    z: number,
    offsetX: number,
    offsetY: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _offsetZ: number,
  ): Segment[] {
    return sliceTriangleSegmentsAtZ(triangles, z, offsetX, offsetY);
  }

  // =========================================================================
  // CONTOUR PROCESSING
  // =========================================================================

  private connectSegments(segments: Segment[]): THREE.Vector2[][] {
    return connectSegmentLoops(segments);
  }

  private classifyContours(rawContours: THREE.Vector2[][]): Contour[] {
    return classifyContoursFromSegments(
      rawContours,
      (contour) => this.contourBBox(contour),
      (point, contour) => this.pointInContour(point, contour),
      (points) => this.signedArea(points),
    );
  }

  private signedArea(points: THREE.Vector2[]): number {
    return signedAreaFromUtils(points);
  }

  // =========================================================================
  // PERIMETER GENERATION (polygon offsetting)
  // =========================================================================

  /**
   * Adaptive layer height — thinner layers on steep curves, thicker on flat
   * regions. Mirrors Cura's `AdaptiveLayerHeights` + Orca's `LayerHeight
   * ProfileSmoothing`:
   *
   *   1. For each Z bin, find the steepest surface (smallest |normal.z|)
   *      among triangles that span that bin. Steep = needs thin layers to
   *      keep the staircase error small.
   *   2. Blend between `minH` (steep slopes) and `maxH` (flat) using the
   *      surface angle as a weight.
   *   3. Smooth neighbour-to-neighbour so the profile respects
   *      `variationStep` — adjacent layers never differ by more than that.
   *   4. Walk up from `firstLayerHeight`, picking the local height from the
   *      smoothed profile.
   *
   * On a mostly-flat model this returns roughly the same layer count as the
   * fixed path; on a mostly-curved model it produces fewer layers overall
   * but concentrates thin layers where the staircase would be most visible.
   */
  private computeAdaptiveLayerZs(
    triangles: Triangle[],
    modelHeight: number,
    firstLayerHeight: number,
    baseLayerHeight: number,
    maxVariation: number,
    variationStep: number,
    zScale: number,
  ): number[] {
    return computeAdaptiveLayerZsFromModule(
      triangles,
      modelHeight,
      firstLayerHeight,
      baseLayerHeight,
      maxVariation,
      variationStep,
      zScale,
    );
  }

  /**
   * Cura/Orca-parity closing-radius ("slicing closing radius") gap-sealer.
   * Grows every contour boundary outward into the material by `r`, unions all
   * grown regions, then shrinks back by the same amount. This seals tiny
   * near-coincident gaps without materially changing larger features.
   */
  private closeContourGaps(contours: Contour[], r: number): Contour[] {
    return closeContourGapsFromModule(contours, r, {
      offsetContour: (contour, offset) => this.offsetContour(contour, offset),
      signedArea: (points) => this.signedArea(points),
    });
  }

  /**
   * Cura-parity `minOddWallLineWidth` filter. Drops wall loops whose bounding
   * box min dimension is smaller than `2 × minOdd`, keeping the
   * corresponding entries in all parallel arrays (`lineWidths`,
   * `innermostHoles`) aligned. `outerCount` is adjusted to reflect how many
   * outer walls survived so infill-boundary logic still points to the right
   * index after filtering. Passing `minOdd ≤ 0` is a no-op pass-through.
   */
  private filterPerimetersByMinOdd(
    p: GeneratedPerimeters,
    minOdd: number,
  ): GeneratedPerimeters {
    return filterPerimetersByMinOddFromModule(
      p,
      minOdd,
      this.printProfile.wallLineWidth,
    );
  }

  /**
   * Hole-aware perimeter generator. Equivalent of OrcaSlicer's
   * `offset_ex(expolygon, -distance)` — for each wall depth, shrinks the outer
   * contour inward AND expands each hole contour outward, then uses Clipper
   * (via polygon-clipping) to compute the resulting ExPolygon region. Every
   * ring of the result (outer boundary + hole boundaries) is emitted as a
   * wall loop, so a single call produces walls around BOTH the outer surface
   * AND each cavity.
   *
   * When walls collide (thin-ring case where `wallCount × lineWidth >
   * ringThickness/2`), the boolean difference naturally returns an empty
   * region — we stop emitting at that depth rather than double-extruding.
   *
   * Returns { walls, outerCount, innermostHoles } where `walls` is a flat
   * array with outer loops first. `outerCount` marks where outer ends;
   * wallSets[outerCount-1] is the innermost outer wall (infill boundary's
   * outer ring). `innermostHoles` carries the innermost hole wall loops so
   * the infill pipeline can subtract them and avoid filling across cavities.
   */
  private generatePerimetersEx(
    outerContour: THREE.Vector2[],
    holeContours: THREE.Vector2[][],
    wallCount: number,
    lineWidth: number,
    outerWallInset = 0,
  ): GeneratedPerimeters {
    return generatePerimetersExFromModule(
      outerContour,
      holeContours,
      wallCount,
      lineWidth,
      outerWallInset,
      this.printProfile,
      {
        offsetContour: (contour, offset) => this.offsetContour(contour, offset),
        signedArea: (points) => this.signedArea(points),
        multiPolygonToRegions: (mp) => this.multiPolygonToRegions(mp),
      },
    );
  }

  private offsetContour(contour: THREE.Vector2[], offset: number): THREE.Vector2[] {
    return offsetContourFromModule(
      contour,
      offset,
      (points) => this.signedArea(points),
    );
  }


  private shouldRetractOnTravel(
    dist: number,
    extrudedSinceRetract: number,
    pp: PrintProfile,
  ): boolean {
    return shouldRetractOnTravelFromModule(dist, extrudedSinceRetract, pp);
  }

  private simplifyClosedContour(points: THREE.Vector2[], tolerance: number): THREE.Vector2[] {
    return simplifyClosedContourFromModule(points, tolerance);
  }

  // =========================================================================
  // Z-SEAM
  // =========================================================================

  private findSeamPosition(
    contour: THREE.Vector2[],
    pp: PrintProfile,
    _layerIndex: number,
    nozzleX?: number,
    nozzleY?: number,
  ): number {
    return findSeamPositionFromModule(contour, pp, _layerIndex, nozzleX, nozzleY);
  }

  private reorderFromIndex(contour: THREE.Vector2[], startIdx: number): THREE.Vector2[] {
    return reorderFromIndexFromUtils(contour, startIdx);
  }

  // =========================================================================
  // INFILL GENERATION
  // =========================================================================

  private generateLinearInfill(
    contour: THREE.Vector2[],
    density: number,
    lineWidth: number,
    layerIndex: number,
    pattern: string,
    holes: THREE.Vector2[][] = [],
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    return generateLinearInfillFromModule(
      contour,
      density,
      lineWidth,
      layerIndex,
      pattern,
      holes,
      this.printProfile,
      {
        contourBBox: (pts) => this.contourBBox(pts),
        pointInContour: (point, pts) => this.pointInContour(point, pts),
        lineContourIntersections: (from, to, pts) => this.lineContourIntersections(from, to, pts),
        offsetContour: (pts, offset) => this.offsetContour(pts, offset),
      },
    );
  }

  private contourToClosedPCRing(contour: THREE.Vector2[]): PCRing {
    return contourToClosedPCRing(contour);
  }

  private multiPolygonToRegions(mp: PCMultiPolygon): Array<{
    contour: THREE.Vector2[];
    holes: THREE.Vector2[][];
  }> {
    return multiPolygonToRegions(mp);
  }

  private generateScanLines(
    contour: THREE.Vector2[],
    density: number,
    lineWidth: number,
    angle: number,
    phaseOffset = 0,
    holes: THREE.Vector2[][] = [],
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    return generateScanLinesFromModule(
      contour,
      density,
      lineWidth,
      angle,
      phaseOffset,
      holes,
      this.printProfile,
      {
        contourBBox: (pts) => this.contourBBox(pts),
        pointInContour: (point, pts) => this.pointInContour(point, pts),
        lineContourIntersections: (from, to, pts) => this.lineContourIntersections(from, to, pts),
        offsetContour: (pts, offset) => this.offsetContour(pts, offset),
      },
    );
  }

  // =========================================================================
  // SUPPORT GENERATION
  // =========================================================================

  // ── Tree support helpers ────────────────────────────────────────────────────

  /** Support generation delegated to the support subsystem module. */
  private generateSupportForLayer(
    triangles: Triangle[],
    sliceZ: number,
    layerZ: number,
    layerIndex: number,
    offsetX: number,
    offsetY: number,
    _offsetZ: number,
    modelHeight: number,
    modelContours: Contour[],
  ): { moves: SliceMove[]; flowOverride?: number } {
    return generateSupportForLayerFromModule(
      triangles,
      sliceZ,
      layerZ,
      layerIndex,
      offsetX,
      offsetY,
      modelHeight,
      modelContours,
      this.printProfile,
      {
        pointInContour: (pt, contour) => this.pointInContour(pt, contour),
        pointsBBox: (points) => this.pointsBBox(points),
        generateScanLines: (contour, density, lineWidth, angle, phaseOffset, holes) =>
          this.generateScanLines(contour, density, lineWidth, angle, phaseOffset, holes),
      },
    );
  }

  // =========================================================================
  // ADHESION GENERATION (skirt, brim, raft)
  // =========================================================================

  private generateAdhesion(
    contours: Contour[],
    pp: PrintProfile,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _layerH: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _offsetX: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _offsetY: number,
  ): SliceMove[] {
    return generateAdhesionFromModule(contours, pp, {
      simplifyClosedContour: (points, tolerance) => this.simplifyClosedContour(points, tolerance),
      offsetContour: (contour, offset) => this.offsetContour(contour, offset),
      generateScanLines: (contour, density, lineWidth, angle, phaseOffset, holes) =>
        this.generateScanLines(contour, density, lineWidth, angle, phaseOffset, holes),
      sortInfillLines: (lines) => this.sortInfillLines(lines),
    });
  }

  // =========================================================================
  // TRAVEL OPTIMIZATION
  // =========================================================================

  private sortInfillLines(
    lines: { from: THREE.Vector2; to: THREE.Vector2 }[],
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    return sortInfillLinesFromModule(lines);
  }

  // Greedy nearest-neighbour infill sort (used when infillTravelOptimization is on).
  // Considers both endpoints of each remaining line and flips the line to start
  // from whichever end is closest to the current nozzle position.
  private sortInfillLinesNN(
    lines: { from: THREE.Vector2; to: THREE.Vector2 }[],
    startX: number,
    startY: number,
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    return sortInfillLinesNNFromModule(lines, startX, startY);
  }

  // =========================================================================
  // GEOMETRY UTILITIES
  // =========================================================================

  private lineContourIntersections(
    p1: THREE.Vector2,
    p2: THREE.Vector2,
    contour: THREE.Vector2[],
  ): number[] {
    return lineContourIntersectionsFromUtils(p1, p2, contour);
  }

  private pointInContour(pt: THREE.Vector2, contour: THREE.Vector2[]): boolean {
    return pointInContourFromUtils(pt, contour);
  }

  /** Ray-casting point-in-polygon test against a polygon-clipping ring
   *  (`[number, number][]` with closing duplicate). Cheaper than converting
   *  to Vector2[] just to call pointInContour — used hot in bridge detection. */
  private pointInRing(x: number, y: number, ring: PCRing): boolean {
    return pointInRingFromModule(x, y, ring);
  }

  private segmentInsideMaterial(
    from: THREE.Vector2,
    to: THREE.Vector2,
    contour: THREE.Vector2[],
    holes: THREE.Vector2[][] = [],
  ): boolean {
    return segmentInsideMaterialFromModule(
      from,
      to,
      contour,
      holes,
      (pt, loop) => this.pointInContour(pt, loop),
    );
  }

  private contourBBox(contour: THREE.Vector2[]): BBox2 {
    return contourBBoxFromUtils(contour);
  }

  private pointsBBox(points: THREE.Vector2[]): BBox2 {
    return this.contourBBox(points);
  }

  // =========================================================================
  // G-CODE TEMPLATE
  // =========================================================================

  // =========================================================================
  // PROGRESS REPORTING
  // =========================================================================

  private reportProgress(
    stage: SliceProgress['stage'],
    percent: number,
    currentLayer: number,
    totalLayers: number,
    message: string,
  ): void {
    reportProgressFromModule(
      this.onProgress,
      stage,
      percent,
      currentLayer,
      totalLayers,
      message,
    );
  }

  private async yieldToUI(): Promise<void> {
    await yieldToUIFromModule();
  }
}
