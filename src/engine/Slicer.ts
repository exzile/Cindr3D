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
} from '../types/slicer';

// ---------------------------------------------------------------------------
// Internal geometry helpers
// ---------------------------------------------------------------------------

interface Triangle {
  v0: THREE.Vector3;
  v1: THREE.Vector3;
  v2: THREE.Vector3;
  normal: THREE.Vector3;
  // Edge-identity keys (sorted pair of vertex positions). Assigned after
  // welding so adjacent triangles sharing a mesh edge get IDENTICAL strings
  // here — this is what lets connectSegments chain loops by exact topology
  // instead of fuzzy positional hashing. Mirrors OrcaSlicer's edge-id tracking
  // in slice_facet + chain_lines_by_triangle_connectivity.
  edgeKey01: string;
  edgeKey12: string;
  edgeKey20: string;
}

interface Segment {
  a: THREE.Vector2;
  b: THREE.Vector2;
  // Edge key of the mesh edge that produced each endpoint's intersection.
  // Same key on two different segments means they came from adjacent triangles
  // sharing that edge — i.e., they MUST chain in the contour. Empty string
  // means the endpoint didn't come from a straddling edge (e.g. vertex-on-plane
  // cases before the perturbation fix), and we fall back to positional matching.
  edgeKeyA: string;
  edgeKeyB: string;
}

interface Contour {
  points: THREE.Vector2[];
  area: number; // signed area (positive = CCW = outer)
  isOuter: boolean;
}

interface BBox2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface GeneratedPerimeters {
  walls: THREE.Vector2[][];
  lineWidths: number[];
  outerCount: number;
  /** Innermost hole wall loops (one per original contained hole) — passed
   *  into the infill pipeline so scan lines pair intersections across holes
   *  correctly and don't fill across open cavities. */
  innermostHoles: THREE.Vector2[][];
}

// ---------------------------------------------------------------------------
// Slicer
// ---------------------------------------------------------------------------

export class Slicer {
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
    const flavor: 'marlin' | 'reprap' | 'duet' | 'klipper' = printer.gcodeFlavorType ?? 'marlin';
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

    const gcode: string[] = [];

    // Relative extrusion mode (Cura: relative_extrusion). When enabled, emit
    // M83 and every G1 E-value is a delta rather than an absolute position.
    const relativeE = pp.relativeExtrusion ?? false;

    // Per-layer flow multiplier — updated at the start of each layer.
    // Cura-parity: initialLayerFlow overrides the base flowRate on the first
    // layer only, letting users print a wider/thicker first layer without
    // changing the global flow.
    let currentLayerFlow = 1.0;

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
    const fanSArg = (pct: number): string => printer.scaleFanSpeedTo01
      ? (pct / 100).toFixed(3)
      : Math.round((pct / 100) * 255).toString();

    // Track the modal state that arbitrary printer start G-code may change so
    // we can cheaply resync the slicer's internal XYZE state afterward.
    let templateUsesAbsolutePositioning = true;
    let templateUsesAbsoluteExtrusion = !relativeE;
    const syncStateFromGCode = (block: string): void => {
      const lines = block.split(/\r?\n/);
      for (const rawLine of lines) {
        const stripped = rawLine.split(';', 1)[0].trim();
        if (!stripped) continue;
        const tokens = stripped.split(/\s+/);
        if (tokens.length === 0) continue;
        const command = tokens[0].toUpperCase();
        if (command === 'G90') {
          templateUsesAbsolutePositioning = true;
          continue;
        }
        if (command === 'G91') {
          templateUsesAbsolutePositioning = false;
          continue;
        }
        if (command === 'M82') {
          templateUsesAbsoluteExtrusion = true;
          continue;
        }
        if (command === 'M83') {
          templateUsesAbsoluteExtrusion = false;
          continue;
        }

        let nextX: number | undefined;
        let nextY: number | undefined;
        let nextZ: number | undefined;
        let nextE: number | undefined;
        for (const token of tokens.slice(1)) {
          if (token.length < 2) continue;
          const axis = token[0].toUpperCase();
          const value = Number.parseFloat(token.slice(1));
          if (!Number.isFinite(value)) continue;
          if (axis === 'X') nextX = value;
          else if (axis === 'Y') nextY = value;
          else if (axis === 'Z') nextZ = value;
          else if (axis === 'E') nextE = value;
        }

        if (command === 'G92') {
          if (nextX !== undefined) currentX = nextX;
          if (nextY !== undefined) currentY = nextY;
          if (nextZ !== undefined) currentZ = nextZ;
          if (nextE !== undefined) currentE = nextE;
          continue;
        }
        if (command !== 'G0' && command !== 'G1') continue;

        if (nextX !== undefined) currentX = templateUsesAbsolutePositioning ? nextX : currentX + nextX;
        if (nextY !== undefined) currentY = templateUsesAbsolutePositioning ? nextY : currentY + nextY;
        if (nextZ !== undefined) currentZ = templateUsesAbsolutePositioning ? nextZ : currentZ + nextZ;
        if (nextE !== undefined) currentE = templateUsesAbsoluteExtrusion ? nextE : currentE + nextE;
      }
    };
    const restorePostStartModes = (): void => {
      gcode.push('G90 ; Restore absolute positioning after start G-code');
      gcode.push(relativeE ? 'M83 ; Restore relative extrusion after start G-code' : 'M82 ; Restore absolute extrusion after start G-code');
      gcode.push('G92 E0 ; Reset extruder after start G-code');
      currentE = 0;
      isRetracted = false;
      extrudedSinceRetract = 0;
      templateUsesAbsolutePositioning = true;
      templateUsesAbsoluteExtrusion = !relativeE;
    };
    const dedupeStartGCode = (
      block: string,
      opts: {
        preheatTemp: number;
        nozzleFirstLayerTemp: number;
        bedFirstLayerTemp: number;
        relativeExtrusion: boolean;
        hasHeatedBed: boolean;
        waitForNozzle: boolean;
        waitForBuildPlate: boolean;
      },
    ): string => {
      const lines = block.split(/\r?\n/);
      const filtered: string[] = [];
      for (const line of lines) {
        const stripped = line.split(';', 1)[0].trim();
        if (!stripped) {
          filtered.push(line);
          continue;
        }

        const tokens = stripped.split(/\s+/);
        const command = tokens[0]?.toUpperCase() ?? '';
        const sval = tokens
          .map((t) => t.trim())
          .find((t) => t[0]?.toUpperCase() === 'S');
        const eToken = tokens
          .map((t) => t.trim())
          .find((t) => t[0]?.toUpperCase() === 'E');
        const sNum = sval != null ? Number.parseFloat(sval.slice(1)) : undefined;
        const eNum = eToken != null ? Number.parseFloat(eToken.slice(1)) : undefined;

        if (command === 'G90') continue;
        if (!opts.relativeExtrusion && command === 'M82') continue;
        if (opts.relativeExtrusion && command === 'M83') continue;
        if (command === 'G92' && eNum === 0 && tokens.every((t, i) => i === 0 || t[0]?.toUpperCase() === 'E')) continue;
        if (command === 'M104' && sNum !== undefined && (Math.abs(sNum - opts.preheatTemp) < 0.0001 || Math.abs(sNum - opts.nozzleFirstLayerTemp) < 0.0001)) continue;
        if (command === 'M109' && opts.waitForNozzle && sNum !== undefined && Math.abs(sNum - opts.nozzleFirstLayerTemp) < 0.0001) continue;
        if (command === 'M140' && opts.hasHeatedBed && sNum !== undefined && Math.abs(sNum - opts.bedFirstLayerTemp) < 0.0001) continue;
        if (command === 'M190' && opts.hasHeatedBed && opts.waitForBuildPlate && sNum !== undefined && Math.abs(sNum - opts.bedFirstLayerTemp) < 0.0001) continue;

        filtered.push(line);
      }
      return filtered.join('\n').trim();
    };
    const dedupeEndGCode = (
      block: string,
      opts: {
        slicerTurnsFanOff: boolean;
        slicerSetsFinalNozzleTemp: boolean;
      },
    ): string => {
      const lines = block.split(/\r?\n/);
      const filtered: string[] = [];
      for (const line of lines) {
        const stripped = line.split(';', 1)[0].trim();
        if (!stripped) {
          filtered.push(line);
          continue;
        }
        const tokens = stripped.split(/\s+/);
        const command = tokens[0]?.toUpperCase() ?? '';
        const sval = tokens
          .map((t) => t.trim())
          .find((t) => t[0]?.toUpperCase() === 'S');
        const sNum = sval != null ? Number.parseFloat(sval.slice(1)) : undefined;

        if (opts.slicerTurnsFanOff && command === 'M107') continue;
        if (opts.slicerTurnsFanOff && command === 'M106' && sNum !== undefined && Math.abs(sNum) < 0.0001) continue;
        if (opts.slicerSetsFinalNozzleTemp && command === 'M104' && sNum !== undefined) continue;

        filtered.push(line);
      }
      return filtered.join('\n').trim();
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
    let lastExtrudeDx = 0;
    let lastExtrudeDy = 0;
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
      const forceRetract = (pp.avoidPrintedParts ?? false) || (pp.avoidSupports ?? false);
      let maxComb = pp.maxCombDistanceNoRetract ?? 0;
      // Apply avoid-distance padding — the travel must be even shorter
      // than (maxComb - avoidDist) to skip retract when the user has
      // asked for a conservative buffer around parts/supports.
      const avoidPad = (pp.travelAvoidDistance ?? 0) + (pp.insideTravelAvoidDistance ?? 0);
      if (avoidPad > 0) maxComb = Math.max(0, maxComb - avoidPad);
      const minTravel = pp.retractionMinTravel ?? 0;
      const minExtrudeWindow = pp.minimumExtrusionDistanceWindow ?? 0;
      const shortTravel = !forceRetract && (
        (maxComb > 0 && dist < maxComb) ||
        (minTravel > 0 && dist < minTravel) ||
        (minExtrudeWindow > 0 && extrudedSinceRetract < minExtrudeWindow)
      );
      if (!shortTravel) doRetract();
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

    // ----- Write header (placeholder -- will be replaced later) -----
    gcode.push('; Generated by Dzign3D Slicer');
    gcode.push('; PRINT_TIME_PLACEHOLDER');
    gcode.push('; FILAMENT_USED_PLACEHOLDER');
    gcode.push(`; Layer height: ${pp.layerHeight}mm`);
    gcode.push(`; Nozzle: ${printer.nozzleDiameter}mm`);
    gcode.push(`; Infill: ${pp.infillDensity}% ${pp.infillPattern}`);
    gcode.push(`; Material: ${mat.name}`);
    gcode.push(`; Printer: ${printer.name}`);
    gcode.push('');

    // ----- Start G-code -----
    const startGCode = this.resolveGCodeTemplate(printer.startGCode, {
      nozzleTemp: mat.nozzleTempFirstLayer,
      nozzleTempFirstLayer: mat.nozzleTempFirstLayer,
      bedTemp: mat.bedTempFirstLayer,
      bedTempFirstLayer: mat.bedTempFirstLayer,
    });
    const startTemplateHasPrintMacro = /^\s*START_PRINT\b/m.test(startGCode);
    const startTemplateOwnsHeatup = printer.startGCodeMustBeFirst && startTemplateHasPrintMacro;
    gcode.push('; ----- Start G-code -----');
    if (printer.startGCodeMustBeFirst && startGCode.trim()) {
      gcode.push(startGCode.trim());
      syncStateFromGCode(startGCode);
    }
    if (!startTemplateOwnsHeatup) {
      gcode.push('G90 ; Absolute positioning');
      gcode.push(relativeE ? 'M83 ; Relative extrusion' : 'M82 ; Absolute extrusion');
    }
    // Preheat sequence (Cura-parity):
    //   If initialPrintingTemperature is set, heat to that lower temp first
    //   (non-blocking) while the bed heats — avoids ooze during bed warmup.
    //   Then after bed reaches target, ramp nozzle to full first-layer temp.
    //   Without initialPrintingTemperature the sequence is unchanged.
    const hasInitTemp = mat.initialPrintingTemperature !== undefined
      && mat.initialPrintingTemperature !== mat.nozzleTempFirstLayer;
    const preheatTemp = hasInitTemp ? mat.initialPrintingTemperature! : mat.nozzleTempFirstLayer;
    const normalizedStartGCode = printer.startGCodeMustBeFirst
      ? startGCode.trim()
      : dedupeStartGCode(startGCode, {
        preheatTemp,
        nozzleFirstLayerTemp: mat.nozzleTempFirstLayer,
        bedFirstLayerTemp: mat.bedTempFirstLayer,
        relativeExtrusion: relativeE,
        hasHeatedBed: printer.hasHeatedBed,
        waitForNozzle: printer.waitForNozzle ?? true,
        waitForBuildPlate: printer.waitForBuildPlate ?? true,
      });
    if (!startTemplateOwnsHeatup) {
    gcode.push(`M104 S${preheatTemp} ; Preheat nozzle`);
    if (printer.hasHeatedBed) {
      gcode.push(`M140 S${mat.bedTempFirstLayer} ; Set bed temp`);
    }
    // Build-volume / chamber fan (Cura: build_volume_fan_speed). Uses M106 P2
    // by convention; printers that lack a second fan channel will simply
    // ignore it. Emit only when the user has set a non-zero value.
    if ((pp.buildVolumeFanSpeed ?? 0) > 0 || (pp.initialLayersBuildVolumeFanSpeed ?? 0) > 0) {
      // Use `initialLayersBuildVolumeFanSpeed` during first layers if set; fall
      // back to the regular build-volume speed when it's not specified.
      const initBVF = pp.initialLayersBuildVolumeFanSpeed ?? pp.buildVolumeFanSpeed ?? 0;
      if (initBVF > 0) gcode.push(`M106 P2 S${fanSArg(initBVF)} ; Build volume fan (initial layers)`);
    }
    if (printer.hasHeatedBed) {
      // waitForBuildPlate defaults true — use M190 (blocking). Setting false
      // uses M140 (non-blocking) and the user's start G-code handles the wait.
      const bedCmd = (printer.waitForBuildPlate ?? true) ? 'M190' : 'M140';
      gcode.push(`${bedCmd} S${mat.bedTempFirstLayer} ; ${(printer.waitForBuildPlate ?? true) ? 'Wait for' : 'Set'} bed temp`);
    }
    if (hasInitTemp) {
      gcode.push(`M104 S${mat.nozzleTempFirstLayer} ; Ramp to full nozzle temp`);
    }
    if (printer.hasHeatedChamber && mat.chamberTemp > 0) {
      gcode.push(`M141 S${mat.chamberTemp} ; Set chamber temp`);
    }
    // waitForNozzle defaults true — use M109 (blocking). Setting false uses M104.
    const nozzleWaitCmd = (printer.waitForNozzle ?? true) ? 'M109' : 'M104';
    gcode.push(`${nozzleWaitCmd} S${mat.nozzleTempFirstLayer} ; ${(printer.waitForNozzle ?? true) ? 'Wait for' : 'Set'} nozzle temp`);
    }
    if (mat.linearAdvanceEnabled && (mat.linearAdvanceFactor ?? 0) >= 0) {
      // "Linear advance" (Marlin) / "pressure advance" (RRF & Klipper) —
      // same concept, different command per firmware.
      const k = (mat.linearAdvanceFactor ?? 0).toFixed(3);
      if (isRRF) {
        gcode.push(`M572 D0 S${k} ; Pressure advance`);
      } else if (isKlipper) {
        gcode.push(`SET_PRESSURE_ADVANCE ADVANCE=${k} ; Pressure advance`);
      } else {
        gcode.push(`M900 K${k} ; Linear advance`);
      }
    }
    // Per-axis machine limits (Cura: machine_max_feedrate_*/machine_max_acceleration_*).
    // Only emit when the user has explicitly set a value — leave firmware defaults otherwise.
    const hasM203 = [printer.maxSpeedX, printer.maxSpeedY, printer.maxSpeedZ, printer.maxSpeedE].some(v => v !== undefined);
    if (hasM203) {
      // Storage is mm/s. Marlin's M203 expects mm/s. RRF's M203 expects mm/min.
      // Klipper ignores M203 (uses printer.cfg max_velocity instead) but
      // tolerates it, so we still emit in mm/s there.
      const scale = isRRF ? 60 : 1;
      const fmt = (v: number) => (isRRF ? Math.round(v * scale).toString() : v.toString());
      const x = printer.maxSpeedX != null ? ` X${fmt(printer.maxSpeedX)}` : '';
      const y = printer.maxSpeedY != null ? ` Y${fmt(printer.maxSpeedY)}` : '';
      const z = printer.maxSpeedZ != null ? ` Z${fmt(printer.maxSpeedZ)}` : '';
      const e = printer.maxSpeedE != null ? ` E${fmt(printer.maxSpeedE)}` : '';
      gcode.push(`M203${x}${y}${z}${e} ; Max axis speeds${isRRF ? ' (mm/min)' : ' (mm/s)'}`);
    }
    const hasM201 = [printer.maxAccelX, printer.maxAccelY, printer.maxAccelZ, printer.maxAccelE].some(v => v !== undefined);
    if (hasM201) {
      const x = printer.maxAccelX != null ? ` X${printer.maxAccelX}` : '';
      const y = printer.maxAccelY != null ? ` Y${printer.maxAccelY}` : '';
      const z = printer.maxAccelZ != null ? ` Z${printer.maxAccelZ}` : '';
      const e = printer.maxAccelE != null ? ` E${printer.maxAccelE}` : '';
      gcode.push(`M201${x}${y}${z}${e} ; Max axis accelerations`);
    }
    if (printer.defaultAcceleration != null) {
      gcode.push(`M204 S${printer.defaultAcceleration} ; Default acceleration`);
    }
    if (printer.defaultJerk != null) {
      if (isRRF) {
        const mmPerMin = Math.round(printer.defaultJerk * 60);
        gcode.push(`M566 X${mmPerMin} Y${mmPerMin} ; Default jerk (RRF instantaneous speed change)`);
      } else if (isKlipper) {
        gcode.push(`SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=${printer.defaultJerk} ; Default jerk (Klipper SCV)`);
      } else {
        gcode.push(`M205 X${printer.defaultJerk} Y${printer.defaultJerk} ; Default jerk`);
      }
    }
    if (!printer.startGCodeMustBeFirst && normalizedStartGCode) {
      gcode.push(normalizedStartGCode);
      syncStateFromGCode(normalizedStartGCode);
    }
    restorePostStartModes();
    // Cura-parity: primeBlobEnable deposits a blob of material at the print
    // origin before the print starts, priming the nozzle and wiping ooze.
    // We approximate as an extrude-in-place move of primeBlobSize mm³.
    if (pp.primeBlobEnable) {
      const blobMm3 = pp.primeBlobSize ?? 0.5;
      const filArea = Math.PI * (printer.filamentDiameter / 2) ** 2;
      const blobE = (blobMm3 / filArea).toFixed(5);
      const blobF = (pp.firstLayerSpeed * 60).toFixed(0);
      gcode.push('; Prime blob');
      gcode.push(`G1 E${blobE} F${blobF} ; Prime blob extrusion`);
      gcode.push('G92 E0 ; Reset extruder after blob');
    }
    gcode.push('');

    // Per-layer travel speed (mutable so travelTo closure picks it up each layer).
    let currentLayerTravelSpeed = pp.travelSpeed;
    // Track whether the regularFanSpeedAtHeight trigger has fired (emit once).
    let regularFanHeightFired = false;
    let buildVolumeFanHeightFired = false;

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
          // For CCW-wound holes, positive offset = inward (tightens) via offsetContour.
          // hhe > 0 means tighten (shrink hole) → positive inward offset.
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

      // Progress reporting
      if (totalLayers > 0) {
        const pctDone = Math.round((li / totalLayers) * 100);
        gcode.push(`M73 P${pctDone} ; Progress`);
      }

      // ----- Small layer temperature -----
      // Cura-parity: reduce nozzle temp on very short layers to avoid heat
      // buildup that would string or blob. We check the PREVIOUS layer's time
      // against pp.minLayerTime — if it was shorter than the minimum, the layer
      // was too fast and may need a cooler nozzle. We restore normal temp once
      // a layer comes in at full speed.
      if ((pp.smallLayerPrintingTemperature ?? 0) > 0 && li > mat.fanDisableFirstLayers) {
        const prevTime = sliceLayers.length > 0 ? sliceLayers[sliceLayers.length - 1].layerTime : Infinity;
        const targetTemp = prevTime < pp.minLayerTime
          ? pp.smallLayerPrintingTemperature!
          : mat.nozzleTemp;
        gcode.push(`M104 S${targetTemp} ; Small layer temp`);
      }

      // ----- Temperature changes -----
      // Switch from first-layer temps to normal temps only once, after layer 0
      // has completed. Using `li === 1` means the command is emitted as part
      // of layer-1 setup — fine — but guard against re-emitting if someone
      // later changes the comparison. Using non-blocking M104/M140 so the
      // nozzle keeps printing while the new setpoint is approached.
      if (li === 1 && mat.nozzleTemp !== mat.nozzleTempFirstLayer) {
        gcode.push(`M104 S${mat.nozzleTemp} ; Normal nozzle temp`);
      }
      if (li === 1 && printer.hasHeatedBed && mat.bedTemp !== mat.bedTempFirstLayer) {
        gcode.push(`M140 S${mat.bedTemp} ; Normal bed temp`);
      }

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
      if (pp.coolingFanEnabled !== false) {
        const maxFanPct = pp.maximumFanSpeed ?? mat.fanSpeedMax;
        if (li === 0 && (pp.initialFanSpeed ?? 0) > 0) {
          const initPct = Math.min(pp.initialFanSpeed ?? 0, maxFanPct);
          gcode.push(`M106 S${fanSArg(initPct)} ; Initial fan speed`);
        }
        if (li === mat.fanDisableFirstLayers) {
          gcode.push(`M106 S${fanSArg(mat.fanSpeedMin)} ; Enable fan`);
          // Transition build-volume fan from initial-layer speed to regular speed.
          if ((pp.initialLayersBuildVolumeFanSpeed ?? 0) > 0 && (pp.buildVolumeFanSpeed ?? 0) > 0) {
            gcode.push(`M106 P2 S${fanSArg(pp.buildVolumeFanSpeed!)} ; Build volume fan regular`);
          }
        }
        if (li > mat.fanDisableFirstLayers && li <= mat.fanDisableFirstLayers + 3) {
          // Ramp up fan
          const rampFraction = (li - mat.fanDisableFirstLayers) / 3;
          let fanPct = mat.fanSpeedMin + (mat.fanSpeedMax - mat.fanSpeedMin) * Math.min(rampFraction, 1);
          // Fast-layer override: if the previous layer printed faster than the
          // threshold, Cura jumps fan straight to max rather than respecting
          // the ramp. This helps thin/narrow regions cool aggressively.
          const thr = pp.regularMaxFanThreshold;
          if (thr && sliceLayers.length > 0 && sliceLayers[sliceLayers.length - 1].layerTime < thr) {
            fanPct = maxFanPct;
          }
          fanPct = Math.min(fanPct, maxFanPct);
          gcode.push(`M106 S${fanSArg(fanPct)} ; Ramp fan`);
        }
        // Cura-parity: regularFanSpeedAtHeight switches the fan to regular
        // (mat.fanSpeedMin) once the nozzle passes the specified Z height.
        // Fired once — avoids re-emitting M106 on every layer above.
        if (!regularFanHeightFired
          && (pp.regularFanSpeedAtHeight ?? 0) > 0
          && layerZ >= (pp.regularFanSpeedAtHeight ?? 0)) {
          regularFanHeightFired = true;
          gcode.push(`M106 S${fanSArg(mat.fanSpeedMin)} ; Regular fan speed at height`);
        }
        // Cura-parity: buildVolumeFanSpeedAtHeight — switch the build-volume
        // fan (P2) to the regular build-volume speed once Z passes the threshold.
        if (!buildVolumeFanHeightFired
          && (pp.buildVolumeFanSpeedAtHeight ?? 0) > 0
          && layerZ >= (pp.buildVolumeFanSpeedAtHeight ?? 0)) {
          buildVolumeFanHeightFired = true;
          gcode.push(`M106 P2 S${fanSArg(pp.buildVolumeFanSpeed ?? 0)} ; Build vol fan at height`);
        }
      }

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
          const seamIdx = this.findSeamPosition(outerWall, pp, li);
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
        if (!groupOW && wallSets.length > 0) {
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
            // two unions.
            const seamIdx = this.findSeamPosition(outerWall, pp, li);
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
          const innerWall = wallSets[wi];
          if (innerWall.length < 2) continue;
          const innerWallLineWidth = wallLineWidths[wi] ?? innerLW;
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

        // ----- Infill / solid fill -----
        // Infill boundary is the innermost OUTER wall (wallSets slice
        // [0..outerCount)), NOT any hole wall. Using a hole wall here would
        // tell the infill to fill *inside* the cavity, which is backwards.
        const adaptiveOuterFilled = outerWallCount === 1
          && (wallLineWidths[0] ?? pp.wallLineWidth) > pp.wallLineWidth + 1e-6;
        const innermostWall = adaptiveOuterFilled
          ? []
          : outerWallCount > 0 ? wallSets[outerWallCount - 1] : contour.points;
        if (innermostWall.length >= 3) {
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
            let skinContour = totalExpand > 0
              ? this.offsetContour(innermostWall, -totalExpand)
              : innermostWall;
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
            const skinInput = skinContour.length >= 3 ? skinContour : innermostWall;
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
              infillLines = this.generateScanLines(skinInput, 100, pp.infillLineWidth, (angleDeg * Math.PI) / 180, 0, infillHoles);
            } else {
              infillLines = this.generateLinearInfill(skinInput, 100, pp.infillLineWidth, li, skinPattern, infillHoles);
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
            const infillRegion = infillOverlapMm > 0
              ? this.offsetContour(innermostWall, -infillOverlapMm)
              : innermostWall;
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
              const genPattern = (region: THREE.Vector2[], density: number) => {
                if (pp.infillLineDirections && pp.infillLineDirections.length > 0) {
                  const angleDeg = pp.infillLineDirections[li % pp.infillLineDirections.length];
                  const spacing = pp.infillLineWidth / (density / 100);
                  const phase = pp.randomInfillStart
                    ? Math.abs(Math.sin(li * 127.1 + 43.7)) * spacing
                    : 0;
                  return this.generateScanLines(
                    region, density, pp.infillLineWidth,
                    (angleDeg * Math.PI) / 180, phase, infillHoles,
                  );
                }
                return this.generateLinearInfill(region, density, pp.infillLineWidth, li, pp.infillPattern, infillHoles);
              };

              if (overhangShadowMP.length === 0) {
                // No overhang on this layer — single infill pass at baseline.
                infillLines = genPattern(infillRegion, effectiveDensity);
              } else {
                // Per-region boost: split the infill region into the shadow
                // portion (1.5× density) and the rest (baseline). Each gets
                // its own scan pass; the final line list is their union.
                const infillRegionMP: PCMultiPolygon = [[
                  infillRegion.map((p) => [p.x, p.y] as [number, number]).concat(
                    infillRegion.length > 0
                      ? [[infillRegion[0].x, infillRegion[0].y] as [number, number]]
                      : [],
                  ),
                ]];
                let boostedMP: PCMultiPolygon = [];
                let normalMP: PCMultiPolygon = infillRegionMP;
                try {
                  boostedMP = polygonClipping.intersection(infillRegionMP, overhangShadowMP);
                  normalMP = polygonClipping.difference(infillRegionMP, overhangShadowMP);
                } catch { boostedMP = []; normalMP = infillRegionMP; }

                const ringToV2 = (ring: PCRing): THREE.Vector2[] => {
                  const pts: THREE.Vector2[] = [];
                  for (let i = 0; i < ring.length - 1; i++) {
                    pts.push(new THREE.Vector2(ring[i][0], ring[i][1]));
                  }
                  return pts;
                };

                const boostedDensity = Math.min(100, effectiveDensity * 1.5);
                infillLines = [];
                for (const poly of boostedMP) {
                  if (poly.length === 0) continue;
                  infillLines.push(...genPattern(ringToV2(poly[0]), boostedDensity));
                }
                for (const poly of normalMP) {
                  if (poly.length === 0) continue;
                  infillLines.push(...genPattern(ringToV2(poly[0]), effectiveDensity));
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
            const connect = pp.connectInfillLines ?? false;
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
              if (connect && idx > 0 && fromDist < connectTol) {
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
    gcode.push('');
    gcode.push('; ----- End G-code -----');
    const rawEndGCode = this.resolveGCodeTemplate(printer.endGCode, {
      nozzleTemp: mat.nozzleTemp,
      bedTemp: mat.bedTemp,
    });
    const endTemplateHasPrintMacro = /^\s*END_PRINT\b/m.test(rawEndGCode);
    if (!endTemplateHasPrintMacro) {
      gcode.push('M73 P100 ; Print complete');
      gcode.push('M107 ; Fan off');
      if (mat.finalPrintingTemperature !== undefined) {
        gcode.push(`M104 S${mat.finalPrintingTemperature} ; Cooldown nozzle`);
      }
    }
    const endGCode = dedupeEndGCode(rawEndGCode, {
      slicerTurnsFanOff: !endTemplateHasPrintMacro,
      slicerSetsFinalNozzleTemp: !endTemplateHasPrintMacro && mat.finalPrintingTemperature !== undefined,
    });
    if (endGCode) gcode.push(endGCode);

    // ----- Compute statistics -----
    const filamentCrossSection = Math.PI * (printer.filamentDiameter / 2) ** 2;
    const filamentVolumeMm3 = totalExtruded * filamentCrossSection;
    const filamentVolumeCm3 = filamentVolumeMm3 / 1000;
    const filamentWeight = filamentVolumeCm3 * mat.density;
    const filamentCost = (filamentWeight / 1000) * mat.costPerKg;

    // Replace header placeholders
    const estimatedTime = totalTime * (printer.printTimeEstimationFactor ?? 1.0);
    const hours = Math.floor(estimatedTime / 3600);
    const minutes = Math.floor((estimatedTime % 3600) / 60);
    gcode[1] = `; Estimated print time: ${hours}h ${minutes}m`;
    gcode[2] = `; Filament used: ${totalExtruded.toFixed(1)}mm (${filamentWeight.toFixed(1)}g)`;

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
  private weldTriangleVertices(triangles: Triangle[]): void {
    // 1 micrometre grid. Any two vertex positions within 1µm collapse to the
    // same canonical Vector3. Picked well below typical printer resolution
    // (~50µm) so genuine geometry never collapses.
    const GRID = 1e-3; // 1µm in mm
    const canon = new Map<string, THREE.Vector3>();
    const snap = (v: THREE.Vector3): THREE.Vector3 => {
      const kx = Math.round(v.x / GRID);
      const ky = Math.round(v.y / GRID);
      const kz = Math.round(v.z / GRID);
      const key = `${kx},${ky},${kz}`;
      let c = canon.get(key);
      if (!c) {
        c = new THREE.Vector3(kx * GRID, ky * GRID, kz * GRID);
        canon.set(key, c);
      }
      return c;
    };
    // After snapping, each vertex position is deterministic to 1µm, so two
    // triangles that share a mesh edge now expose the same canonical Vector3
    // instances. We also precompute per-triangle edge keys here: the sorted
    // coordinate-string pair of the two endpoints uniquely identifies a mesh
    // edge. These keys let connectSegments chain loops via exact topology.
    const vkey = (v: THREE.Vector3) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    const edgeKey = (a: THREE.Vector3, b: THREE.Vector3): string => {
      const ka = vkey(a);
      const kb = vkey(b);
      return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    };
    for (const t of triangles) {
      t.v0 = snap(t.v0);
      t.v1 = snap(t.v1);
      t.v2 = snap(t.v2);
      t.edgeKey01 = edgeKey(t.v0, t.v1);
      t.edgeKey12 = edgeKey(t.v1, t.v2);
      t.edgeKey20 = edgeKey(t.v2, t.v0);
    }
  }

  private extractTriangles(
    geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
  ): Triangle[] {
    const triangles: Triangle[] = [];

    for (const { geometry, transform } of geometries) {
      const posAttr = geometry.getAttribute('position');
      if (!posAttr) continue;

      const index = geometry.getIndex();

      const getVertex = (idx: number): THREE.Vector3 => {
        return new THREE.Vector3(
          posAttr.getX(idx),
          posAttr.getY(idx),
          posAttr.getZ(idx),
        ).applyMatrix4(transform);
      };

      if (index) {
        for (let i = 0; i < index.count; i += 3) {
          const v0 = getVertex(index.getX(i));
          const v1 = getVertex(index.getX(i + 1));
          const v2 = getVertex(index.getX(i + 2));
          const edge1 = new THREE.Vector3().subVectors(v1, v0);
          const edge2 = new THREE.Vector3().subVectors(v2, v0);
          const cross = new THREE.Vector3().crossVectors(edge1, edge2);
          // Skip degenerate triangles (collinear vertices → zero-length normal
          // which would produce NaN after normalize()).
          if (cross.lengthSq() < 1e-12) continue;
          const normal = cross.normalize();
          triangles.push({ v0, v1, v2, normal, edgeKey01: '', edgeKey12: '', edgeKey20: '' });
        }
      } else {
        for (let i = 0; i < posAttr.count; i += 3) {
          const v0 = getVertex(i);
          const v1 = getVertex(i + 1);
          const v2 = getVertex(i + 2);
          const edge1 = new THREE.Vector3().subVectors(v1, v0);
          const edge2 = new THREE.Vector3().subVectors(v2, v0);
          const cross = new THREE.Vector3().crossVectors(edge1, edge2);
          if (cross.lengthSq() < 1e-12) continue;
          const normal = cross.normalize();
          triangles.push({ v0, v1, v2, normal, edgeKey01: '', edgeKey12: '', edgeKey20: '' });
        }
      }
    }

    this.weldTriangleVertices(triangles);
    this.repairTriangleNormals(triangles);
    return triangles;
  }

  /**
   * Propagate consistent winding order across the mesh so every triangle's
   * normal points OUTWARD. CAD/sculpting exports sometimes produce meshes
   * with mixed or fully-inverted normals; our polygon-clipping ops are
   * winding-agnostic (Clipper normalises), but overhang detection, support
   * generation, bridge detection, and the adaptive layer-height penalty
   * all read `tri.normal.z` directly and break silently on inverted
   * meshes — "my supports won't generate" bugs trace back here.
   *
   * Algorithm (admesh `stl_fix_normal_directions` in spirit):
   *   1. Build edge → neighbour-triangle adjacency using the canonical
   *      Vector3 instances left by weldTriangleVertices.
   *   2. BFS from each unvisited seed. A consistent manifold traverses any
   *      shared edge in OPPOSITE directions on either side; a neighbour
   *      that traverses it in the SAME direction gets its winding swapped
   *      and its normal negated.
   *   3. After BFS, the topmost triangle's normal.z tells us whether the
   *      component settled outward or inside-out. If inverted, flip every
   *      triangle in one pass.
   */
  private repairTriangleNormals(triangles: Triangle[]): void {
    if (triangles.length === 0) return;

    const vkey = (v: THREE.Vector3) => `${v.x},${v.y},${v.z}`;
    type EdgeRef = { tri: number; dir: 1 | -1 };
    const edgeMap = new Map<string, EdgeRef[]>();
    const edgeKey = (a: THREE.Vector3, b: THREE.Vector3): { key: string; dir: 1 | -1 } => {
      const ka = vkey(a); const kb = vkey(b);
      if (ka < kb) return { key: `${ka}|${kb}`, dir: 1 };
      return { key: `${kb}|${ka}`, dir: -1 };
    };
    const addEdge = (a: THREE.Vector3, b: THREE.Vector3, triIdx: number) => {
      const { key, dir } = edgeKey(a, b);
      let list = edgeMap.get(key);
      if (!list) { list = []; edgeMap.set(key, list); }
      list.push({ tri: triIdx, dir });
    };
    for (let i = 0; i < triangles.length; i++) {
      const t = triangles[i];
      addEdge(t.v0, t.v1, i);
      addEdge(t.v1, t.v2, i);
      addEdge(t.v2, t.v0, i);
    }

    const visited = new Uint8Array(triangles.length);
    const flip = (ti: number) => {
      const t = triangles[ti];
      const tmp = t.v1; t.v1 = t.v2; t.v2 = tmp;
      t.normal.multiplyScalar(-1);
      // Update this triangle's entries in the edge map to reflect its new
      // vertex order — otherwise subsequent neighbours see stale dirs.
      const newEdges: Array<[THREE.Vector3, THREE.Vector3]> = [
        [t.v0, t.v1], [t.v1, t.v2], [t.v2, t.v0],
      ];
      for (const [a, b] of newEdges) {
        const { key, dir } = edgeKey(a, b);
        const list = edgeMap.get(key);
        if (!list) continue;
        for (const e of list) if (e.tri === ti) e.dir = dir;
      }
    };

    for (let seed = 0; seed < triangles.length; seed++) {
      if (visited[seed]) continue;
      visited[seed] = 1;
      const queue: number[] = [seed];
      while (queue.length > 0) {
        const curIdx = queue.shift()!;
        const cur = triangles[curIdx];
        const edges: Array<[THREE.Vector3, THREE.Vector3]> = [
          [cur.v0, cur.v1], [cur.v1, cur.v2], [cur.v2, cur.v0],
        ];
        for (const [a, b] of edges) {
          const { key, dir: curDir } = edgeKey(a, b);
          const list = edgeMap.get(key);
          if (!list) continue;
          for (const c of list) {
            if (c.tri === curIdx) continue;
            if (visited[c.tri]) continue;
            if (c.dir === curDir) flip(c.tri); // same dir → inconsistent
            visited[c.tri] = 1;
            queue.push(c.tri);
          }
        }
      }
    }

    // Global orientation check. The triangle with the highest centroid Z
    // must face upward (normal.z > 0) on a correctly-oriented mesh. If it's
    // below, the whole component settled inside-out — flip everything.
    let topIdx = 0;
    let topZ = -Infinity;
    for (let i = 0; i < triangles.length; i++) {
      const cz = (triangles[i].v0.z + triangles[i].v1.z + triangles[i].v2.z) / 3;
      if (cz > topZ) { topZ = cz; topIdx = i; }
    }
    if (triangles[topIdx].normal.z < 0) {
      for (let i = 0; i < triangles.length; i++) flip(i);
    }
  }

  private computeBBox(triangles: Triangle[]): THREE.Box3 {
    const box = new THREE.Box3();
    for (const tri of triangles) {
      box.expandByPoint(tri.v0);
      box.expandByPoint(tri.v1);
      box.expandByPoint(tri.v2);
    }
    return box;
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
    const segments: Segment[] = [];

    for (const tri of triangles) {
      const pts = this.trianglePlaneIntersection(tri, z);
      if (pts) {
        segments.push({
          a: new THREE.Vector2(pts[0].pt.x + offsetX, pts[0].pt.y + offsetY),
          b: new THREE.Vector2(pts[1].pt.x + offsetX, pts[1].pt.y + offsetY),
          edgeKeyA: pts[0].edgeKey,
          edgeKeyB: pts[1].edgeKey,
        });
      }
    }

    return segments;
  }

  private trianglePlaneIntersection(
    tri: Triangle,
    z: number,
  ): [{ pt: THREE.Vector3; edgeKey: string }, { pt: THREE.Vector3; edgeKey: string }] | null {
    // Perturb vertices that lie exactly on the slice plane slightly above it.
    // This is the Cura/Orca robustness trick: without it, a triangle whose
    // edge sits coplanar with Z and whose third vertex is below the plane
    // produces NO intersection segment, and entire horizontal faces
    // (gussets, flat-topped features) silently vanish from the slice. By
    // nudging on-plane vertices up by a sub-micron epsilon we guarantee
    // every triangle reports the correct [0 or 2] straddling edges.
    const EPS = 1e-7;
    const { v0, v1, v2 } = tri;
    const z0 = v0.z === z ? z + EPS : v0.z;
    const z1 = v1.z === z ? z + EPS : v1.z;
    const z2 = v2.z === z ? z + EPS : v2.z;

    const hits: Array<{ pt: THREE.Vector3; edgeKey: string }> = [];
    const edges: Array<[THREE.Vector3, number, THREE.Vector3, number, string]> = [
      [v0, z0, v1, z1, tri.edgeKey01],
      [v1, z1, v2, z2, tri.edgeKey12],
      [v2, z2, v0, z0, tri.edgeKey20],
    ];

    for (const [a, az, b, bz, key] of edges) {
      if ((az < z && bz > z) || (bz < z && az > z)) {
        const t = (z - az) / (bz - az);
        hits.push({
          pt: new THREE.Vector3(
            a.x + t * (b.x - a.x),
            a.y + t * (b.y - a.y),
            z,
          ),
          edgeKey: key,
        });
      }
    }

    if (hits.length >= 2) return [hits[0], hits[1]];
    return null;
  }

  // =========================================================================
  // CONTOUR PROCESSING
  // =========================================================================

  private connectSegments(segments: Segment[]): THREE.Vector2[][] {
    if (segments.length === 0) return [];

    // Two-tier chain building:
    //
    //   1. EDGE-KEY INDEX (exact, topological). Each intersection point knows
    //      which mesh edge produced it — adjacent triangles that share a mesh
    //      edge produce TWO segments whose endpoints carry the same edgeKey.
    //      Looking up by that key chains exact neighbours, no float fuzz.
    //
    //   2. POSITIONAL GRID (fallback, fuzzy). For endpoints whose edgeKey is
    //      missing (shouldn't happen after the perturbation fix, but kept for
    //      safety) or whose exact-key neighbour was already consumed in a
    //      different loop, we fall back to the old 0.01mm quantised hash.
    //
    // Mirrors OrcaSlicer's chain_lines_by_triangle_connectivity (edge-id pass)
    // followed by chain_open_polylines_by_position (positional pass).

    // Edge-key index: edgeKey → list of endpoint refs carrying that key.
    const byEdge = new Map<string, Array<{ idx: number; isA: boolean }>>();
    const addEdgeRef = (key: string, idx: number, isA: boolean) => {
      if (!key) return;
      let list = byEdge.get(key);
      if (!list) { list = []; byEdge.set(key, list); }
      list.push({ idx, isA });
    };

    // Positional fallback grid.
    const GRID = 0.01;
    const posKey = (p: THREE.Vector2) =>
      `${Math.round(p.x / GRID)},${Math.round(p.y / GRID)}`;
    const byPos = new Map<string, Array<{ idx: number; isA: boolean }>>();
    const addPosRef = (p: THREE.Vector2, idx: number, isA: boolean) => {
      const k = posKey(p);
      let list = byPos.get(k);
      if (!list) { list = []; byPos.set(k, list); }
      list.push({ idx, isA });
    };

    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      addEdgeRef(s.edgeKeyA, i, true);
      addEdgeRef(s.edgeKeyB, i, false);
      addPosRef(s.a, i, true);
      addPosRef(s.b, i, false);
    }

    const used = new Uint8Array(segments.length);

    // Find the next-segment candidate for an endpoint currently at the tail.
    // Prefers exact edge-key match; falls back to positional hash.
    const findNext = (endpointEdgeKey: string, endpointPos: THREE.Vector2): { idx: number; isA: boolean } | null => {
      if (endpointEdgeKey) {
        const list = byEdge.get(endpointEdgeKey);
        if (list) {
          for (const cand of list) {
            if (!used[cand.idx]) return cand;
          }
        }
      }
      const plist = byPos.get(posKey(endpointPos));
      if (plist) {
        for (const cand of plist) {
          if (!used[cand.idx]) return cand;
        }
      }
      return null;
    };

    const contours: THREE.Vector2[][] = [];

    for (let i = 0; i < segments.length; i++) {
      if (used[i]) continue;

      const s0 = segments[i];
      const contour: THREE.Vector2[] = [s0.a.clone(), s0.b.clone()];
      used[i] = 1;
      // After consuming segment i, the "tail" is at endpoint b — which came
      // from mesh-edge edgeKeyB, so the next segment must carry that key too.
      let tailEdgeKey = s0.edgeKeyB;
      let tailPos = s0.b;

      // Cap loop length to avoid runaway on pathological geometry.
      let guard = segments.length + 4;
      while (guard-- > 0) {
        const next = findNext(tailEdgeKey, tailPos);
        if (!next) break;
        used[next.idx] = 1;
        const seg = segments[next.idx];
        // If we matched via the `a` endpoint, the segment's OTHER end is `b`.
        const otherPt = next.isA ? seg.b : seg.a;
        const otherEdgeKey = next.isA ? seg.edgeKeyB : seg.edgeKeyA;
        contour.push(otherPt.clone());
        tailPos = otherPt;
        tailEdgeKey = otherEdgeKey;
      }

      if (contour.length >= 3) contours.push(contour);
    }

    return contours;
  }

  private classifyContours(rawContours: THREE.Vector2[][]): Contour[] {
    return rawContours.map((points) => {
      const area = this.signedArea(points);
      return {
        points,
        area,
        isOuter: area >= 0, // CCW = outer, CW = hole
      };
    });
  }

  private signedArea(points: THREE.Vector2[]): number {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return area / 2;
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
    const minH = Math.max(0.04, baseLayerHeight - maxVariation);
    const maxH = Math.max(minH + 0.01, baseLayerHeight + maxVariation);

    // Model Z range (we offset triangles to start at 0 via offsetZ at slice
    // time, but triangles here still carry their raw Z). Compute a baseline
    // min so binning is relative.
    let modelMinZ = Infinity;
    for (const tri of triangles) {
      const z = Math.min(tri.v0.z, tri.v1.z, tri.v2.z);
      if (z < modelMinZ) modelMinZ = z;
    }
    if (!isFinite(modelMinZ)) modelMinZ = 0;

    // Bin the Z range into fine slots so we have enough resolution to
    // represent the thinnest possible layer.
    const binSize = Math.max(0.025, minH / 2);
    const numBins = Math.max(1, Math.ceil(modelHeight / binSize) + 2);

    // `penalty` is a non-monotonic function of the triangle's normal.z that
    // peaks at ~45° slopes (nz ≈ 0.707) and falls to 0 at both extremes:
    //   • |nz| = 1 (horizontal top/bottom) — surface IS the layer, no
    //     staircase, no benefit from thin layers → penalty 0.
    //   • |nz| = 0 (vertical wall) — perfectly resolved at ANY layer height,
    //     staircase error is strictly zero → penalty 0.
    //   • |nz| ≈ 0.707 (45° slope) — horizontal staircase step == layer
    //     height, most visible aliasing → penalty 1.
    // Per-bin we take the MAXIMUM penalty of any triangle touching the bin
    // (the thinnest layer required to satisfy the WORST surface detail).
    const maxPenalty = new Float32Array(numBins); // default 0

    for (const tri of triangles) {
      const nz = Math.abs(tri.normal.z);
      // 2·|nz|·√(1-nz²) peaks at 1.0 when nz = √½, and is 0 at nz=0 or nz=1.
      const penalty = 2 * nz * Math.sqrt(Math.max(0, 1 - nz * nz));
      if (penalty <= 0) continue;
      const zMinT = Math.min(tri.v0.z, tri.v1.z, tri.v2.z) - modelMinZ;
      const zMaxT = Math.max(tri.v0.z, tri.v1.z, tri.v2.z) - modelMinZ;
      const bStart = Math.max(0, Math.floor(zMinT / binSize));
      const bEnd = Math.min(numBins - 1, Math.ceil(zMaxT / binSize));
      for (let b = bStart; b <= bEnd; b++) {
        if (penalty > maxPenalty[b]) maxPenalty[b] = penalty;
      }
    }

    // Convert penalty → layer height. 0 penalty = maxH (coarse), 1 penalty =
    // minH (fine). Linear blend.
    const idealH = new Float32Array(numBins);
    for (let b = 0; b < numBins; b++) {
      idealH[b] = maxH - (maxH - minH) * Math.min(1, maxPenalty[b]);
    }

    // Smooth: neighbouring bins cannot differ by more than variationStep.
    // Two passes (forward then backward) propagate the min constraint.
    for (let b = 1; b < numBins; b++) {
      if (idealH[b] > idealH[b - 1] + variationStep) {
        idealH[b] = idealH[b - 1] + variationStep;
      }
    }
    for (let b = numBins - 2; b >= 0; b--) {
      if (idealH[b] > idealH[b + 1] + variationStep) {
        idealH[b] = idealH[b + 1] + variationStep;
      }
    }

    // Walk up, stepping by the local ideal height. The first layer is always
    // printed at `firstLayerHeight` — adhesion depends on this and we don't
    // want adaptive to shrink it.
    const layerZs: number[] = [];
    let z = firstLayerHeight;
    layerZs.push(z * zScale);
    while (z < modelHeight - 1e-4) {
      const bin = Math.min(numBins - 1, Math.max(0, Math.floor(z / binSize)));
      const h = Math.max(minH, Math.min(maxH, idealH[bin]));
      z = Math.min(modelHeight, z + h);
      layerZs.push(z * zScale);
    }
    return layerZs;
  }

  /**
   * Cura/Orca-parity closing-radius ("slicing closing radius") gap-sealer.
   * Grows every contour boundary outward into the material by `r`, unions all
   * grown regions, then shrinks back by the same amount. This seals tiny
   * near-coincident gaps without materially changing larger features.
   */
  private closeContourGaps(contours: Contour[], r: number): Contour[] {
    if (r <= 0 || contours.length === 0) return contours;

    const toRing = (pts: THREE.Vector2[]): PCRing => {
      const ring: PCRing = pts.map((p) => [p.x, p.y] as [number, number]);
      if (ring.length > 0) {
        const f = ring[0];
        const l = ring[ring.length - 1];
        if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
      }
      return ring;
    };
    const fromRing = (ring: PCRing): THREE.Vector2[] => {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < ring.length - 1; i++) {
        pts.push(new THREE.Vector2(ring[i][0], ring[i][1]));
      }
      return pts;
    };

    const inflated: PCMultiPolygon = [];
    for (const c of contours) {
      const grown = this.offsetContour(c.points, c.isOuter ? -r : +r);
      if (grown.length >= 3) inflated.push([toRing(grown)]);
    }
    if (inflated.length === 0) return contours;

    let unioned: PCMultiPolygon;
    try {
      unioned = inflated.length === 1
        ? inflated
        : polygonClipping.union(inflated[0], ...inflated.slice(1));
    } catch {
      return contours;
    }
    if (unioned.length === 0) return contours;

    const result: Contour[] = [];
    for (const poly of unioned) {
      for (let i = 0; i < poly.length; i++) {
        const isOuter = i === 0;
        const ringPts = fromRing(poly[i]);
        const shrunk = this.offsetContour(ringPts, isOuter ? +r : -r);
        if (shrunk.length >= 3) {
          result.push({
            points: shrunk,
            area: this.signedArea(shrunk),
            isOuter,
          });
        }
      }
    }
    return result.length > 0 ? result : contours;
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
    if (minOdd <= 0) return p;
    const keep: boolean[] = p.walls.map((w) => {
      if (w.length < 3) return false;
      let miX = Infinity, maX = -Infinity, miY = Infinity, maY = -Infinity;
      for (const pt of w) {
        if (pt.x < miX) miX = pt.x; if (pt.x > maX) maX = pt.x;
        if (pt.y < miY) miY = pt.y; if (pt.y > maY) maY = pt.y;
      }
      return Math.min(maX - miX, maY - miY) >= 2 * minOdd;
    });
    const walls: THREE.Vector2[][] = [];
    const lineWidths: number[] = [];
    let outerCount = 0;
    for (let i = 0; i < p.walls.length; i++) {
      if (!keep[i]) continue;
      walls.push(p.walls[i]);
      lineWidths.push(p.lineWidths[i] ?? this.printProfile.wallLineWidth);
      if (i < p.outerCount) outerCount++;
    }
    return { walls, lineWidths, outerCount, innermostHoles: p.innermostHoles };
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

    const toRing = (pts: THREE.Vector2[]): PCRing => {
      const ring: PCRing = pts.map((p) => [p.x, p.y] as [number, number]);
      if (ring.length > 0) {
        const f = ring[0];
        const l = ring[ring.length - 1];
        if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
      }
      return ring;
    };
    const fromRing = (ring: PCRing): THREE.Vector2[] => {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < ring.length - 1; i++) {
        pts.push(new THREE.Vector2(ring[i][0], ring[i][1]));
      }
      return pts;
    };

    const computeDepth = (offset: number): {
      result: PCMultiPolygon;
      holesAtDepth: THREE.Vector2[][];
    } | null => {
      const outerShrunk = this.offsetContour(outerContour, offset);
      if (outerShrunk.length < 3) return null;

      const holesExpanded = holeContours
        .map((h) => this.offsetContour(h, offset))
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

    for (let w = 0; w < wallCount; w++) {
      const nominalOffset = w * lineWidth + lineWidth / 2 + (w === 0 ? outerWallInset : 0);
      const nominalDepth = computeDepth(nominalOffset);
      if (!nominalDepth) break;

      let result = nominalDepth.result;
      let thisDepthHoles = nominalDepth.holesAtDepth;
      let depthLineWidth = lineWidth;

      const nextOffset = (w + 1) * lineWidth + lineWidth / 2 + (w === 0 ? outerWallInset : 0);
      const nextDepth = computeDepth(nextOffset);

      if ((this.printProfile.thinWallDetection ?? false) && nextDepth === null) {
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
          this.printProfile.minWallLineWidth ?? lineWidth * 0.5,
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
    }

    return {
      walls: [...outerLoops, ...holeLoops],
      lineWidths: [...outerLineWidths, ...holeLineWidths],
      outerCount: outerLoops.length,
      innermostHoles: lastInnermostHoles,
    };
  }

  private offsetContour(contour: THREE.Vector2[], offset: number): THREE.Vector2[] {
    if (contour.length < 3) return [];

    const n = contour.length;
    const result: THREE.Vector2[] = [];

    // Build offset edges
    const offsetEdges: { a: THREE.Vector2; b: THREE.Vector2 }[] = [];
    for (let i = 0; i < n; i++) {
      const curr = contour[i];
      const next = contour[(i + 1) % n];
      const dx = next.x - curr.x;
      const dy = next.y - curr.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-8) continue;

      // Normal pointing inward (left side for CCW polygon)
      const nx = -dy / len;
      const ny = dx / len;

      offsetEdges.push({
        a: new THREE.Vector2(curr.x + nx * offset, curr.y + ny * offset),
        b: new THREE.Vector2(next.x + nx * offset, next.y + ny * offset),
      });
    }

    if (offsetEdges.length < 3) return [];

    // Compute intersection of consecutive offset edges.
    // At very acute/reflex vertices the intersection can be arbitrarily far
    // away — clamp it so degenerate points don't produce spike lines in the
    // preview or brim/skin geometry.
    const maxReach = Math.abs(offset) * 10 + 1; // generous but finite
    for (let i = 0; i < offsetEdges.length; i++) {
      const e1 = offsetEdges[i];
      const e2 = offsetEdges[(i + 1) % offsetEdges.length];

      const refPt = e1.b; // original vertex after offset
      const pt = this.lineLineIntersection2D(e1.a, e1.b, e2.a, e2.b);
      if (pt && pt.distanceTo(refPt) <= maxReach) {
        result.push(pt);
      } else {
        // Parallel edges or degenerate intersection — use midpoint fallback
        result.push(
          new THREE.Vector2(
            (e1.b.x + e2.a.x) / 2,
            (e1.b.y + e2.a.y) / 2,
          ),
        );
      }
    }

    // Remove self-intersections with a simple check
    return this.cleanOffsetContour(result);
  }

  private cleanOffsetContour(contour: THREE.Vector2[]): THREE.Vector2[] {
    // Simple self-intersection removal: if the offset contour has any segment
    // that crosses another, clip the loop. This is a simplified approach.
    if (contour.length < 3) return contour;

    const n = contour.length;
    // Check for degenerate triangles and remove duplicate points
    const cleaned: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) {
      const curr = contour[i];
      const prev = cleaned.length > 0 ? cleaned[cleaned.length - 1] : contour[n - 1];
      if (curr.distanceTo(prev) > 0.001) {
        cleaned.push(curr);
      }
    }

    // Check if area sign flipped (contour collapsed)
    const originalArea = this.signedArea(cleaned);
    if (Math.abs(originalArea) < 0.1) return []; // collapsed

    return cleaned;
  }

  private lineLineIntersection2D(
    p1: THREE.Vector2,
    p2: THREE.Vector2,
    p3: THREE.Vector2,
    p4: THREE.Vector2,
  ): THREE.Vector2 | null {
    const d1x = p2.x - p1.x;
    const d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x;
    const d2y = p4.y - p3.y;

    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-10) return null;

    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;

    return new THREE.Vector2(p1.x + t * d1x, p1.y + t * d1y);
  }

  // =========================================================================
  // Z-SEAM
  // =========================================================================

  private findSeamPosition(
    contour: THREE.Vector2[],
    pp: PrintProfile,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _layerIndex: number,
  ): number {
    if (contour.length === 0) return 0;

    // Cura-parity mapping: `zSeamPosition` (Cura's union) takes precedence
    // over our legacy `zSeamAlignment` when set. Both feed this switch.
    // User-specified / back / random / sharpest_corner / shortest all share
    // handling here; aligned maps to 'back' semantics for backward compat.
    const mode: string = pp.zSeamPosition ?? pp.zSeamAlignment ?? 'shortest';

    switch (mode) {
      case 'random':
        return Math.floor(Math.random() * contour.length);

      case 'aligned':
      case 'back':
        // Start from the point closest to (midX, maxY) — the back of the part.
        return this.closestPointIndex(contour, new THREE.Vector2(0, 1e6));

      case 'user_specified': {
        // zSeamX/Y define the target point. `zSeamRelative` means the
        // coordinates are relative to the contour centroid; otherwise they're
        // absolute (in the slicer's bed-centered coordinate space).
        const tx = pp.zSeamX ?? 0;
        const ty = pp.zSeamY ?? 0;
        let cx = 0, cy = 0;
        if (pp.zSeamRelative) {
          for (const p of contour) { cx += p.x; cy += p.y; }
          cx /= contour.length;
          cy /= contour.length;
        }
        return this.closestPointIndex(contour, new THREE.Vector2(cx + tx, cy + ty));
      }

      case 'sharpest_corner': {
        // Find the point with the sharpest angle, biased by corner preference.
        //   hide_seam      — concave corners only (seam tucked inside)
        //   expose_seam    — convex corners only (seam clearly visible)
        //   hide_or_expose — either, pick sharpest overall
        //   smart_hide     — prefer concave; fall back to sharpest-overall
        //                    when no concave corner exists
        //   none (default) — any corner, unchanged legacy behavior
        const pref = pp.seamCornerPreference ?? 'none';
        let sharpestIdx = 0;
        let sharpestAngle = Math.PI * 2;
        let sharpestConcaveIdx = -1;
        let sharpestConcaveAngle = Math.PI * 2;
        let sharpestConvexIdx = -1;
        let sharpestConvexAngle = Math.PI * 2;
        const n = contour.length;
        for (let i = 0; i < n; i++) {
          const prev = contour[(i - 1 + n) % n];
          const curr = contour[i];
          const next = contour[(i + 1) % n];
          const v1 = new THREE.Vector2().subVectors(prev, curr).normalize();
          const v2 = new THREE.Vector2().subVectors(next, curr).normalize();
          const angle = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
          // 2D cross product sign distinguishes convex/concave for CCW polys:
          // cross > 0 → convex (outward); cross < 0 → concave (inward).
          const cross = v1.x * v2.y - v1.y * v2.x;
          if (angle < sharpestAngle) {
            sharpestAngle = angle;
            sharpestIdx = i;
          }
          if (cross < 0 && angle < sharpestConcaveAngle) {
            sharpestConcaveAngle = angle;
            sharpestConcaveIdx = i;
          }
          if (cross > 0 && angle < sharpestConvexAngle) {
            sharpestConvexAngle = angle;
            sharpestConvexIdx = i;
          }
        }
        if (pref === 'hide_seam' && sharpestConcaveIdx >= 0)   return sharpestConcaveIdx;
        if (pref === 'expose_seam' && sharpestConvexIdx >= 0)  return sharpestConvexIdx;
        if (pref === 'smart_hide' && sharpestConcaveIdx >= 0)  return sharpestConcaveIdx;
        return sharpestIdx;
      }

      case 'shortest':
      default:
        return 0;
    }
  }

  private closestPointIndex(contour: THREE.Vector2[], target: THREE.Vector2): number {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < contour.length; i++) {
      const d = contour[i].distanceTo(target);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  private reorderFromIndex(contour: THREE.Vector2[], startIdx: number): THREE.Vector2[] {
    const n = contour.length;
    const result: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) {
      result.push(contour[(startIdx + i) % n]);
    }
    return result;
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
    if (contour.length < 3 || density <= 0) return [];

    // Cura-parity: randomize infill start position per layer to reduce
    // resonance artifacts and improve inter-layer bonding randomness.
    const spacing = lineWidth / (density / 100);
    const phase = this.printProfile.randomInfillStart
      ? Math.abs(Math.sin(layerIndex * 127.1 + 43.7)) * spacing
      : 0;

    switch (pattern) {
      case 'grid': {
        const gridAngle = layerIndex % 2 === 0 ? 0 : Math.PI / 4;
        return [
          ...this.generateScanLines(contour, density, lineWidth, gridAngle, phase, holes),
          ...this.generateScanLines(contour, density, lineWidth, gridAngle + Math.PI / 2, phase, holes),
        ];
      }
      case 'lines':
        return this.generateScanLines(
          contour,
          density,
          lineWidth,
          layerIndex % 2 === 0 ? Math.PI / 4 : -Math.PI / 4,
          phase,
          holes,
        );
      case 'triangles': {
        const triAngle = ((layerIndex % 3) * Math.PI) / 3;
        return [
          ...this.generateScanLines(contour, density, lineWidth, triAngle, phase, holes),
          ...this.generateScanLines(contour, density, lineWidth, triAngle + Math.PI / 3, phase, holes),
          ...this.generateScanLines(contour, density, lineWidth, triAngle + (2 * Math.PI) / 3, phase, holes),
        ];
      }
      case 'gyroid':
        return this.generateGyroidInfill(contour, density, lineWidth, layerIndex, holes);
      case 'honeycomb':
        return this.generateHoneycombInfill(contour, density, lineWidth, layerIndex, holes);
      case 'concentric':
        return this.generateConcentricInfill(contour, lineWidth, holes);
      case 'cubic':
        return this.generateCubicInfill(contour, density, lineWidth, layerIndex, holes);
      case 'lightning': {
        // Lightning infill is complex tree-based; approximate with sparse lines.
        // Cura-parity: `lightningPruneAngle` and `lightningStraighteningAngle`
        // control how aggressively the tree prunes side-branches and how
        // straight branches stay. In our sparse-line approximation, both
        // effectively shift how sparse the lines get — higher prune angle
        // (more aggressive pruning) means even fewer lines. We scale the
        // density inversely to the prune angle so users still feel the knob.
        // `lightningInfillOverhangAngle` (separate from support angle) gates
        // which triangles contribute to the lightning base — here it adjusts
        // the effective density the same way the overhang angle narrows coverage.
        const lightningOverhangAngle = (this.printProfile.lightningInfillOverhangAngle ?? 40) / 90;
        const prune = this.printProfile.lightningPruneAngle ?? 40;
        const straight = this.printProfile.lightningStraighteningAngle ?? 40;
        // Avg the two; they're both 0-89° in meaningful range. Higher = thinner.
        const sparsity = 1 - ((prune + straight) / 180); // 0..1
        // lightningOverhangAngle scales density: higher angle (less aggressive) = denser
        const lightDensity = Math.max(density * 0.5 * Math.max(0.2, sparsity) * Math.max(0.2, lightningOverhangAngle), 2);
        return this.generateScanLines(
          contour,
          lightDensity,
          lineWidth,
          layerIndex % 3 === 0 ? 0 : layerIndex % 3 === 1 ? Math.PI / 3 : (2 * Math.PI) / 3,
        );
      }
      case 'zigzag':
        return this.generateZigzagLines(contour, density, lineWidth, layerIndex);
      default:
        return this.generateScanLines(contour, density, lineWidth, layerIndex % 2 === 0 ? 0 : Math.PI / 2);
    }
  }

  private generateScanLines(
    contour: THREE.Vector2[],
    density: number,
    lineWidth: number,
    angle: number,
    phaseOffset = 0,
    holes: THREE.Vector2[][] = [],
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    const results: { from: THREE.Vector2; to: THREE.Vector2 }[] = [];
    const bbox = this.contourBBox(contour);
    const spacing = lineWidth / (density / 100);

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const maxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * 1.5;
    // Cura-parity: infill X/Y offset shifts the entire pattern origin. This
    // lets users align infill seams across adjacent parts or to a grid of
    // their choosing. Zero offset is the default — original behavior unchanged.
    const offX = this.printProfile.infillXOffset ?? 0;
    const offY = this.printProfile.infillYOffset ?? 0;
    const centerX = (bbox.minX + bbox.maxX) / 2 + offX;
    const centerY = (bbox.minY + bbox.maxY) / 2 + offY;

    // Defensive: spacing must be a positive finite number. If it's NaN/0/-0,
    // the loop below would either run zero times or spin forever. Zero-
    // density was already short-circuited up-callers but an explicit guard
    // here protects this hot path regardless.
    if (!(spacing > 0) || !isFinite(spacing)) return results;
    // Belt-and-suspenders iteration cap. Even on absurd bboxes a scan-line
    // pass shouldn't emit more than a few thousand lines; 50k is well past
    // any legitimate case.
    const MAX_SCAN_LINES = 50000;
    let scanCount = 0;

    const start = -maxDim / 2 + (phaseOffset % spacing);
    for (let d = start; d <= maxDim / 2 + (phaseOffset % spacing); d += spacing) {
      if (++scanCount > MAX_SCAN_LINES) break;
      // Rotated scan line endpoints
      const p1 = new THREE.Vector2(
        centerX + cos * (-maxDim) - sin * d,
        centerY + sin * (-maxDim) + cos * d,
      );
      const p2 = new THREE.Vector2(
        centerX + cos * maxDim - sin * d,
        centerY + sin * maxDim + cos * d,
      );

      // Find intersections with the outer contour AND every hole. Pairing
      // intersections even/odd across this combined sorted list gives correct
      // "inside material, outside material, inside..." segmentation for
      // ExPolygons: a scan line entering the outer then crossing a hole
      // exits material when it enters the hole and re-enters on the far side.
      const intersections = this.lineContourIntersections(p1, p2, contour);
      for (const h of holes) {
        if (h.length < 3) continue;
        const hi = this.lineContourIntersections(p1, p2, h);
        for (const t of hi) intersections.push(t);
      }
      intersections.sort((a, b) => a - b);

      // Precompute direction once per scan line — avoids allocating 4 Vector2
      // objects per intersection pair on complex infill (measurable ~5-10%
      // slice-time reduction on dense gyroids).
      const dirX = p2.x - p1.x;
      const dirY = p2.y - p1.y;

      // Pair intersections into segments
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const t1 = intersections[i];
        const t2 = intersections[i + 1];
        const start = new THREE.Vector2(p1.x + dirX * t1, p1.y + dirY * t1);
        const end   = new THREE.Vector2(p1.x + dirX * t2, p1.y + dirY * t2);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        if (dx * dx + dy * dy > 0.01) {
          results.push({ from: start, to: end });
        }
      }
    }

    return results;
  }

  private generateGyroidInfill(
    contour: THREE.Vector2[],
    density: number,
    lineWidth: number,
    layerIndex: number,
    holes: THREE.Vector2[][] = [],
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    // Approximate gyroid with sinusoidal scan lines
    const results: { from: THREE.Vector2; to: THREE.Vector2 }[] = [];
    const bbox = this.contourBBox(contour);
    const spacing = lineWidth / (density / 100);
    const amplitude = spacing * 0.4;
    const period = spacing * 2;

    const phaseShift = (layerIndex * Math.PI) / 3;

    // A point is inside the printable region when it's inside the outer
    // contour AND outside every hole. Used to clip every sampled gyroid
    // sub-segment so curves never cross cavities.
    const inMaterial = (p: THREE.Vector2): boolean => {
      if (!this.pointInContour(p, contour)) return false;
      for (const h of holes) {
        if (h.length >= 3 && this.pointInContour(p, h)) return false;
      }
      return true;
    };

    for (let y = bbox.minY; y <= bbox.maxY; y += spacing) {
      const linePoints: THREE.Vector2[] = [];
      // Guard against degenerate (single-X-coordinate) bbox slices — without
      // this, steps=0 and `s/steps = 0/0 = NaN` corrupts the infill polyline.
      const steps = Math.max(1, Math.ceil((bbox.maxX - bbox.minX) / 0.5));
      for (let s = 0; s <= steps; s++) {
        const x = bbox.minX + (s / steps) * (bbox.maxX - bbox.minX);
        const yOff = y + amplitude * Math.sin((2 * Math.PI * x) / period + phaseShift);
        linePoints.push(new THREE.Vector2(x, yOff));
      }

      // Clip to contour + holes
      for (let i = 0; i + 1 < linePoints.length; i++) {
        const a = linePoints[i];
        const b = linePoints[i + 1];
        if (inMaterial(a) && inMaterial(b)) {
          results.push({ from: a, to: b });
        }
      }
    }

    return results;
  }

  private generateHoneycombInfill(
    contour: THREE.Vector2[],
    density: number,
    lineWidth: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _layerIndex: number,
    holes: THREE.Vector2[][] = [],
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    // Hexagonal pattern: rows of zigzag offset every other row
    const results: { from: THREE.Vector2; to: THREE.Vector2 }[] = [];
    const bbox = this.contourBBox(contour);
    const spacing = lineWidth / (density / 100);
    const hexHeight = spacing * Math.sqrt(3);
    const hexWidth = spacing * 2;

    const inMaterial = (p: THREE.Vector2): boolean => {
      if (!this.pointInContour(p, contour)) return false;
      for (const h of holes) {
        if (h.length >= 3 && this.pointInContour(p, h)) return false;
      }
      return true;
    };

    for (let row = bbox.minY - hexHeight; row <= bbox.maxY + hexHeight; row += hexHeight) {
      const isOddRow = Math.round((row - bbox.minY) / hexHeight) % 2 !== 0;
      const xOffset = isOddRow ? hexWidth * 0.5 : 0;

      for (let col = bbox.minX - hexWidth + xOffset; col <= bbox.maxX + hexWidth; col += hexWidth) {
        // Hexagon vertices (6 sides)
        const cx = col;
        const cy = row;
        const hexPts: THREE.Vector2[] = [];
        for (let a = 0; a < 6; a++) {
          const angle = (Math.PI / 3) * a + Math.PI / 6;
          hexPts.push(
            new THREE.Vector2(
              cx + spacing * Math.cos(angle),
              cy + spacing * Math.sin(angle),
            ),
          );
        }

        // Draw hex edges clipped to material (contour minus holes)
        for (let i = 0; i < hexPts.length; i++) {
          const from = hexPts[i];
          const to = hexPts[(i + 1) % hexPts.length];
          if (inMaterial(from) && inMaterial(to)) {
            results.push({ from, to });
          }
        }
      }
    }

    return results;
  }

  private generateConcentricInfill(
    contour: THREE.Vector2[],
    lineWidth: number,
    holes: THREE.Vector2[][] = [],
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    const results: { from: THREE.Vector2; to: THREE.Vector2 }[] = [];
    const MAX_ITER = 500;

    // No holes = legacy inward-offset loop. The hole-aware path below pays
    // polygon-clipping overhead per iteration; skip it when we know there's
    // nothing to subtract.
    if (holes.length === 0) {
      let current = contour;
      let iter = 0;
      let prevBbox = this.contourBBox(current);
      while (current.length >= 3 && iter++ < MAX_ITER) {
        const next = this.offsetContour(current, -lineWidth);
        if (next.length < 3) break;
        const nextBbox = this.contourBBox(next);
        const shrinkX = Math.abs((prevBbox.maxX - prevBbox.minX) - (nextBbox.maxX - nextBbox.minX));
        const shrinkY = Math.abs((prevBbox.maxY - prevBbox.minY) - (nextBbox.maxY - nextBbox.minY));
        if (shrinkX < 0.01 && shrinkY < 0.01) break;
        prevBbox = nextBbox;
        for (let i = 0; i < next.length; i++) {
          results.push({ from: next[i], to: next[(i + 1) % next.length] });
        }
        current = next;
      }
      return results;
    }

    // Hole-aware path: at each depth, compute the material region as an
    // ExPolygon via polygon-clipping difference, then emit every ring as a
    // concentric loop. When the region pinches off (e.g. outer shrinks past
    // a hole), polygon-clipping returns multiple sub-polygons or an empty
    // MultiPolygon — we stop cleanly in either case.
    const toRing = (pts: THREE.Vector2[]): PCRing => {
      const r: PCRing = pts.map((p) => [p.x, p.y] as [number, number]);
      if (r.length > 0) {
        const f = r[0]; const l = r[r.length - 1];
        if (f[0] !== l[0] || f[1] !== l[1]) r.push([f[0], f[1]]);
      }
      return r;
    };
    const ringToSegs = (ring: PCRing) => {
      for (let i = 0; i < ring.length - 1; i++) {
        results.push({
          from: new THREE.Vector2(ring[i][0], ring[i][1]),
          to: new THREE.Vector2(ring[i + 1][0], ring[i + 1][1]),
        });
      }
    };

    for (let step = 1; step < MAX_ITER; step++) {
      const depth = step * lineWidth;
      const outerShrunk = this.offsetContour(contour, depth);
      if (outerShrunk.length < 3) break;
      const holesExpanded = holes
        .map((h) => this.offsetContour(h, depth))
        .filter((h) => h.length >= 3);
      let region: PCMultiPolygon = [[toRing(outerShrunk)]];
      if (holesExpanded.length > 0) {
        const holeMPs: PCMultiPolygon[] = holesExpanded.map((h) => [[toRing([...h].reverse())]]);
        try {
          region = polygonClipping.difference(region, ...holeMPs);
        } catch { break; }
      }
      if (region.length === 0) break;
      for (const poly of region) {
        for (const ring of poly) ringToSegs(ring);
      }
    }

    return results;
  }

  private generateCubicInfill(
    contour: THREE.Vector2[],
    density: number,
    lineWidth: number,
    layerIndex: number,
    holes: THREE.Vector2[][] = [],
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    // Cubic infill: three interlocked diagonal sets, each layer rotated 60° in the cycle
    const angleOffset = ((layerIndex % 3) * Math.PI) / 3;
    return [
      ...this.generateScanLines(contour, density, lineWidth, angleOffset, 0, holes),
      ...this.generateScanLines(contour, density, lineWidth, angleOffset + Math.PI / 3, 0, holes),
      ...this.generateScanLines(contour, density, lineWidth, angleOffset + (2 * Math.PI) / 3, 0, holes),
    ];
  }

  private generateZigzagLines(
    contour: THREE.Vector2[],
    density: number,
    lineWidth: number,
    layerIndex: number,
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    // Zigzag: like lines but connected at the edges so there are no travel moves
    const angle = layerIndex % 2 === 0 ? 0 : Math.PI / 2;
    const scanLines = this.generateScanLines(contour, density, lineWidth, angle);

    if (scanLines.length < 2) return scanLines;

    // Connect consecutive scan line endpoints
    const results: { from: THREE.Vector2; to: THREE.Vector2 }[] = [];
    for (let i = 0; i < scanLines.length; i++) {
      const line = scanLines[i];
      if (i % 2 === 0) {
        results.push(line);
      } else {
        // Reverse direction
        results.push({ from: line.to, to: line.from });
      }
      // Connect to next line
      if (i + 1 < scanLines.length) {
        const nextLine = scanLines[i + 1];
        const currentEnd = i % 2 === 0 ? line.to : line.from;
        const nextStart = (i + 1) % 2 === 0 ? nextLine.from : nextLine.to;
        if (currentEnd.distanceTo(nextStart) > 0.1) {
          results.push({ from: currentEnd, to: nextStart });
        }
      }
    }

    return results;
  }

  // =========================================================================
  // SUPPORT GENERATION
  // =========================================================================

  // ── Tree support helpers ────────────────────────────────────────────────────

  /** Greedy merge of anchor points within mergeRadius of each other. */
  private mergeTreeAnchors(
    anchors: { cx: number; cy: number; topZ: number }[],
    mergeRadius: number,
  ): { cx: number; cy: number; topZ: number }[] {
    const merged: { cx: number; cy: number; topZ: number; count: number }[] = [];
    for (const a of anchors) {
      let found = false;
      for (const m of merged) {
        if (Math.hypot(a.cx - m.cx, a.cy - m.cy) < mergeRadius) {
          m.cx = (m.cx * m.count + a.cx) / (m.count + 1);
          m.cy = (m.cy * m.count + a.cy) / (m.count + 1);
          m.topZ = Math.max(m.topZ, a.topZ);
          m.count++;
          found = true;
          break;
        }
      }
      if (!found) merged.push({ ...a, count: 1 });
    }
    return merged;
  }

  /**
   * Tree / organic support for one layer.
   *
   * For every overhang triangle above this layer, compute a branch anchor.
   * Merge nearby anchors, then for each branch emit:
   *   – a circular perimeter wall
   *   – scan-line infill inside the circle
   *
   * The branch radius grows linearly with depth below the overhang tip at the
   * combined rate of supportTreeAngle + supportTreeBranchDiameterAngle.
   */
  private generateTreeSupportForLayer(
    triangles: Triangle[],
    sliceZ: number,
    layerIndex: number,
    offsetX: number,
    offsetY: number,
    modelContours: Contour[],
  ): SliceMove[] {
    const pp = this.printProfile;
    const moves: SliceMove[] = [];

    const overhangAngleRad = (pp.supportAngle * Math.PI) / 180;
    const topGap = pp.supportTopDistance ?? pp.supportZDistance ?? 0;
    const tipR = (pp.supportTreeTipDiameter ?? 0.8) / 2;
    const maxR = (pp.supportTreeMaxBranchDiameter ?? pp.supportTreeBranchDiameter * 4) / 2;
    const growAngleRad =
      ((pp.supportTreeAngle + (pp.supportTreeBranchDiameterAngle ?? 0)) * Math.PI) / 180;
    const supLW = pp.supportLineWidth ?? pp.wallLineWidth;
    const supportSpeed = pp.supportInfillSpeed ?? pp.supportSpeed ?? pp.printSpeed * 0.8;
    const minHeight = pp.supportTreeMinHeight ?? 0;

    // Collect one anchor per overhang triangle that is above this layer.
    const rawAnchors: { cx: number; cy: number; topZ: number }[] = [];
    for (const tri of triangles) {
      const dotUp = tri.normal.z;
      const clamped = Math.max(0, Math.min(1, Math.abs(dotUp)));
      const faceAngle = Math.acos(clamped);
      if (dotUp >= 0 || faceAngle <= overhangAngleRad) continue;

      const maxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
      if (maxZ - topGap <= sliceZ) continue; // this layer is in the top-gap or above
      if (minHeight > 0 && maxZ - sliceZ < minHeight) continue;

      rawAnchors.push({
        cx: (tri.v0.x + tri.v1.x + tri.v2.x) / 3 + offsetX,
        cy: (tri.v0.y + tri.v1.y + tri.v2.y) / 3 + offsetY,
        topZ: maxZ,
      });
    }
    if (rawAnchors.length === 0) return moves;

    // Merge anchors closer than one branch diameter.
    const anchors = this.mergeTreeAnchors(rawAnchors, pp.supportTreeBranchDiameter);

    for (const anchor of anchors) {
      const distBelow = anchor.topZ - sliceZ;
      if (distBelow <= 0) continue;

      const r = Math.min(maxR, tipR + Math.tan(growAngleRad) * distBelow);
      if (r < supLW / 2) continue;

      // Skip branches whose center is inside the model.
      const centerPt = new THREE.Vector2(anchor.cx, anchor.cy);
      let inside = false;
      for (const c of modelContours) {
        if (c.isOuter && this.pointInContour(centerPt, c.points)) { inside = true; break; }
      }
      if (inside) continue;

      // Circular perimeter — number of segments scales with circumference.
      const segs = Math.max(8, Math.round((2 * Math.PI * r) / supLW));
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * 2 * Math.PI;
        const a1 = ((i + 1) / segs) * 2 * Math.PI;
        moves.push({
          type: 'support',
          from: { x: anchor.cx + Math.cos(a0) * r, y: anchor.cy + Math.sin(a0) * r },
          to:   { x: anchor.cx + Math.cos(a1) * r, y: anchor.cy + Math.sin(a1) * r },
          speed: supportSpeed, extrusion: 0, lineWidth: supLW,
        });
      }

      // Infill — scan lines clipped to the circle, alternating angle per layer.
      const circContour: THREE.Vector2[] = [];
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * 2 * Math.PI;
        circContour.push(new THREE.Vector2(anchor.cx + Math.cos(a) * r, anchor.cy + Math.sin(a) * r));
      }
      const infillAngle = (layerIndex % 2 === 0) ? 0 : Math.PI / 2;
      const lines = this.generateScanLines(circContour, pp.supportDensity, supLW, infillAngle);
      for (const line of lines) {
        moves.push({
          type: 'support',
          from: { x: line.from.x, y: line.from.y },
          to:   { x: line.to.x,  y: line.to.y  },
          speed: supportSpeed, extrusion: 0, lineWidth: supLW,
        });
      }
    }

    return moves;
  }

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
    const pp = this.printProfile;
    const moves: SliceMove[] = [];

    // Dispatch to tree-support generator for tree / organic modes.
    if (pp.supportType === 'tree' || pp.supportType === 'organic') {
      return { moves: this.generateTreeSupportForLayer(
        triangles, sliceZ, layerIndex, offsetX, offsetY, modelContours,
      ) };
    }

    // Find triangles that are overhanging at this Z
    const overhangAngleRad = (pp.supportAngle * Math.PI) / 180;
    const overhangRegions: THREE.Vector2[][] = [];

    for (const tri of triangles) {
      // Check if triangle faces downward beyond the support angle.
      // Clamp dotUp to [-1, 1] before acos — FP drift can push it slightly
      // outside that range, producing NaN that silently breaks the comparison
      // below for what should be exactly-vertical faces.
      const dotUp = tri.normal.z; // dot with (0,0,1)
      // Clamp into the strict [0, 1] domain of acos — floating-point drift
      // on perfectly-vertical faces can push |dotUp| slightly above 1.0 which
      // would otherwise yield NaN and silently skip the overhang.
      const clamped = Math.max(0, Math.min(1, Math.abs(dotUp)));
      const faceAngle = Math.acos(clamped);

      if (dotUp < 0 && faceAngle > overhangAngleRad) {
        // Check if triangle overlaps with this layer
        const minZ = Math.min(tri.v0.z, tri.v1.z, tri.v2.z);
        const maxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
        // supportTopDistance shrinks the range of layers that generate
        // support — equivalent to leaving a gap below the model's underside.
        const topGap = pp.supportTopDistance ?? pp.supportZDistance ?? 0;
        if (sliceZ >= minZ && sliceZ <= maxZ + pp.layerHeight - topGap) {
          // Project triangle onto XY plane
          const projected: THREE.Vector2[] = [
            new THREE.Vector2(tri.v0.x + offsetX, tri.v0.y + offsetY),
            new THREE.Vector2(tri.v1.x + offsetX, tri.v1.y + offsetY),
            new THREE.Vector2(tri.v2.x + offsetX, tri.v2.y + offsetY),
          ];
          overhangRegions.push(projected);
        }
      }
    }

    if (overhangRegions.length === 0) return { moves };

    // Generate support infill in overhang regions.
    // Merge all overhang triangles into a bounding region and generate a
    // single support pattern. Cura-parity note: `supportJoinDistance`
    // controls how far apart two support islands may be before they're
    // merged into one. Our implementation already merges ALL overhang
    // triangles into a single bbox — equivalent to an infinite
    // supportJoinDistance. The flag round-trips through the profile but
    // has no behavioral effect in this slicer (would need multi-island
    // support tracking to honor differently).
    const allOverhangPts: THREE.Vector2[] = [];
    for (const region of overhangRegions) {
      allOverhangPts.push(...region);
    }
    if (allOverhangPts.length === 0) return { moves };

    let rawBbox = this.pointsBBox(allOverhangPts);

    // Cura-parity: Conical Support. When enabled, the support footprint
    // shrinks with every layer of print height so the base of the support
    // is broader than its top. `conicalSupportAngle` is the draft angle
    // in degrees; 0° = no taper, 60° = aggressive taper.
    if (pp.enableConicalSupport) {
      const angleRad = ((pp.conicalSupportAngle ?? 30) * Math.PI) / 180;
      const shrinkPerLayer = Math.tan(angleRad) * pp.layerHeight;
      // Shrink the bbox inward by `shrinkPerLayer × layerIndex`.
      const shrink = shrinkPerLayer * layerIndex;
      rawBbox = {
        minX: rawBbox.minX + shrink,
        maxX: rawBbox.maxX - shrink,
        minY: rawBbox.minY + shrink,
        maxY: rawBbox.maxY - shrink,
      };
      if (rawBbox.maxX <= rawBbox.minX || rawBbox.maxY <= rawBbox.minY) {
        // Shrunk to nothing — skip support on this layer.
        return { moves };
      }
    }

    // Cura-parity: Stair-Step Base. When the support base meets a sloped
    // model surface at an angle below `supportStairStepMinSlope`, we
    // quantize the support base height to `supportStairStepHeight` so the
    // contact pattern steps in discrete layer-height multiples. Approximated
    // here as a no-op past the first `stairSteps` layers — which gives a
    // thicker, squarer base where supports meet the build plate.
    if (
      (pp.supportStairStepHeight ?? 0) > 0 &&
      (pp.supportStairStepMinSlope ?? 0) > 0
    ) {
      const stepLayers = Math.max(1, Math.ceil((pp.supportStairStepHeight ?? 0.3) / pp.layerHeight));
      // On layers that fall on a stair-step boundary, emit a slightly wider
      // base by padding the bbox by one lineWidth. Keeps the support foot
      // more stable on sloped surfaces.
      if (layerIndex < stepLayers) {
        const maxW = pp.supportStairStepMaxWidth ?? 0;
        const pad = maxW > 0 ? Math.min(pp.wallLineWidth, maxW / 2) : pp.wallLineWidth;
        rawBbox = {
          minX: rawBbox.minX - pad,
          maxX: rawBbox.maxX + pad,
          minY: rawBbox.minY - pad,
          maxY: rawBbox.maxY + pad,
        };
      }
    }

    // Cura-parity: Conical Support. When conicalSupportAngle > 0, the support
    // base expands outward from the top (overhang) to the bottom (build plate)
    // at the given angle, creating a cone-shaped structure. Approximated as
    // bbox expansion proportional to distance below the model top: each layer
    // gets extra clearance of tan(angle) * (modelHeight - layerZ).
    const conicalAngle = (pp.enableConicalSupport ?? false) ? (pp.conicalSupportAngle ?? 0) : 0;
    if (conicalAngle > 0 && modelHeight > 0) {
      const conicalRad = (conicalAngle * Math.PI) / 180;
      const expansion = Math.tan(conicalRad) * Math.max(0, modelHeight - layerZ);
      const minWidth = (pp.conicalSupportMinWidth ?? 0) / 2;
      const actualExp = Math.max(minWidth, expansion);
      rawBbox = {
        minX: rawBbox.minX - actualExp,
        maxX: rawBbox.maxX + actualExp,
        minY: rawBbox.minY - actualExp,
        maxY: rawBbox.maxY + actualExp,
      };
    }

    // Cura-parity: minimumSupportArea drops tiny support islands so the user
    // doesn't get pockmark-like supports from stray overhang triangles. We
    // use the bounding-box area of the merged overhang region as a
    // conservative approximation (the real support polygon area is ≤ bbox
    // area, so anything below threshold by bbox is definitely below by
    // polygon).
    const minArea = pp.minimumSupportArea ?? 0;
    if (minArea > 0) {
      const bboxArea = (rawBbox.maxX - rawBbox.minX) * (rawBbox.maxY - rawBbox.minY);
      if (bboxArea < minArea) return { moves };
    }

    // Cura-parity: supportHorizontalExpansion inflates the support region
    // outward (positive) or shrinks it inward (negative) before generating
    // infill lines. Useful for supports that need a wider footprint to avoid
    // slipping off the build plate, or tighter fit against the model.
    // minSupportXYDistance adds an additional hard-minimum XY gap on top of
    // supportXYDistance. We approximate by shrinking the bbox further inward.
    const horizExp = pp.supportHorizontalExpansion ?? 0;
    const minXYGap = Math.max(0, (pp.minSupportXYDistance ?? 0) - (pp.supportXYDistance ?? 0));
    const bbox = {
      minX: rawBbox.minX - horizExp + minXYGap,
      maxX: rawBbox.maxX + horizExp - minXYGap,
      minY: rawBbox.minY - horizExp + minXYGap,
      maxY: rawBbox.maxY + horizExp - minXYGap,
    };

    // Cura-parity: supportLineDistance (mm) is an absolute-spacing override
    // that bypasses the density-derived calculation. Useful for tuning
    // support strength independent of print-profile density %.
    // initialLayerSupportLineDistance overrides spacing on layer 0 only.
    const supLW = pp.supportLineWidth ?? pp.wallLineWidth;
    const baseSpacing = (pp.supportLineDistance ?? 0) > 0
      ? (pp.supportLineDistance ?? 1)
      : supLW / (pp.supportDensity / 100);
    // Cura-parity: gradualSupportSteps reduces support density for the top N
    // "steps" worth of layers, halving the density each step. Each step spans
    // gradualSupportStepHeight mm. Layer 0 override takes precedence.
    let spacing = (layerIndex === 0 && (pp.initialLayerSupportLineDistance ?? 0) > 0)
      ? pp.initialLayerSupportLineDistance!
      : baseSpacing;
    const gradSteps = pp.gradualSupportSteps ?? 0;
    const gradHeight = pp.gradualSupportStepHeight ?? 1.0;
    if (gradSteps > 0 && gradHeight > 0) {
      const totalGradZ = gradSteps * gradHeight;
      const fromTop = Math.max(0, totalGradZ - (layerZ - (layerZ % gradHeight)));
      const stepN = Math.min(gradSteps, Math.floor(fromTop / gradHeight));
      if (stepN > 0) spacing = baseSpacing * Math.pow(2, stepN);
    }
    // Cura-parity: support roof/floor interface layers get their own speed and
    // flow. "Roof" = support touching the model from below (top N mm of support
    // column). "Floor" = support resting on model surface (bottom N mm).
    // Approximate by checking triangle Z ranges relative to this layer.
    const ifThickRoof  = pp.supportRoofThickness  ?? pp.supportInterfaceThickness ?? 0;
    const ifThickFloor = pp.supportFloorThickness ?? pp.supportInterfaceThickness ?? 0;
    const supZDist     = pp.supportZDistance ?? 0;
    let isRoofLayer  = false;
    let isFloorLayer = false;
    if (ifThickRoof > 0 || ifThickFloor > 0) {
      for (const tri of triangles) {
        const triMinZ = Math.min(tri.v0.z, tri.v1.z, tri.v2.z);
        const triMaxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
        // Roof: model surface is just above this support layer
        if (!isRoofLayer && ifThickRoof > 0) {
          if (triMinZ > sliceZ && triMinZ <= sliceZ + supZDist + ifThickRoof) isRoofLayer = true;
        }
        // Floor: model surface is just below this support layer
        if (!isFloorLayer && ifThickFloor > 0) {
          if (triMaxZ < sliceZ && triMaxZ >= sliceZ - supZDist - ifThickFloor) isFloorLayer = true;
        }
        if (isRoofLayer && isFloorLayer) break;
      }
    }
    let supportSpeed = pp.supportInfillSpeed ?? pp.supportSpeed ?? pp.printSpeed * 0.8;
    // supportInterfaceSpeed applies to all interface layers (roof + floor) when
    // no layer-specific override is set. It's a single knob for both zones.
    if ((isRoofLayer || isFloorLayer) && (pp.supportInterfaceSpeed ?? 0) > 0) supportSpeed = pp.supportInterfaceSpeed!;
    if (isRoofLayer  && (pp.supportRoofSpeed  ?? 0) > 0) supportSpeed = pp.supportRoofSpeed!;
    if (isFloorLayer && (pp.supportFloorSpeed ?? 0) > 0) supportSpeed = pp.supportFloorSpeed!;

    // Track interface flow overrides — applied via currentLayerFlow in caller.
    // We encode them in a marker on the first move (handled by caller).
    const supportFlowOverride: number | undefined =
      isRoofLayer  && (pp.supportRoofFlow  ?? 0) > 0 ? pp.supportRoofFlow! / 100 :
      isFloorLayer && (pp.supportFloorFlow ?? 0) > 0 ? pp.supportFloorFlow! / 100 :
      undefined;

    // Cura-parity: interface layers (roof/floor) use their own density, pattern,
    // line directions, and horizontal expansion settings.
    if (isRoofLayer || isFloorLayer) {
      const ifHorizExp = pp.supportInterfaceHorizontalExpansion ?? 0;
      if (ifHorizExp !== 0) {
        bbox.minX -= ifHorizExp; bbox.maxX += ifHorizExp;
        bbox.minY -= ifHorizExp; bbox.maxY += ifHorizExp;
      }
      if (isRoofLayer) {
        const roofDensity = pp.supportRoofDensity ?? pp.supportDensity;
        const roofDist    = (pp.supportRoofLineDistance ?? 0) > 0
          ? pp.supportRoofLineDistance!
          : supLW / (roofDensity / 100);
        spacing = roofDist;
      } else {
        const floorDensity = pp.supportFloorDensity ?? pp.supportDensity;
        const floorDist    = (pp.supportFloorLineDistance ?? 0) > 0
          ? pp.supportFloorLineDistance!
          : supLW / (floorDensity / 100);
        spacing = floorDist;
      }
    }

    // Generate support pattern — interface line directions take priority over
    // bulk directions for roof/floor layers.
    const activeLineDirs = (isRoofLayer || isFloorLayer)
      ? (pp.supportInterfaceLineDirections ?? pp.supportInfillLineDirections ?? null)
      : (pp.supportInfillLineDirections ?? null);
    const ifPattern = isRoofLayer
      ? (pp.supportRoofPattern  ?? pp.supportPattern)
      : isFloorLayer
        ? (pp.supportFloorPattern ?? pp.supportPattern)
        : pp.supportPattern;

    let angle: number;
    if (activeLineDirs && activeLineDirs.length > 0) {
      angle = (activeLineDirs[layerIndex % activeLineDirs.length] * Math.PI) / 180;
    } else {
      switch (ifPattern) {
        case 'grid':
          angle = layerIndex % 2 === 0 ? 0 : Math.PI / 2;
          break;
        case 'zigzag':
          angle = layerIndex % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
          break;
        case 'lines':
        default:
          angle = 0;
          break;
      }
    }

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const maxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * 1.5;
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;

    // XY distance offset from model
    const xyDist = pp.supportXYDistance;

    // Cura-parity: supportWallLineCount — emit N rectangular perimeter loops.
    // Interface layers use supportInterfaceWallCount when specified.
    const supWalls = (isRoofLayer || isFloorLayer)
      ? (pp.supportInterfaceWallCount ?? pp.supportWallLineCount ?? 0)
      : (pp.supportWallLineCount ?? 0);
    for (let w = 0; w < supWalls; w++) {
      const wallOff = w * supLW + supLW / 2;
      const wx0 = bbox.minX - wallOff, wx1 = bbox.maxX + wallOff;
      const wy0 = bbox.minY - wallOff, wy1 = bbox.maxY + wallOff;
      const corners = [
        { x: wx0, y: wy0 }, { x: wx1, y: wy0 },
        { x: wx1, y: wy1 }, { x: wx0, y: wy1 }, { x: wx0, y: wy0 },
      ];
      for (let ci = 1; ci < corners.length; ci++) {
        moves.push({
          type: 'support',
          from: { x: corners[ci - 1].x, y: corners[ci - 1].y },
          to: { x: corners[ci].x, y: corners[ci].y },
          speed: supportSpeed, extrusion: 0, lineWidth: supLW,
        });
      }
    }

    // Defensive: same scan-line safety as generateScanLines. Bail on bad
    // spacing and cap total iterations.
    if (!(spacing > 0) || !isFinite(spacing)) return { moves };
    const SUPPORT_MAX_SCAN = 50000;
    let supScanCount = 0;

    for (let d = -maxDim / 2; d <= maxDim / 2; d += spacing) {
      if (++supScanCount > SUPPORT_MAX_SCAN) break;
      const p1x = centerX + cos * (-maxDim) - sin * d;
      const p1y = centerY + sin * (-maxDim) + cos * d;
      const p2x = centerX + cos * maxDim - sin * d;
      const p2y = centerY + sin * maxDim + cos * d;

      // Check if this line is within the overhang bounding box
      // (simplified -- ideally we would clip to the actual overhang region)
      const lineMinX = Math.min(p1x, p2x);
      const lineMaxX = Math.max(p1x, p2x);
      const lineMinY = Math.min(p1y, p2y);
      const lineMaxY = Math.max(p1y, p2y);

      if (lineMaxX < bbox.minX || lineMinX > bbox.maxX) continue;
      if (lineMaxY < bbox.minY || lineMinY > bbox.maxY) continue;

      // Clip to bounding box
      const fromX = Math.max(p1x, bbox.minX + xyDist);
      const toX = Math.min(p2x, bbox.maxX - xyDist);
      const fromY = Math.max(p1y, bbox.minY + xyDist);
      const toY = Math.min(p2y, bbox.maxY - xyDist);

      // Skip support lines whose midpoint falls inside the model footprint.
      const midPt = new THREE.Vector2(
        (fromX + toX) / 2,
        (fromY + toY) / 2,
      );
      let insideModel = false;
      for (const contour of modelContours) {
        if (contour.isOuter && this.pointInContour(midPt, contour.points)) {
          insideModel = true;
          break;
        }
      }

      if (!insideModel && (Math.abs(fromX - toX) > 0.5 || Math.abs(fromY - toY) > 0.5)) {
        const from = new THREE.Vector2(fromX, fromY);
        const to = new THREE.Vector2(toX, toY);
        moves.push({
          type: 'support',
          from: { x: from.x, y: from.y },
          to: { x: to.x, y: to.y },
          speed: supportSpeed,
          extrusion: 0, // calculated by caller
          lineWidth: supLW,
        });
      }
    }

    return { moves, flowOverride: supportFlowOverride };
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
    const moves: SliceMove[] = [];

    // Compute overall model bounding box on bed from contours
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const contour of contours) {
      for (const pt of contour.points) {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      }
    }
    if (!isFinite(minX)) return moves;

    const speed = pp.firstLayerSpeed;
    const lineWidth = pp.skirtBrimLineWidth ?? pp.wallLineWidth;

    switch (pp.adhesionType) {
      case 'skirt': {
        // Cura-parity: skirtBrimMinLength keeps adding loops until the total
        // perimeter of all skirt lines reaches the minimum length. This ensures
        // the nozzle primes enough material regardless of model footprint size.
        const minLen = pp.skirtBrimMinLength ?? 0;
        let totalSkirtLen = 0;
        let skirtLine = 0;
        while (skirtLine < pp.skirtLines || (minLen > 0 && totalSkirtLen < minLen)) {
          const dist = pp.skirtDistance + skirtLine * lineWidth;
          const w = (maxX - minX) + 2 * dist;
          const h = (maxY - minY) + 2 * dist;
          const loopPerim = 2 * (w + h);
          totalSkirtLen += loopPerim;
          const corners = [
            new THREE.Vector2(minX - dist, minY - dist),
            new THREE.Vector2(maxX + dist, minY - dist),
            new THREE.Vector2(maxX + dist, maxY + dist),
            new THREE.Vector2(minX - dist, maxY + dist),
          ];
          for (let i = 0; i < corners.length; i++) {
            const from = corners[i];
            const to = corners[(i + 1) % corners.length];
            moves.push({
              type: 'skirt',
              from: { x: from.x, y: from.y },
              to: { x: to.x, y: to.y },
              speed,
              extrusion: 0,
              lineWidth,
            });
          }
          skirtLine++;
          if (skirtLine > 100) break; // safety cap
        }
        break;
      }

      case 'brim': {
        // Generate concentric loops around the model base.
        // offsetContour convention: positive = inward for CCW polygon.
        // Brim must go OUTWARD, so offset is negative.
        // brimGap (Cura: brim_gap) adds an air gap between the model edge and
        // the innermost brim line — useful when you want to remove the brim
        // cleanly without damaging fine first-layer details.
        const brimGapMm = pp.brimGap ?? 0;
        // brimAvoidMargin: keep outward brim lines at least this far from inner
        // hole contours so the brim does not cover small holes.
        const brimAvoidMm = pp.brimAvoidMargin ?? 0;
        // smartBrim: skip brim on large footprint outer contours — only small
        // or thin shapes need adhesion help. Threshold is the area of a square
        // with side = brimWidth * 6, so models wider than ~6× the brim width
        // are considered well-adhered and skipped.
        const smartBrimArea = (pp.smartBrim ?? false)
          ? Math.pow(pp.brimWidth * 6, 2)
          : Infinity;
        const brimLoops = Math.ceil(pp.brimWidth / lineWidth);
        for (let line = 0; line < brimLoops; line++) {
          const dist = brimGapMm + line * lineWidth;
          for (const contour of contours) {
            if (!contour.isOuter) continue;
            if (Math.abs(contour.area) > smartBrimArea) continue;
            const brimContour = this.offsetContour(contour.points, -(dist + lineWidth));
            if (brimContour.length < 3) continue;
            // brimAvoidMargin: skip this brim line if any point is within
            // brimAvoidMm of an inner (hole) contour.
            if (brimAvoidMm > 0) {
              const innerContours = contours.filter((c) => !c.isOuter);
              const tooClose = innerContours.some((ic) =>
                brimContour.some((bp) =>
                  ic.points.some((ip) => Math.hypot(bp.x - ip.x, bp.y - ip.y) < brimAvoidMm)
                )
              );
              if (tooClose) continue;
            }
            for (let i = 0; i < brimContour.length; i++) {
              const from = brimContour[i];
              const to = brimContour[(i + 1) % brimContour.length];
              moves.push({
                type: 'brim',
                from: { x: from.x, y: from.y },
                to: { x: to.x, y: to.y },
                speed,
                extrusion: 0,
                lineWidth,
              });
            }
          }
        }
        break;
      }

      case 'raft': {
        // Generate a multi-layer solid platform under the model.
        //
        // Cura-parity (Phase B4): a real Cura raft has three zones —
        //   • Base     — thick, wide lines anchoring to the bed
        //   • Middle   — N layers that step down thickness toward the model
        //   • Top/Surface — fine lines giving the first model layer something
        //                   smooth to sit on
        // We emit moves for all three zones. Line-widths and angle-per-layer
        // rotate to interlock the grid. All moves share the 'raft' SliceMove
        // type so the preview/G-code paths stay untouched.
        const raftMargin = pp.raftExtraMargin ?? 3;
        // Cura-parity: raftSmoothing rounds raft corners so the raft
        // outline doesn't have sharp 90-degree angles. The smoothing value
        // is the radius (mm) to chamfer each corner with; 0 = square corners.
        const smooth = pp.raftSmoothing ?? 0;
        const raftContour: THREE.Vector2[] = smooth > 0
          ? (() => {
              const rx0 = minX - raftMargin, ry0 = minY - raftMargin;
              const rx1 = maxX + raftMargin, ry1 = maxY + raftMargin;
              const r = Math.min(smooth, (rx1 - rx0) / 2, (ry1 - ry0) / 2);
              // Build a rounded rectangle by chamfering each of the 4 corners.
              // Eight vertices approximate the rounded corners as a chamfer.
              return [
                new THREE.Vector2(rx0 + r, ry0),
                new THREE.Vector2(rx1 - r, ry0),
                new THREE.Vector2(rx1,     ry0 + r),
                new THREE.Vector2(rx1,     ry1 - r),
                new THREE.Vector2(rx1 - r, ry1),
                new THREE.Vector2(rx0 + r, ry1),
                new THREE.Vector2(rx0,     ry1 - r),
                new THREE.Vector2(rx0,     ry0 + r),
              ];
            })()
          : [
              new THREE.Vector2(minX - raftMargin, minY - raftMargin),
              new THREE.Vector2(maxX + raftMargin, minY - raftMargin),
              new THREE.Vector2(maxX + raftMargin, maxY + raftMargin),
              new THREE.Vector2(minX - raftMargin, maxY + raftMargin),
            ];
        // ── BASE layer ──────────────────────────────────────────────────
        const baseLH      = pp.raftBaseThickness;
        const baseLW      = pp.raftBaseLineWidth ?? lineWidth * 1.5;
        const baseSpeed   = pp.raftBaseSpeed ?? speed * 0.8;
        const baseSpacing = (pp.raftBaseLineSpacing ?? 0) > 0
          ? pp.raftBaseLineSpacing!
          : baseLW / ((100 - (pp.raftBaseInfillOverlap ?? 0)) / 100 || 1);
        const baseFlowMul = (pp.raftFlow ?? 100) / 100;
        const baseLines   = this.generateScanLines(raftContour, 100, baseSpacing > 0 ? baseLW : baseLW, Math.PI / 2);
        // raftFanSpeed is emitted before the raft moves in the main emit loop (li===0 block).
        for (const line of baseLines) {
          moves.push({
            type: 'raft',
            from: { x: line.from.x, y: line.from.y },
            to: { x: line.to.x, y: line.to.y },
            speed: baseSpeed,
            extrusion: 0,
            lineWidth: baseLW * baseFlowMul,
            layerHeight: baseLH,
          });
        }
        // ── MIDDLE layers ───────────────────────────────────────────────
        const midCount   = pp.raftMiddleLayers ?? 0;
        const midLH      = pp.raftMiddleThickness ?? pp.raftBaseThickness;
        const midLW      = pp.raftMiddleLineWidth ?? lineWidth;
        const midSpacing = (pp.raftMiddleLineSpacing ?? 0) > 0 ? pp.raftMiddleLineSpacing! : midLW;
        const midSpeed   = pp.raftBaseSpeed ? pp.raftBaseSpeed * 1.0625 : speed * 0.85;
        for (let mli = 0; mli < midCount; mli++) {
          const angle = (mli % 2 === 0) ? Math.PI / 4 : -Math.PI / 4;
          const midLines = this.generateScanLines(raftContour, 100, midSpacing > midLW ? midLW : midLW, angle);
          for (const line of midLines) {
            moves.push({
              type: 'raft',
              from: { x: line.from.x, y: line.from.y },
              to: { x: line.to.x, y: line.to.y },
              speed: midSpeed,
              extrusion: 0,
              lineWidth: midLW * baseFlowMul,
              layerHeight: midLH,
            });
          }
        }
        // ── TOP / SURFACE layers ────────────────────────────────────────
        const topCount   = Math.max(1, pp.raftTopLayers ?? 2);
        const topLH      = pp.raftTopThickness ?? pp.layerHeight;
        const topLW      = pp.raftTopLineWidth ?? lineWidth;
        const topSpacing = (pp.raftTopLineSpacing ?? 0) > 0 ? pp.raftTopLineSpacing! : topLW;
        const topSpeed   = speed * 0.9;
        const monotonicTop = pp.monotonicRaftTopSurface ?? false;
        for (let tli = 0; tli < topCount; tli++) {
          const angle = Math.PI / 2 + tli * Math.PI / 3; // rotate to interlock
          const rawTopLines = this.generateScanLines(raftContour, 100, topSpacing, angle);
          // Default: boustrophedon (flip every other line for efficient travel).
          // monotonicRaftTopSurface: keep all lines in the same direction for
          // a more consistent surface finish at the cost of extra travel.
          const topLines = monotonicTop
            ? rawTopLines
            : this.sortInfillLines(rawTopLines);
          for (const line of topLines) {
            moves.push({
              type: 'raft',
              from: { x: line.from.x, y: line.from.y },
              to: { x: line.to.x, y: line.to.y },
              speed: topSpeed,
              extrusion: 0,
              lineWidth: topLW * baseFlowMul,
              layerHeight: topLH,
            });
          }
        }
        // ── Optional raft wall loops around the perimeter ───────────────
        // `raftWallCount` (Cura: raft_wall_count) emits perimeter passes
        // around each raft zone — useful for enclosed rafts that need a
        // clean outer edge.
        const raftWalls = pp.raftWallCount ?? 0;
        for (let rw = 0; rw < raftWalls; rw++) {
          const inset = rw * lineWidth;
          const wallContour: THREE.Vector2[] = [
            new THREE.Vector2(minX - raftMargin + inset, minY - raftMargin + inset),
            new THREE.Vector2(maxX + raftMargin - inset, minY - raftMargin + inset),
            new THREE.Vector2(maxX + raftMargin - inset, maxY + raftMargin - inset),
            new THREE.Vector2(minX - raftMargin + inset, maxY + raftMargin - inset),
          ];
          for (let wi = 0; wi < wallContour.length; wi++) {
            const from = wallContour[wi];
            const to = wallContour[(wi + 1) % wallContour.length];
            moves.push({
              type: 'raft',
              from: { x: from.x, y: from.y },
              to: { x: to.x, y: to.y },
              speed: speed * 0.85,
              extrusion: 0,
              lineWidth,
            });
          }
        }
        break;
      }

      case 'none':
      default:
        break;
    }

    return moves;
  }

  // =========================================================================
  // TRAVEL OPTIMIZATION
  // =========================================================================

  private sortInfillLines(
    lines: { from: THREE.Vector2; to: THREE.Vector2 }[],
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    if (lines.length <= 1) return lines;

    // Boustrophedon (snake) ordering: scan lines from generateScanLines already
    // arrive sorted by position. Reverse every other line so the nozzle travels
    // one line end-to-start across to the next, minimising travel with O(n) work
    // instead of the O(n²) nearest-neighbour search that stalled on solid layers.
    return lines.map((line, i) =>
      i % 2 === 0 ? line : { from: line.to, to: line.from },
    );
  }

  // Greedy nearest-neighbour infill sort (used when infillTravelOptimization is on).
  // Considers both endpoints of each remaining line and flips the line to start
  // from whichever end is closest to the current nozzle position.
  private sortInfillLinesNN(
    lines: { from: THREE.Vector2; to: THREE.Vector2 }[],
    startX: number,
    startY: number,
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    if (lines.length <= 1) return lines;
    const remaining = lines.slice();
    const result: { from: THREE.Vector2; to: THREE.Vector2 }[] = [];
    let rx = startX, ry = startY;
    while (remaining.length > 0) {
      let bestIdx = 0, bestDist = Infinity, bestFlip = false;
      for (let i = 0; i < remaining.length; i++) {
        const { from, to } = remaining[i];
        const df = Math.hypot(from.x - rx, from.y - ry);
        const dt = Math.hypot(to.x - rx, to.y - ry);
        if (df < bestDist) { bestDist = df; bestIdx = i; bestFlip = false; }
        if (dt < bestDist) { bestDist = dt; bestIdx = i; bestFlip = true; }
      }
      const line = remaining.splice(bestIdx, 1)[0];
      const ordered = bestFlip ? { from: line.to, to: line.from } : line;
      result.push(ordered);
      rx = ordered.to.x;
      ry = ordered.to.y;
    }
    return result;
  }

  // =========================================================================
  // GEOMETRY UTILITIES
  // =========================================================================

  private lineContourIntersections(
    p1: THREE.Vector2,
    p2: THREE.Vector2,
    contour: THREE.Vector2[],
  ): number[] {
    const results: number[] = [];
    const n = contour.length;

    for (let i = 0; i < n; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % n];
      const t = this.segSegIntersectionT(p1, p2, a, b);
      if (t !== null) results.push(t);
    }

    return results;
  }

  private segSegIntersectionT(
    p1: THREE.Vector2,
    p2: THREE.Vector2,
    p3: THREE.Vector2,
    p4: THREE.Vector2,
  ): number | null {
    const d1x = p2.x - p1.x;
    const d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x;
    const d2y = p4.y - p3.y;

    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-10) return null;

    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
    const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;

    if (u >= 0 && u <= 1 && t >= 0 && t <= 1) return t;
    return null;
  }

  private pointInContour(pt: THREE.Vector2, contour: THREE.Vector2[]): boolean {
    // Ray-casting algorithm
    let inside = false;
    const n = contour.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = contour[i].x, yi = contour[i].y;
      const xj = contour[j].x, yj = contour[j].y;

      if (
        yi > pt.y !== yj > pt.y &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** Ray-casting point-in-polygon test against a polygon-clipping ring
   *  (`[number, number][]` with closing duplicate). Cheaper than converting
   *  to Vector2[] just to call pointInContour — used hot in bridge detection. */
  private pointInRing(x: number, y: number, ring: PCRing): boolean {
    let inside = false;
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if (
        yi > y !== yj > y &&
        x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
    return inside;
  }

  private contourBBox(contour: THREE.Vector2[]): BBox2 {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of contour) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }

  private pointsBBox(points: THREE.Vector2[]): BBox2 {
    return this.contourBBox(points);
  }

  // =========================================================================
  // G-CODE TEMPLATE
  // =========================================================================

  private resolveGCodeTemplate(
    template: string,
    vars: Record<string, number>,
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
    }
    return result;
  }

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
    if (this.onProgress) {
      this.onProgress({
        stage,
        percent: Math.round(percent),
        currentLayer,
        totalLayers,
        message,
      });
    }
  }

  private async yieldToUI(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
}
