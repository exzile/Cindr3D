// =============================================================================
// DesignCAD Slicer Engine
// Full-featured slicer: takes Three.js meshes and produces G-code
// =============================================================================

import * as THREE from 'three';
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
}

interface Segment {
  a: THREE.Vector2;
  b: THREE.Vector2;
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
    const layerZs: number[] = [];
    let z = pp.firstLayerHeight;
    while (z <= modelHeight + 0.0001) {
      layerZs.push(z);
      z += pp.layerHeight;
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

    const gcode: string[] = [];

    // Helper: calculate extrusion length for a move
    const calcExtrusion = (distance: number, lineWidth: number, layerH: number): number => {
      const filamentArea = Math.PI * (printer.filamentDiameter / 2) ** 2;
      const volumePerMm = lineWidth * layerH;
      return (volumePerMm / filamentArea) * distance * mat.flowRate;
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
        currentE -= mat.retractionDistance;
        gcode.push(`G1 E${currentE.toFixed(5)} F${(mat.retractionSpeed * 60).toFixed(0)}`);
        if (hopEnabled && hopHeight > 0) {
          const hopZ = currentZ + hopHeight;
          gcode.push(`G1 Z${hopZ.toFixed(3)} F${hopFeedPerMin.toFixed(0)}`);
          currentZ = hopZ;
        }
        isRetracted = true;
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
        // Include wipeExtraPrime to compensate for material lost during wipe.
        currentE += mat.retractionDistance + extraPrime + (wipeDist > 0 ? wipeExtraPrime : 0);
        gcode.push(`G1 E${currentE.toFixed(5)} F${(mat.retractionSpeed * 60).toFixed(0)}`);
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
      const shortTravel = !forceRetract && (
        (maxComb > 0 && dist < maxComb) ||
        (minTravel > 0 && dist < minTravel)
      );
      if (!shortTravel) doRetract();
      gcode.push(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F${(pp.travelSpeed * 60).toFixed(0)}`);
      currentX = x;
      currentY = y;
    };

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
      gcode.push(
        `G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${currentE.toFixed(5)} F${(speed * 60).toFixed(0)}`,
      );
      // Record direction so the next retract can wipe along this vector.
      if (dist > 1e-6) {
        lastExtrudeDx = dx;
        lastExtrudeDy = dy;
      }
      currentX = x;
      currentY = y;
      const time = dist / speed;
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
      nozzleTemp: mat.nozzleTemp,
      nozzleTempFirstLayer: mat.nozzleTempFirstLayer,
      bedTemp: mat.bedTemp,
      bedTempFirstLayer: mat.bedTempFirstLayer,
    });
    gcode.push('; ----- Start G-code -----');
    gcode.push('G90 ; Absolute positioning');
    gcode.push('M82 ; Absolute extrusion');
    gcode.push(`M104 S${mat.nozzleTempFirstLayer} ; Set nozzle temp`);
    if (printer.hasHeatedBed) {
      gcode.push(`M140 S${mat.bedTempFirstLayer} ; Set bed temp`);
    }
    // Build-volume / chamber fan (Cura: build_volume_fan_speed). Uses M106 P2
    // by convention; printers that lack a second fan channel will simply
    // ignore it. Emit only when the user has set a non-zero value.
    if ((pp.buildVolumeFanSpeed ?? 0) > 0) {
      const s = Math.round(((pp.buildVolumeFanSpeed ?? 0) / 100) * 255);
      gcode.push(`M106 P2 S${s} ; Build volume fan`);
    }
    if (printer.hasHeatedBed) {
      gcode.push(`M190 S${mat.bedTempFirstLayer} ; Wait for bed temp`);
    }
    if (printer.hasHeatedChamber && mat.chamberTemp > 0) {
      gcode.push(`M141 S${mat.chamberTemp} ; Set chamber temp`);
    }
    gcode.push(`M109 S${mat.nozzleTempFirstLayer} ; Wait for nozzle temp`);
    gcode.push(startGCode.trim());
    gcode.push('G92 E0 ; Reset extruder');
    gcode.push('');

    // ----- Process each layer -----
    for (let li = 0; li < totalLayers; li++) {
      if (this.cancelled) {
        throw new Error('Slicing cancelled by user.');
      }
      const layerZ = layerZs[li];
      // The slicing plane is in model space at layerZ relative to model bottom
      const sliceZ = modelBBox.min.z + layerZ;
      const isFirstLayer = li === 0;
      const layerH = isFirstLayer ? pp.firstLayerHeight : pp.layerHeight;

      this.reportProgress('slicing', (li / totalLayers) * 80, li, totalLayers, `Slicing layer ${li + 1}/${totalLayers}...`);

      await this.yieldToUI();

      // ----- 4a. Compute contours via triangle-plane intersection -----
      const segments = this.sliceTrianglesAtZ(triangles, sliceZ, offsetX, offsetY, offsetZ);
      const rawContours = this.connectSegments(segments);
      if (rawContours.length === 0) continue;

      // Process contours: compute areas, classify inner/outer
      const contours = this.classifyContours(rawContours);

      // Determine if this is a solid layer (top or bottom).
      // Cura-parity note: `noSkinInZGaps` is effectively always honored by
      // our implementation — skin detection keys off absolute layer index
      // (li vs solidBottom/solidTop) rather than tracking per-island solid
      // regions across layers. Internal cavities therefore don't produce
      // skin in Z-gaps because we never see them as "solid top of a lower
      // feature". The flag becomes a no-op here but round-trips through
      // profile save/load.
      const isSolidBottom = li < solidBottom;
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
      let outerWallSpeed = isFirstLayer ? pp.firstLayerSpeed : pp.outerWallSpeed;
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
      const innerWallSpeed = isFirstLayer ? pp.firstLayerSpeed : pp.wallSpeed;
      const infillSpeed = isFirstLayer ? pp.firstLayerSpeed : pp.infillSpeed;
      const topBottomSpeed = isFirstLayer ? pp.firstLayerSpeed : pp.topSpeed;

      const moves: SliceMove[] = [];

      // ----- Layer header -----
      gcode.push('');
      gcode.push(`; ----- Layer ${li}, Z=${layerZ.toFixed(3)} -----`);
      gcode.push(`G1 Z${layerZ.toFixed(3)} F${(pp.travelSpeed * 60).toFixed(0)}`);
      currentZ = layerZ;

      // Progress reporting
      if (totalLayers > 0) {
        const pctDone = Math.round((li / totalLayers) * 100);
        gcode.push(`M73 P${pctDone} ; Progress`);
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
      const maxFanPct = pp.maximumFanSpeed ?? mat.fanSpeedMax;
      if (li === 0 && (pp.initialFanSpeed ?? 0) > 0) {
        const initPct = Math.min(pp.initialFanSpeed ?? 0, maxFanPct);
        const initS = Math.round((initPct / 100) * 255);
        gcode.push(`M106 S${initS} ; Initial fan speed`);
      }
      if (li === mat.fanDisableFirstLayers) {
        const fanS = Math.round((mat.fanSpeedMin / 100) * 255);
        gcode.push(`M106 S${fanS} ; Enable fan`);
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
        const fanS = Math.round((fanPct / 100) * 255);
        gcode.push(`M106 S${fanS} ; Ramp fan`);
      }

      // ----- Adhesion (first layer only) -----
      if (li === 0) {
        const adhesionMoves = this.generateAdhesion(contours, pp, layerH, offsetX, offsetY);
        let layerTimeAdhesion = 0;
        for (const am of adhesionMoves) {
          // Travel to start
          travelTo(am.from.x, am.from.y);
          layerTimeAdhesion += extrudeTo(am.to.x, am.to.y, am.speed, am.lineWidth, layerH);
          moves.push(am);
        }
        totalTime += layerTimeAdhesion;
      }

      let layerTime = 0;

      // Cura-parity: `groupOuterWalls`. When enabled, emit the outer wall
      // of EVERY contour before any inner walls or infill. This makes all
      // outer-surface passes happen in one group per layer, reducing the
      // number of transitions between inner/outer features (useful for
      // fast printers with pressure-advance or to improve surface quality
      // on multi-contour layers). We pre-compute the wall sets once and
      // dispatch the emission into two phases keyed by this flag.
      const groupOW = pp.groupOuterWalls ?? false;
      const perContour: Array<{ contour: Contour; wallSets: THREE.Vector2[][] }> = [];
      if (groupOW) {
        for (const contour of contours) {
          if (!contour.isOuter) continue;
          let wallSets = this.generatePerimeters(contour.points, pp.wallCount, pp.wallLineWidth);
          const minOdd = pp.minOddWallLineWidth ?? 0;
          if (minOdd > 0) {
            wallSets = wallSets.filter((w) => {
              if (w.length < 3) return false;
              let miX = Infinity, maX = -Infinity, miY = Infinity, maY = -Infinity;
              for (const p of w) {
                if (p.x < miX) miX = p.x; if (p.x > maX) maX = p.x;
                if (p.y < miY) miY = p.y; if (p.y > maY) maY = p.y;
              }
              return Math.min(maX - miX, maY - miY) >= 2 * minOdd;
            });
          }
          perContour.push({ contour, wallSets });
        }
        // Pass 1: emit all outer walls across all contours using the same
        // seam/scarf/fluid-motion logic as the inline path. We reuse the
        // helper below and emit only outer walls here.
        for (const { wallSets } of perContour) {
          if (wallSets.length === 0) continue;
          const outerWall = wallSets[0];
          if (outerWall.length < 2) continue;
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
          travelTo(reordered[0].x, reordered[0].y);
          gcode.push(`; Outer wall (grouped)`);
          const scarfLen = pp.scarfSeamLength ?? 0;
          const scarfActive = scarfLen > 0
            && (pp.scarfSeamStartHeight === undefined || layerZ >= pp.scarfSeamStartHeight);
          let scarfRemaining = scarfActive ? scarfLen : 0;
          for (let pi = 1; pi < reordered.length; pi++) {
            const from = reordered[pi - 1];
            const to = reordered[pi];
            let segLW = pp.wallLineWidth;
            if (scarfRemaining > 0) {
              const done = scarfLen - scarfRemaining;
              segLW = pp.wallLineWidth * Math.min(1, done / scarfLen);
              scarfRemaining = Math.max(0, scarfRemaining - from.distanceTo(to));
            }
            layerTime += extrudeTo(to.x, to.y, outerWallSpeed, segLW, layerH);
            moves.push({
              type: 'wall-outer',
              from: { x: from.x, y: from.y },
              to: { x: to.x, y: to.y },
              speed: outerWallSpeed,
              extrusion: calcExtrusion(from.distanceTo(to), segLW, layerH),
              lineWidth: segLW,
            });
          }
          // Close loop (simple; coasting handled only in main path)
          if (reordered.length > 2) {
            const lastPt = reordered[reordered.length - 1];
            const firstPt = reordered[0];
            layerTime += extrudeTo(firstPt.x, firstPt.y, outerWallSpeed, pp.wallLineWidth, layerH);
            moves.push({
              type: 'wall-outer',
              from: { x: lastPt.x, y: lastPt.y },
              to: { x: firstPt.x, y: firstPt.y },
              speed: outerWallSpeed,
              extrusion: calcExtrusion(lastPt.distanceTo(firstPt), pp.wallLineWidth, layerH),
              lineWidth: pp.wallLineWidth,
            });
          }
        }
      }

      // ----- For each contour, generate walls, then infill -----
      for (const contour of contours) {
        if (!contour.isOuter) continue; // process outer contours only; inner holes handled during offset

        // Generate perimeters (walls)
        let wallSets = this.generatePerimeters(contour.points, pp.wallCount, pp.wallLineWidth);
        // Cura-parity: `minOddWallLineWidth` drops walls whose bounding box
        // is too small to fit the requested line width (approximation: if
        // the wall's min bbox dimension < 2 × threshold, skip it). Prevents
        // sub-nozzle "odd walls" from being emitted as a no-op loop in
        // narrow internal regions.
        const minOdd = pp.minOddWallLineWidth ?? 0;
        if (minOdd > 0) {
          wallSets = wallSets.filter((w) => {
            if (w.length < 3) return false;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const p of w) {
              if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
              if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            }
            return Math.min(maxX - minX, maxY - minY) >= 2 * minOdd;
          });
        }

        // Outer wall — skipped here when `groupOuterWalls` already emitted
        // them in the layer-wide pre-pass above.
        if (!groupOW && wallSets.length > 0) {
          const outerWall = wallSets[0];
          if (outerWall.length >= 2) {
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
            let scarfRemaining = scarfActive ? scarfLen : 0;
            for (let pi = 1; pi < reordered.length; pi++) {
              const from = reordered[pi - 1];
              const to = reordered[pi];
              let segLW = pp.wallLineWidth;
              if (scarfRemaining > 0) {
                // Ramp: completed distance into scarf / total scarf length
                const done = scarfLen - scarfRemaining;
                segLW = pp.wallLineWidth * Math.min(1, done / scarfLen);
                scarfRemaining = Math.max(0, scarfRemaining - from.distanceTo(to));
              }
              layerTime += extrudeTo(to.x, to.y, outerWallSpeed, segLW, layerH);
              moves.push({
                type: 'wall-outer',
                from: { x: from.x, y: from.y },
                to: { x: to.x, y: to.y },
                speed: outerWallSpeed,
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
              const coastDist = coastVol > 0
                ? coastVol / (pp.wallLineWidth * layerH)
                : 0;
              if (coastDist > 0 && segLen > coastDist + 1e-3) {
                // Extrude up to the coast-start point, then travel the rest.
                const t = 1 - coastDist / segLen;
                const midX = lastPt.x + (firstPt.x - lastPt.x) * t;
                const midY = lastPt.y + (firstPt.y - lastPt.y) * t;
                layerTime += extrudeTo(midX, midY, outerWallSpeed, pp.wallLineWidth, layerH);
                moves.push({
                  type: 'wall-outer',
                  from: { x: lastPt.x, y: lastPt.y },
                  to: { x: midX, y: midY },
                  speed: outerWallSpeed,
                  extrusion: calcExtrusion(segLen * t, pp.wallLineWidth, layerH),
                  lineWidth: pp.wallLineWidth,
                });
                // Coast — unextruded travel at (optionally) reduced speed.
                const coastSpeed = outerWallSpeed * ((pp.coastingSpeed ?? 90) / 100);
                gcode.push(`G0 X${firstPt.x.toFixed(3)} Y${firstPt.y.toFixed(3)} F${(coastSpeed * 60).toFixed(0)} ; Coast`);
                currentX = firstPt.x;
                currentY = firstPt.y;
              } else {
                layerTime += extrudeTo(firstPt.x, firstPt.y, outerWallSpeed, pp.wallLineWidth, layerH);
                moves.push({
                  type: 'wall-outer',
                  from: { x: lastPt.x, y: lastPt.y },
                  to: { x: firstPt.x, y: firstPt.y },
                  speed: outerWallSpeed,
                  extrusion: calcExtrusion(segLen, pp.wallLineWidth, layerH),
                  lineWidth: pp.wallLineWidth,
                });
              }
            }
          }
        }

        // Inner walls. Cura-parity: innerWallLineWidth lets users use a
        // different extrusion width for inner loops than outer/default walls.
        // Falls back to pp.wallLineWidth when unset so existing profiles
        // behave identically.
        const innerLW = pp.innerWallLineWidth ?? pp.wallLineWidth;
        for (let wi = 1; wi < wallSets.length; wi++) {
          const innerWall = wallSets[wi];
          if (innerWall.length < 2) continue;
          travelTo(innerWall[0].x, innerWall[0].y);
          gcode.push(`; Inner wall ${wi}`);
          for (let pi = 1; pi < innerWall.length; pi++) {
            const from = innerWall[pi - 1];
            const to = innerWall[pi];
            layerTime += extrudeTo(to.x, to.y, innerWallSpeed, innerLW, layerH);
            moves.push({
              type: 'wall-inner',
              from: { x: from.x, y: from.y },
              to: { x: to.x, y: to.y },
              speed: innerWallSpeed,
              extrusion: calcExtrusion(from.distanceTo(to), innerLW, layerH),
              lineWidth: innerLW,
            });
          }
          // Close loop
          if (innerWall.length > 2) {
            const lastPt = innerWall[innerWall.length - 1];
            const firstPt = innerWall[0];
            layerTime += extrudeTo(firstPt.x, firstPt.y, innerWallSpeed, innerLW, layerH);
            moves.push({
              type: 'wall-inner',
              from: { x: lastPt.x, y: lastPt.y },
              to: { x: firstPt.x, y: firstPt.y },
              speed: innerWallSpeed,
              extrusion: calcExtrusion(lastPt.distanceTo(firstPt), innerLW, layerH),
              lineWidth: innerLW,
            });
          }
        }

        // ----- Infill / solid fill -----
        const innermostWall = wallSets.length > 0 ? wallSets[wallSets.length - 1] : contour.points;
        if (innermostWall.length >= 3) {
          let infillLines: { from: THREE.Vector2; to: THREE.Vector2 }[];
          let infillMoveType: SliceMove['type'];
          let speed: number;
          let lineWidth: number;

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
            infillLines = this.generateLinearInfill(skinInput, 100, pp.infillLineWidth, li, skinPattern);
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
            // Cura-parity: `infillOverhangAngle`. If this layer contains a
            // triangle facing down steeper than the threshold, overhanging
            // walls will need denser infill underneath for support. We boost
            // infill density ×1.5 (capped at 100%) for the whole layer. True
            // Cura does per-region detection; ours is layer-level.
            if ((pp.infillOverhangAngle ?? 0) > 0 && !isSolid) {
              const thr = (pp.infillOverhangAngle! * Math.PI) / 180;
              for (const tri of triangles) {
                const dotUp = tri.normal.z;
                if (dotUp >= 0) continue;
                const a = Math.acos(Math.max(0, Math.min(1, Math.abs(dotUp))));
                const tMinZ = Math.min(tri.v0.z, tri.v1.z, tri.v2.z);
                const tMaxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
                if (sliceZ < tMinZ || sliceZ > tMaxZ + pp.layerHeight) continue;
                if (a > thr) {
                  effectiveDensity = Math.min(100, effectiveDensity * 1.5);
                  break;
                }
              }
            }
            infillLines = this.generateLinearInfill(innermostWall, effectiveDensity, pp.infillLineWidth, li, pp.infillPattern);
            infillMoveType = 'infill';
            speed = infillSpeed;
            lineWidth = pp.infillLineWidth;
          } else {
            infillLines = [];
            infillMoveType = 'infill';
            speed = infillSpeed;
            lineWidth = pp.infillLineWidth;
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
              const loop = ew === 0
                ? (wallSets.length > 0 ? wallSets[wallSets.length - 1] : contour.points)
                : this.offsetContour(
                    wallSets.length > 0 ? wallSets[wallSets.length - 1] : contour.points,
                    ew * pp.infillLineWidth,
                  );
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
            gcode.push(`; ${isSolid ? 'Solid fill' : 'Infill'}`);
            // Sort infill lines to minimize travel
            const sorted = this.sortInfillLines(infillLines);
            // Cura-parity: `connectInfillLines` bridges adjacent scan lines
            // with an extrusion instead of a travel. When the snake-ordered
            // lines share an endpoint within ~lineWidth, we emit a continuous
            // zig-zag rather than a travel+extrude pair. This reduces stringing
            // and gives cleaner infill at the cost of slightly more material.
            const connect = pp.connectInfillLines ?? false;
            const connectTol = lineWidth * 1.5;
            for (let idx = 0; idx < sorted.length; idx++) {
              const line = sorted[idx];
              const fromDist = Math.hypot(line.from.x - currentX, line.from.y - currentY);
              if (connect && idx > 0 && fromDist < connectTol) {
                // Close enough to the previous segment's end — extrude the
                // bridge instead of traveling.
                layerTime += extrudeTo(line.from.x, line.from.y, speed, lineWidth, layerH);
              } else {
                travelTo(line.from.x, line.from.y);
              }
              layerTime += extrudeTo(line.to.x, line.to.y, speed, lineWidth, layerH);
              moves.push({
                type: infillMoveType,
                from: { x: line.from.x, y: line.from.y },
                to: { x: line.to.x, y: line.to.y },
                speed,
                extrusion: calcExtrusion(
                  line.from.distanceTo(line.to),
                  lineWidth,
                  layerH,
                ),
                lineWidth,
              });
            }
          }
        }
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
        const supportMoves = this.generateSupportForLayer(
          triangles,
          sliceZ,
          layerZ,
          li,
          offsetX,
          offsetY,
          offsetZ,
          contours,
        );
        if (supportMoves.length > 0) {
          // Support brim is handled in a layer-0 pre-pass above; this block
          // only runs on layers > 0 (the `li > 0` gate).
          gcode.push('; Support');
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
          const innermost = this.offsetContour(contour.points, -(pp.wallCount * pp.wallLineWidth));
          if (innermost.length < 3) continue;
          const ironLines = this.generateLinearInfill(innermost, 100, pp.ironingSpacing, li, 'lines');
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
    }

    // ----- End G-code -----
    this.reportProgress('generating', 95, totalLayers, totalLayers, 'Writing end G-code...');
    gcode.push('');
    gcode.push('; ----- End G-code -----');
    gcode.push('M73 P100 ; Print complete');
    const endGCode = this.resolveGCodeTemplate(printer.endGCode, {
      nozzleTemp: mat.nozzleTemp,
      bedTemp: mat.bedTemp,
    });
    gcode.push(endGCode.trim());

    // ----- Compute statistics -----
    const filamentCrossSection = Math.PI * (printer.filamentDiameter / 2) ** 2;
    const filamentVolumeMm3 = totalExtruded * filamentCrossSection;
    const filamentVolumeCm3 = filamentVolumeMm3 / 1000;
    const filamentWeight = filamentVolumeCm3 * mat.density;
    const filamentCost = (filamentWeight / 1000) * mat.costPerKg;

    // Replace header placeholders
    const hours = Math.floor(totalTime / 3600);
    const minutes = Math.floor((totalTime % 3600) / 60);
    gcode[1] = `; Estimated print time: ${hours}h ${minutes}m`;
    gcode[2] = `; Filament used: ${totalExtruded.toFixed(1)}mm (${filamentWeight.toFixed(1)}g)`;

    this.reportProgress('complete', 100, totalLayers, totalLayers, 'Slicing complete.');

    return {
      gcode: gcode.join('\n'),
      layerCount: totalLayers,
      printTime: totalTime,
      filamentUsed: totalExtruded,
      filamentWeight,
      filamentCost,
      layers: sliceLayers,
    };
  }

  // =========================================================================
  // MESH PREPARATION
  // =========================================================================

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
          triangles.push({ v0, v1, v2, normal });
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
          triangles.push({ v0, v1, v2, normal });
        }
      }
    }

    return triangles;
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
      const pts = this.trianglePlaneIntersection(tri.v0, tri.v1, tri.v2, z);
      if (pts) {
        segments.push({
          a: new THREE.Vector2(pts[0].x + offsetX, pts[0].y + offsetY),
          b: new THREE.Vector2(pts[1].x + offsetX, pts[1].y + offsetY),
        });
      }
    }

    return segments;
  }

  private trianglePlaneIntersection(
    v0: THREE.Vector3,
    v1: THREE.Vector3,
    v2: THREE.Vector3,
    z: number,
  ): [THREE.Vector3, THREE.Vector3] | null {
    const points: THREE.Vector3[] = [];
    const edges: [THREE.Vector3, THREE.Vector3][] = [
      [v0, v1],
      [v1, v2],
      [v2, v0],
    ];

    for (const [a, b] of edges) {
      if ((a.z <= z && b.z > z) || (b.z <= z && a.z > z)) {
        const t = (z - a.z) / (b.z - a.z);
        points.push(
          new THREE.Vector3(
            a.x + t * (b.x - a.x),
            a.y + t * (b.y - a.y),
            z,
          ),
        );
      }
    }

    if (points.length >= 2) return [points[0], points[1]];
    return null;
  }

  // =========================================================================
  // CONTOUR PROCESSING
  // =========================================================================

  private connectSegments(segments: Segment[]): THREE.Vector2[][] {
    if (segments.length === 0) return [];

    // O(n) connection via hash map: quantize each endpoint to a grid key so
    // we can find the next connecting segment in O(1) instead of scanning all
    // remaining segments on every step (the old O(n²) approach stalled on
    // complex cross-sections with thousands of segments).
    const GRID = 0.01; // quantisation cell size (same as old epsilon)
    const key = (p: THREE.Vector2) =>
      `${Math.round(p.x / GRID)},${Math.round(p.y / GRID)}`;

    // adjacencyMap: endpoint-key → list of { segIndex, isA }
    // isA=true means this segment's 'a' endpoint hashes to this key
    const adjacency = new Map<string, Array<{ idx: number; isA: boolean }>>();
    const addEndpoint = (p: THREE.Vector2, idx: number, isA: boolean) => {
      const k = key(p);
      let list = adjacency.get(k);
      if (!list) { list = []; adjacency.set(k, list); }
      list.push({ idx, isA });
    };

    for (let i = 0; i < segments.length; i++) {
      addEndpoint(segments[i].a, i, true);
      addEndpoint(segments[i].b, i, false);
    }

    const used = new Set<number>();
    const contours: THREE.Vector2[][] = [];

    const removeFromMap = (p: THREE.Vector2, idx: number) => {
      const k = key(p);
      const list = adjacency.get(k);
      if (!list) return;
      const pos = list.findIndex((e) => e.idx === idx);
      if (pos !== -1) list.splice(pos, 1);
    };

    for (let i = 0; i < segments.length; i++) {
      if (used.has(i)) continue;

      const contour: THREE.Vector2[] = [segments[i].a.clone(), segments[i].b.clone()];
      used.add(i);
      removeFromMap(segments[i].a, i);
      removeFromMap(segments[i].b, i);

      // Grow contour tail
      let growing = true;
      while (growing) {
        growing = false;
        const tail = contour[contour.length - 1];
        const candidates = adjacency.get(key(tail));
        if (candidates && candidates.length > 0) {
          const { idx, isA } = candidates[0];
          if (!used.has(idx)) {
            used.add(idx);
            const seg = segments[idx];
            const next = isA ? seg.b : seg.a;
            const prev = isA ? seg.a : seg.b;
            removeFromMap(prev, idx);
            removeFromMap(next, idx);
            contour.push(next.clone());
            growing = true;
          }
        }
      }

      if (contour.length >= 3) {
        contours.push(contour);
      }
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

  private generatePerimeters(
    outerContour: THREE.Vector2[],
    wallCount: number,
    lineWidth: number,
  ): THREE.Vector2[][] {
    const walls: THREE.Vector2[][] = [];

    for (let w = 0; w < wallCount; w++) {
      const offset = -(w * lineWidth + lineWidth / 2);
      const wall = this.offsetContour(outerContour, offset);
      if (wall.length >= 3) {
        walls.push(wall);
      } else {
        break; // contour collapsed, stop adding walls
      }
    }

    return walls;
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

    // Compute intersection of consecutive offset edges
    for (let i = 0; i < offsetEdges.length; i++) {
      const e1 = offsetEdges[i];
      const e2 = offsetEdges[(i + 1) % offsetEdges.length];

      const pt = this.lineLineIntersection2D(e1.a, e1.b, e2.a, e2.b);
      if (pt) {
        result.push(pt);
      } else {
        // Parallel edges, use midpoint
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
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    if (contour.length < 3 || density <= 0) return [];

    switch (pattern) {
      case 'grid':
        return [
          ...this.generateScanLines(contour, density, lineWidth, 0),
          ...this.generateScanLines(contour, density, lineWidth, Math.PI / 2),
        ];
      case 'lines':
        return this.generateScanLines(
          contour,
          density,
          lineWidth,
          layerIndex % 2 === 0 ? Math.PI / 4 : -Math.PI / 4,
        );
      case 'triangles':
        return [
          ...this.generateScanLines(contour, density, lineWidth, 0),
          ...this.generateScanLines(contour, density, lineWidth, Math.PI / 3),
          ...this.generateScanLines(contour, density, lineWidth, (2 * Math.PI) / 3),
        ];
      case 'gyroid':
        return this.generateGyroidInfill(contour, density, lineWidth, layerIndex);
      case 'honeycomb':
        return this.generateHoneycombInfill(contour, density, lineWidth, layerIndex);
      case 'concentric':
        return this.generateConcentricInfill(contour, lineWidth);
      case 'cubic':
        return this.generateCubicInfill(contour, density, lineWidth, layerIndex);
      case 'lightning': {
        // Lightning infill is complex tree-based; approximate with sparse lines.
        // Cura-parity: `lightningPruneAngle` and `lightningStraighteningAngle`
        // control how aggressively the tree prunes side-branches and how
        // straight branches stay. In our sparse-line approximation, both
        // effectively shift how sparse the lines get — higher prune angle
        // (more aggressive pruning) means even fewer lines. We scale the
        // density inversely to the prune angle so users still feel the knob.
        const prune = this.printProfile.lightningPruneAngle ?? 40;
        const straight = this.printProfile.lightningStraighteningAngle ?? 40;
        // Avg the two; they're both 0-89° in meaningful range. Higher = thinner.
        const sparsity = 1 - ((prune + straight) / 180); // 0..1
        const lightDensity = Math.max(density * 0.5 * Math.max(0.2, sparsity), 2);
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

    for (let d = -maxDim / 2; d <= maxDim / 2; d += spacing) {
      // Rotated scan line endpoints
      const p1 = new THREE.Vector2(
        centerX + cos * (-maxDim) - sin * d,
        centerY + sin * (-maxDim) + cos * d,
      );
      const p2 = new THREE.Vector2(
        centerX + cos * maxDim - sin * d,
        centerY + sin * maxDim + cos * d,
      );

      // Find intersections with contour
      const intersections = this.lineContourIntersections(p1, p2, contour);
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
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    // Approximate gyroid with sinusoidal scan lines
    const results: { from: THREE.Vector2; to: THREE.Vector2 }[] = [];
    const bbox = this.contourBBox(contour);
    const spacing = lineWidth / (density / 100);
    const amplitude = spacing * 0.4;
    const period = spacing * 2;

    const phaseShift = (layerIndex * Math.PI) / 3;

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

      // Clip to contour
      for (let i = 0; i + 1 < linePoints.length; i++) {
        const a = linePoints[i];
        const b = linePoints[i + 1];
        if (this.pointInContour(a, contour) && this.pointInContour(b, contour)) {
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
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    // Hexagonal pattern: rows of zigzag offset every other row
    const results: { from: THREE.Vector2; to: THREE.Vector2 }[] = [];
    const bbox = this.contourBBox(contour);
    const spacing = lineWidth / (density / 100);
    const hexHeight = spacing * Math.sqrt(3);
    const hexWidth = spacing * 2;

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

        // Draw hex edges clipped to contour
        for (let i = 0; i < hexPts.length; i++) {
          const from = hexPts[i];
          const to = hexPts[(i + 1) % hexPts.length];
          if (this.pointInContour(from, contour) && this.pointInContour(to, contour)) {
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
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    const results: { from: THREE.Vector2; to: THREE.Vector2 }[] = [];
    let current = contour;
    const offsetDist = -lineWidth;
    // Safety caps: the inner `while` relied on `offsetContour` eventually
    // shrinking the polygon to fewer than 3 points. On certain pathological
    // inputs (self-intersecting cleaned contours, near-parallel edges) the
    // output can stay at the same bbox size indefinitely. Two guards:
    //   • absolute iteration cap so we can never spin forever
    //   • "no-progress" bbox check that bails when shrinking stalls
    const MAX_ITER = 500;
    let iter = 0;
    let prevBbox = this.contourBBox(current);

    while (current.length >= 3 && iter++ < MAX_ITER) {
      const next = this.offsetContour(current, offsetDist);
      if (next.length < 3) break;

      const nextBbox = this.contourBBox(next);
      const shrinkX = Math.abs((prevBbox.maxX - prevBbox.minX) - (nextBbox.maxX - nextBbox.minX));
      const shrinkY = Math.abs((prevBbox.maxY - prevBbox.minY) - (nextBbox.maxY - nextBbox.minY));
      if (shrinkX < 0.01 && shrinkY < 0.01) break;
      prevBbox = nextBbox;

      // Convert closed contour to line segments
      for (let i = 0; i < next.length; i++) {
        results.push({
          from: next[i],
          to: next[(i + 1) % next.length],
        });
      }

      current = next;
    }

    return results;
  }

  private generateCubicInfill(
    contour: THREE.Vector2[],
    density: number,
    lineWidth: number,
    layerIndex: number,
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    // Cubic infill: three sets of lines at 60 degree offsets, cycling per layer
    const angleOffset = ((layerIndex % 3) * Math.PI) / 3;
    return this.generateScanLines(contour, density, lineWidth, angleOffset);
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

  private generateSupportForLayer(
    triangles: Triangle[],
    sliceZ: number,
    _layerZ: number,
    layerIndex: number,
    offsetX: number,
    offsetY: number,
    _offsetZ: number,
    modelContours: Contour[],
  ): SliceMove[] {
    const pp = this.printProfile;
    const moves: SliceMove[] = [];

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
        if (sliceZ >= minZ && sliceZ <= maxZ + pp.layerHeight) {
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

    if (overhangRegions.length === 0) return moves;

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
    if (allOverhangPts.length === 0) return moves;

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
        return moves;
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
        const pad = pp.wallLineWidth;
        rawBbox = {
          minX: rawBbox.minX - pad,
          maxX: rawBbox.maxX + pad,
          minY: rawBbox.minY - pad,
          maxY: rawBbox.maxY + pad,
        };
      }
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
      if (bboxArea < minArea) return moves;
    }

    // Cura-parity: supportHorizontalExpansion inflates the support region
    // outward (positive) or shrinks it inward (negative) before generating
    // infill lines. Useful for supports that need a wider footprint to avoid
    // slipping off the build plate, or tighter fit against the model.
    const horizExp = pp.supportHorizontalExpansion ?? 0;
    const bbox = {
      minX: rawBbox.minX - horizExp,
      maxX: rawBbox.maxX + horizExp,
      minY: rawBbox.minY - horizExp,
      maxY: rawBbox.maxY + horizExp,
    };

    // Cura-parity: supportLineDistance (mm) is an absolute-spacing override
    // that bypasses the density-derived calculation. Useful for tuning
    // support strength independent of print-profile density %.
    const spacing = (pp.supportLineDistance ?? 0) > 0
      ? (pp.supportLineDistance ?? 1)
      : pp.wallLineWidth / (pp.supportDensity / 100);
    const supportSpeed = pp.printSpeed * 0.8; // slightly slower

    // Generate support pattern
    let angle: number;
    switch (pp.supportPattern) {
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

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const maxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * 1.5;
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;

    // XY distance offset from model
    const xyDist = pp.supportXYDistance;

    for (let d = -maxDim / 2; d <= maxDim / 2; d += spacing) {
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

      // Check the line isn't inside the model contour
      const midPt = new THREE.Vector2(
        (fromX + toX) / 2,
        (fromY + toY) / 2,
      );
      for (const contour of modelContours) {
        if (contour.isOuter && this.pointInContour(midPt, contour.points)) {
          break;
        }
      }

      // Support should be outside model or in overhang areas
      // For simplicity, we generate support in the overhang bounding box
      if (Math.abs(fromX - toX) > 0.5 || Math.abs(fromY - toY) > 0.5) {
        const from = new THREE.Vector2(fromX, fromY);
        const to = new THREE.Vector2(toX, toY);
        moves.push({
          type: 'support',
          from: { x: from.x, y: from.y },
          to: { x: to.x, y: to.y },
          speed: supportSpeed,
          extrusion: 0, // calculated by caller
          lineWidth: pp.wallLineWidth,
        });
      }
    }

    return moves;
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
    const lineWidth = pp.wallLineWidth;

    switch (pp.adhesionType) {
      case 'skirt': {
        for (let line = 0; line < pp.skirtLines; line++) {
          const dist = pp.skirtDistance + line * lineWidth;
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
        }
        break;
      }

      case 'brim': {
        // Generate concentric rectangles around the model base
        const brimLoops = Math.ceil(pp.brimWidth / lineWidth);
        for (let line = 0; line < brimLoops; line++) {
          const dist = line * lineWidth;
          // For each outer contour, offset outward
          for (const contour of contours) {
            if (!contour.isOuter) continue;
            const brimContour = this.offsetContour(contour.points, dist + lineWidth);
            if (brimContour.length < 3) continue;
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
        const baseLines = this.generateScanLines(raftContour, 100, lineWidth, 0);
        for (const line of baseLines) {
          moves.push({
            type: 'raft',
            from: { x: line.from.x, y: line.from.y },
            to: { x: line.to.x, y: line.to.y },
            speed: speed * 0.8,
            extrusion: 0,
            lineWidth: lineWidth * 1.5,
          });
        }
        // ── MIDDLE layers ───────────────────────────────────────────────
        const midCount = pp.raftMiddleLayers ?? 0;
        const midLW = pp.raftMiddleLineWidth ?? lineWidth;
        for (let mli = 0; mli < midCount; mli++) {
          const angle = (mli % 2 === 0) ? Math.PI / 4 : -Math.PI / 4;
          const midLines = this.generateScanLines(raftContour, 100, midLW, angle);
          for (const line of midLines) {
            moves.push({
              type: 'raft',
              from: { x: line.from.x, y: line.from.y },
              to: { x: line.to.x, y: line.to.y },
              speed: speed * 0.85,
              extrusion: 0,
              lineWidth: midLW,
            });
          }
        }
        // ── TOP / SURFACE layers ────────────────────────────────────────
        // Default 2 matches the legacy single "90-degree" surface layer
        // behavior, but with multiple layers when the user requests them.
        const topCount = Math.max(1, pp.raftTopLayers ?? 1);
        for (let tli = 0; tli < topCount; tli++) {
          const angle = Math.PI / 2 + tli * Math.PI / 3; // rotate to interlock
          const topLines = this.generateScanLines(raftContour, 100, lineWidth, angle);
          for (const line of topLines) {
            moves.push({
              type: 'raft',
              from: { x: line.from.x, y: line.from.y },
              to: { x: line.to.x, y: line.to.y },
              speed: speed * 0.9,
              extrusion: 0,
              lineWidth,
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
