import * as THREE from 'three';

export interface SlicerSettings {
  // Layer settings
  layerHeight: number;         // mm (typical: 0.2)
  firstLayerHeight: number;    // mm (typical: 0.3)

  // Extrusion
  nozzleDiameter: number;      // mm (typical: 0.4)
  filamentDiameter: number;    // mm (typical: 1.75)
  extrusionMultiplier: number; // (typical: 1.0)

  // Temperatures
  nozzleTemp: number;          // C (typical: 200-220 for PLA)
  bedTemp: number;             // C (typical: 60 for PLA)

  // Speed (mm/min)
  printSpeed: number;          // mm/s (typical: 50)
  firstLayerSpeed: number;     // mm/s (typical: 25)
  travelSpeed: number;         // mm/s (typical: 150)

  // Infill
  infillDensity: number;       // 0-100%
  infillPattern: 'lines' | 'grid' | 'triangles' | 'gyroid';

  // Shell
  wallCount: number;           // (typical: 2-3)
  topLayers: number;           // (typical: 3-4)
  bottomLayers: number;        // (typical: 3-4)

  // Support
  supportEnabled: boolean;
  supportAngle: number;        // degrees (typical: 45)
  supportDensity: number;      // 0-100%

  // Bed
  bedSizeX: number;            // mm
  bedSizeY: number;            // mm
  bedSizeZ: number;            // mm

  // Retraction
  retractionDistance: number;   // mm (typical: 5)
  retractionSpeed: number;     // mm/s (typical: 45)

  // Skirt/Brim
  skirtLines: number;          // (typical: 2)
  brimWidth: number;           // mm (0 = disabled)

  // Fan
  fanSpeed: number;            // 0-100%
  fanStartLayer: number;       // (typical: 2)
}

export const DEFAULT_SLICER_SETTINGS: SlicerSettings = {
  layerHeight: 0.2,
  firstLayerHeight: 0.3,
  nozzleDiameter: 0.4,
  filamentDiameter: 1.75,
  extrusionMultiplier: 1.0,
  nozzleTemp: 210,
  bedTemp: 60,
  printSpeed: 50,
  firstLayerSpeed: 25,
  travelSpeed: 150,
  infillDensity: 20,
  infillPattern: 'grid',
  wallCount: 2,
  topLayers: 4,
  bottomLayers: 3,
  supportEnabled: false,
  supportAngle: 45,
  supportDensity: 15,
  bedSizeX: 220,
  bedSizeY: 220,
  bedSizeZ: 250,
  retractionDistance: 5,
  retractionSpeed: 45,
  skirtLines: 2,
  brimWidth: 0,
  fanSpeed: 100,
  fanStartLayer: 2,
};

interface SliceLayer {
  z: number;
  paths: SlicePath[];
}

interface SlicePath {
  type: 'perimeter' | 'infill' | 'support' | 'skirt' | 'brim';
  points: THREE.Vector2[];
  closed: boolean;
}

export class GCodeGenerator {
  private settings: SlicerSettings;
  private gcode: string[] = [];
  private currentE = 0; // extruder position
  private currentX = 0;
  private currentY = 0;

  constructor(settings: SlicerSettings = DEFAULT_SLICER_SETTINGS) {
    this.settings = settings;
  }

  /**
   * Generate G-code from a Three.js mesh by slicing it layer by layer
   */
  generate(object: THREE.Object3D): string {
    this.gcode = [];
    this.currentE = 0;

    // Get bounding box
    const bbox = new THREE.Box3().setFromObject(object);
    const min = bbox.min;
    const max = bbox.max;

    // Center on bed
    const centerX = this.settings.bedSizeX / 2;
    const centerY = this.settings.bedSizeY / 2;
    const offsetX = centerX - (min.x + max.x) / 2;
    const offsetY = centerY - (min.y + max.y) / 2;

    // Collect triangles
    const triangles = this.collectTriangles(object);

    // Generate layers
    const layers = this.sliceMesh(triangles, min.z, max.z, offsetX, offsetY);

    // Estimate print time
    const totalLayers = layers.length;
    const estimatedMinutes = Math.round(totalLayers * 0.5);

    // Write header
    this.writeHeader(estimatedMinutes, totalLayers);

    // Write start G-code
    this.writeStartGCode();

    // Write skirt if enabled
    if (this.settings.skirtLines > 0 && layers.length > 0) {
      this.writeSkirt(layers[0], bbox, offsetX, offsetY);
    }

    // Process each layer
    for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
      const layer = layers[layerIdx];
      const isFirstLayer = layerIdx === 0;
      const speed = isFirstLayer ? this.settings.firstLayerSpeed : this.settings.printSpeed;

      this.gcode.push('');
      this.gcode.push(`; Layer ${layerIdx}, Z=${layer.z.toFixed(3)}`);

      // Move to layer height
      this.gcode.push(`G1 Z${layer.z.toFixed(3)} F${this.settings.travelSpeed * 60}`);

      // Fan control
      if (layerIdx === this.settings.fanStartLayer) {
        this.gcode.push(`M106 S${Math.round(this.settings.fanSpeed * 2.55)}`);
      }

      // Print paths
      for (const path of layer.paths) {
        this.writePath(path, speed);
      }
    }

    // Write end G-code
    this.writeEndGCode();

    return this.gcode.join('\n');
  }

  /**
   * Estimate print time and filament usage
   */
  estimate(object: THREE.Object3D): PrintEstimate {
    const bbox = new THREE.Box3().setFromObject(object);
    const volume = (bbox.max.x - bbox.min.x) * (bbox.max.y - bbox.min.y) * (bbox.max.z - bbox.min.z);
    const layerCount = Math.ceil((bbox.max.z - bbox.min.z) / this.settings.layerHeight);

    // Rough estimates based on volume and settings
    const fillRatio = this.settings.infillDensity / 100;
    const materialVolume = volume * (0.3 + fillRatio * 0.7); // shell + infill
    const filamentCrossSection = Math.PI * Math.pow(this.settings.filamentDiameter / 2, 2);
    const filamentLength = materialVolume / filamentCrossSection;
    const filamentWeight = filamentLength * filamentCrossSection * 1.24; // PLA density ~1.24 g/cm3

    const avgSpeed = (this.settings.printSpeed + this.settings.firstLayerSpeed) / 2;
    const printTimeMinutes = Math.round(layerCount * 2 + (filamentLength / avgSpeed / 60));

    return {
      layerCount,
      filamentLengthMm: Math.round(filamentLength),
      filamentWeightG: Math.round(filamentWeight * 10) / 10,
      estimatedTimeMinutes: printTimeMinutes,
      dimensions: {
        x: Math.round((bbox.max.x - bbox.min.x) * 10) / 10,
        y: Math.round((bbox.max.y - bbox.min.y) * 10) / 10,
        z: Math.round((bbox.max.z - bbox.min.z) * 10) / 10,
      },
    };
  }

  private sliceMesh(
    triangles: MeshTriangle[],
    minZ: number,
    maxZ: number,
    offsetX: number,
    offsetY: number
  ): SliceLayer[] {
    const layers: SliceLayer[] = [];
    let z = minZ + this.settings.firstLayerHeight;
    let isFirstLayer = true;

    while (z <= maxZ) {
      const contours = this.sliceAtZ(triangles, z, offsetX, offsetY);
      const paths: SlicePath[] = [];

      // Generate perimeters
      for (const contour of contours) {
        // Outer wall
        paths.push({ type: 'perimeter', points: contour, closed: true });

        // Inner walls (offset inward)
        for (let w = 1; w < this.settings.wallCount; w++) {
          const inset = this.offsetContour(contour, -w * this.settings.nozzleDiameter);
          if (inset.length > 2) {
            paths.push({ type: 'perimeter', points: inset, closed: true });
          }
        }

        // Infill
        const infillOffset = this.settings.wallCount * this.settings.nozzleDiameter;
        const innerContour = this.offsetContour(contour, -infillOffset);
        if (innerContour.length > 2 && this.settings.infillDensity > 0) {
          const infillPaths = this.generateInfill(innerContour, z, layers.length);
          paths.push(...infillPaths);
        }
      }

      layers.push({ z, paths });
      z += isFirstLayer ? this.settings.firstLayerHeight : this.settings.layerHeight;
      isFirstLayer = false;
    }

    return layers;
  }

  private sliceAtZ(
    triangles: MeshTriangle[],
    z: number,
    offsetX: number,
    offsetY: number
  ): THREE.Vector2[][] {
    const segments: [THREE.Vector2, THREE.Vector2][] = [];

    for (const tri of triangles) {
      const [v0, v1, v2] = tri.vertices;
      const intersection = this.trianglePlaneIntersection(v0, v1, v2, z);
      if (intersection) {
        segments.push([
          new THREE.Vector2(intersection[0].x + offsetX, intersection[0].y + offsetY),
          new THREE.Vector2(intersection[1].x + offsetX, intersection[1].y + offsetY),
        ]);
      }
    }

    // Connect segments into contours
    return this.connectSegments(segments);
  }

  private trianglePlaneIntersection(
    v0: THREE.Vector3, v1: THREE.Vector3, v2: THREE.Vector3, z: number
  ): [THREE.Vector3, THREE.Vector3] | null {
    const points: THREE.Vector3[] = [];
    const edges: [THREE.Vector3, THREE.Vector3][] = [[v0, v1], [v1, v2], [v2, v0]];

    for (const [a, b] of edges) {
      if ((a.z <= z && b.z > z) || (b.z <= z && a.z > z)) {
        const t = (z - a.z) / (b.z - a.z);
        points.push(new THREE.Vector3(
          a.x + t * (b.x - a.x),
          a.y + t * (b.y - a.y),
          z
        ));
      }
    }

    if (points.length >= 2) return [points[0], points[1]];
    return null;
  }

  private connectSegments(segments: [THREE.Vector2, THREE.Vector2][]): THREE.Vector2[][] {
    if (segments.length === 0) return [];

    const contours: THREE.Vector2[][] = [];
    const used = new Set<number>();
    const epsilon = 0.01;

    for (let i = 0; i < segments.length; i++) {
      if (used.has(i)) continue;

      const contour: THREE.Vector2[] = [segments[i][0], segments[i][1]];
      used.add(i);

      let changed = true;
      while (changed) {
        changed = false;
        for (let j = 0; j < segments.length; j++) {
          if (used.has(j)) continue;
          const last = contour[contour.length - 1];

          if (last.distanceTo(segments[j][0]) < epsilon) {
            contour.push(segments[j][1]);
            used.add(j);
            changed = true;
          } else if (last.distanceTo(segments[j][1]) < epsilon) {
            contour.push(segments[j][0]);
            used.add(j);
            changed = true;
          }
        }
      }

      if (contour.length > 2) contours.push(contour);
    }

    return contours;
  }

  private offsetContour(contour: THREE.Vector2[], offset: number): THREE.Vector2[] {
    if (contour.length < 3) return [];

    const result: THREE.Vector2[] = [];
    const n = contour.length;

    for (let i = 0; i < n; i++) {
      const prev = contour[(i - 1 + n) % n];
      const curr = contour[i];
      const next = contour[(i + 1) % n];

      // Edge normals
      const e1 = new THREE.Vector2(curr.y - prev.y, prev.x - curr.x).normalize();
      const e2 = new THREE.Vector2(next.y - curr.y, curr.x - next.x).normalize();

      // Bisector
      const bisector = new THREE.Vector2(e1.x + e2.x, e1.y + e2.y).normalize();
      const dot = e1.dot(bisector);
      const dist = dot !== 0 ? offset / dot : offset;

      result.push(new THREE.Vector2(
        curr.x + bisector.x * dist,
        curr.y + bisector.y * dist
      ));
    }

    return result;
  }

  private generateInfill(contour: THREE.Vector2[], _z: number, layerIndex: number): SlicePath[] {
    const paths: SlicePath[] = [];
    const bbox = this.contourBBox(contour);
    const spacing = this.settings.nozzleDiameter / (this.settings.infillDensity / 100);
    const angle = this.settings.infillPattern === 'grid'
      ? (layerIndex % 2 === 0 ? 0 : Math.PI / 2)
      : (layerIndex % 2 === 0 ? Math.PI / 4 : -Math.PI / 4);

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Generate scan lines
    const maxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * 1.5;
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;

    for (let d = -maxDim / 2; d <= maxDim / 2; d += spacing) {
      // Rotated scan line
      const p1 = new THREE.Vector2(
        centerX + cos * (-maxDim) - sin * d,
        centerY + sin * (-maxDim) + cos * d
      );
      const p2 = new THREE.Vector2(
        centerX + cos * maxDim - sin * d,
        centerY + sin * maxDim + cos * d
      );

      // Intersect with contour
      const intersections = this.lineContourIntersections(p1, p2, contour);
      intersections.sort((a, b) => a - b);

      // Create infill segments from pairs
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const t1 = intersections[i];
        const t2 = intersections[i + 1];
        const dir = new THREE.Vector2().subVectors(p2, p1);
        const start = new THREE.Vector2().addVectors(p1, dir.clone().multiplyScalar(t1));
        const end = new THREE.Vector2().addVectors(p1, dir.clone().multiplyScalar(t2));

        paths.push({
          type: 'infill',
          points: [start, end],
          closed: false,
        });
      }
    }

    return paths;
  }

  private lineContourIntersections(
    p1: THREE.Vector2, p2: THREE.Vector2, contour: THREE.Vector2[]
  ): number[] {
    const results: number[] = [];
    const n = contour.length;

    for (let i = 0; i < n; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % n];

      const t = this.lineLineIntersection(p1, p2, a, b);
      if (t !== null) results.push(t);
    }

    return results;
  }

  private lineLineIntersection(
    p1: THREE.Vector2, p2: THREE.Vector2,
    p3: THREE.Vector2, p4: THREE.Vector2
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

  private contourBBox(contour: THREE.Vector2[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of contour) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }

  private collectTriangles(object: THREE.Object3D): MeshTriangle[] {
    const triangles: MeshTriangle[] = [];

    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geometry = child.geometry;
        const posAttr = geometry.getAttribute('position');
        if (!posAttr) return;

        const matrixWorld = child.matrixWorld;
        const index = geometry.getIndex();

        if (index) {
          for (let i = 0; i < index.count; i += 3) {
            const vA = new THREE.Vector3().fromBufferAttribute(posAttr, index.getX(i)).applyMatrix4(matrixWorld);
            const vB = new THREE.Vector3().fromBufferAttribute(posAttr, index.getX(i + 1)).applyMatrix4(matrixWorld);
            const vC = new THREE.Vector3().fromBufferAttribute(posAttr, index.getX(i + 2)).applyMatrix4(matrixWorld);
            triangles.push({ vertices: [vA, vB, vC] });
          }
        } else {
          for (let i = 0; i < posAttr.count; i += 3) {
            const vA = new THREE.Vector3().fromBufferAttribute(posAttr, i).applyMatrix4(matrixWorld);
            const vB = new THREE.Vector3().fromBufferAttribute(posAttr, i + 1).applyMatrix4(matrixWorld);
            const vC = new THREE.Vector3().fromBufferAttribute(posAttr, i + 2).applyMatrix4(matrixWorld);
            triangles.push({ vertices: [vA, vB, vC] });
          }
        }
      }
    });

    return triangles;
  }

  private writePath(path: SlicePath, speed: number) {
    if (path.points.length < 2) return;

    // Travel to start
    const start = path.points[0];
    this.retract();
    this.gcode.push(`G0 X${start.x.toFixed(3)} Y${start.y.toFixed(3)} F${this.settings.travelSpeed * 60}`);
    this.currentX = start.x;
    this.currentY = start.y;
    this.unretract();

    // Print path
    for (let i = 1; i < path.points.length; i++) {
      const pt = path.points[i];
      const dx = pt.x - this.currentX;
      const dy = pt.y - this.currentY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      this.currentE += this.calculateExtrusion(dist);
      this.gcode.push(
        `G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} E${this.currentE.toFixed(5)} F${speed * 60}`
      );
      this.currentX = pt.x;
      this.currentY = pt.y;
    }

    // Close path
    if (path.closed && path.points.length > 2) {
      const first = path.points[0];
      const dx = first.x - this.currentX;
      const dy = first.y - this.currentY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      this.currentE += this.calculateExtrusion(dist);
      this.gcode.push(
        `G1 X${first.x.toFixed(3)} Y${first.y.toFixed(3)} E${this.currentE.toFixed(5)} F${speed * 60}`
      );
      this.currentX = first.x;
      this.currentY = first.y;
    }
  }

  private calculateExtrusion(distance: number): number {
    const nozzleArea = this.settings.nozzleDiameter * this.settings.layerHeight;
    const filamentArea = Math.PI * Math.pow(this.settings.filamentDiameter / 2, 2);
    return (nozzleArea / filamentArea) * distance * this.settings.extrusionMultiplier;
  }

  private retract() {
    if (this.settings.retractionDistance > 0) {
      this.currentE -= this.settings.retractionDistance;
      this.gcode.push(`G1 E${this.currentE.toFixed(5)} F${this.settings.retractionSpeed * 60}`);
    }
  }

  private unretract() {
    if (this.settings.retractionDistance > 0) {
      this.currentE += this.settings.retractionDistance;
      this.gcode.push(`G1 E${this.currentE.toFixed(5)} F${this.settings.retractionSpeed * 60}`);
    }
  }

  private writeSkirt(_firstLayer: SliceLayer, bbox: THREE.Box3, offsetX: number, offsetY: number) {
    const margin = 5; // mm from model
    const minX = bbox.min.x + offsetX - margin;
    const minY = bbox.min.y + offsetY - margin;
    const maxX = bbox.max.x + offsetX + margin;
    const maxY = bbox.max.y + offsetY + margin;

    this.gcode.push('; Skirt');
    for (let line = 0; line < this.settings.skirtLines; line++) {
      const offset = line * this.settings.nozzleDiameter;
      const points = [
        new THREE.Vector2(minX - offset, minY - offset),
        new THREE.Vector2(maxX + offset, minY - offset),
        new THREE.Vector2(maxX + offset, maxY + offset),
        new THREE.Vector2(minX - offset, maxY + offset),
      ];
      this.writePath({ type: 'skirt', points, closed: true }, this.settings.firstLayerSpeed);
    }
  }

  private writeHeader(estimatedMinutes: number, totalLayers: number) {
    this.gcode.push('; Generated by DesignCAD G-Code Generator');
    this.gcode.push(`; Estimated print time: ${Math.floor(estimatedMinutes / 60)}h ${estimatedMinutes % 60}m`);
    this.gcode.push(`; Total layers: ${totalLayers}`);
    this.gcode.push(`; Layer height: ${this.settings.layerHeight}mm`);
    this.gcode.push(`; Nozzle: ${this.settings.nozzleDiameter}mm`);
    this.gcode.push(`; Infill: ${this.settings.infillDensity}% ${this.settings.infillPattern}`);
    this.gcode.push(`; Nozzle temp: ${this.settings.nozzleTemp}C`);
    this.gcode.push(`; Bed temp: ${this.settings.bedTemp}C`);
    this.gcode.push('');
  }

  private writeStartGCode() {
    this.gcode.push('; Start G-code');
    this.gcode.push('G90 ; Absolute positioning');
    this.gcode.push('M82 ; Absolute extrusion');
    this.gcode.push(`M104 S${this.settings.nozzleTemp} ; Set nozzle temp`);
    this.gcode.push(`M140 S${this.settings.bedTemp} ; Set bed temp`);
    this.gcode.push(`M190 S${this.settings.bedTemp} ; Wait for bed temp`);
    this.gcode.push(`M109 S${this.settings.nozzleTemp} ; Wait for nozzle temp`);
    this.gcode.push('G28 ; Home all axes');
    this.gcode.push('G29 ; Auto bed leveling (if supported)');
    this.gcode.push('G92 E0 ; Reset extruder');
    this.gcode.push('G1 Z5 F3000 ; Lift nozzle');
    this.gcode.push('G1 X0.1 Y20 F5000 ; Move to prime position');
    this.gcode.push('G1 Z0.3 F3000 ; Lower nozzle');
    this.gcode.push('G1 X0.1 Y150 E15 F1500 ; Prime line');
    this.gcode.push('G1 X0.4 Y150 F5000 ; Move over');
    this.gcode.push('G1 X0.4 Y20 E30 F1500 ; Second prime line');
    this.gcode.push('G92 E0 ; Reset extruder');
    this.gcode.push('G1 Z2 F3000 ; Lift nozzle');
    this.gcode.push('');
  }

  private writeEndGCode() {
    this.gcode.push('');
    this.gcode.push('; End G-code');
    this.gcode.push('G91 ; Relative positioning');
    this.gcode.push('G1 E-2 F2700 ; Retract');
    this.gcode.push('G1 Z10 F3000 ; Lift nozzle');
    this.gcode.push('G90 ; Absolute positioning');
    this.gcode.push('G1 X0 Y200 F3000 ; Move bed forward');
    this.gcode.push('M104 S0 ; Turn off nozzle');
    this.gcode.push('M140 S0 ; Turn off bed');
    this.gcode.push('M84 ; Disable steppers');
    this.gcode.push('M107 ; Turn off fan');
  }
}

interface MeshTriangle {
  vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

export interface PrintEstimate {
  layerCount: number;
  filamentLengthMm: number;
  filamentWeightG: number;
  estimatedTimeMinutes: number;
  dimensions: { x: number; y: number; z: number };
}
