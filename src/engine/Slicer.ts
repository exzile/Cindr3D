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

    // Precompute which layers are top/bottom solid
    const solidBottom = pp.bottomLayers;
    const solidTop = pp.topLayers;

    // ----- 4. Slice layer by layer -----
    const sliceLayers: SliceLayer[] = [];
    let totalExtruded = 0; // mm of filament
    let totalTime = 0; // seconds

    // Track extruder state
    let currentE = 0;
    let currentX = 0;
    let currentY = 0;
    let isRetracted = false;

    const gcode: string[] = [];

    // Helper: calculate extrusion length for a move
    const calcExtrusion = (distance: number, lineWidth: number, layerH: number): number => {
      const filamentArea = Math.PI * (printer.filamentDiameter / 2) ** 2;
      const volumePerMm = lineWidth * layerH;
      return (volumePerMm / filamentArea) * distance * mat.flowRate;
    };

    // Helper: retract
    const doRetract = (): void => {
      if (!isRetracted && mat.retractionDistance > 0) {
        currentE -= mat.retractionDistance;
        gcode.push(`G1 E${currentE.toFixed(5)} F${(mat.retractionSpeed * 60).toFixed(0)}`);
        if (mat.retractionZHop > 0) {
          gcode.push(`G91`);
          gcode.push(`G1 Z${mat.retractionZHop.toFixed(3)} F${(pp.travelSpeed * 60).toFixed(0)}`);
          gcode.push(`G90`);
        }
        isRetracted = true;
      }
    };

    // Helper: unretract
    const doUnretract = (): void => {
      if (isRetracted && mat.retractionDistance > 0) {
        if (mat.retractionZHop > 0) {
          gcode.push(`G91`);
          gcode.push(`G1 Z${(-mat.retractionZHop).toFixed(3)} F${(pp.travelSpeed * 60).toFixed(0)}`);
          gcode.push(`G90`);
        }
        currentE += mat.retractionDistance;
        gcode.push(`G1 E${currentE.toFixed(5)} F${(mat.retractionSpeed * 60).toFixed(0)}`);
        isRetracted = false;
      }
    };

    // Helper: travel move (with retraction)
    const travelTo = (x: number, y: number): void => {
      doRetract();
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

      // Determine if this is a solid layer (top or bottom)
      const isSolidBottom = li < solidBottom;
      const isSolidTop = li >= totalLayers - solidTop;
      const isSolid = isSolidBottom || isSolidTop;

      // Determine speeds
      const outerWallSpeed = isFirstLayer ? pp.firstLayerSpeed : pp.outerWallSpeed;
      const innerWallSpeed = isFirstLayer ? pp.firstLayerSpeed : pp.wallSpeed;
      const infillSpeed = isFirstLayer ? pp.firstLayerSpeed : pp.infillSpeed;
      const topBottomSpeed = isFirstLayer ? pp.firstLayerSpeed : pp.topSpeed;

      const moves: SliceMove[] = [];

      // ----- Layer header -----
      gcode.push('');
      gcode.push(`; ----- Layer ${li}, Z=${layerZ.toFixed(3)} -----`);
      gcode.push(`G1 Z${layerZ.toFixed(3)} F${(pp.travelSpeed * 60).toFixed(0)}`);

      // Progress reporting
      if (totalLayers > 0) {
        const pctDone = Math.round((li / totalLayers) * 100);
        gcode.push(`M73 P${pctDone} ; Progress`);
      }

      // ----- Temperature changes -----
      if (li === 1) {
        // Switch from first layer temps to normal temps
        gcode.push(`M104 S${mat.nozzleTemp} ; Normal nozzle temp`);
        if (printer.hasHeatedBed) {
          gcode.push(`M140 S${mat.bedTemp} ; Normal bed temp`);
        }
      }

      // ----- Fan control -----
      if (li === mat.fanDisableFirstLayers) {
        const fanS = Math.round((mat.fanSpeedMin / 100) * 255);
        gcode.push(`M106 S${fanS} ; Enable fan`);
      }
      if (li > mat.fanDisableFirstLayers && li <= mat.fanDisableFirstLayers + 3) {
        // Ramp up fan
        const rampFraction = (li - mat.fanDisableFirstLayers) / 3;
        const fanPct = mat.fanSpeedMin + (mat.fanSpeedMax - mat.fanSpeedMin) * Math.min(rampFraction, 1);
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

      // ----- For each contour, generate walls, then infill -----
      for (const contour of contours) {
        if (!contour.isOuter) continue; // process outer contours only; inner holes handled during offset

        // Generate perimeters (walls)
        const wallSets = this.generatePerimeters(contour.points, pp.wallCount, pp.wallLineWidth);

        // Outer wall
        if (wallSets.length > 0) {
          const outerWall = wallSets[0];
          if (outerWall.length >= 2) {
            // Find seam position
            const seamIdx = this.findSeamPosition(outerWall, pp.zSeamAlignment, li);
            const reordered = this.reorderFromIndex(outerWall, seamIdx);

            travelTo(reordered[0].x, reordered[0].y);
            gcode.push(`; Outer wall`);
            for (let pi = 1; pi < reordered.length; pi++) {
              const from = reordered[pi - 1];
              const to = reordered[pi];
              layerTime += extrudeTo(to.x, to.y, outerWallSpeed, pp.wallLineWidth, layerH);
              moves.push({
                type: 'wall-outer',
                from: { x: from.x, y: from.y },
                to: { x: to.x, y: to.y },
                speed: outerWallSpeed,
                extrusion: calcExtrusion(from.distanceTo(to), pp.wallLineWidth, layerH),
                lineWidth: pp.wallLineWidth,
              });
            }
            // Close the loop
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

        // Inner walls
        for (let wi = 1; wi < wallSets.length; wi++) {
          const innerWall = wallSets[wi];
          if (innerWall.length < 2) continue;
          travelTo(innerWall[0].x, innerWall[0].y);
          gcode.push(`; Inner wall ${wi}`);
          for (let pi = 1; pi < innerWall.length; pi++) {
            const from = innerWall[pi - 1];
            const to = innerWall[pi];
            layerTime += extrudeTo(to.x, to.y, innerWallSpeed, pp.wallLineWidth, layerH);
            moves.push({
              type: 'wall-inner',
              from: { x: from.x, y: from.y },
              to: { x: to.x, y: to.y },
              speed: innerWallSpeed,
              extrusion: calcExtrusion(from.distanceTo(to), pp.wallLineWidth, layerH),
              lineWidth: pp.wallLineWidth,
            });
          }
          // Close loop
          if (innerWall.length > 2) {
            const lastPt = innerWall[innerWall.length - 1];
            const firstPt = innerWall[0];
            layerTime += extrudeTo(firstPt.x, firstPt.y, innerWallSpeed, pp.wallLineWidth, layerH);
            moves.push({
              type: 'wall-inner',
              from: { x: lastPt.x, y: lastPt.y },
              to: { x: firstPt.x, y: firstPt.y },
              speed: innerWallSpeed,
              extrusion: calcExtrusion(lastPt.distanceTo(firstPt), pp.wallLineWidth, layerH),
              lineWidth: pp.wallLineWidth,
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
            // Solid top/bottom fill at 100% density
            infillLines = this.generateLinearInfill(innermostWall, 100, pp.infillLineWidth, li, pp.topBottomPattern === 'concentric' ? 'concentric' : 'lines');
            infillMoveType = 'top-bottom';
            speed = topBottomSpeed;
            lineWidth = pp.infillLineWidth;
          } else if (pp.infillDensity > 0) {
            infillLines = this.generateLinearInfill(innermostWall, pp.infillDensity, pp.infillLineWidth, li, pp.infillPattern);
            infillMoveType = 'infill';
            speed = infillSpeed;
            lineWidth = pp.infillLineWidth;
          } else {
            infillLines = [];
            infillMoveType = 'infill';
            speed = infillSpeed;
            lineWidth = pp.infillLineWidth;
          }

          if (infillLines.length > 0) {
            gcode.push(`; ${isSolid ? 'Solid fill' : 'Infill'}`);
            // Sort infill lines to minimize travel
            const sorted = this.sortInfillLines(infillLines);
            for (const line of sorted) {
              travelTo(line.from.x, line.from.y);
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

      // ----- Support generation -----
      if (pp.supportEnabled && li > 0) {
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
          gcode.push('; Support');
          for (const sm of supportMoves) {
            travelTo(sm.from.x, sm.from.y);
            layerTime += extrudeTo(sm.to.x, sm.to.y, sm.speed, sm.lineWidth, layerH);
            moves.push(sm);
          }
        }
      }

      // ----- Ironing -----
      if (pp.ironingEnabled && isSolidTop) {
        gcode.push('; Ironing');
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
            const e = calcExtrusion(dist, pp.ironingSpacing, layerH) * (pp.ironingFlow / 100);
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
          const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
          triangles.push({ v0, v1, v2, normal });
        }
      } else {
        for (let i = 0; i < posAttr.count; i += 3) {
          const v0 = getVertex(i);
          const v1 = getVertex(i + 1);
          const v2 = getVertex(i + 2);
          const edge1 = new THREE.Vector3().subVectors(v1, v0);
          const edge2 = new THREE.Vector3().subVectors(v2, v0);
          const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
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
    alignment: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _layerIndex: number,
  ): number {
    if (contour.length === 0) return 0;

    switch (alignment) {
      case 'random':
        return Math.floor(Math.random() * contour.length);

      case 'aligned':
        // Always start from the point closest to (0, maxY) -- back-left
        return this.closestPointIndex(contour, new THREE.Vector2(0, 1e6));

      case 'sharpest_corner': {
        // Find the point with the sharpest angle
        let sharpestIdx = 0;
        let sharpestAngle = Math.PI * 2;
        const n = contour.length;
        for (let i = 0; i < n; i++) {
          const prev = contour[(i - 1 + n) % n];
          const curr = contour[i];
          const next = contour[(i + 1) % n];
          const v1 = new THREE.Vector2().subVectors(prev, curr).normalize();
          const v2 = new THREE.Vector2().subVectors(next, curr).normalize();
          const angle = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
          if (angle < sharpestAngle) {
            sharpestAngle = angle;
            sharpestIdx = i;
          }
        }
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
      case 'lightning':
        // Lightning infill is complex tree-based; approximate with sparse lines
        return this.generateScanLines(
          contour,
          Math.max(density * 0.5, 5),
          lineWidth,
          layerIndex % 3 === 0 ? 0 : layerIndex % 3 === 1 ? Math.PI / 3 : (2 * Math.PI) / 3,
        );
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
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;

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

      // Pair intersections into segments
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const t1 = intersections[i];
        const t2 = intersections[i + 1];
        const dir = new THREE.Vector2().subVectors(p2, p1);
        const start = new THREE.Vector2().addVectors(p1, dir.clone().multiplyScalar(t1));
        const end = new THREE.Vector2().addVectors(p1, dir.clone().multiplyScalar(t2));
        if (start.distanceTo(end) > 0.1) {
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

    while (current.length >= 3) {
      const next = this.offsetContour(current, offsetDist);
      if (next.length < 3) break;

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
      const faceAngle = Math.acos(Math.min(1, Math.abs(dotUp)));

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

    // Generate support infill in overhang regions
    // Merge all overhang triangles into a bounding region and generate support pattern
    const allOverhangPts: THREE.Vector2[] = [];
    for (const region of overhangRegions) {
      allOverhangPts.push(...region);
    }
    if (allOverhangPts.length === 0) return moves;

    const bbox = this.pointsBBox(allOverhangPts);
    const spacing = pp.wallLineWidth / (pp.supportDensity / 100);
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
        // Generate a solid platform under the model
        const raftMargin = 3; // mm extra around model
        const raftContour = [
          new THREE.Vector2(minX - raftMargin, minY - raftMargin),
          new THREE.Vector2(maxX + raftMargin, minY - raftMargin),
          new THREE.Vector2(maxX + raftMargin, maxY + raftMargin),
          new THREE.Vector2(minX - raftMargin, maxY + raftMargin),
        ];
        const raftLines = this.generateScanLines(raftContour, 100, lineWidth, 0);
        for (const line of raftLines) {
          moves.push({
            type: 'raft',
            from: { x: line.from.x, y: line.from.y },
            to: { x: line.to.x, y: line.to.y },
            speed: speed * 0.8,
            extrusion: 0,
            lineWidth: lineWidth * 1.5,
          });
        }
        // Second raft layer at 90 degrees
        const raftLines2 = this.generateScanLines(raftContour, 100, lineWidth, Math.PI / 2);
        for (const line of raftLines2) {
          moves.push({
            type: 'raft',
            from: { x: line.from.x, y: line.from.y },
            to: { x: line.to.x, y: line.to.y },
            speed: speed * 0.8,
            extrusion: 0,
            lineWidth: lineWidth * 1.5,
          });
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
