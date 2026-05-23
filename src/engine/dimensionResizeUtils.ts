import * as THREE from 'three';
import { GeometryEngine } from './GeometryEngine';
import type { Sketch, SketchDimension, SketchEntity, SketchPoint } from '../types/cad';

type Vec2 = { x: number; y: number };
type DimensionReference = {
  raw: string;
  entityId: string;
  edgePart?: string;
  vertexIndex?: number;
  isCenter: boolean;
};

function toWorldVec(p: Vec2, origin: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3): THREE.Vector3 {
  return origin.clone().addScaledVector(t1, p.x).addScaledVector(t2, p.y);
}

function parseReference(raw: string | undefined): DimensionReference | null {
  if (!raw) return null;
  const [edgeEntityId, edgePart] = raw.split('::edge:');
  if (edgePart !== undefined) return { raw, entityId: edgeEntityId, edgePart, isCenter: false };

  const [vertexEntityId, vertexPart] = raw.split('::vertex:');
  if (vertexPart !== undefined) {
    const vertexIndex = Number(vertexPart);
    return {
      raw,
      entityId: vertexEntityId,
      vertexIndex: Number.isInteger(vertexIndex) ? vertexIndex : undefined,
      isCenter: false,
    };
  }

  const [centerEntityId, centerPart] = raw.split('::center');
  if (centerPart !== undefined) return { raw, entityId: centerEntityId, isCenter: true };

  return { raw, entityId: raw, isCenter: false };
}

/**
 * Returns a new entities array with geometry resized to satisfy `dimension` at `newValue`.
 * Only linear/aligned/radial/diameter types mutate geometry; angular and arc-length are no-ops.
 * Pass the sketch that already contains `dimension` in its dimensions array (or a working copy).
 */
export function applyDimensionResize(
  sketch: Sketch,
  dimension: SketchDimension,
  newValue: number,
): SketchEntity[] {
  const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
  const origin = sketch.planeOrigin ?? new THREE.Vector3(0, 0, 0);
  const firstRef = parseReference(dimension.entityIds[0]);
  const secondRef = parseReference(dimension.entityIds[1]);

  const toLocal = (point: SketchPoint): Vec2 => {
    const delta = new THREE.Vector3(point.x, point.y, point.z).sub(origin);
    return { x: delta.dot(t1), y: delta.dot(t2) };
  };
  const toPoint = (point: SketchPoint, local: Vec2): SketchPoint => {
    const world = toWorldVec(local, origin, t1, t2);
    return { ...point, x: world.x, y: world.y, z: world.z };
  };

  const resizeLine = (entity: SketchEntity): SketchEntity => {
    if (entity.points.length < 2) return entity;
    const start = new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z);
    const end = new THREE.Vector3(
      entity.points[entity.points.length - 1].x,
      entity.points[entity.points.length - 1].y,
      entity.points[entity.points.length - 1].z,
    );
    const dir = end.clone().sub(start);
    const len = dir.length();
    if (len < 1e-8) return entity;
    if (newValue <= 0) return entity;
    const nextEnd = start.clone().add(dir.multiplyScalar(newValue / len));
    return {
      ...entity,
      points: entity.points.map((p, i) =>
        i === entity.points.length - 1
          ? { ...p, x: nextEnd.x, y: nextEnd.y, z: nextEnd.z }
          : p,
      ),
    };
  };

  const resizeRectangle = (entity: SketchEntity, edgePart: string | undefined): SketchEntity => {
    if (entity.points.length < 2) return entity;
    const edgeIndex = edgePart === undefined ? null : Number(edgePart);
    const first = toLocal(entity.points[0]);
    const second = toLocal(entity.points[1]);
    const next = { ...second };
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const signX = dx < 0 ? -1 : 1;
    const signY = dy < 0 ? -1 : 1;
    const isSameRectTwo =
      dimension.entityIds.length >= 2 &&
      firstRef?.entityId === secondRef?.entityId;
    const horizontal = isSameRectTwo
      ? dimension.orientation === 'horizontal'
      : edgeIndex === 0 || edgeIndex === 2 || (edgeIndex === null && Math.abs(dx) >= Math.abs(dy));
    if (horizontal) {
      next.x = first.x + signX * newValue;
    } else {
      next.y = first.y + signY * newValue;
    }
    return {
      ...entity,
      points: entity.points.map((p, i) => (i === 1 ? toPoint(p, next) : p)),
    };
  };

  const pointForRef = (entity: SketchEntity, ref: DimensionReference): SketchPoint | null => {
    if (ref.isCenter) return entity.points[0] ?? null;
    if (ref.vertexIndex !== undefined) {
      if (ref.vertexIndex < 0 || ref.vertexIndex >= entity.points.length) return null;
      return entity.points[ref.vertexIndex] ?? null;
    }
    return null;
  };

  const resizePointDimension = (entity: SketchEntity): SketchEntity => {
    if (!firstRef || !secondRef || entity.id !== secondRef.entityId) return entity;
    const firstEntity = sketch.entities.find((e) => e.id === firstRef.entityId);
    if (!firstEntity) return entity;
    const anchorPoint = pointForRef(firstEntity, firstRef);
    const movedPoint = pointForRef(entity, secondRef);
    if (!anchorPoint || !movedPoint) return entity;

    const anchor = toLocal(anchorPoint);
    const current = toLocal(movedPoint);
    const next = { ...current };
    if (dimension.type === 'aligned') {
      const dx = current.x - anchor.x;
      const dy = current.y - anchor.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-8) return entity;
      next.x = anchor.x + (dx / length) * newValue;
      next.y = anchor.y + (dy / length) * newValue;
    } else {
      const axis: 'x' | 'y' =
        dimension.orientation === 'vertical'
          ? 'y'
          : dimension.orientation === 'horizontal'
            ? 'x'
            : Math.abs(current.x - anchor.x) >= Math.abs(current.y - anchor.y)
              ? 'x'
              : 'y';
      const sign = current[axis] >= anchor[axis] ? 1 : -1;
      next[axis] = anchor[axis] + sign * newValue;
    }

    const worldDelta = toWorldVec(next, origin, t1, t2).sub(toWorldVec(current, origin, t1, t2));
    if (secondRef.isCenter) {
      return {
        ...entity,
        points: entity.points.map((p) => ({ ...p, x: p.x + worldDelta.x, y: p.y + worldDelta.y, z: p.z + worldDelta.z })),
      };
    }
    return {
      ...entity,
      points: entity.points.map((p, i) =>
        i === secondRef.vertexIndex
          ? { ...p, x: p.x + worldDelta.x, y: p.y + worldDelta.y, z: p.z + worldDelta.z }
          : p,
      ),
    };
  };

  const resizeCircle = (entity: SketchEntity): SketchEntity => ({
    ...entity,
    radius: dimension.type === 'diameter' ? newValue / 2 : newValue,
  });

  const updateEntity = (entity: SketchEntity): SketchEntity => {
    const entityId0 = firstRef?.entityId;
    const edgePart0 = firstRef?.edgePart;
    const entityId1 = secondRef?.entityId ?? null;

    if (entity.id !== entityId0 && entity.id !== entityId1) return entity;

    if (dimension.type === 'radial' || dimension.type === 'diameter' || dimension.type === 'linear-diameter') {
      return entity.id === entityId0 ? resizeCircle(entity) : entity;
    }
    if (dimension.type === 'ellipse-major') {
      return entity.id === entityId0 ? { ...entity, majorRadius: newValue } : entity;
    }
    if (dimension.type === 'ellipse-minor') {
      return entity.id === entityId0 ? { ...entity, minorRadius: newValue } : entity;
    }

    // Angular / arc-length: geometry unchanged, dimension is measurement only.
    if (dimension.type === 'angular' || dimension.type === 'arc-length') return entity;

    if (firstRef && secondRef && (firstRef.vertexIndex !== undefined || firstRef.isCenter || secondRef.vertexIndex !== undefined || secondRef.isCenter)) {
      return resizePointDimension(entity);
    }

    // Two distinct entities: anchor entity[0], translate entity[1] along the measured axis.
    if (entityId1 !== null && entityId1 !== entityId0) {
      if (entity.id === entityId0) return entity;
      const anchorEnt = sketch.entities.find((e) => e.id === entityId0);
      if (!anchorEnt) return entity;
      const axis: 'x' | 'y' = dimension.orientation === 'vertical' ? 'y' : 'x';
      const avgOnAxis = (ent: SketchEntity) => {
        const pts = ent.points.map(toLocal);
        return pts.length > 0 ? pts.reduce((s, p) => s + p[axis], 0) / pts.length : 0;
      };
      const anchor = avgOnAxis(anchorEnt);
      const current = avgOnAxis(entity);
      const sign = current >= anchor ? 1 : -1;
      const delta = anchor + sign * newValue - current;
      const worldDelta = t1
        .clone()
        .multiplyScalar(axis === 'x' ? delta : 0)
        .addScaledVector(t2, axis === 'y' ? delta : 0);
      return {
        ...entity,
        points: entity.points.map((p) => ({
          ...p,
          x: p.x + worldDelta.x,
          y: p.y + worldDelta.y,
          z: p.z + worldDelta.z,
        })),
      };
    }

    // Single entity or same-rectangle two-entity.
    if (entity.id !== entityId0) return entity;
    if (entity.type === 'rectangle') return resizeRectangle(entity, edgePart0);
    if (
      entity.type === 'line' ||
      entity.type === 'construction-line' ||
      entity.type === 'centerline'
    )
      return resizeLine(entity);
    return entity;
  };

  return sketch.entities.map(updateEntity);
}
