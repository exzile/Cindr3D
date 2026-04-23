import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../../../store/cadStore';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import { commitSketchTool } from '../commitTool';
import type { SketchPoint } from '../../../../../types/cad';
import { commitDraggedTangentArc, finalizeSplineFromContextMenu } from './sketchEventHelpers';
import { handleSpecialSketchClick } from './specialSketchClickHandlers';

interface UseSketchInteractionEventsParams {
  activeSketch: ReturnType<typeof useCADStore.getState>['activeSketch'];
  activeTool: string;
  getWorldPoint: (event: MouseEvent) => THREE.Vector3 | null;
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
  findSnapCandidate,
  addSketchEntity,
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
  lineArcModeRef,
  drawingConstructionRef,
  planePickPendingRef,
  dragScreenStartRef,
  isDraggingArcRef,
  dragJustFinishedRef,
}: UseSketchInteractionEventsParams) {
  useEffect(() => {
    if (!activeSketch || activeTool === 'select') return;
    void projectLiveLink;
    void cancelSketchProjectSurfaceTool;

    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const projectToPlane = (pt: SketchPoint, origin: SketchPoint) => {
      const d = new THREE.Vector3(pt.x - origin.x, pt.y - origin.y, pt.z - origin.z);
      return { u: d.dot(t1), v: d.dot(t2) };
    };

    const handleMouseMove = (event: MouseEvent) => {
      const drawingPoints = drawingPointsRef.current;
      const point = getWorldPoint(event);
      if (!point) return;
      const drawStart =
        drawingPoints.length > 0
          ? new THREE.Vector3(drawingPoints[0].x, drawingPoints[0].y, drawingPoints[0].z)
          : null;
      const snapCandidate = findSnapCandidate(point, drawStart);
      if (snapCandidate) {
        setMousePos(snapCandidate.worldPos.clone());
        setSnapTarget(snapCandidate);
      } else {
        setMousePos(point);
        setSnapTarget(null);
      }

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

      const point = getWorldPoint(event);
      if (!point) return;
      const sketchPoint: SketchPoint = { id: crypto.randomUUID(), x: point.x, y: point.y, z: point.z };

      if (handleSpecialSketchClick({
        activeTool,
        point,
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
      if ((event.key === 'a' || event.key === 'A') && ['line', 'construction-line', 'centerline'].includes(activeTool)) {
        lineArcModeRef.current = !lineArcModeRef.current;
        const base = `Click to place - ${drawingPoints.length === 0 ? 'start point' : 'next point'}`;
        setStatusMessage(
          `${base}${lineArcModeRef.current ? ' [ARC]' : ''}${drawingConstructionRef.current ? ' [CONSTRUCTION]' : ''}`,
        );
        return;
      }
      if (event.key === 'x' || event.key === 'X') {
        drawingConstructionRef.current = !drawingConstructionRef.current;
        setStatusMessage(
          `${activeTool.replace(/-/g, ' ')}${lineArcModeRef.current ? ' [ARC]' : ''}${
            drawingConstructionRef.current ? ' [CONSTRUCTION]' : ''
          }`,
        );
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
      isDraggingArcRef.current = false;
      dragJustFinishedRef.current = false;
      dragScreenStartRef.current = { x: event.clientX, y: event.clientY };
    };

    const handlePointerMove = (event: PointerEvent) => {
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
    lineArcModeRef,
    drawingConstructionRef,
    planePickPendingRef,
    dragScreenStartRef,
    isDraggingArcRef,
    dragJustFinishedRef,
  ]);
}
