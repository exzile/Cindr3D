import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../../../store/cadStore';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import { commitSketchTool } from '../commitTool';
import type { SketchEntity, SketchPoint } from '../../../../../types/cad';
import { commitDraggedTangentArc, finalizeSplineFromContextMenu } from './sketchEventHelpers';
import { handleSpecialSketchClick } from './specialSketchClickHandlers';

const focusSketchEvent = 'cad:focus-sketch';
const EDGE_ON_VIEW_DOT = 0.45;
const SELECT_DRAG_PICK_RADIUS = 3;
const SELECT_ENTITY_PICK_RADIUS = 1.2;

interface SketchPointDragTarget {
  entityId: string;
  pointIndex: number;
}

function getSketchFocusCenter(activeSketch: NonNullable<ReturnType<typeof useCADStore.getState>['activeSketch']>): [number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  const include = (point: SketchPoint, radius = 0) => {
    minX = Math.min(minX, point.x - radius);
    minY = Math.min(minY, point.y - radius);
    minZ = Math.min(minZ, point.z - radius);
    maxX = Math.max(maxX, point.x + radius);
    maxY = Math.max(maxY, point.y + radius);
    maxZ = Math.max(maxZ, point.z + radius);
  };

  activeSketch.entities.forEach((entity) => {
    const radius = entity.type === 'circle' || entity.type === 'arc' ? entity.radius ?? 0 : 0;
    entity.points.forEach((point) => include(point, radius));
  });

  if (!Number.isFinite(minX)) {
    const origin = activeSketch.planeOrigin;
    return [origin.x, origin.y, origin.z];
  }

  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

interface UseSketchInteractionEventsParams {
  activeSketch: ReturnType<typeof useCADStore.getState>['activeSketch'];
  activeTool: string;
  getWorldPoint: (event: MouseEvent) => THREE.Vector3 | null;
  getRawWorldPoint: (event: MouseEvent) => THREE.Vector3 | null;
  findSnapCandidate: (
    worldPt: THREE.Vector3,
    drawStart?: THREE.Vector3 | null,
  ) => {
    worldPos: THREE.Vector3;
    type: 'endpoint' | 'midpoint' | 'center' | 'intersection' | 'perpendicular' | 'tangent';
  } | null;
  addSketchEntity: ReturnType<typeof useCADStore.getState>['addSketchEntity'];
  replaceSketchEntities: ReturnType<typeof useCADStore.getState>['replaceSketchEntities'];
  cycleEntityLinetype: ReturnType<typeof useCADStore.getState>['cycleEntityLinetype'];
  setStatusMessage: ReturnType<typeof useCADStore.getState>['setStatusMessage'];
  setActiveTool: ReturnType<typeof useCADStore.getState>['setActiveTool'];
  polygonSides: number;
  filletRadius: number;
  chamferDist1: number;
  chamferDist2: number;
  chamferAngle: number;
  tangentCircleRadius: number;
  conicRho: number;
  blendCurveMode: 'g1' | 'g2';
  sketchTextContent: string;
  sketchTextHeight: number;
  sketchTextBold: boolean;
  sketchTextItalic: boolean;
  commitSketchTextEntities: ReturnType<typeof useCADStore.getState>['commitSketchTextEntities'];
  sketch3DMode: boolean;
  setSketch3DActivePlane: ReturnType<typeof useCADStore.getState>['setSketch3DActivePlane'];
  projectLiveLink: boolean;
  cancelSketchProjectSurfaceTool: ReturnType<typeof useCADStore.getState>['cancelSketchProjectSurfaceTool'];
  camera: THREE.Camera;
  gl: { domElement: HTMLCanvasElement };
  raycaster: THREE.Raycaster;
  scene: THREE.Scene;
  drawingPointsRef: MutableRefObject<SketchPoint[]>;
  mousePosRef: MutableRefObject<THREE.Vector3 | null>;
  setDrawingPoints: (value: SketchPoint[]) => void;
  setMousePos: (value: THREE.Vector3 | null) => void;
  setSnapTarget: (
    value:
      | {
          worldPos: THREE.Vector3;
          type: 'endpoint' | 'midpoint' | 'center' | 'intersection' | 'perpendicular' | 'tangent';
        }
      | null,
  ) => void;
  findHoverMidpoints: (worldPt: THREE.Vector3) => THREE.Vector3[];
  setHoverMidpoints: (value: THREE.Vector3[]) => void;
  lineArcModeRef: MutableRefObject<boolean>;
  drawingConstructionRef: MutableRefObject<boolean>;
  planePickPendingRef: MutableRefObject<boolean>;
  dragScreenStartRef: MutableRefObject<{ x: number; y: number } | null>;
  isDraggingArcRef: MutableRefObject<boolean>;
  dragJustFinishedRef: MutableRefObject<boolean>;
}

export function useSketchInteractionEvents({
  activeSketch,
  activeTool,
  getWorldPoint,
  getRawWorldPoint,
  findSnapCandidate,
  addSketchEntity,
  replaceSketchEntities,
  cycleEntityLinetype,
  setStatusMessage,
  setActiveTool,
  polygonSides,
  filletRadius,
  chamferDist1,
  chamferDist2,
  chamferAngle,
  tangentCircleRadius,
  conicRho,
  blendCurveMode,
  sketchTextContent,
  sketchTextHeight,
  sketchTextBold,
  sketchTextItalic,
  commitSketchTextEntities,
  projectLiveLink,
  cancelSketchProjectSurfaceTool,
  sketch3DMode,
  setSketch3DActivePlane,
  camera,
  gl,
  raycaster,
  scene,
  drawingPointsRef,
  mousePosRef,
  setDrawingPoints,
  setMousePos,
  setSnapTarget,
  findHoverMidpoints,
  setHoverMidpoints,
  lineArcModeRef,
  drawingConstructionRef,
  planePickPendingRef,
  dragScreenStartRef,
  isDraggingArcRef,
  dragJustFinishedRef,
}: UseSketchInteractionEventsParams) {
  const pointDragRef = useRef<SketchPointDragTarget | null>(null);
  const pointDragStartEntitiesRef = useRef<SketchEntity[] | null>(null);

  useEffect(() => {
    if (!activeSketch) return;
    void projectLiveLink;
    void cancelSketchProjectSurfaceTool;

    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const viewDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    const sketchNormal = activeSketch.planeNormal.clone().normalize();
    if (Math.abs(viewDir.dot(sketchNormal)) < EDGE_ON_VIEW_DOT) {
      window.dispatchEvent(new CustomEvent(focusSketchEvent, {
        detail: {
          center: getSketchFocusCenter(activeSketch),
          normal: [sketchNormal.x, sketchNormal.y, sketchNormal.z],
        },
      }));
    }

    const projectToPlane = (pt: SketchPoint, origin: SketchPoint) => {
      const d = new THREE.Vector3(pt.x - origin.x, pt.y - origin.y, pt.z - origin.z);
      return { u: d.dot(t1), v: d.dot(t2) };
    };

    const worldToSketch2D = (point: THREE.Vector3) => {
      const d = point.clone().sub(activeSketch.planeOrigin);
      return { u: d.dot(t1), v: d.dot(t2) };
    };

    const sketchPointTo2D = (point: SketchPoint) => worldToSketch2D(new THREE.Vector3(point.x, point.y, point.z));

    const distanceToSegment2D = (
      point: { u: number; v: number },
      start: { u: number; v: number },
      end: { u: number; v: number },
    ) => {
      const dx = end.u - start.u;
      const dy = end.v - start.v;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq < 1e-10) return Math.hypot(point.u - start.u, point.v - start.v);
      const t = Math.max(0, Math.min(1, ((point.u - start.u) * dx + (point.v - start.v) * dy) / lengthSq));
      return Math.hypot(point.u - (start.u + dx * t), point.v - (start.v + dy * t));
    };

    const normalizedAngle = (angle: number) => {
      const twoPi = Math.PI * 2;
      return ((angle % twoPi) + twoPi) % twoPi;
    };

    const angleWithinArc = (angle: number, start: number, end: number) => {
      const a = normalizedAngle(angle);
      const s = normalizedAngle(start);
      const e = normalizedAngle(end);
      return s <= e ? a >= s && a <= e : a >= s || a <= e;
    };

    const findNearestSelectableEntity = (worldPoint: THREE.Vector3): string | null => {
      const point = worldToSketch2D(worldPoint);
      let bestId: string | null = null;
      let bestDistance = SELECT_ENTITY_PICK_RADIUS;

      const considerSegment = (entityId: string, start: SketchPoint, end: SketchPoint) => {
        const distance = distanceToSegment2D(point, sketchPointTo2D(start), sketchPointTo2D(end));
        if (distance < bestDistance) {
          bestDistance = distance;
          bestId = entityId;
        }
      };

      for (const entity of activeSketch.entities) {
        if (entity.points.length === 0) continue;

        if (['line', 'construction-line', 'centerline'].includes(entity.type) && entity.points.length >= 2) {
          considerSegment(entity.id, entity.points[0], entity.points[entity.points.length - 1]);
          continue;
        }

        if (entity.type === 'spline' && entity.points.length >= 2) {
          for (let i = 1; i < entity.points.length; i += 1) {
            considerSegment(entity.id, entity.points[i - 1], entity.points[i]);
          }
          continue;
        }

        if (entity.type === 'rectangle' && entity.points.length >= 2) {
          const p1 = new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z);
          const p2 = new THREE.Vector3(entity.points[1].x, entity.points[1].y, entity.points[1].z);
          const delta = p2.clone().sub(p1);
          const dt1 = t1.clone().multiplyScalar(delta.dot(t1));
          const dt2 = t2.clone().multiplyScalar(delta.dot(t2));
          const corners = [
            p1.clone(),
            p1.clone().add(dt1),
            p1.clone().add(dt1).add(dt2),
            p1.clone().add(dt2),
          ].map((p) => ({ id: '', x: p.x, y: p.y, z: p.z }));
          for (let i = 0; i < corners.length; i += 1) {
            considerSegment(entity.id, corners[i], corners[(i + 1) % corners.length]);
          }
          continue;
        }

        if (entity.type === 'circle' || entity.type === 'arc') {
          const center = sketchPointTo2D(entity.points[0]);
          const radius = entity.radius ?? 0;
          const du = point.u - center.u;
          const dv = point.v - center.v;
          if (entity.type === 'arc' && !angleWithinArc(Math.atan2(dv, du), entity.startAngle ?? 0, entity.endAngle ?? Math.PI)) {
            continue;
          }
          const distance = Math.abs(Math.hypot(du, dv) - radius);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestId = entity.id;
          }
          continue;
        }

        if (entity.type === 'ellipse' || entity.type === 'elliptical-arc') {
          const center = sketchPointTo2D(entity.points[0]);
          const rotation = entity.rotation ?? 0;
          const cosR = Math.cos(-rotation);
          const sinR = Math.sin(-rotation);
          const du = point.u - center.u;
          const dv = point.v - center.v;
          const localU = du * cosR - dv * sinR;
          const localV = du * sinR + dv * cosR;
          const angle = Math.atan2(localV / (entity.minorRadius ?? 1), localU / (entity.majorRadius ?? 1));
          if (
            entity.type === 'elliptical-arc' &&
            !angleWithinArc(angle, entity.startAngle ?? 0, entity.endAngle ?? Math.PI)
          ) {
            continue;
          }
          const boundaryU = (entity.majorRadius ?? 1) * Math.cos(angle);
          const boundaryV = (entity.minorRadius ?? 1) * Math.sin(angle);
          const distance = Math.hypot(localU - boundaryU, localV - boundaryV);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestId = entity.id;
          }
          continue;
        }

        if (entity.type === 'point') {
          const point2D = sketchPointTo2D(entity.points[0]);
          const distance = Math.hypot(point.u - point2D.u, point.v - point2D.v);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestId = entity.id;
          }
        }
      }

      return bestId;
    };

    const selectSketchEntity = (entityId: string | null, additive: boolean) => {
      const { selectedEntityIds, setSelectedEntityIds } = useCADStore.getState();
      if (!entityId) {
        if (!additive && selectedEntityIds.length > 0) setSelectedEntityIds([]);
        return;
      }
      if (additive) {
        setSelectedEntityIds(
          selectedEntityIds.includes(entityId)
            ? selectedEntityIds.filter((id) => id !== entityId)
            : [...selectedEntityIds, entityId],
        );
      } else {
        setSelectedEntityIds([entityId]);
      }
    };

    const findNearestEditablePoint = (worldPoint: THREE.Vector3): SketchPointDragTarget | null => {
      let best: SketchPointDragTarget | null = null;
      let bestDist = SELECT_DRAG_PICK_RADIUS;

      for (const entity of activeSketch.entities) {
        if (!['line', 'construction-line', 'centerline', 'rectangle', 'circle', 'arc'].includes(entity.type)) continue;
        entity.points.forEach((point, pointIndex) => {
          const distance = worldPoint.distanceTo(new THREE.Vector3(point.x, point.y, point.z));
          if (distance < bestDist) {
            bestDist = distance;
            best = { entityId: entity.id, pointIndex };
          }
        });
      }

      return best;
    };

    const updateDraggedPoint = (target: SketchPointDragTarget, point: THREE.Vector3) => {
      const latestSketch = useCADStore.getState().activeSketch;
      if (!latestSketch) return;
      replaceSketchEntities(
        latestSketch.entities.map((entity) => {
          if (entity.id !== target.entityId) return entity;
          return {
            ...entity,
            points: entity.points.map((existingPoint, pointIndex) => (
              pointIndex === target.pointIndex
                ? { ...existingPoint, x: point.x, y: point.y, z: point.z }
                : existingPoint
            )),
          };
        }),
      );
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (activeTool === 'select') return;
      const drawingPoints = drawingPointsRef.current;
      // Use raw (pre-grid-snap) point for object-snap and hover detection.
      // Grid snap is only applied as a fallback when no object snap is found,
      // so non-grid-aligned points like midpoints are always reachable.
      const rawPoint = getRawWorldPoint(event);
      if (!rawPoint) return;
      const drawStart =
        drawingPoints.length > 0
          ? new THREE.Vector3(drawingPoints[0].x, drawingPoints[0].y, drawingPoints[0].z)
          : null;
      const snapCandidate = findSnapCandidate(rawPoint, drawStart);
      const point = snapCandidate?.worldPos.clone() ?? getWorldPoint(event) ?? rawPoint;
      if (snapCandidate) {
        setSnapTarget(snapCandidate);
      } else {
        setSnapTarget(null);
      }
      setMousePos(point);
      setHoverMidpoints(findHoverMidpoints(rawPoint));

      if (drawingPoints.length > 0) {
        const start = drawingPoints[0];
        if (activeTool === 'circle' || activeTool === 'polygon' || activeTool === 'polygon-inscribed') {
          const radius = point.distanceTo(new THREE.Vector3(start.x, start.y, start.z));
          setStatusMessage(`Radius: ${radius.toFixed(2)} - click to place`);
        } else if (activeTool === 'arc') {
          if (drawingPoints.length === 1) {
            const r = point.distanceTo(new THREE.Vector3(start.x, start.y, start.z));
            setStatusMessage(`Arc radius: ${r.toFixed(2)} - click to set start angle`);
          } else {
            setStatusMessage('Click to set end angle');
          }
        } else if (activeTool === 'circle-2point') {
          const radius = point.distanceTo(new THREE.Vector3(start.x, start.y, start.z)) / 2;
          setStatusMessage(`Diameter: ${(radius * 2).toFixed(2)}, r=${radius.toFixed(2)}`);
        } else if (activeTool === 'circle-3point') {
          setStatusMessage(drawingPoints.length === 1 ? 'Click second point on circle' : 'Click third point to complete circle');
        } else if (activeTool === 'arc-3point') {
          setStatusMessage(drawingPoints.length === 1 ? 'Click a point on the arc' : 'Click end point to complete arc');
        } else if (activeTool === 'rectangle-center') {
          const sketchPt: SketchPoint = { id: '', x: point.x, y: point.y, z: point.z };
          const { u: du, v: dv } = projectToPlane(sketchPt, start);
          setStatusMessage(`Width: ${(Math.abs(du) * 2).toFixed(2)}, Height: ${(Math.abs(dv) * 2).toFixed(2)}`);
        } else if (activeTool === 'polygon-edge') {
          setStatusMessage(`Edge length: ${point.distanceTo(new THREE.Vector3(start.x, start.y, start.z)).toFixed(2)}`);
        } else if (activeTool === 'polygon-circumscribed') {
          const apothem = point.distanceTo(new THREE.Vector3(start.x, start.y, start.z));
          setStatusMessage(`Apothem: ${apothem.toFixed(2)} - click to place`);
        } else {
          setStatusMessage(`Δ: ${(point.x - start.x).toFixed(2)}, ${(point.y - start.y).toFixed(2)}, ${(point.z - start.z).toFixed(2)}`);
        }
      } else {
        setStatusMessage(
          `Click to start ${activeTool.replace(/-/g, ' ')} - ${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}`,
        );
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (activeTool === 'select') return;
      const drawingPoints = drawingPointsRef.current;
      if (event.button !== 0) return;
      if (dragJustFinishedRef.current) {
        dragJustFinishedRef.current = false;
        return;
      }

      if (planePickPendingRef.current && sketch3DMode) {
        const rect = gl.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(mouse, camera);
        const pickable: THREE.Mesh[] = [];
        scene.traverse((obj) => {
          const m = obj as THREE.Mesh;
          if (m.isMesh && obj.userData?.pickable) pickable.push(m);
        });
        const hits = raycaster.intersectObjects(pickable, false);
        if (hits.length > 0 && hits[0].faceIndex !== undefined && hits[0].face) {
          const hit = hits[0];
          const normalLocal = hit.face!.normal.clone();
          const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
          const worldNormal = normalLocal.applyMatrix3(normalMatrix).normalize();
          const worldOrigin = hit.point.clone();
          setSketch3DActivePlane({
            normal: [worldNormal.x, worldNormal.y, worldNormal.z],
            origin: [worldOrigin.x, worldOrigin.y, worldOrigin.z],
          });
          planePickPendingRef.current = false;
          setStatusMessage('Draw plane switched to face - Tab to change again');
        } else {
          setStatusMessage('No face hit - click a solid face to switch plane');
        }
        return;
      }

      const rawPoint = getRawWorldPoint(event);
      if (!rawPoint) return;
      const point = getWorldPoint(event) ?? rawPoint;
      const drawStart =
        drawingPoints.length > 0
          ? new THREE.Vector3(drawingPoints[0].x, drawingPoints[0].y, drawingPoints[0].z)
          : null;
      const snapCandidate = findSnapCandidate(rawPoint, drawStart);
      const commitPoint = snapCandidate?.worldPos.clone() ?? point.clone();
      const planeNormal = activeSketch.planeNormal.clone().normalize();
      const planeOrigin = activeSketch.planeOrigin;
      commitPoint.addScaledVector(
        planeNormal,
        -planeNormal.dot(commitPoint.clone().sub(planeOrigin)),
      );
      if (snapCandidate) {
        setMousePos(commitPoint.clone());
        setSnapTarget(snapCandidate);
      }
      const sketchPoint: SketchPoint = { id: crypto.randomUUID(), x: commitPoint.x, y: commitPoint.y, z: commitPoint.z };

      if (handleSpecialSketchClick({
        activeTool,
        point: commitPoint,
        shiftKey: event.shiftKey,
        drawingPoints,
        t1,
        t2,
        addSketchEntity,
        setDrawingPoints,
        setStatusMessage,
        lineArcModeRef,
        drawingConstructionRef,
        sketchTextContent,
        sketchTextHeight,
        sketchTextBold,
        sketchTextItalic,
        commitSketchTextEntities,
      })) {
        return;
      }

      const addSketchEntityWrapped: typeof addSketchEntity = drawingConstructionRef.current
        ? (entity) => addSketchEntity({ ...entity, isConstruction: true })
        : addSketchEntity;

      commitSketchTool({
        activeTool,
        activeSketch,
        sketchPoint,
        drawingPoints,
        setDrawingPoints,
        t1,
        t2,
        projectToPlane,
        addSketchEntity: addSketchEntityWrapped,
        replaceSketchEntities,
        cycleEntityLinetype,
        setStatusMessage,
        polygonSides,
        filletRadius,
        chamferDist1,
        chamferDist2,
        chamferAngle,
        tangentCircleRadius,
        conicRho,
        blendCurveMode,
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const drawingPoints = drawingPointsRef.current;
      if (event.key === 'Escape') {
        if (planePickPendingRef.current) {
          planePickPendingRef.current = false;
          setStatusMessage('Plane pick cancelled');
          return;
        }
        if (drawingPoints.length === 0 && activeTool !== 'select') {
          setActiveTool('select');
          setStatusMessage('Select: drag a sketch corner or endpoint to adjust it');
          return;
        }
        setDrawingPoints([]);
        setStatusMessage('Drawing cancelled');
        return;
      }
      if (event.key === 'Tab' && sketch3DMode) {
        event.preventDefault();
        planePickPendingRef.current = !planePickPendingRef.current;
        setStatusMessage(
          planePickPendingRef.current
            ? 'Click a face or construction plane to switch draw plane [Tab to cancel]'
            : 'Plane pick cancelled',
        );
        return;
      }
      // Skip all single-key shortcuts when a text input is focused
      const activeTag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const k = event.key.toLowerCase();

      // A — toggle arc mode when already in line/construction-line, else switch to 3-pt arc
      if (k === 'a') {
        if (['line', 'construction-line', 'centerline'].includes(activeTool)) {
          lineArcModeRef.current = !lineArcModeRef.current;
          const base = `Click to place - ${drawingPoints.length === 0 ? 'start point' : 'next point'}`;
          setStatusMessage(
            `${base}${lineArcModeRef.current ? ' [ARC]' : ''}${drawingConstructionRef.current ? ' [CONSTRUCTION]' : ''}`,
          );
        } else {
          setDrawingPoints([]);
          setActiveTool('arc-3point');
          setStatusMessage('3-Point Arc: click start, end, then point on arc');
        }
        return;
      }

      // X — toggle construction geometry
      if (k === 'x') {
        drawingConstructionRef.current = !drawingConstructionRef.current;
        setStatusMessage(
          `${activeTool.replace(/-/g, ' ')}${lineArcModeRef.current ? ' [ARC]' : ''}${
            drawingConstructionRef.current ? ' [CONSTRUCTION]' : ''
          }`,
        );
        return;
      }

      // Tool hotkeys (Fusion 360 mapping)
      const toolHotkeys: Record<string, { tool: string; msg: string }> = {
        l: { tool: 'line',          msg: 'Line: click to place start point' },
        c: { tool: 'circle',        msg: 'Circle: click center point' },
        r: { tool: 'rectangle',     msg: 'Rectangle: click first corner' },
        s: { tool: 'spline',        msg: 'Spline: click to place fit points, right-click to finish' },
        f: { tool: 'sketch-fillet', msg: 'Sketch Fillet: click near the corner of two lines' },
        t: { tool: 'trim',          msg: 'Trim: click a segment portion to remove it' },
        o: { tool: 'sketch-offset', msg: 'Offset: click a line, then click the side to offset towards' },
        p: { tool: 'sketch-project',msg: 'Project: click a solid face to project its boundary onto the sketch plane' },
        d: { tool: 'dimension',     msg: 'Dimension: click a line, arc, or two points to add a dimension' },
      };
      const hotkey = toolHotkeys[k];
      if (hotkey) {
        setDrawingPoints([]);
        setActiveTool(hotkey.tool as Parameters<typeof setActiveTool>[0]);
        setStatusMessage(hotkey.msg);
        return;
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      const drawingPoints = drawingPointsRef.current;
      if (finalizeSplineFromContextMenu(activeTool, drawingPoints, addSketchEntity, setDrawingPoints, setStatusMessage)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (drawingPoints.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setDrawingPoints([]);
        setStatusMessage('');
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (activeTool === 'select') {
        const point = getWorldPoint(event);
        if (!point) return;
        const additive = event.ctrlKey || event.metaKey;
        const selectedEntityId = findNearestSelectableEntity(point);
        const target = additive ? null : findNearestEditablePoint(point);
        if (!target) {
          selectSketchEntity(selectedEntityId, additive);
          setStatusMessage(selectedEntityId ? 'Sketch entity selected' : 'Select: drag a sketch corner or endpoint to adjust it');
          if (selectedEntityId) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        selectSketchEntity(target.entityId, false);
        const state = useCADStore.getState();
        state.pushUndo();
        pointDragStartEntitiesRef.current = state.activeSketch?.entities ?? null;
        pointDragRef.current = target;
        setStatusMessage('Dragging sketch point');
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      isDraggingArcRef.current = false;
      dragJustFinishedRef.current = false;
      dragScreenStartRef.current = { x: event.clientX, y: event.clientY };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (activeTool === 'select') {
        const target = pointDragRef.current;
        if (!target || event.buttons !== 1) return;
        const point = getWorldPoint(event);
        if (!point) return;
        updateDraggedPoint(target, point);
        setStatusMessage('Adjusting sketch point');
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const drawingPoints = drawingPointsRef.current;
      if (event.buttons !== 1) return;
      const start = dragScreenStartRef.current;
      if (!start) return;
      const isLineMode = ['line', 'construction-line', 'centerline'].includes(activeTool);
      if (!isLineMode || drawingPoints.length === 0) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!isDraggingArcRef.current && Math.sqrt(dx * dx + dy * dy) > 8) {
        isDraggingArcRef.current = true;
        setStatusMessage('Drag: tangent arc - release to place');
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (activeTool === 'select') {
        if (!pointDragRef.current) return;
        pointDragRef.current = null;
        useCADStore.getState().solveSketch?.();
        const state = useCADStore.getState();
        if (state.activeSketch?.overConstrained && pointDragStartEntitiesRef.current) {
          const revertedSketch = {
            ...state.activeSketch,
            entities: pointDragStartEntitiesRef.current,
            overConstrained: false,
          };
          useCADStore.setState({
            activeSketch: revertedSketch,
            sketches: state.sketches.map((sketch) => (sketch.id === revertedSketch.id ? revertedSketch : sketch)),
            statusMessage: 'Move blocked by sketch dimensions or constraints',
          });
        } else {
          setStatusMessage('Sketch point adjusted');
        }
        pointDragStartEntitiesRef.current = null;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const drawingPoints = drawingPointsRef.current;
      const mousePos = mousePosRef.current;
      if (event.button !== 0 || !isDraggingArcRef.current) return;
      isDraggingArcRef.current = false;
      dragJustFinishedRef.current = true;
      dragScreenStartRef.current = null;
      commitDraggedTangentArc({
        activeTool,
        activeSketch,
        drawingPoints,
        mousePos,
        addSketchEntity,
        setDrawingPoints,
        setStatusMessage,
      });
    };

    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    activeSketch,
    activeTool,
    getWorldPoint,
    findSnapCandidate,
    addSketchEntity,
    replaceSketchEntities,
    cycleEntityLinetype,
    setStatusMessage,
    setActiveTool,
    polygonSides,
    filletRadius,
    chamferDist1,
    chamferDist2,
    chamferAngle,
    tangentCircleRadius,
    conicRho,
    blendCurveMode,
    sketchTextContent,
    sketchTextHeight,
    sketchTextBold,
    sketchTextItalic,
    commitSketchTextEntities,
    cancelSketchProjectSurfaceTool,
    camera,
    gl,
    raycaster,
    sketch3DMode,
    setSketch3DActivePlane,
    scene,
    drawingPointsRef,
    mousePosRef,
    setDrawingPoints,
    setMousePos,
    setSnapTarget,
    findHoverMidpoints,
    setHoverMidpoints,
    getRawWorldPoint,
    lineArcModeRef,
    drawingConstructionRef,
    planePickPendingRef,
    projectLiveLink,
    dragScreenStartRef,
    isDraggingArcRef,
    dragJustFinishedRef,
  ]);
}
