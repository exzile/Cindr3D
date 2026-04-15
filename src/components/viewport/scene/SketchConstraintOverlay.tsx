import { useMemo } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { SketchEntity, SketchConstraint, SketchPoint, Sketch } from '../../../types/cad';

// ── Constraint indicator colors ────────────────────────────────────────────
const COLOR_HORIZONTAL   = new THREE.Color('#10b981'); // green
const COLOR_VERTICAL     = new THREE.Color('#10b981'); // green
const COLOR_COINCIDENT   = new THREE.Color('#f59e0b'); // amber
const COLOR_PARALLEL     = new THREE.Color('#60a5fa'); // blue
const COLOR_PERPENDICULAR = new THREE.Color('#a78bfa'); // purple
const COLOR_EQUAL        = new THREE.Color('#f472b6'); // pink
const COLOR_TANGENT      = new THREE.Color('#fb923c'); // orange
const COLOR_DEFAULT      = new THREE.Color('#94a3b8'); // slate (fallback)

// Reuse materials keyed by hex color — avoids new allocations per render
const materialCache = new Map<string, THREE.LineBasicMaterial>();
function getLineMat(color: THREE.Color): THREE.LineBasicMaterial {
  const key = color.getHexString();
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
  }
  return materialCache.get(key)!;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Compute the world-space midpoint of a sketch entity. */
function entityMidpoint(entity: SketchEntity, sketch: Sketch): THREE.Vector3 | null {
  const pts = entity.points;
  if (!pts || pts.length === 0) return null;

  if (entity.type === 'circle') {
    // Center point is pts[0]
    return new THREE.Vector3(pts[0].x, pts[0].y, pts[0].z);
  }

  if (entity.type === 'arc') {
    // Arc center is pts[0]; midpoint is at startAngle+endAngle/2 on the circumference
    const c = pts[0];
    const radius = entity.radius ?? 1;
    const sa = entity.startAngle ?? 0;
    const ea = entity.endAngle ?? Math.PI;
    let mid = (sa + ea) / 2;
    // Ensure mid is in the swept arc
    if (ea < sa) mid = sa + ((ea + 2 * Math.PI - sa) / 2);
    const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
    return new THREE.Vector3(c.x, c.y, c.z)
      .addScaledVector(t1, Math.cos(mid) * radius)
      .addScaledVector(t2, Math.sin(mid) * radius);
  }

  // For lines, rectangles, splines, polygons etc. — use average of all points
  const sum = new THREE.Vector3();
  for (const p of pts) sum.add(new THREE.Vector3(p.x, p.y, p.z));
  sum.divideScalar(pts.length);
  return sum;
}

/** Get the specific point of an entity by pointIndex (0 = first endpoint, 1 = second, etc.). */
function entityPoint(entity: SketchEntity, pointIndex: number): THREE.Vector3 | null {
  const p: SketchPoint | undefined = entity.points[pointIndex];
  if (!p) return null;
  return new THREE.Vector3(p.x, p.y, p.z);
}

// ── Geometry factories (return LineSegments — no per-frame alloc) ─────────

/**
 * Horizontal arrow ↔ in the t1 direction: ──── with arrowheads on both ends.
 * size = half-length of the main bar.
 */
function makeHArrow(pos: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3, size: number, color: THREE.Color): THREE.LineSegments {
  const s = size;
  const h = size * 0.35; // arrowhead height
  const w = size * 0.25; // arrowhead width

  // Main bar
  const p0 = pos.clone().addScaledVector(t1, -s);
  const p1 = pos.clone().addScaledVector(t1,  s);
  // Left arrowhead
  const laTop = p0.clone().addScaledVector(t1,  h).addScaledVector(t2,  w);
  const laBot = p0.clone().addScaledVector(t1,  h).addScaledVector(t2, -w);
  // Right arrowhead
  const raTop = p1.clone().addScaledVector(t1, -h).addScaledVector(t2,  w);
  const raBot = p1.clone().addScaledVector(t1, -h).addScaledVector(t2, -w);

  const verts = new Float32Array([
    p0.x, p0.y, p0.z, p1.x, p1.y, p1.z,           // bar
    p0.x, p0.y, p0.z, laTop.x, laTop.y, laTop.z,   // left arrow
    p0.x, p0.y, p0.z, laBot.x, laBot.y, laBot.z,
    p1.x, p1.y, p1.z, raTop.x, raTop.y, raTop.z,   // right arrow
    p1.x, p1.y, p1.z, raBot.x, raBot.y, raBot.z,
  ]);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  return new THREE.LineSegments(geom, getLineMat(color));
}

/**
 * Vertical arrow ↕ in the t2 direction.
 */
function makeVArrow(pos: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3, size: number, color: THREE.Color): THREE.LineSegments {
  // Reuse the horizontal factory with swapped axes
  return makeHArrow(pos, t2, t1, size, color);
}

/**
 * Small circle ring at a point (used for coincident).
 */
function makeCoincidentRing(pos: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3, radius: number, color: THREE.Color): THREE.LineLoop {
  const segs = 16;
  const pts: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const p = pos.clone()
      .addScaledVector(t1, Math.cos(a) * radius)
      .addScaledVector(t2, Math.sin(a) * radius);
    pts.push(p.x, p.y, p.z);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  return new THREE.LineLoop(geom, getLineMat(color));
}

/**
 * Two short parallel lines side-by-side (used for parallel constraint).
 * Rendered at the given position, oriented along t1.
 */
function makeParallelLines(pos: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3, size: number, color: THREE.Color): THREE.LineSegments {
  const half = size * 0.4;
  const sep  = size * 0.3;
  // Line 1
  const l1a = pos.clone().addScaledVector(t1, -half).addScaledVector(t2, -sep);
  const l1b = pos.clone().addScaledVector(t1,  half).addScaledVector(t2, -sep);
  // Line 2
  const l2a = pos.clone().addScaledVector(t1, -half).addScaledVector(t2,  sep);
  const l2b = pos.clone().addScaledVector(t1,  half).addScaledVector(t2,  sep);
  const verts = new Float32Array([
    l1a.x, l1a.y, l1a.z, l1b.x, l1b.y, l1b.z,
    l2a.x, l2a.y, l2a.z, l2b.x, l2b.y, l2b.z,
  ]);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  return new THREE.LineSegments(geom, getLineMat(color));
}

/**
 * Small right-angle square ⌐ (used for perpendicular).
 * The L-shape is in the t1–t2 plane.
 */
function makePerpSymbol(pos: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3, size: number, color: THREE.Color): THREE.LineSegments {
  const s = size * 0.5;
  // vertical leg
  const a = pos.clone();
  const b = pos.clone().addScaledVector(t2, s);
  // horizontal leg
  const c = pos.clone().addScaledVector(t1, s).addScaledVector(t2, s);
  // corner tick
  const d = pos.clone().addScaledVector(t1, s * 0.25).addScaledVector(t2, s * 0.25);
  const e = pos.clone().addScaledVector(t1, s * 0.25);
  const f = pos.clone().addScaledVector(t1, s * 0.25).addScaledVector(t2, s * 0.5);
  const verts = new Float32Array([
    a.x, a.y, a.z, b.x, b.y, b.z,   // vertical
    b.x, b.y, b.z, c.x, c.y, c.z,   // horizontal
    d.x, d.y, d.z, e.x, e.y, e.z,   // corner box side 1
    e.x, e.y, e.z, f.x, f.y, f.z,   // corner box side 2
  ]);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  return new THREE.LineSegments(geom, getLineMat(color));
}

/**
 * Tick marks = (used for equal constraint).
 * Two short horizontal strokes stacked in t2.
 */
function makeEqualTicks(pos: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3, size: number, color: THREE.Color): THREE.LineSegments {
  const half = size * 0.3;
  const sep  = size * 0.2;
  const t1a = pos.clone().addScaledVector(t1, -half).addScaledVector(t2, -sep);
  const t1b = pos.clone().addScaledVector(t1,  half).addScaledVector(t2, -sep);
  const t2a = pos.clone().addScaledVector(t1, -half).addScaledVector(t2,  sep);
  const t2b = pos.clone().addScaledVector(t1,  half).addScaledVector(t2,  sep);
  const verts = new Float32Array([
    t1a.x, t1a.y, t1a.z, t1b.x, t1b.y, t1b.z,
    t2a.x, t2a.y, t2a.z, t2b.x, t2b.y, t2b.z,
  ]);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  return new THREE.LineSegments(geom, getLineMat(color));
}

/**
 * Small T-shape (used for tangent constraint).
 */
function makeTangentSymbol(pos: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3, size: number, color: THREE.Color): THREE.LineSegments {
  const half = size * 0.4;
  const stem = size * 0.5;
  const top = pos.clone().addScaledVector(t2,  half);
  const la  = top.clone().addScaledVector(t1, -half);
  const ra  = top.clone().addScaledVector(t1,  half);
  const bot = pos.clone().addScaledVector(t2, -stem + half);
  const verts = new Float32Array([
    la.x, la.y, la.z, ra.x, ra.y, ra.z,   // T-bar
    top.x, top.y, top.z, bot.x, bot.y, bot.z, // T-stem
  ]);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  return new THREE.LineSegments(geom, getLineMat(color));
}

// ── Small generic dot (for constraints whose entity can't be found) ────────
function makeDot(pos: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3, size: number, color: THREE.Color): THREE.LineSegments {
  return makeCoincidentRing(pos, t1, t2, size * 0.3, color) as unknown as THREE.LineSegments;
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function SketchConstraintOverlay() {
  const activeSketch = useCADStore((s) => s.activeSketch);

  const objects = useMemo(() => {
    if (!activeSketch || !activeSketch.constraints || activeSketch.constraints.length === 0) {
      return null;
    }

    const sketch = activeSketch;
    const entityMap = new Map<string, SketchEntity>();
    for (const e of sketch.entities) entityMap.set(e.id, e);

    const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
    const SIZE = 1.0; // base indicator size in world units

    const objs: THREE.Object3D[] = [];

    for (const constraint of sketch.constraints) {
      const { type, entityIds, pointIndices } = constraint;

      const entities = entityIds.map((id) => entityMap.get(id)).filter(Boolean) as SketchEntity[];

      switch (type) {
        case 'horizontal': {
          const entity = entities[0];
          if (!entity) break;
          const mid = entityMidpoint(entity, sketch);
          if (!mid) break;
          objs.push(makeHArrow(mid, t1, t2, SIZE, COLOR_HORIZONTAL));
          break;
        }
        case 'vertical': {
          const entity = entities[0];
          if (!entity) break;
          const mid = entityMidpoint(entity, sketch);
          if (!mid) break;
          objs.push(makeVArrow(mid, t1, t2, SIZE, COLOR_VERTICAL));
          break;
        }
        case 'coincident': {
          // Place the ring at the coincident point (use pointIndex if available)
          let pos: THREE.Vector3 | null = null;
          if (entities[0] && pointIndices && pointIndices[0] !== undefined) {
            pos = entityPoint(entities[0], pointIndices[0]);
          }
          if (!pos && entities[0]) pos = entityMidpoint(entities[0], sketch);
          if (!pos) break;
          objs.push(makeCoincidentRing(pos, t1, t2, SIZE * 0.5, COLOR_COINCIDENT));
          break;
        }
        case 'concentric': {
          // Treat like coincident — ring at first entity center
          const entity = entities[0];
          if (!entity) break;
          const mid = entityMidpoint(entity, sketch);
          if (!mid) break;
          objs.push(makeCoincidentRing(mid, t1, t2, SIZE * 0.5, COLOR_COINCIDENT));
          break;
        }
        case 'parallel': {
          // One parallel indicator at each involved entity midpoint
          for (const entity of entities) {
            const mid = entityMidpoint(entity, sketch);
            if (mid) objs.push(makeParallelLines(mid, t1, t2, SIZE, COLOR_PARALLEL));
          }
          break;
        }
        case 'collinear': {
          for (const entity of entities) {
            const mid = entityMidpoint(entity, sketch);
            if (mid) objs.push(makeParallelLines(mid, t1, t2, SIZE, COLOR_PARALLEL));
          }
          break;
        }
        case 'perpendicular': {
          // Show symbol at first entity midpoint
          const entity = entities[0];
          if (!entity) break;
          const mid = entityMidpoint(entity, sketch);
          if (!mid) break;
          objs.push(makePerpSymbol(mid, t1, t2, SIZE, COLOR_PERPENDICULAR));
          break;
        }
        case 'tangent': {
          // Show T at the tangent point (use pointIndex) or midpoint
          let pos: THREE.Vector3 | null = null;
          if (entities[0] && pointIndices && pointIndices[0] !== undefined) {
            pos = entityPoint(entities[0], pointIndices[0]);
          }
          if (!pos && entities[0]) pos = entityMidpoint(entities[0], sketch);
          if (!pos) break;
          objs.push(makeTangentSymbol(pos, t1, t2, SIZE, COLOR_TANGENT));
          break;
        }
        case 'curvature': {
          // G2 continuity — same as tangent visually
          let pos: THREE.Vector3 | null = null;
          if (entities[0] && pointIndices && pointIndices[0] !== undefined) {
            pos = entityPoint(entities[0], pointIndices[0]);
          }
          if (!pos && entities[0]) pos = entityMidpoint(entities[0], sketch);
          if (!pos) break;
          objs.push(makeTangentSymbol(pos, t1, t2, SIZE, COLOR_TANGENT));
          break;
        }
        case 'equal': {
          // Tick mark on each involved entity
          for (const entity of entities) {
            const mid = entityMidpoint(entity, sketch);
            if (mid) objs.push(makeEqualTicks(mid, t1, t2, SIZE, COLOR_EQUAL));
          }
          break;
        }
        case 'symmetric': {
          // Equal-style ticks on each entity
          for (const entity of entities) {
            const mid = entityMidpoint(entity, sketch);
            if (mid) objs.push(makeEqualTicks(mid, t1, t2, SIZE, COLOR_EQUAL));
          }
          break;
        }
        case 'fix':
        case 'midpoint': {
          // Small ring at the fixed/midpoint
          let pos: THREE.Vector3 | null = null;
          if (entities[0] && pointIndices && pointIndices[0] !== undefined) {
            pos = entityPoint(entities[0], pointIndices[0]);
          }
          if (!pos && entities[0]) pos = entityMidpoint(entities[0], sketch);
          if (!pos) break;
          objs.push(makeCoincidentRing(pos, t1, t2, SIZE * 0.4, COLOR_DEFAULT));
          break;
        }
        default: {
          // Unknown type — place a small dot at first entity
          const entity = entities[0];
          if (entity) {
            const mid = entityMidpoint(entity, sketch);
            if (mid) objs.push(makeDot(mid, t1, t2, SIZE, COLOR_DEFAULT));
          }
          break;
        }
      }
    }

    return objs.length > 0 ? objs : null;
  }, [activeSketch]);

  if (!objects) return null;

  return (
    <group renderOrder={999}>
      {objects.map((obj, i) => (
        <primitive key={i} object={obj} />
      ))}
    </group>
  );
}
