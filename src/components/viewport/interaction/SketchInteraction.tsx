import { useEffect, useRef, useState, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useThemeStore } from '../../../store/themeStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { SketchPoint } from '../../../types/cad';
import { renderSketchPreview } from './sketchInteraction/previewTool';
import { useSketchProjectionTools } from './sketchInteraction/hooks/useSketchProjectionTools';
import { useSketchDimensionTool } from './sketchInteraction/hooks/useSketchDimensionTool';
import { useSketchConstraintTool } from './sketchInteraction/hooks/useSketchConstraintTool';
import { useSketchInteractionEvents } from './sketchInteraction/hooks/useSketchInteractionEvents';
import { SketchInteractionHud } from './sketchInteraction/SketchInteractionHud';

export default function SketchInteraction() {
  const { camera, gl, raycaster, scene } = useThree();
  const activeTool = useCADStore((s) => s.activeTool);
  const activeSketch = useCADStore((s) => s.activeSketch);
  const addSketchEntity = useCADStore((s) => s.addSketchEntity);
  const replaceSketchEntities = useCADStore((s) => s.replaceSketchEntities);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const snapEnabled = useCADStore((s) => s.snapEnabled);
  const sketchSnapEnabled = useCADStore((s) => s.sketchSnapEnabled);
  // NAV-24: per-type object snap settings
  const objectSnapEnabled = useCADStore((s) => s.objectSnapEnabled);
  const snapToEndpoint = useCADStore((s) => s.snapToEndpoint);
  const snapToMidpoint = useCADStore((s) => s.snapToMidpoint);
  const snapToCenter = useCADStore((s) => s.snapToCenter);
  const snapToIntersection = useCADStore((s) => s.snapToIntersection);
  const snapToPerpendicular = useCADStore((s) => s.snapToPerpendicular);
  const snapToTangent = useCADStore((s) => s.snapToTangent);
  const gridSize = useCADStore((s) => s.gridSize);
  const units = useCADStore((s) => s.units);
  const polygonSides = useCADStore((s) => s.sketchPolygonSides);
  const filletRadius = useCADStore((s) => s.sketchFilletRadius);
  const chamferDist1 = useCADStore((s) => s.sketchChamferDist1);
  const chamferDist2 = useCADStore((s) => s.sketchChamferDist2);
  const chamferAngle = useCADStore((s) => s.sketchChamferAngle);
  const tangentCircleRadius = useCADStore((s) => s.tangentCircleRadius);
  const cycleEntityLinetype = useCADStore((s) => s.cycleEntityLinetype);
  const conicRho = useCADStore((s) => s.conicRho);
  const blendCurveMode = useCADStore((s) => s.blendCurveMode);
  const themeColors = useThemeStore((s) => s.colors);
  // D12: Sketch Text
  const sketchTextContent = useCADStore((s) => s.sketchTextContent);
  const sketchTextHeight  = useCADStore((s) => s.sketchTextHeight);
  // SK-A6: formatting flags
  const sketchTextBold    = useCADStore((s) => s.sketchTextBold);
  const sketchTextItalic  = useCADStore((s) => s.sketchTextItalic);
  const commitSketchTextEntities = useCADStore((s) => s.commitSketchTextEntities);
  // D45: Project / Include live-link toggle
  const projectLiveLink = useCADStore((s) => s.projectLiveLink);
  // D46: Project to Surface
  const cancelSketchProjectSurfaceTool = useCADStore((s) => s.cancelSketchProjectSurfaceTool);
  // D28: Dimension tool
  const activeDimensionType = useCADStore((s) => s.activeDimensionType);
  const dimensionOffset = useCADStore((s) => s.dimensionOffset);
  const dimensionDrivenMode = useCADStore((s) => s.dimensionDrivenMode);
  const dimensionOrientation = useCADStore((s) => s.dimensionOrientation);
  const dimensionToleranceMode = useCADStore((s) => s.dimensionToleranceMode);
  const dimensionToleranceUpper = useCADStore((s) => s.dimensionToleranceUpper);
  const dimensionToleranceLower = useCADStore((s) => s.dimensionToleranceLower);
  const addPendingDimensionEntity = useCADStore((s) => s.addPendingDimensionEntity);
  const addSketchDimension = useCADStore((s) => s.addSketchDimension);
  const cancelDimensionTool = useCADStore((s) => s.cancelDimensionTool);
  // D52: Constraint tool state
  const addToConstraintSelection = useCADStore((s) => s.addToConstraintSelection);
  const clearConstraintSelection = useCADStore((s) => s.clearConstraintSelection);
  const addSketchConstraint = useCADStore((s) => s.addSketchConstraint);
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  // S7: 3D sketch multi-plane
  const sketch3DMode = useCADStore((s) => s.sketch3DMode);
  const sketch3DActivePlane = useCADStore((s) => s.sketch3DActivePlane);
  const setSketch3DActivePlane = useCADStore((s) => s.setSketch3DActivePlane);

  const [drawingPoints, setDrawingPoints] = useState<SketchPoint[]>([]);
  const [mousePos, setMousePos] = useState<THREE.Vector3 | null>(null);
  // Refs mirror the same state so the master-effect's DOM handlers can read
  // the latest value WITHOUT having `drawingPoints` / `mousePos` in the
  // effect's dep list. Previously they were deps → every setMousePos call
  // (i.e. every pointermove) tore down and re-attached all 6 DOM listeners,
  // silently dropping pointer events that arrived mid-teardown.
  // Refs are synced in a useEffect (not during render) so React's
  // react-hooks/refs rule stays happy.
  const drawingPointsRef = useRef<SketchPoint[]>(drawingPoints);
  const mousePosRef = useRef<THREE.Vector3 | null>(mousePos);
  useEffect(() => { drawingPointsRef.current = drawingPoints; }, [drawingPoints]);
  useEffect(() => { mousePosRef.current = mousePos; }, [mousePos]);
  // D65: snap indicator target
  const [snapTarget, setSnapTarget] = useState<{ worldPos: THREE.Vector3; type: 'endpoint' | 'midpoint' | 'center' | 'intersection' | 'perpendicular' | 'tangent' } | null>(null);
  const previewRef = useRef<THREE.Group>(null);
  // Stable preview materials — created once, never recreated per frame
  const previewMaterial = useRef(new THREE.LineBasicMaterial({
    color: 0xffaa00, linewidth: 2, depthTest: false, depthWrite: false,
  }));
  const constructionPreviewMaterial = useRef(new THREE.LineDashedMaterial({
    color: 0xff8800, linewidth: 1, dashSize: 0.3, gapSize: 0.18, depthTest: false, depthWrite: false,
  }));
  const centerlinePreviewMaterial = useRef(new THREE.LineDashedMaterial({
    color: 0x00aa55, linewidth: 1, dashSize: 0.7, gapSize: 0.2, depthTest: false, depthWrite: false,
  }));

  // Scratch Vector3 for useFrame — avoids per-frame allocation
  const startVRef = useRef(new THREE.Vector3());

  // D42: click-drag tangent arc detection for line tool
  const isDraggingArcRef = useRef(false);
  const dragScreenStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragJustFinishedRef = useRef(false);
  const lineArcModeRef = useRef(false);
  const drawingConstructionRef = useRef(false);
  // S10: construction-mode preview material (cyan dashed)
  const constructionModePreviewMaterial = useRef(new THREE.LineDashedMaterial({
    color: 0x00ccff, linewidth: 1, dashSize: 0.4, gapSize: 0.2, depthTest: false, depthWrite: false,
  }));

  // S7: plane-pick pending — set true when Tab is pressed to redirect draw plane
  const planePickPendingRef = useRef(false);

  // Dispose the shared preview materials when SketchInteraction unmounts.
  useEffect(() => {
    const mat = previewMaterial.current;
    const constMat = constructionPreviewMaterial.current;
    const cenMat = centerlinePreviewMaterial.current;
    const constrModeMat = constructionModePreviewMaterial.current;
    return () => {
      mat.dispose();
      constMat.dispose();
      cenMat.dispose();
      constrModeMat.dispose();
    };
  }, []);

  // Clear in-progress drawing when the user switches tools
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawingPoints([]);
    setMousePos(null);
    setSnapTarget(null);
    // S9/S10: reset inline-arc and construction-mode toggles on tool change
    lineArcModeRef.current = false;
    drawingConstructionRef.current = false;
  }, [activeTool]);

  const getSketchPlane = useCallback((): THREE.Plane => {
    if (!activeSketch) return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // S7: when a 3D active draw plane override is set, use it
    if (sketch3DActivePlane) {
      const n = new THREE.Vector3(...sketch3DActivePlane.normal).normalize();
      const o = new THREE.Vector3(...sketch3DActivePlane.origin);
      return new THREE.Plane(n, -n.dot(o));
    }

    const origin = activeSketch.planeOrigin ?? new THREE.Vector3(0, 0, 0);

    // Normals must match getPlaneNormal() in cadStore and the visual plane selector:
    //   XY = horizontal ground   → Y-normal  (0, 1, 0)
    //   XZ = vertical front wall → Z-normal  (0, 0, 1)
    //   YZ = vertical side wall  → X-normal  (1, 0, 0)
    //   custom = face plane → use stored planeNormal & planeOrigin
    switch (activeSketch.plane) {
      case 'XY': {
        const n = new THREE.Vector3(0, 1, 0);
        return new THREE.Plane(n, -n.dot(origin));
      }
      case 'XZ': {
        const n = new THREE.Vector3(0, 0, 1);
        return new THREE.Plane(n, -n.dot(origin));
      }
      case 'YZ': {
        const n = new THREE.Vector3(1, 0, 0);
        return new THREE.Plane(n, -n.dot(origin));
      }
      case 'custom': {
        const n = activeSketch.planeNormal.clone().normalize();
        return new THREE.Plane(n, -n.dot(activeSketch.planeOrigin));
      }
      default: {
        const n = new THREE.Vector3(0, 1, 0);
        return new THREE.Plane(n, -n.dot(origin));
      }
    }
  }, [activeSketch, sketch3DActivePlane]);

  const snapToGrid = useCallback((point: THREE.Vector3): THREE.Vector3 => {
    // D207: sketchSnapEnabled controls snap-to-grid; snapEnabled is global geometry snap
    if (!snapEnabled && !sketchSnapEnabled) return point;
    if (!activeSketch) return point;

    const snap = gridSize / 10;
    const origin = activeSketch.planeOrigin ?? new THREE.Vector3(0, 0, 0);
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const fromOrigin = point.clone().sub(origin);
    const u = Math.round(fromOrigin.dot(t1) / snap) * snap;
    const v = Math.round(fromOrigin.dot(t2) / snap) * snap;

    return origin.clone()
      .addScaledVector(t1, u)
      .addScaledVector(t2, v);
  }, [snapEnabled, sketchSnapEnabled, gridSize, activeSketch]);

  // D65 / S8 / NAV-24: find nearest snap candidate within snap radius.
  // Supports endpoint, midpoint, center, intersection (existing) +
  // perpendicular and tangent (NAV-24).
  const SNAP_RADIUS = 4;
  const SKETCH_PLANE_SNAP_TOLERANCE = 0.05;
  const findSnapCandidate = useCallback((worldPt: THREE.Vector3, drawStart?: THREE.Vector3 | null) => {
    if (!activeSketch || !snapEnabled) return null;
    // NAV-24: master object-snap gate
    if (!objectSnapEnabled) return null;
    let bestDist = SNAP_RADIUS;
    let best: { worldPos: THREE.Vector3; type: 'endpoint' | 'midpoint' | 'center' | 'intersection' | 'perpendicular' | 'tangent' } | null = null;
    const considerCandidate = (
      worldPos: THREE.Vector3,
      type: 'endpoint' | 'midpoint' | 'center' | 'intersection' | 'perpendicular' | 'tangent',
    ) => {
      const d = worldPt.distanceTo(worldPos);
      if (d < bestDist) {
        bestDist = d;
        best = { worldPos: worldPos.clone(), type };
      }
    };

    // Collect line-like entities for intersection / perpendicular testing
    const lineEntities = activeSketch.entities.filter(
      (e) =>
        (e.type === 'line' || e.type === 'construction-line' || e.type === 'centerline') &&
        e.points.length >= 2,
    );

    for (const e of activeSketch.entities) {
      if ((e.type === 'line' || e.type === 'construction-line' || e.type === 'centerline') && e.points.length >= 2) {
        // Endpoint snap
        if (snapToEndpoint) {
          for (const idx of [0, e.points.length - 1]) {
            const p = e.points[idx];
            const wp = new THREE.Vector3(p.x, p.y, p.z);
            considerCandidate(wp, 'endpoint');
          }
        }
        // Midpoint snap
        if (snapToMidpoint) {
          const p0 = e.points[0], p1 = e.points[e.points.length - 1];
          const mid = new THREE.Vector3((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
          considerCandidate(mid, 'midpoint');
        }
        // Perpendicular snap: foot of perpendicular from worldPt to segment
        if (snapToPerpendicular) {
          const P0 = new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z);
          const P1 = new THREE.Vector3(e.points[e.points.length - 1].x, e.points[e.points.length - 1].y, e.points[e.points.length - 1].z);
          const seg = P1.clone().sub(P0);
          const segLen2 = seg.lengthSq();
          if (segLen2 > 1e-10) {
            const t = worldPt.clone().sub(P0).dot(seg) / segLen2;
            if (t >= 0 && t <= 1) {
              const foot = P0.clone().addScaledVector(seg, t);
              considerCandidate(foot, 'perpendicular');
            }
          }
        }
      } else if ((e.type === 'circle' || e.type === 'arc') && e.points.length >= 1) {
        // Center snap
        if (snapToCenter) {
          const center = new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z);
          considerCandidate(center, 'center');
        }
        // Tangent snap: when drawing a line (drawStart set), find tangent point on circle
        // where the line from drawStart to that point is tangent to the circle.
        // PLANE-AWARE: must use sketch t1/t2 axes, not world x/y, so this works on
        // XZ / YZ / arbitrary construction-plane sketches — not just XY.
        if (snapToTangent && drawStart && e.points.length >= 2 && activeSketch) {
          const center = new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z);
          const radiusPt = new THREE.Vector3(e.points[1].x, e.points[1].y, e.points[1].z);
          const r = center.distanceTo(radiusPt);
          if (r > 1e-6) {
            const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
            const dVec = center.clone().sub(drawStart);
            const dist = dVec.length();
            if (dist > r) {
              // Project dVec onto sketch UV to compute the base angle in sketch-plane space
              const du = dVec.dot(t1);
              const dv = dVec.dot(t2);
              const alpha = Math.asin(r / dist);
              const baseAngle = Math.atan2(dv, du);
              for (const sign of [-1, 1]) {
                const angle = baseAngle + sign * (Math.PI / 2 - alpha);
                // Build tangent point in world space via t1*cos + t2*sin
                const tp = center.clone()
                  .addScaledVector(t1, Math.cos(angle) * r)
                  .addScaledVector(t2, Math.sin(angle) * r);
                considerCandidate(tp, 'tangent');
              }
            }
          }
        }
      }
    }

    if (snapToEndpoint) {
      const plane = getSketchPlane();
      const worldVertex = new THREE.Vector3();
      const seen = new Set<string>();

      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;
        const geometry = mesh.geometry as THREE.BufferGeometry;
        const positions = geometry.getAttribute('position');
        if (!positions) return;

        for (let index = 0; index < positions.count; index += 1) {
          worldVertex.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
          if (Math.abs(plane.distanceToPoint(worldVertex)) > SKETCH_PLANE_SNAP_TOLERANCE) continue;

          const key = `${worldVertex.x.toFixed(3)},${worldVertex.y.toFixed(3)},${worldVertex.z.toFixed(3)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          considerCandidate(worldVertex, 'endpoint');
        }
      });
    }

    // S8 / NAV-24: brute-force line-line intersection snap
    if (snapToIntersection) {
      for (let i = 0; i < lineEntities.length; i++) {
        const a = lineEntities[i];
        const A0 = new THREE.Vector3(a.points[0].x, a.points[0].y, a.points[0].z);
        const Ad = new THREE.Vector3(
          a.points[a.points.length - 1].x - a.points[0].x,
          a.points[a.points.length - 1].y - a.points[0].y,
          a.points[a.points.length - 1].z - a.points[0].z,
        );
        const aLen = Ad.length();
        if (aLen < 1e-6) continue;
        Ad.divideScalar(aLen);

        for (let j = i + 1; j < lineEntities.length; j++) {
          const b = lineEntities[j];
          const B0 = new THREE.Vector3(b.points[0].x, b.points[0].y, b.points[0].z);
          const Bd = new THREE.Vector3(
            b.points[b.points.length - 1].x - b.points[0].x,
            b.points[b.points.length - 1].y - b.points[0].y,
            b.points[b.points.length - 1].z - b.points[0].z,
          );
          const bLen = Bd.length();
          if (bLen < 1e-6) continue;
          Bd.divideScalar(bLen);

          const w0 = new THREE.Vector3().subVectors(A0, B0);
          const a11 = Ad.dot(Ad);
          const a12 = -Ad.dot(Bd);
          const a22 = Bd.dot(Bd);
          const b1 = -Ad.dot(w0);
          const b2 = Bd.dot(w0);
          const det = a11 * a22 - a12 * a12;
          if (Math.abs(det) < 1e-8) continue;
          const t = (a22 * b1 - a12 * b2) / det;
          const s = (a11 * b2 - a12 * b1) / det;
          if (t < -0.1 * aLen || t > 1.1 * aLen) continue;
          if (s < -0.1 * bLen || s > 1.1 * bLen) continue;

          const P1 = A0.clone().add(Ad.clone().multiplyScalar(t));
          const P2 = B0.clone().add(Bd.clone().multiplyScalar(s));
          if (P1.distanceTo(P2) > 0.5) continue;

          const mid = P1.clone().add(P2).multiplyScalar(0.5);
          considerCandidate(mid, 'intersection');
        }
      }
    }

    return best;
  }, [activeSketch, snapEnabled, objectSnapEnabled, snapToEndpoint, snapToMidpoint, snapToCenter, snapToIntersection, snapToPerpendicular, snapToTangent, getSketchPlane, scene]);

  const getWorldPoint = useCallback((event: MouseEvent): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    raycaster.setFromCamera(mouse, camera);
    const plane = getSketchPlane();
    const intersection = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, intersection);

    if (hit) return snapToGrid(intersection);
    return null;
  }, [camera, gl, raycaster, getSketchPlane, snapToGrid]);

  useSketchProjectionTools({
    activeTool,
    activeSketch,
    camera,
    gl,
    raycaster,
    scene,
    addSketchEntity,
    setStatusMessage,
    projectLiveLink,
    cancelSketchProjectSurfaceTool,
  });

  useSketchDimensionTool({
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
  });

  useSketchConstraintTool({
    activeTool,
    activeSketch,
    addToConstraintSelection,
    clearConstraintSelection,
    addSketchConstraint,
    setActiveTool,
    getWorldPoint,
    setStatusMessage,
    gl,
  });

  useSketchInteractionEvents({
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
  });


  // Preview of current drawing operation
  useFrame(({ invalidate }) => {
    if (!previewRef.current) return;
    invalidate(); // keep sketch preview updating in frameloop="demand" mode
    // S10: when construction-mode toggle is active, use cyan dashed material for preview
    const activeLine = drawingConstructionRef.current
      ? constructionModePreviewMaterial.current
      : previewMaterial.current;
    renderSketchPreview({
      previewGroup: previewRef.current,
      drawingPoints,
      mousePos,
      activeSketch,
      activeTool,
      isDraggingArc: isDraggingArcRef.current,
      startV: startVRef.current,
      lineMat: activeLine,
      constructionMat: constructionPreviewMaterial.current,
      centerlineMat: centerlinePreviewMaterial.current,
      conicRho,
      blendCurveMode,
    });
  });

  // Cursor crosshair at mouse position
  if (!mousePos || !activeSketch) return null;

  return (
    <group ref={previewRef}>
      <SketchInteractionHud
        mousePos={mousePos}
        activeSketch={activeSketch}
        activeTool={activeTool}
        drawingPoints={drawingPoints}
        units={units}
        themeColors={themeColors}
        snapTarget={snapTarget}
      />
    </group>
  );
}
