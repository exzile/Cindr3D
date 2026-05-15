import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { DimensionEngine } from '../../../../../engine/DimensionEngine';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import { applyDimensionResize } from '../../../../../engine/dimensionResizeUtils';
import { inferLinearPlacement } from '../../../../../engine/dimensionPlacement';
import { useCADStore } from '../../../../../store/cadStore';
import type { Sketch, SketchDimension, SketchEntity } from '../../../../../types/cad';

interface DimensionToolContext {
  activeTool: string;
  activeSketch: Sketch | null;
  activeDimensionType: string;
  dimensionOffset: number;
  dimensionDrivenMode: boolean;
  dimensionOrientation: 'horizontal' | 'vertical' | 'auto';
  dimensionToleranceMode: string;
  dimensionToleranceUpper: number;
  dimensionToleranceLower: number;
  addPendingDimensionEntity: (entityId: string) => void;
  addSketchDimension: (dimension: Parameters<typeof useCADStore.getState> extends never ? never : {
    id: string;
    type: 'linear' | 'angular' | 'radial' | 'diameter' | 'arc-length' | 'aligned';
    entityIds: string[];
    value: number;
    position: { x: number; y: number };
    driven: boolean;
    orientation?: 'horizontal' | 'vertical' | 'auto';
    toleranceUpper?: number;
    toleranceLower?: number;
  }) => void;
  cancelDimensionTool: () => void;
  getWorldPoint: (event: MouseEvent) => THREE.Vector3 | null;
  setStatusMessage: (message: string) => void;
  gl: { domElement: HTMLCanvasElement };
}

interface PickedDimensionEntity {
  entity: SketchEntity;
  start?: THREE.Vector3;
  end?: THREE.Vector3;
  highlightId?: string;
}

function createNearestEntityFinder(entities: SketchEntity[], origin: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3) {
  const entityPickRadius = 5;
  const considerSegment = (
    worldPoint: THREE.Vector3,
    entity: SketchEntity,
    start: THREE.Vector3,
    end: THREE.Vector3,
    best: { pick: PickedDimensionEntity | null; distance: number },
    highlightId = entity.id,
  ) => {
    const delta = end.clone().sub(start);
    const deltaLength = delta.length();
    if (deltaLength < 1e-8) {
      return;
    }
    const projection = Math.max(
      0,
      Math.min(1, worldPoint.clone().sub(start).dot(delta) / (deltaLength * deltaLength)),
    );
    const closest = start.clone().add(delta.multiplyScalar(projection));
    const distance = worldPoint.distanceTo(closest);
    if (distance < best.distance) {
      best.distance = distance;
      best.pick = { entity, start, end, highlightId };
    }
  };

  return (worldPoint: THREE.Vector3): PickedDimensionEntity | null => {
    const best: { pick: PickedDimensionEntity | null; distance: number } = {
      pick: null,
      distance: entityPickRadius,
    };
    let bestDistance = entityPickRadius;
    for (const entity of entities) {
      if (
        (entity.type === 'line' || entity.type === 'construction-line' || entity.type === 'centerline') &&
        entity.points.length >= 2
      ) {
        const start = new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z);
        const end = new THREE.Vector3(
          entity.points[entity.points.length - 1].x,
          entity.points[entity.points.length - 1].y,
          entity.points[entity.points.length - 1].z,
        );
        considerSegment(worldPoint, entity, start, end, best);
        bestDistance = best.distance;
        continue;
      }

      if (entity.type === 'rectangle' && entity.points.length >= 2) {
        const p1 = new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z);
        const p2 = new THREE.Vector3(entity.points[1].x, entity.points[1].y, entity.points[1].z);
        const d1 = p1.clone().sub(origin);
        const d2 = p2.clone().sub(origin);
        const p1u = d1.dot(t1);
        const p1v = d1.dot(t2);
        const p2u = d2.dot(t1);
        const p2v = d2.dot(t2);
        const toWorld = (u: number, v: number) => origin.clone().addScaledVector(t1, u).addScaledVector(t2, v);
        const corners = [
          toWorld(p1u, p1v),
          toWorld(p2u, p1v),
          toWorld(p2u, p2v),
          toWorld(p1u, p2v),
        ];
        for (let i = 0; i < corners.length; i += 1) {
          considerSegment(worldPoint, entity, corners[i], corners[(i + 1) % corners.length], best, `${entity.id}::edge:${i}`);
        }
        bestDistance = best.distance;
        continue;
      }

      if ((entity.type === 'circle' || entity.type === 'arc') && entity.points.length >= 1 && entity.radius) {
        const center = new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z);
        const distance = Math.abs(worldPoint.distanceTo(center) - entity.radius);
        if (distance < bestDistance) {
          bestDistance = distance;
          best.pick = { entity };
        }
      }
    }

    // Second pass: vertex/center proximity wins over a segment if closer.
    for (const entity of entities) {
      const checkVertex = (pt: { x: number; y: number; z?: number }, vid: string) => {
        const vWorld = new THREE.Vector3(pt.x, pt.y, pt.z ?? 0);
        const d = worldPoint.distanceTo(vWorld);
        if (d < entityPickRadius && d < best.distance) {
          best.distance = d;
          best.pick = { entity, start: vWorld, end: vWorld, highlightId: vid };
        }
      };
      if (
        (entity.type === 'line' || entity.type === 'construction-line' || entity.type === 'centerline') &&
        entity.points.length >= 2
      ) {
        checkVertex(entity.points[0], `${entity.id}::vertex:0`);
        checkVertex(entity.points[entity.points.length - 1], `${entity.id}::vertex:${entity.points.length - 1}`);
      }
      if ((entity.type === 'circle' || entity.type === 'arc') && entity.points.length >= 1) {
        checkVertex(entity.points[0], `${entity.id}::center`);
      }
    }

    return best.pick;
  };
}

/**
 * Adds a dimension to the active sketch and immediately resizes entities to match the value.
 * Single atomic store update so first-creation and subsequent edits behave identically.
 */
function commitDimension(
  dim: SketchDimension,
  activeSketchId: string,
  drivenMode: boolean,
): void {
  const state = useCADStore.getState();
  const sketch = state.activeSketch;
  if (!sketch || sketch.id !== activeSketchId) return;
  const existing = sketch.dimensions ?? [];
  if (existing.some((d) => d.id === dim.id)) return;
  // Reject semantic duplicates: same entity set + same type + same orientation.
  const dimEntitiesKey = [...dim.entityIds].sort().join(',');
  const isDuplicate = existing.some((d) => {
    if (d.type !== dim.type) return false;
    if ([...d.entityIds].sort().join(',') !== dimEntitiesKey) return false;
    const sameOrientation =
      (d.orientation ?? 'auto') === (dim.orientation ?? 'auto') ||
      dim.type === 'radial' || dim.type === 'diameter' ||
      dim.type === 'angular' || dim.type === 'arc-length' || dim.type === 'aligned';
    return sameOrientation;
  });
  if (isDuplicate) return;

  state.pushUndo?.();
  const applyToSketch = (s: Sketch): Sketch => {
    if (s.id !== activeSketchId) return s;
    const withDim = { ...s, dimensions: [...(s.dimensions ?? []), dim] };
    const entities = drivenMode ? withDim.entities : applyDimensionResize(withDim, dim, dim.value);
    return { ...withDim, entities };
  };
  const nextActive = applyToSketch(sketch);
  useCADStore.setState({
    activeSketch: nextActive,
    sketches: state.sketches.map(applyToSketch),
  });
  if (!state.sketchComputeDeferred) state.solveSketch?.();
}

export function useSketchDimensionTool({
  activeTool,
  activeSketch,
  activeDimensionType,
  dimensionOffset,
  dimensionDrivenMode,
  dimensionOrientation,
  dimensionToleranceMode,
  dimensionToleranceUpper,
  dimensionToleranceLower,
  addPendingDimensionEntity,
  addSketchDimension,
  cancelDimensionTool,
  getWorldPoint,
  setStatusMessage,
  gl,
}: DimensionToolContext): void {
  const pendingLinearPickRef = useRef<PickedDimensionEntity | null>(null);
  const pendingLinearSecondPickRef = useRef<PickedDimensionEntity | null>(null);
  const draggingDimensionRef = useRef<{ dimensionId: string; moved: boolean } | null>(null);
  const suppressNextClickRef = useRef(false);
  // Fingerprint of the last published ghost preview — avoids per-move store
  // writes (preview-fingerprint pattern from sketch_interaction_pipeline.md).
  const previewFingerprintRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeSketch || activeTool !== 'dimension') {
      return;
    }

    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const origin = activeSketch.planeOrigin;
    const to2D = (worldPoint: THREE.Vector3): { x: number; y: number } => {
      const delta = worldPoint.clone().sub(origin);
      return { x: delta.dot(t1), y: delta.dot(t2) };
    };
    const findNearestEntity = createNearestEntityFinder(activeSketch.entities, origin, t1, t2);
    const lineAxis = (pick: PickedDimensionEntity) => {
      if (!pick.start || !pick.end) return null;
      const start = to2D(pick.start);
      const end = to2D(pick.end);
      return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'horizontal' : 'vertical';
    };
    const lineIntersection = (
      a1: { x: number; y: number },
      a2: { x: number; y: number },
      b1: { x: number; y: number },
      b2: { x: number; y: number },
    ) => {
      const adx = a2.x - a1.x;
      const ady = a2.y - a1.y;
      const bdx = b2.x - b1.x;
      const bdy = b2.y - b1.y;
      const denominator = adx * bdy - ady * bdx;
      if (Math.abs(denominator) < 1e-8) return null;
      const t = ((b1.x - a1.x) * bdy - (b1.y - a1.y) * bdx) / denominator;
      return { x: a1.x + t * adx, y: a1.y + t * ady };
    };
    const fartherFromVertex = (
      vertex: { x: number; y: number },
      start: { x: number; y: number },
      end: { x: number; y: number },
    ) => {
      const startDistance = Math.hypot(start.x - vertex.x, start.y - vertex.y);
      const endDistance = Math.hypot(end.x - vertex.x, end.y - vertex.y);
      return endDistance >= startDistance ? end : start;
    };
    const computeTwoLineDimension = (
      firstPick: PickedDimensionEntity,
      secondPick: PickedDimensionEntity,
      placementWorld?: THREE.Vector3,
    ) => {
      if (!firstPick.start || !firstPick.end || !secondPick.start || !secondPick.end) return null;
      const firstStart = to2D(firstPick.start);
      const firstEnd = to2D(firstPick.end);
      const secondStart = to2D(secondPick.start);
      const secondEnd = to2D(secondPick.end);
      const firstAxis = lineAxis(firstPick);
      const secondAxis = lineAxis(secondPick);
      if (!firstAxis || firstAxis !== secondAxis) return null;
      if (firstAxis === 'horizontal') {
        const y1 = (firstStart.y + firstEnd.y) / 2;
        const y2 = (secondStart.y + secondEnd.y) / 2;
        const allX = [firstStart.x, firstEnd.x, secondStart.x, secondEnd.x];
        const defaultX = Math.min(...allX) - Math.abs(dimensionOffset);
        const x = placementWorld ? to2D(placementWorld).x : defaultX;
        return {
          value: Math.abs(y2 - y1),
          position: { x, y: (y1 + y2) / 2 },
          orientation: 'vertical' as const,
        };
      }
      const x1 = (firstStart.x + firstEnd.x) / 2;
      const x2 = (secondStart.x + secondEnd.x) / 2;
      const allY = [firstStart.y, firstEnd.y, secondStart.y, secondEnd.y];
      const defaultY = Math.max(...allY) + Math.abs(dimensionOffset);
      const y = placementWorld ? to2D(placementWorld).y : defaultY;
      return {
        value: Math.abs(x2 - x1),
        position: { x: (x1 + x2) / 2, y },
        orientation: 'horizontal' as const,
      };
    };
    const computeAngleDimension = (
      firstPick: PickedDimensionEntity,
      secondPick: PickedDimensionEntity,
      placementWorld?: THREE.Vector3,
    ) => {
      if (!firstPick.start || !firstPick.end || !secondPick.start || !secondPick.end) return null;
      const firstStart = to2D(firstPick.start);
      const firstEnd = to2D(firstPick.end);
      const secondStart = to2D(secondPick.start);
      const secondEnd = to2D(secondPick.end);
      if (lineAxis(firstPick) === lineAxis(secondPick)) return null;
      const vertex = lineIntersection(firstStart, firstEnd, secondStart, secondEnd);
      if (!vertex) return null;
      const ray1End = fartherFromVertex(vertex, firstStart, firstEnd);
      const ray2End = fartherFromVertex(vertex, secondStart, secondEnd);
      const placement = placementWorld ? to2D(placementWorld) : null;
      const radius = placement
        ? Math.max(1, Math.hypot(placement.x - vertex.x, placement.y - vertex.y))
        : Math.max(1, Math.abs(dimensionOffset) * 2);
      const dimension = DimensionEngine.computeAngleDimension(vertex, ray1End, ray2End, radius);
      return {
        value: dimension.value,
        position: placement ?? dimension.textPosition,
      };
    };
    // Cursor-driven single-line linear/aligned placement (Fusion-style).
    // Returns the would-be SketchDimension shape (sans id) for a single line
    // pick measured against the cursor world point. Used both for the live
    // ghost preview and the click-to-place commit so they agree exactly.
    const computeSingleLinearDimension = (
      pick: PickedDimensionEntity,
      cursorWorld: THREE.Vector3,
    ): {
      type: 'linear' | 'aligned';
      value: number;
      position: { x: number; y: number };
      orientation?: 'horizontal' | 'vertical';
    } | null => {
      if (!pick.start || !pick.end) return null;
      const start = to2D(pick.start);
      const end = to2D(pick.end);
      if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-8) return null;
      const cursor = to2D(cursorWorld);
      const placement = inferLinearPlacement(start, end, cursor, dimensionOrientation);
      if (placement.kind === 'aligned') {
        const aligned = DimensionEngine.computeAlignedDimension(start, end, placement.offset);
        return { type: 'aligned', value: aligned.value, position: aligned.textPosition };
      }
      const linear = DimensionEngine.computeLinearDimension(
        start,
        end,
        placement.offset,
        placement.axis,
      );
      return {
        type: 'linear',
        value: linear.value,
        position: linear.textPosition,
        orientation: placement.axis,
      };
    };

    const dimensionReferenceKey = (type: string, entityIds: string[]) => {
      const normalizedIds = entityIds.length >= 2 && entityIds.every((id) => id === entityIds[0])
        ? [entityIds[0]]
        : [...entityIds].sort();
      return `${type}:${normalizedIds.join('|')}`;
    };
    const hasExistingDimension = (type: string, entityIds: string[]) => {
      const key = dimensionReferenceKey(type, entityIds);
      return (activeSketch.dimensions ?? []).some((dimension) =>
        dimensionReferenceKey(dimension.type, dimension.entityIds) === key,
      );
    };
    const rejectDuplicateDimension = () => {
      pendingLinearPickRef.current = null;
      pendingLinearSecondPickRef.current = null;
      useCADStore.setState({ pendingDimensionEntityIds: [] });
      setStatusMessage('Dimension already exists for this selection; drag or edit the existing dimension');
    };

    const buildToleranceFields = () =>
      dimensionToleranceMode !== 'none'
        ? { toleranceUpper: dimensionToleranceUpper, toleranceLower: dimensionToleranceLower }
        : {};
    // Helper retained for future use by the dimension tool (was wired
    // in the "theirs" branch of an earlier merge; the "ours" side
    // doesn't call it yet). Underscore prefix to silence unused-var
    // until a caller is restored.
    const _addCircleOrArcDimension = (
      entity: SketchEntity,
      preferDiameterForCircle: boolean,
    ): boolean => {
      if ((entity.type !== 'circle' && entity.type !== 'arc') || !entity.radius) return false;
      const center = entity.points[0];
      const center2d = to2D(new THREE.Vector3(center.x, center.y, center.z));
      const isCircleDiameter = entity.type === 'circle' && preferDiameterForCircle;
      if (isCircleDiameter) {
        const dimension = DimensionEngine.computeDiameterDimension(center2d.x, center2d.y, entity.radius, 0);
        if (hasExistingDimension('diameter', [entity.id])) {
          rejectDuplicateDimension();
          return true;
        }
        addSketchDimension({
          id: crypto.randomUUID(),
          type: 'diameter',
          entityIds: [entity.id],
          value: dimension.value,
          position: dimension.textPosition,
          driven: dimensionDrivenMode,
          ...buildToleranceFields(),
        });
        setStatusMessage(`Diameter dimension added: DIA ${dimension.value.toFixed(2)}`);
        return true;
      }
      const dimension = DimensionEngine.computeArcLengthDimension(
        center2d.x,
        center2d.y,
        entity.radius,
        entity.startAngle ?? 0,
        entity.endAngle ?? (2 * Math.PI),
        dimensionOffset,
      );
      if (hasExistingDimension('radial', [entity.id])) {
        rejectDuplicateDimension();
        return true;
      }
      addSketchDimension({
        id: crypto.randomUUID(),
        type: 'radial',
        entityIds: [entity.id],
        value: entity.radius,
        position: dimension.textPosition,
        driven: dimensionDrivenMode,
        ...buildToleranceFields(),
      });
      setStatusMessage(`Radial dimension added: r=${entity.radius.toFixed(2)}`);
      return true;
    };
    void _addCircleOrArcDimension;

    const fireAndEdit = (dim: SketchDimension, statusMsg: string) => {
      commitDimension(dim, activeSketch.id, dimensionDrivenMode);
      // Tear down the ghost preview on commit so it doesn't linger over the
      // freshly-placed real dimension. The fingerprint reset lets the next
      // hover (after the editor closes) recompute cleanly.
      previewFingerprintRef.current = null;
      useCADStore.setState({ pendingNewDimensionId: dim.id, dimensionPreview: null });
      setStatusMessage(statusMsg);
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) {
        return;
      }
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }

      const worldPoint = getWorldPoint(event);
      if (!worldPoint) {
        return;
      }

      const pick = findNearestEntity(worldPoint);
      const entity = pick?.entity ?? null;

      if (activeDimensionType === 'linear' || activeDimensionType === 'aligned' || activeDimensionType === 'angular') {
        const currentPending = useCADStore.getState().pendingDimensionEntityIds;
        const firstPick = pendingLinearPickRef.current;
        const secondPick = pendingLinearSecondPickRef.current;
        if (currentPending.length >= 2 && firstPick && secondPick) {
          const twoLineDimension = computeTwoLineDimension(firstPick, secondPick, worldPoint);
          if (twoLineDimension) {
            const entityIds = [
              firstPick.highlightId ?? firstPick.entity.id,
              secondPick.highlightId ?? secondPick.entity.id,
            ];
            if (hasExistingDimension(activeDimensionType, entityIds)) {
              rejectDuplicateDimension();
              return;
            }
            fireAndEdit(
              {
                id: crypto.randomUUID(),
                type: activeDimensionType as SketchDimension['type'],
                entityIds,
                value: twoLineDimension.value,
                position: twoLineDimension.position,
                driven: dimensionDrivenMode,
                ...(activeDimensionType === 'linear' ? { orientation: twoLineDimension.orientation } : {}),
                ...buildToleranceFields(),
              },
              `${activeDimensionType === 'linear' ? 'Linear' : 'Aligned'} dimension added: ${twoLineDimension.value.toFixed(2)}`,
            );
            pendingLinearPickRef.current = null;
            pendingLinearSecondPickRef.current = null;
            useCADStore.setState({ pendingDimensionEntityIds: entityIds });
            return;
          }
          const angleDimension = computeAngleDimension(firstPick, secondPick, worldPoint);
          if (angleDimension) {
            const entityIds = [
              firstPick.highlightId ?? firstPick.entity.id,
              secondPick.highlightId ?? secondPick.entity.id,
            ];
            if (hasExistingDimension('angular', entityIds)) {
              rejectDuplicateDimension();
              return;
            }
            fireAndEdit(
              {
                id: crypto.randomUUID(),
                type: 'angular',
                entityIds,
                value: angleDimension.value,
                position: angleDimension.position,
                driven: dimensionDrivenMode,
                ...buildToleranceFields(),
              },
              `Angular dimension added: ${angleDimension.value.toFixed(2)}`,
            );
            pendingLinearPickRef.current = null;
            pendingLinearSecondPickRef.current = null;
            useCADStore.setState({ pendingDimensionEntityIds: entityIds });
            return;
          }
        }

        const isPointPick = (p: PickedDimensionEntity) =>
          p.start != null && p.end != null && p.start.distanceTo(p.end) < 1e-8;

        if ((activeDimensionType === 'linear' || activeDimensionType === 'aligned') && pick && isPointPick(pick)) {
          const currentPending2 = useCADStore.getState().pendingDimensionEntityIds;
          const firstPick2 = pendingLinearPickRef.current;
          if (currentPending2.length === 0) {
            pendingLinearPickRef.current = pick;
            addPendingDimensionEntity(pick.highlightId ?? pick.entity.id);
            setStatusMessage('Dimension: click the second point');
            return;
          }
          if (firstPick2 && isPointPick(firstPick2) && (pick.highlightId ?? pick.entity.id) !== currentPending2[0]) {
            const p1 = to2D(firstPick2.start!);
            const p2 = to2D(pick.start!);
            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            if (dist > 1e-8) {
              const entityIds = [
                firstPick2.highlightId ?? firstPick2.entity.id,
                pick.highlightId ?? pick.entity.id,
              ];
              if (hasExistingDimension(activeDimensionType, entityIds)) {
                rejectDuplicateDimension();
                return;
              }
              const dimension = activeDimensionType === 'linear'
                ? DimensionEngine.computeLinearDimension(p1, p2, dimensionOffset, dimensionOrientation !== 'auto' ? dimensionOrientation : undefined)
                : DimensionEngine.computeAlignedDimension(p1, p2, dimensionOffset);
              fireAndEdit(
                {
                  id: crypto.randomUUID(),
                  type: activeDimensionType as SketchDimension['type'],
                  entityIds,
                  value: dimension.value,
                  position: dimension.textPosition,
                  driven: dimensionDrivenMode,
                  ...(activeDimensionType === 'linear' ? { orientation: dimensionOrientation } : {}),
                  ...buildToleranceFields(),
                },
                `${activeDimensionType === 'linear' ? 'Linear' : 'Aligned'} dimension added: ${dimension.value.toFixed(2)}`,
              );
              pendingLinearPickRef.current = null;
              pendingLinearSecondPickRef.current = null;
              useCADStore.setState({ pendingDimensionEntityIds: [] });
              return;
            }
          }
        }

        // Fusion-style placement click for a pending SINGLE-line linear/aligned
        // pick. Runs before the "must be near an entity" guard so the dimension
        // can be placed in empty space. A click that lands on a *different*
        // valid line still defers to the existing two-entity / angular upgrade
        // paths below (we only commit here when no valid two-entity dim forms).
        {
          const _placePick = pendingLinearPickRef.current;
          if (
            (activeDimensionType === 'linear' || activeDimensionType === 'aligned') &&
            _placePick &&
            _placePick.start &&
            _placePick.end &&
            _placePick.start.distanceTo(_placePick.end) >= 1e-8 &&
            !pendingLinearSecondPickRef.current &&
            currentPending.length === 1
          ) {
            const _firstId = _placePick.highlightId ?? _placePick.entity.id;
            const _clickedId = pick ? (pick.highlightId ?? pick.entity.id) : null;
            const _isSecondLine =
              pick != null &&
              !!pick.start &&
              !!pick.end &&
              pick.start.distanceTo(pick.end) >= 1e-8 &&
              _clickedId !== _firstId &&
              (computeTwoLineDimension(_placePick, pick, worldPoint) != null ||
                computeAngleDimension(_placePick, pick, worldPoint) != null);
            if (!_isSecondLine) {
              const _single = computeSingleLinearDimension(_placePick, worldPoint);
              if (_single) {
                const _ids = [_firstId];
                if (hasExistingDimension(activeDimensionType, _ids)) {
                  rejectDuplicateDimension();
                  return;
                }
                fireAndEdit(
                  {
                    id: crypto.randomUUID(),
                    type: _single.type,
                    entityIds: _ids,
                    value: _single.value,
                    position: _single.position,
                    driven: dimensionDrivenMode,
                    ...(_single.type === 'linear' && _single.orientation
                      ? { orientation: _single.orientation }
                      : {}),
                    ...buildToleranceFields(),
                  },
                  `${_single.type === 'linear' ? 'Linear' : 'Aligned'} dimension added: ${_single.value.toFixed(2)}`,
                );
                pendingLinearPickRef.current = null;
                pendingLinearSecondPickRef.current = null;
                useCADStore.setState({ pendingDimensionEntityIds: _ids, dimensionPreview: null });
                return;
              }
            }
          }
        }

        if (!entity) {
          setStatusMessage(
            activeDimensionType === 'linear'
              ? 'Dimension: click closer to a line entity'
              : activeDimensionType === 'angular'
                ? 'Angular: click closer to a line entity'
              : 'Aligned: click closer to a line entity',
          );
          return;
        }
        if (entity.type === 'circle' && entity.radius) {
          const center = entity.points[0];
          const center2d = to2D(new THREE.Vector3(center.x, center.y, center.z));
          const dimension = DimensionEngine.computeDiameterDimension(center2d.x, center2d.y, entity.radius, 0);
          if (hasExistingDimension('diameter', [entity.id])) {
            rejectDuplicateDimension();
            return;
          }
          addSketchDimension({
            id: crypto.randomUUID(),
            type: 'diameter',
            entityIds: [entity.id],
            value: dimension.value,
            position: dimension.textPosition,
            driven: dimensionDrivenMode,
            ...buildToleranceFields(),
          });
          setStatusMessage(`Diameter dimension added: DIA ${dimension.value.toFixed(2)}`);
          return;
        }
        if (entity.type === 'arc' && entity.radius) {
          const center = entity.points[0];
          const center2d = to2D(new THREE.Vector3(center.x, center.y, center.z));
          const dimension = DimensionEngine.computeArcLengthDimension(
            center2d.x,
            center2d.y,
            entity.radius,
            entity.startAngle ?? 0,
            entity.endAngle ?? (2 * Math.PI),
            dimensionOffset,
          );
          if (hasExistingDimension('radial', [entity.id])) {
            rejectDuplicateDimension();
            return;
          }
          addSketchDimension({
            id: crypto.randomUUID(),
            type: 'radial',
            entityIds: [entity.id],
            value: entity.radius,
            position: dimension.textPosition,
            driven: dimensionDrivenMode,
            ...buildToleranceFields(),
          });
          setStatusMessage(`Radial dimension added: r=${entity.radius.toFixed(2)}`);
          return;
        }

        if (!pick?.start || !pick.end) {
          setStatusMessage(
            activeDimensionType === 'linear'
              ? 'Dimension: click closer to a line segment'
              : activeDimensionType === 'angular'
                ? 'Angular: click closer to a line segment'
              : 'Aligned: click closer to a line segment',
          );
          return;
        }

        // While a newly-placed single-entity edit is open, allow upgrading to two-entity
        // by clicking a second parallel line — or silently ignore same-entity re-clicks.
        const { sketchDimEditId: _editId, sketchDimEditIsNew: _editIsNew } = useCADStore.getState();
        if (_editId && _editIsNew && pendingLinearPickRef.current && activeDimensionType !== 'angular') {
          const _firstId = pendingLinearPickRef.current.highlightId ?? pendingLinearPickRef.current.entity.id;
          const _clickedId = pick.highlightId ?? entity.id;
          if (_clickedId === _firstId) return; // same entity — editor already open, do nothing
          const _twoLine = computeTwoLineDimension(pendingLinearPickRef.current, pick, worldPoint);
          if (_twoLine) {
            const _entityIds = [_firstId, _clickedId];
            if (!hasExistingDimension(activeDimensionType, _entityIds)) {
              // Close editor without undo and directly remove the provisional single-entity
              // dimension by ID. Using undo() is unreliable here because it can leave D1
              // in the sketch if the undo stack isn't exactly as expected.
              const _firstDimId = useCADStore.getState().pendingNewDimensionId ?? _editId;
              useCADStore.setState({
                pendingNewDimensionId: null,
                sketchDimEditId: null,
                sketchDimEditValue: '',
                sketchDimEditIsNew: false,
                sketchDimEditTypeahead: [],
              });
              useCADStore.getState().removeDimension(_firstDimId);
              fireAndEdit(
                {
                  id: crypto.randomUUID(),
                  type: activeDimensionType as SketchDimension['type'],
                  entityIds: _entityIds,
                  value: _twoLine.value,
                  position: _twoLine.position,
                  driven: dimensionDrivenMode,
                  ...(activeDimensionType === 'linear' ? { orientation: _twoLine.orientation } : {}),
                  ...buildToleranceFields(),
                },
                `${activeDimensionType === 'linear' ? 'Linear' : 'Aligned'} dimension added: ${_twoLine.value.toFixed(2)}`,
              );
              pendingLinearPickRef.current = null;
              pendingLinearSecondPickRef.current = null;
              useCADStore.setState({ pendingDimensionEntityIds: _entityIds });
              return;
            }
          }
          // Perpendicular line clicked — try upgrading to angular dimension
          const _angleResult = computeAngleDimension(pendingLinearPickRef.current, pick, worldPoint);
          if (_angleResult) {
            const _entityIds = [_firstId, _clickedId];
            if (!hasExistingDimension('angular', _entityIds)) {
              const _firstDimId = useCADStore.getState().pendingNewDimensionId ?? _editId;
              useCADStore.setState({
                pendingNewDimensionId: null,
                sketchDimEditId: null,
                sketchDimEditValue: '',
                sketchDimEditIsNew: false,
                sketchDimEditTypeahead: [],
              });
              useCADStore.getState().removeDimension(_firstDimId);
              fireAndEdit(
                {
                  id: crypto.randomUUID(),
                  type: 'angular',
                  entityIds: _entityIds,
                  value: _angleResult.value,
                  position: _angleResult.position,
                  driven: dimensionDrivenMode,
                  ...buildToleranceFields(),
                },
                `Angular dimension added: ${_angleResult.value.toFixed(2)}°`,
              );
              pendingLinearPickRef.current = null;
              pendingLinearSecondPickRef.current = null;
              useCADStore.setState({ pendingDimensionEntityIds: _entityIds });
              return;
            }
          }
          return; // lines are parallel or intersecting but no valid dimension — ignore
        }

        // Editor is open for a just-placed dimension (pendingLinearPickRef was cleared
        // after a successful two-entity upgrade). Block new placements until confirmed/cancelled.
        if (_editId && _editIsNew) return;

        if (currentPending.length === 0) {
          if (activeDimensionType === 'angular') {
            pendingLinearPickRef.current = pick;
            addPendingDimensionEntity(pick.highlightId ?? entity.id);
            setStatusMessage('Angular: click the second line');
            return;
          }
          // Linear/aligned: Fusion-style — first click only PICKS the line.
          // The dimension rubber-bands with the cursor; orientation + offset
          // are decided by the next (placement) click. Keep the ref so the
          // existing two-entity upgrade path still works when the second
          // click lands on another line.
          const _entityIds0 = [pick.highlightId ?? entity.id];
          if (hasExistingDimension(activeDimensionType, _entityIds0)) {
            rejectDuplicateDimension();
            return;
          }
          pendingLinearPickRef.current = pick;
          addPendingDimensionEntity(pick.highlightId ?? entity.id);
          useCADStore.setState({ pendingDimensionEntityIds: _entityIds0 });
          setStatusMessage('Move cursor and click to place dimension');
          return;
        }

        if (!firstPick?.start || !firstPick.end) {
          setStatusMessage(
            activeDimensionType === 'linear'
              ? 'Dimension: first entity is invalid, please try again'
              : activeDimensionType === 'angular'
                ? 'Angular: first entity is invalid, please try again'
              : 'Aligned: first entity is invalid, please try again',
          );
          useCADStore.setState({ pendingDimensionEntityIds: [] });
          return;
        }

        if (currentPending.length === 1 && (pick.highlightId ?? entity.id) !== currentPending[0]) {
          const twoLineDimension = computeTwoLineDimension(firstPick, pick);
          if (twoLineDimension) {
            pendingLinearSecondPickRef.current = pick;
            addPendingDimensionEntity(pick.highlightId ?? entity.id);
            setStatusMessage('Dimension: select location for dimension');
            return;
          }
          const angleDimension = computeAngleDimension(firstPick, pick);
          if (angleDimension) {
            pendingLinearSecondPickRef.current = pick;
            addPendingDimensionEntity(pick.highlightId ?? entity.id);
            setStatusMessage('Angular: select location for dimension');
            return;
          }
        }

        if (activeDimensionType === 'angular') {
          setStatusMessage('Angular: click a different non-parallel line');
          return;
        }

        const start = to2D(firstPick.start);
        const end = to2D(firstPick.end);
        const dimension =
          activeDimensionType === 'linear'
            ? DimensionEngine.computeLinearDimension(start, end, dimensionOffset)
            : DimensionEngine.computeAlignedDimension(start, end, dimensionOffset);
        const entityIds = [firstPick.highlightId ?? firstPick.entity.id];
        if (hasExistingDimension(activeDimensionType, entityIds)) {
          rejectDuplicateDimension();
          return;
        }

        fireAndEdit(
          {
            id: crypto.randomUUID(),
            type: activeDimensionType as SketchDimension['type'],
            entityIds,
            value: dimension.value,
            position: dimension.textPosition,
            driven: dimensionDrivenMode,
            ...(activeDimensionType === 'linear' ? { orientation: dimensionOrientation } : {}),
            ...buildToleranceFields(),
          },
          `${activeDimensionType === 'linear' ? 'Linear' : 'Aligned'} dimension added: ${dimension.value.toFixed(2)}`,
        );
        pendingLinearPickRef.current = null;
        pendingLinearSecondPickRef.current = null;
        useCADStore.setState({ pendingDimensionEntityIds: [] });
        return;
      }

      if (activeDimensionType === 'radial') {
        if (!entity || (entity.type !== 'circle' && entity.type !== 'arc') || !entity.radius) {
          setStatusMessage('Dimension: click on a circle or arc');
          return;
        }
        if (hasExistingDimension('radial', [entity.id])) { rejectDuplicateDimension(); return; }
        {
          const center = entity.points[0];
          const center2d = to2D(new THREE.Vector3(center.x, center.y, center.z));
          const radDim = DimensionEngine.computeArcLengthDimension(
            center2d.x, center2d.y, entity.radius,
            entity.startAngle ?? 0, entity.endAngle ?? (2 * Math.PI), dimensionOffset,
          );
          fireAndEdit(
            {
              id: crypto.randomUUID(),
              type: 'radial',
              entityIds: [entity.id],
              value: entity.radius,
              position: radDim.textPosition,
              driven: dimensionDrivenMode,
              ...buildToleranceFields(),
            },
            `Radial dimension added: r=${entity.radius.toFixed(2)}`,
          );
        }
        return;
      }

      if (activeDimensionType === 'diameter') {
        if (!entity || entity.type !== 'circle' || !entity.radius) {
          setStatusMessage('Dimension: click on a circle');
          return;
        }
        if (hasExistingDimension('diameter', [entity.id])) { rejectDuplicateDimension(); return; }
        {
          const center = entity.points[0];
          const center2d = to2D(new THREE.Vector3(center.x, center.y, center.z));
          const diaPos = DimensionEngine.computeDiameterDimension(center2d.x, center2d.y, entity.radius, 0);
          fireAndEdit(
            {
              id: crypto.randomUUID(),
              type: 'diameter',
              entityIds: [entity.id],
              value: entity.radius * 2,
              position: diaPos.textPosition,
              driven: dimensionDrivenMode,
              ...buildToleranceFields(),
            },
            `Diameter dimension added: DIA ${(entity.radius * 2).toFixed(2)}`,
          );
        }
        return;
      }

      if (activeDimensionType === 'arc-length') {
        if (!entity || (entity.type !== 'arc' && entity.type !== 'circle') || !entity.radius) {
          setStatusMessage('Arc Length: click on an arc or circle');
          return;
        }
        const center = entity.points[0];
        const center2d = to2D(new THREE.Vector3(center.x, center.y, center.z));
        const dimension = DimensionEngine.computeArcLengthDimension(
          center2d.x,
          center2d.y,
          entity.radius,
          entity.startAngle ?? 0,
          entity.endAngle ?? (2 * Math.PI),
          dimensionOffset,
        );
        if (hasExistingDimension('arc-length', [entity.id])) {
          rejectDuplicateDimension();
          return;
        }
        addSketchDimension({
          id: crypto.randomUUID(),
          type: 'arc-length',
          entityIds: [entity.id],
          value: dimension.value,
          position: dimension.textPosition,
          driven: dimensionDrivenMode,
          ...buildToleranceFields(),
        });
        setStatusMessage(`Arc length dimension added: ${dimension.value.toFixed(2)}`);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        pendingLinearPickRef.current = null;
        pendingLinearSecondPickRef.current = null;
        previewFingerprintRef.current = null;
        // cancelDimensionTool() also resets dimensionPreview to null.
        cancelDimensionTool();
      }
    };
    // Build the transient ghost SketchDimension from the current cursor while a
    // placement is pending: single-entity linear/aligned (pendingLinearPickRef
    // set, no second pick) OR the existing two-entity / angular placement step
    // (both picks set, awaiting a location click).
    const computePreviewDimension = (cursorWorld: THREE.Vector3): SketchDimension | null => {
      const firstPick = pendingLinearPickRef.current;
      const secondPick = pendingLinearSecondPickRef.current;
      if (firstPick && secondPick) {
        const ids = [
          firstPick.highlightId ?? firstPick.entity.id,
          secondPick.highlightId ?? secondPick.entity.id,
        ];
        const twoLine = computeTwoLineDimension(firstPick, secondPick, cursorWorld);
        if (twoLine) {
          return {
            id: '__preview__',
            type: activeDimensionType === 'aligned' ? 'aligned' : 'linear',
            entityIds: ids,
            value: twoLine.value,
            position: twoLine.position,
            driven: dimensionDrivenMode,
            ...(activeDimensionType !== 'aligned' ? { orientation: twoLine.orientation } : {}),
          };
        }
        const angle = computeAngleDimension(firstPick, secondPick, cursorWorld);
        if (angle) {
          return {
            id: '__preview__',
            type: 'angular',
            entityIds: ids,
            value: angle.value,
            position: angle.position,
            driven: dimensionDrivenMode,
          };
        }
        return null;
      }
      if (
        firstPick &&
        !secondPick &&
        (activeDimensionType === 'linear' || activeDimensionType === 'aligned')
      ) {
        const single = computeSingleLinearDimension(firstPick, cursorWorld);
        if (!single) return null;
        return {
          id: '__preview__',
          type: single.type,
          entityIds: [firstPick.highlightId ?? firstPick.entity.id],
          value: single.value,
          position: single.position,
          driven: dimensionDrivenMode,
          ...(single.type === 'linear' && single.orientation
            ? { orientation: single.orientation }
            : {}),
        };
      }
      return null;
    };

    const publishPreview = (worldPoint: THREE.Vector3 | null) => {
      const preview = worldPoint ? computePreviewDimension(worldPoint) : null;
      if (!preview) {
        if (previewFingerprintRef.current !== null) {
          previewFingerprintRef.current = null;
          useCADStore.setState({ dimensionPreview: null });
        }
        return;
      }
      // Round value + position so micro-cursor jitter doesn't spam the store.
      const fp = [
        preview.type,
        preview.entityIds.join('|'),
        preview.value.toFixed(3),
        preview.position.x.toFixed(3),
        preview.position.y.toFixed(3),
        preview.orientation ?? '',
      ].join('~');
      if (fp === previewFingerprintRef.current) return;
      previewFingerprintRef.current = fp;
      useCADStore.setState({ dimensionPreview: preview });
    };

    const handleHoverMove = (event: MouseEvent) => {
      const worldPoint = getWorldPoint(event);
      const pick = worldPoint ? findNearestEntity(worldPoint) : null;
      const hoverId = pick ? (pick.highlightId ?? pick.entity.id) : null;
      if (useCADStore.getState().dimensionHoverEntityId !== hoverId) {
        useCADStore.setState({ dimensionHoverEntityId: hoverId });
      }
      publishPreview(worldPoint);
      canvas.style.cursor = hoverId ? 'crosshair' : '';
    };

    const canvas = gl.domElement;
    canvas.addEventListener('mousemove', handleHoverMove);
    canvas.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      canvas.removeEventListener('mousemove', handleHoverMove);
      canvas.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
      draggingDimensionRef.current = null;
      canvas.style.cursor = '';
      useCADStore.setState({ dimensionHoverEntityId: null });
      // Only clear pending picks when leaving the dimension tool entirely.
      // Do NOT clear on activeSketch re-runs (e.g. after adding the first dim)
      // since pendingLinearPickRef is needed for the two-entity upgrade path.
      if (useCADStore.getState().activeTool !== 'dimension') {
        pendingLinearPickRef.current = null;
        pendingLinearSecondPickRef.current = null;
        previewFingerprintRef.current = null;
        if (useCADStore.getState().dimensionPreview !== null) {
          useCADStore.setState({ dimensionPreview: null });
        }
      }
    };
  }, [
    activeDimensionType,
    activeSketch,
    activeTool,
    addPendingDimensionEntity,
    addSketchDimension,
    cancelDimensionTool,
    dimensionDrivenMode,
    dimensionOffset,
    dimensionOrientation,
    dimensionToleranceLower,
    dimensionToleranceMode,
    dimensionToleranceUpper,
    getWorldPoint,
    gl,
    setStatusMessage,
  ]);
}
