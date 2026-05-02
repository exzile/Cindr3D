import { useEffect } from 'react';
import * as THREE from 'three';
import { DimensionEngine } from '../../../../../engine/DimensionEngine';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import { useCADStore } from '../../../../../store/cadStore';
import type { Sketch, SketchEntity } from '../../../../../types/cad';

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
    type: 'linear' | 'radial' | 'diameter' | 'arc-length' | 'aligned';
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
}

function createNearestEntityFinder(entities: SketchEntity[], origin: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3) {
  const entityPickRadius = 5;
  const considerSegment = (
    worldPoint: THREE.Vector3,
    entity: SketchEntity,
    start: THREE.Vector3,
    end: THREE.Vector3,
    best: { pick: PickedDimensionEntity | null; distance: number },
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
      best.pick = { entity, start, end };
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
          considerSegment(worldPoint, entity, corners[i], corners[(i + 1) % corners.length], best);
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
    return best.pick;
  };
}

function updateCircleRadius(activeSketchId: string, entityId: string, radius: number) {
  const state = useCADStore.getState();
  const updateSketch = (sketch: Sketch): Sketch => ({
    ...sketch,
    entities: sketch.entities.map((entity) =>
      entity.id === entityId && (entity.type === 'circle' || entity.type === 'arc')
        ? { ...entity, radius }
        : entity,
    ),
  });

  useCADStore.setState({
    activeSketch: state.activeSketch?.id === activeSketchId ? updateSketch(state.activeSketch) : state.activeSketch,
    sketches: state.sketches.map((sketch) => (sketch.id === activeSketchId ? updateSketch(sketch) : sketch)),
  });
}

function promptForCircleDimension(
  event: MouseEvent,
  initialValue: number,
  onCommit: (value: number) => void,
) {
  document.querySelectorAll('.sketch-inline-dimension-input').forEach((node) => node.remove());
  document.querySelectorAll('.sketch-inline-dimension-editor').forEach((node) => node.remove());

  const editor = document.createElement('div');
  editor.className = 'sketch-inline-dimension-editor';
  editor.style.left = `${event.clientX + 10}px`;
  editor.style.top = `${event.clientY - 16}px`;
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.1';
  input.min = '0.001';
  input.value = initialValue.toFixed(2);
  input.className = 'sketch-inline-dimension-input';
  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'sketch-inline-dimension-action sketch-inline-dimension-action--confirm';
  confirmButton.title = 'Apply dimension';
  confirmButton.textContent = 'OK';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'sketch-inline-dimension-action';
  cancelButton.title = 'Cancel dimension';
  cancelButton.textContent = 'X';

  let committed = false;
  const cleanup = () => {
    input.removeEventListener('keydown', handleKeyDown);
    confirmButton.removeEventListener('pointerdown', preventFocusLoss);
    cancelButton.removeEventListener('pointerdown', preventFocusLoss);
    confirmButton.removeEventListener('click', handleConfirmClick);
    cancelButton.removeEventListener('click', handleCancelClick);
    editor.remove();
  };
  const finish = (shouldCommit: boolean) => {
    if (committed) {
      return;
    }
    committed = true;
    const value = Number.parseFloat(input.value);
    cleanup();
    if (shouldCommit && Number.isFinite(value) && value > 0) {
      onCommit(value);
    }
  };
  function preventFocusLoss(pointerEvent: PointerEvent) {
    pointerEvent.preventDefault();
  }
  function handleKeyDown(keyEvent: KeyboardEvent) {
    keyEvent.stopPropagation();
    if (keyEvent.key === 'Enter') {
      keyEvent.preventDefault();
      finish(true);
    } else if (keyEvent.key === 'Escape') {
      keyEvent.preventDefault();
      finish(false);
    }
  }
  function handleConfirmClick() {
    finish(true);
  }
  function handleCancelClick() {
    finish(false);
  }

  editor.append(input, confirmButton, cancelButton);
  document.body.appendChild(editor);
  input.addEventListener('keydown', handleKeyDown);
  confirmButton.addEventListener('pointerdown', preventFocusLoss);
  cancelButton.addEventListener('pointerdown', preventFocusLoss);
  confirmButton.addEventListener('click', handleConfirmClick);
  cancelButton.addEventListener('click', handleCancelClick);
  input.focus();
  input.select();
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

    const commitCircleDimension = (entity: SketchEntity, type: 'radial' | 'diameter', value: number) => {
      if (!entity.radius) {
        return;
      }
      const nextRadius = type === 'diameter' ? value / 2 : value;
      const center = entity.points[0];
      const center2d = to2D(new THREE.Vector3(center.x, center.y, center.z));
      const dimension =
        type === 'diameter'
          ? DimensionEngine.computeDiameterDimension(center2d.x, center2d.y, nextRadius, 0)
          : DimensionEngine.computeArcLengthDimension(
              center2d.x,
              center2d.y,
              nextRadius,
              entity.startAngle ?? 0,
              entity.endAngle ?? (2 * Math.PI),
              dimensionOffset,
            );

      if (!dimensionDrivenMode) {
        updateCircleRadius(activeSketch.id, entity.id, nextRadius);
      }

      addSketchDimension({
        id: crypto.randomUUID(),
        type,
        entityIds: [entity.id],
        value: type === 'diameter' ? nextRadius * 2 : nextRadius,
        position: dimension.textPosition,
        driven: dimensionDrivenMode,
        ...buildToleranceFields(),
      });
      setStatusMessage(
        type === 'diameter'
          ? `Diameter dimension added: DIA ${(nextRadius * 2).toFixed(2)}`
          : `Radial dimension added: r=${nextRadius.toFixed(2)}`,
      );
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) {
        return;
      }

      const worldPoint = getWorldPoint(event);
      if (!worldPoint) {
        return;
      }

      if (activeDimensionType === 'angular') {
        setStatusMessage('Angular dimensions coming soon');
        return;
      }

      const pick = findNearestEntity(worldPoint);
      const entity = pick?.entity ?? null;

      if (activeDimensionType === 'linear' || activeDimensionType === 'aligned') {
        if (!entity) {
          setStatusMessage(
            activeDimensionType === 'linear'
              ? 'Dimension: click closer to a line entity'
              : 'Aligned: click closer to a line entity',
          );
          return;
        }
        if (entity.type === 'circle' && entity.radius) {
          const center = entity.points[0];
          const center2d = to2D(new THREE.Vector3(center.x, center.y, center.z));
          const dimension = DimensionEngine.computeDiameterDimension(center2d.x, center2d.y, entity.radius, 0);
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

        const currentPending = useCADStore.getState().pendingDimensionEntityIds;
        if (currentPending.length === 0 && pick?.start && pick.end) {
          const start = to2D(pick.start);
          const end = to2D(pick.end);
          const dimension =
            activeDimensionType === 'linear'
              ? DimensionEngine.computeLinearDimension(start, end, dimensionOffset)
              : DimensionEngine.computeAlignedDimension(start, end, dimensionOffset);

          addSketchDimension({
            id: crypto.randomUUID(),
            type: activeDimensionType,
            entityIds: [entity.id],
            value: dimension.value,
            position: dimension.textPosition,
            driven: dimensionDrivenMode,
            ...(activeDimensionType === 'linear' ? { orientation: dimensionOrientation } : {}),
            ...buildToleranceFields(),
          });
          setStatusMessage(
            `${activeDimensionType === 'linear' ? 'Linear' : 'Aligned'} dimension added: ${dimension.value.toFixed(2)}`,
          );
          return;
        }

        if (currentPending.length === 0) {
          addPendingDimensionEntity(entity.id);
          setStatusMessage(
            activeDimensionType === 'linear'
              ? 'Dimension: click a second line or point to complete'
              : 'Aligned: click a second entity to complete',
          );
          return;
        }

        const firstEntity = activeSketch.entities.find((candidate) => candidate.id === currentPending[0]);
        if (!firstEntity || firstEntity.points.length < 2) {
          setStatusMessage(
            activeDimensionType === 'linear'
              ? 'Dimension: first entity is invalid, please try again'
              : 'Aligned: first entity is invalid, please try again',
          );
          useCADStore.setState({ pendingDimensionEntityIds: [] });
          return;
        }

        const startWorld = new THREE.Vector3(firstEntity.points[0].x, firstEntity.points[0].y, firstEntity.points[0].z);
        const endWorld = new THREE.Vector3(
          firstEntity.points[firstEntity.points.length - 1].x,
          firstEntity.points[firstEntity.points.length - 1].y,
          firstEntity.points[firstEntity.points.length - 1].z,
        );
        const start = to2D(startWorld);
        const end = to2D(endWorld);
        const dimension =
          activeDimensionType === 'linear'
            ? DimensionEngine.computeLinearDimension(start, end, dimensionOffset)
            : DimensionEngine.computeAlignedDimension(start, end, dimensionOffset);

        addSketchDimension({
          id: crypto.randomUUID(),
          type: activeDimensionType,
          entityIds: [currentPending[0], entity.id],
          value: dimension.value,
          position: dimension.textPosition,
          driven: dimensionDrivenMode,
          ...(activeDimensionType === 'linear' ? { orientation: dimensionOrientation } : {}),
          ...buildToleranceFields(),
        });
        useCADStore.setState({ pendingDimensionEntityIds: [] });
        setStatusMessage(
          `${activeDimensionType === 'linear' ? 'Linear' : 'Aligned'} dimension added: ${dimension.value.toFixed(2)}`,
        );
        return;
      }

      if (activeDimensionType === 'radial') {
        if (!entity || (entity.type !== 'circle' && entity.type !== 'arc') || !entity.radius) {
          setStatusMessage('Dimension: click on a circle or arc');
          return;
        }
        promptForCircleDimension(event, entity.radius, (value) => commitCircleDimension(entity, 'radial', value));
        return;
      }

      if (activeDimensionType === 'diameter') {
        if (!entity || entity.type !== 'circle' || !entity.radius) {
          setStatusMessage('Dimension: click on a circle');
          return;
        }
        promptForCircleDimension(event, entity.radius * 2, (value) => commitCircleDimension(entity, 'diameter', value));
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
        cancelDimensionTool();
      }
    };

    const canvas = gl.domElement;
    canvas.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      canvas.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
      document.querySelectorAll('.sketch-inline-dimension-input').forEach((node) => node.remove());
      document.querySelectorAll('.sketch-inline-dimension-editor').forEach((node) => node.remove());
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
