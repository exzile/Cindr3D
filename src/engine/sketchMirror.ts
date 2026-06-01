import { GeometryEngine } from './GeometryEngine';
import type { Sketch, SketchEntity, SketchPoint } from '../types/cad';

export interface SketchMirrorBuildResult {
  mirrored: SketchEntity[];
  idMap: Map<string, string>;
  axisId: string | null;
  label: string;
  reflectLocal: (lx: number, ly: number) => { lx: number; ly: number };
  mirrorPoint: (point: SketchPoint, id?: string) => SketchPoint;
}

export interface SketchMirrorBuildOptions {
  axis: 'horizontal' | 'vertical' | 'diagonal' | string;
  lineId?: string | null;
  objectIds?: string[];
  createEntityId?: (entity: SketchEntity) => string;
  createPointId?: (point: SketchPoint) => string;
}

const FIXED_AXIS_IDS = new Set(['horizontal', 'vertical', 'diagonal']);

export function buildSketchMirrorResult(
  sketch: Sketch,
  {
    axis,
    lineId,
    objectIds = [],
    createEntityId = () => crypto.randomUUID(),
    createPointId = () => crypto.randomUUID(),
  }: SketchMirrorBuildOptions,
): SketchMirrorBuildResult | null {
  if (sketch.entities.length === 0) return null;
  const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
  const pickedAxisId = lineId ?? (FIXED_AXIS_IDS.has(axis) ? null : axis);
  const isPicked = Boolean(pickedAxisId);
  let axisOrigin = { lx: 0, ly: 0 };
  let axisDirLx = 0;
  let axisDirLy = 1;

  if (isPicked) {
    const axisEntity = sketch.entities.find((entity) => entity.id === pickedAxisId && entity.points.length >= 2);
    if (!axisEntity) return null;
    const p0 = axisEntity.points[0];
    const p1 = axisEntity.points[1];
    axisOrigin = {
      lx: p0.x * t1.x + p0.y * t1.y + p0.z * t1.z,
      ly: p0.x * t2.x + p0.y * t2.y + p0.z * t2.z,
    };
    const delta = {
      lx: (p1.x - p0.x) * t1.x + (p1.y - p0.y) * t1.y + (p1.z - p0.z) * t1.z,
      ly: (p1.x - p0.x) * t2.x + (p1.y - p0.y) * t2.y + (p1.z - p0.z) * t2.z,
    };
    const length = Math.hypot(delta.lx, delta.ly);
    if (length <= 1e-8) return null;
    axisDirLx = delta.lx / length;
    axisDirLy = delta.ly / length;
  } else {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let count = 0;
    for (const entity of sketch.entities) {
      for (const point of entity.points) {
        cx += point.x;
        cy += point.y;
        cz += point.z;
        count += 1;
      }
    }
    if (count === 0) return null;
    cx /= count;
    cy /= count;
    cz /= count;
    axisOrigin = {
      lx: cx * t1.x + cy * t1.y + cz * t1.z,
      ly: cx * t2.x + cy * t2.y + cz * t2.z,
    };
    if (axis === 'horizontal') {
      axisDirLx = 1;
      axisDirLy = 0;
    } else if (axis === 'vertical') {
      axisDirLx = 0;
      axisDirLy = 1;
    } else {
      axisDirLx = 1 / Math.SQRT2;
      axisDirLy = 1 / Math.SQRT2;
    }
  }

  const reflectLocal = (lx: number, ly: number): { lx: number; ly: number } => {
    const ox = lx - axisOrigin.lx;
    const oy = ly - axisOrigin.ly;
    const dot = ox * axisDirLx + oy * axisDirLy;
    const projX = dot * axisDirLx;
    const projY = dot * axisDirLy;
    return { lx: axisOrigin.lx + 2 * projX - ox, ly: axisOrigin.ly + 2 * projY - oy };
  };

  const mirrorPoint = (point: SketchPoint, id = createPointId(point)): SketchPoint => {
    const lx = point.x * t1.x + point.y * t1.y + point.z * t1.z;
    const ly = point.x * t2.x + point.y * t2.y + point.z * t2.z;
    const { lx: mx, ly: my } = reflectLocal(lx, ly);
    const dx = mx - lx;
    const dy = my - ly;
    return {
      ...point,
      id,
      x: point.x + t1.x * dx + t2.x * dy,
      y: point.y + t1.y * dx + t2.y * dy,
      z: point.z + t1.z * dx + t2.z * dy,
    };
  };

  const axisId = pickedAxisId ?? null;
  const entityIds = new Set(sketch.entities.map((entity) => entity.id));
  const requestedObjectIds = new Set(objectIds.filter((id) => id !== axisId && entityIds.has(id)));
  const entitiesToMirror = requestedObjectIds.size > 0
    ? sketch.entities.filter((entity) => requestedObjectIds.has(entity.id))
    : isPicked
      ? sketch.entities.filter((entity) => entity.id !== axisId)
      : sketch.entities;

  if (entitiesToMirror.length === 0) return null;

  const twoPhi = 2 * Math.atan2(axisDirLy, axisDirLx);
  const idMap = new Map<string, string>();
  const mirrored = entitiesToMirror.map((entity) => {
    const hasAngles = entity.startAngle !== undefined && entity.endAngle !== undefined;
    const id = createEntityId(entity);
    idMap.set(entity.id, id);
    return {
      ...entity,
      id,
      points: entity.points.map((point) => mirrorPoint(point)),
      startAngle: hasAngles ? twoPhi - (entity.endAngle as number) : entity.startAngle,
      endAngle: hasAngles ? twoPhi - (entity.startAngle as number) : entity.endAngle,
    };
  });

  return {
    mirrored,
    idMap,
    axisId,
    label: isPicked ? 'picked line' : axis,
    reflectLocal,
    mirrorPoint,
  };
}
