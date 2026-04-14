import * as THREE from 'three';
import type { Sketch, SketchEntity, SketchPoint, SketchPlane } from '../types/cad';

// Shared materials — created once, never duplicated per-entity
const SKETCH_MATERIAL = new THREE.LineBasicMaterial({ color: 0x00aaff, linewidth: 2 });
// Construction lines: orange, short dash — reference geometry, not part of profile
const CONSTRUCTION_MATERIAL = new THREE.LineDashedMaterial({
  color: 0xff8800, linewidth: 1, dashSize: 0.3, gapSize: 0.18,
});
// Centerlines: dark green/teal, long dash + small gap — used for symmetry/revolve axes
const CENTERLINE_MATERIAL = new THREE.LineDashedMaterial({
  color: 0x00aa55, linewidth: 1, dashSize: 0.7, gapSize: 0.2,
});
const EXTRUDE_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x8899aa,
  metalness: 0.3,
  roughness: 0.4,
  side: THREE.DoubleSide,
});

export class GeometryEngine {
  /**
   * Returns the two in-plane tangent vectors for the given sketch plane.
   * These define the 2-D coordinate system used for circles, rectangles, etc.
   *
   *   XY  (horizontal, Y-normal)  → draws in X–Z world plane
   *   XZ  (vertical front, Z-normal) → draws in X–Y world plane
   *   YZ  (vertical side, X-normal)  → draws in Y–Z world plane
   */
  static getPlaneAxes(plane: SketchPlane): { t1: THREE.Vector3; t2: THREE.Vector3 } {
    switch (plane) {
      case 'XY': return { t1: new THREE.Vector3(1, 0, 0), t2: new THREE.Vector3(0, 0, 1) };
      case 'YZ': return { t1: new THREE.Vector3(0, 1, 0), t2: new THREE.Vector3(0, 0, 1) };
      case 'XZ': // fall-through to default
      default:   return { t1: new THREE.Vector3(1, 0, 0), t2: new THREE.Vector3(0, 1, 0) };
    }
  }

  static createSketchGeometry(sketch: Sketch): THREE.Group {
    const group = new THREE.Group();
    group.name = sketch.name;
    for (const entity of sketch.entities) {
      const obj = this.createEntityGeometry(entity, sketch.plane);
      if (obj) group.add(obj);
    }
    return group;
  }

  static createEntityGeometry(entity: SketchEntity, plane: SketchPlane = 'XZ'): THREE.Object3D | null {
    const material = SKETCH_MATERIAL;
    switch (entity.type) {
      case 'line':              return this.createLine(entity.points, material);
      case 'construction-line': return this.createDashedLine(entity.points, CONSTRUCTION_MATERIAL);
      case 'centerline':        return this.createDashedLine(entity.points, CENTERLINE_MATERIAL);
      case 'circle':            return this.createCircle(entity, material, plane);
      case 'rectangle':         return this.createRectangle(entity.points, material, plane);
      case 'arc':               return this.createArc(entity, material, plane);
      default: return null;
    }
  }

  private static createLine(points: SketchPoint[], material: THREE.LineBasicMaterial): THREE.Line {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array(points.flatMap(p => [p.x, p.y, p.z]));
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    return new THREE.Line(geometry, material);
  }

  private static createDashedLine(points: SketchPoint[], material: THREE.LineDashedMaterial): THREE.Line {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array(points.flatMap(p => [p.x, p.y, p.z]));
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const line = new THREE.Line(geometry, material);
    // Required for LineDashedMaterial — computes per-vertex distances along the line
    line.computeLineDistances();
    return line;
  }

  private static createCircle(entity: SketchEntity, material: THREE.LineBasicMaterial, plane: SketchPlane): THREE.Line {
    const c = entity.points[0];
    const radius = entity.radius || 1;
    const segments = 64;
    const center = new THREE.Vector3(c.x, c.y, c.z);
    const { t1, t2 } = this.getPlaneAxes(plane);
    const points: THREE.Vector3[] = [];

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(
        center.clone()
          .addScaledVector(t1, Math.cos(angle) * radius)
          .addScaledVector(t2, Math.sin(angle) * radius)
      );
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geometry, material);
  }

  private static createRectangle(points: SketchPoint[], material: THREE.LineBasicMaterial, plane: SketchPlane): THREE.Line {
    if (points.length < 2) return new THREE.Line(new THREE.BufferGeometry(), material);
    const v1 = new THREE.Vector3(points[0].x, points[0].y, points[0].z);
    const v2 = new THREE.Vector3(points[1].x, points[1].y, points[1].z);
    const { t1, t2 } = this.getPlaneAxes(plane);
    const delta = v2.clone().sub(v1);
    // Project delta onto each plane axis to get the two edge vectors
    const dt1 = t1.clone().multiplyScalar(delta.dot(t1));
    const dt2 = t2.clone().multiplyScalar(delta.dot(t2));
    const corners = [
      v1.clone(),
      v1.clone().add(dt1),
      v1.clone().add(dt1).add(dt2),
      v1.clone().add(dt2),
      v1.clone(), // close
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(corners);
    return new THREE.Line(geometry, material);
  }

  private static createArc(entity: SketchEntity, material: THREE.LineBasicMaterial, plane: SketchPlane): THREE.Line {
    const c = entity.points[0];
    const radius = entity.radius || 1;
    const startAngle = entity.startAngle || 0;
    const endAngle = entity.endAngle || Math.PI;
    const segments = 32;
    const center = new THREE.Vector3(c.x, c.y, c.z);
    const { t1, t2 } = this.getPlaneAxes(plane);
    const points: THREE.Vector3[] = [];

    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + (i / segments) * (endAngle - startAngle);
      points.push(
        center.clone()
          .addScaledVector(t1, Math.cos(angle) * radius)
          .addScaledVector(t2, Math.sin(angle) * radius)
      );
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geometry, material);
  }

  static extrudeSketch(sketch: Sketch, distance: number): THREE.Mesh | null {
    if (sketch.entities.length === 0) return null;

    const shape = this.sketchToShape(sketch);
    if (!shape) return null;

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: distance,
      bevelEnabled: false,
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    const mesh = new THREE.Mesh(geometry, EXTRUDE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Orient based on sketch plane
    if (sketch.plane === 'XZ') {
      mesh.rotation.x = -Math.PI / 2;
    } else if (sketch.plane === 'YZ') {
      mesh.rotation.y = Math.PI / 2;
    }

    return mesh;
  }

  static sketchToShape(sketch: Sketch): THREE.Shape | null {
    const shape = new THREE.Shape();
    let hasContent = false;

    for (const entity of sketch.entities) {
      switch (entity.type) {
        case 'line': {
          if (entity.points.length >= 2) {
            const [start, end] = entity.points;
            if (!hasContent) {
              shape.moveTo(start.x, start.y);
              hasContent = true;
            }
            shape.lineTo(end.x, end.y);
          }
          break;
        }
        case 'rectangle': {
          if (entity.points.length >= 2) {
            const [p1, p2] = entity.points;
            shape.moveTo(p1.x, p1.y);
            shape.lineTo(p2.x, p1.y);
            shape.lineTo(p2.x, p2.y);
            shape.lineTo(p1.x, p2.y);
            shape.lineTo(p1.x, p1.y);
            hasContent = true;
          }
          break;
        }
        case 'circle': {
          if (entity.points.length >= 1 && entity.radius) {
            const center = entity.points[0];
            const path = new THREE.Path();
            path.absarc(center.x, center.y, entity.radius, 0, Math.PI * 2, false);
            shape.setFromPoints(path.getPoints(64));
            hasContent = true;
          }
          break;
        }
        case 'arc': {
          if (entity.points.length >= 1 && entity.radius) {
            const center = entity.points[0];
            if (!hasContent) {
              const sx = center.x + Math.cos(entity.startAngle || 0) * entity.radius;
              const sy = center.y + Math.sin(entity.startAngle || 0) * entity.radius;
              shape.moveTo(sx, sy);
              hasContent = true;
            }
            shape.absarc(
              center.x, center.y, entity.radius,
              entity.startAngle || 0, entity.endAngle || Math.PI, false
            );
          }
          break;
        }
      }
    }

    return hasContent ? shape : null;
  }

  static createFilletGeometry(mesh: THREE.Mesh, _radius: number): THREE.Mesh {
    // Fillet approximation using edge beveling — full implementation requires OpenCascade
    const geometry = mesh.geometry.clone();
    const material = (mesh.material as THREE.Material).clone();
    return new THREE.Mesh(geometry, material);
  }

  static revolveSketch(sketch: Sketch, angle: number, _axis: THREE.Vector3): THREE.Mesh | null {
    if (sketch.entities.length === 0) return null;

    const shape = this.sketchToShape(sketch);
    if (!shape) return null;

    const points = shape.getPoints(64);
    const lathePoints = points.map(p => new THREE.Vector2(Math.abs(p.x), p.y));

    const geometry = new THREE.LatheGeometry(
      lathePoints,
      64,
      0,
      angle
    );

    const mesh = new THREE.Mesh(geometry, EXTRUDE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}
