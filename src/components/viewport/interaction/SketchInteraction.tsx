import { useEffect, useRef, useState, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useThemeStore } from '../../../store/themeStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { SketchPoint, SketchEntity } from '../../../types/cad';
import { commitSketchTool } from './sketchInteraction/commitTool';
import { renderSketchPreview } from './sketchInteraction/previewTool';
import { loadDefaultFont, fontPathToSegments } from '../../../utils/sketchTextUtil';
import { DimensionEngine } from '../../../engine/DimensionEngine';

export default function SketchInteraction() {
  const { camera, gl, raycaster, scene } = useThree();
  const activeTool = useCADStore((s) => s.activeTool);
  const activeSketch = useCADStore((s) => s.activeSketch);
  const addSketchEntity = useCADStore((s) => s.addSketchEntity);
  const replaceSketchEntities = useCADStore((s) => s.replaceSketchEntities);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const snapEnabled = useCADStore((s) => s.snapEnabled);
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
  const sketchTextHeight = useCADStore((s) => s.sketchTextHeight);
  const commitSketchTextEntities = useCADStore((s) => s.commitSketchTextEntities);
  // D45: Project / Include live-link toggle
  const projectLiveLink = useCADStore((s) => s.projectLiveLink);
  // D46: Project to Surface
  const cancelSketchProjectSurfaceTool = useCADStore((s) => s.cancelSketchProjectSurfaceTool);
  // D28: Dimension tool
  const activeDimensionType = useCADStore((s) => s.activeDimensionType);
  const dimensionOffset = useCADStore((s) => s.dimensionOffset);
  const pendingDimensionEntityIds = useCADStore((s) => s.pendingDimensionEntityIds);
  const addPendingDimensionEntity = useCADStore((s) => s.addPendingDimensionEntity);
  const addSketchDimension = useCADStore((s) => s.addSketchDimension);
  const cancelDimensionTool = useCADStore((s) => s.cancelDimensionTool);

  const [drawingPoints, setDrawingPoints] = useState<SketchPoint[]>([]);
  const [mousePos, setMousePos] = useState<THREE.Vector3 | null>(null);
  // D65: snap indicator target
  const [snapTarget, setSnapTarget] = useState<{ worldPos: THREE.Vector3; type: 'endpoint' | 'midpoint' | 'center' | 'intersection' } | null>(null);
  const previewRef = useRef<THREE.Group>(null);
  // Stable preview materials — created once, never recreated per frame
  const previewMaterial = useRef(new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 2 }));
  const constructionPreviewMaterial = useRef(new THREE.LineDashedMaterial({
    color: 0xff8800, linewidth: 1, dashSize: 0.3, gapSize: 0.18,
  }));
  const centerlinePreviewMaterial = useRef(new THREE.LineDashedMaterial({
    color: 0x00aa55, linewidth: 1, dashSize: 0.7, gapSize: 0.2,
  }));

  // Scratch Vector3 for useFrame — avoids per-frame allocation
  const startVRef = useRef(new THREE.Vector3());

  // D42: click-drag tangent arc detection for line tool
  const isDraggingArcRef = useRef(false);
  const dragScreenStartRef = useRef<{ x: number; y: number } | null>(null);
  // Set to true on pointerup after a drag; consumed by the next click event.
  const dragJustFinishedRef = useRef(false);

  // Dispose the shared preview materials when SketchInteraction unmounts
  useEffect(() => {
    const mat = previewMaterial.current;
    const constMat = constructionPreviewMaterial.current;
    const cenMat = centerlinePreviewMaterial.current;
    return () => {
      mat.dispose();
      constMat.dispose();
      cenMat.dispose();
    };
  }, []);

  // Clear in-progress drawing when the user switches tools
  useEffect(() => {
    setDrawingPoints([]);
    setMousePos(null);
    setSnapTarget(null);
  }, [activeTool]);

  const getSketchPlane = useCallback((): THREE.Plane => {
    if (!activeSketch) return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Normals must match getPlaneNormal() in cadStore and the visual plane selector:
    //   XY = horizontal ground   → Y-normal  (0, 1, 0)
    //   XZ = vertical front wall → Z-normal  (0, 0, 1)
    //   YZ = vertical side wall  → X-normal  (1, 0, 0)
    //   custom = face plane → use stored planeNormal & planeOrigin
    switch (activeSketch.plane) {
      case 'XY': return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      case 'XZ': return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      case 'YZ': return new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
      case 'custom': {
        const n = activeSketch.planeNormal.clone().normalize();
        return new THREE.Plane(n, -n.dot(activeSketch.planeOrigin));
      }
      default:   return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    }
  }, [activeSketch]);

  const snapToGrid = useCallback((point: THREE.Vector3): THREE.Vector3 => {
    if (!snapEnabled) return point;
    const snap = gridSize / 10;
    return new THREE.Vector3(
      Math.round(point.x / snap) * snap,
      Math.round(point.y / snap) * snap,
      Math.round(point.z / snap) * snap
    );
  }, [snapEnabled, gridSize]);

  // D65 / S8: find nearest snap candidate (endpoint / midpoint / center / intersection) within snap radius
  const SNAP_RADIUS = 4;
  const findSnapCandidate = useCallback((worldPt: THREE.Vector3) => {
    if (!activeSketch || !snapEnabled) return null;
    let bestDist = SNAP_RADIUS;
    let best: { worldPos: THREE.Vector3; type: 'endpoint' | 'midpoint' | 'center' | 'intersection' } | null = null;

    // Collect line-like entities for intersection testing (S8)
    const lineEntities = activeSketch.entities.filter(
      (e) =>
        (e.type === 'line' || e.type === 'construction-line' || e.type === 'centerline') &&
        e.points.length >= 2,
    );

    for (const e of activeSketch.entities) {
      if ((e.type === 'line' || e.type === 'construction-line' || e.type === 'centerline') && e.points.length >= 2) {
        for (const idx of [0, e.points.length - 1]) {
          const p = e.points[idx];
          const wp = new THREE.Vector3(p.x, p.y, p.z);
          const d = worldPt.distanceTo(wp);
          if (d < bestDist) { bestDist = d; best = { worldPos: wp, type: 'endpoint' }; }
        }
        const p0 = e.points[0], p1 = e.points[e.points.length - 1];
        const mid = new THREE.Vector3((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
        const dm = worldPt.distanceTo(mid);
        if (dm < bestDist) { bestDist = dm; best = { worldPos: mid, type: 'midpoint' }; }
      } else if ((e.type === 'circle' || e.type === 'arc') && e.points.length >= 1) {
        const center = new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z);
        const d = worldPt.distanceTo(center);
        if (d < bestDist) { bestDist = d; best = { worldPos: center, type: 'center' }; }
      }
    }

    // S8: brute-force line-line intersection snap. For each pair of line-like
    // entities, compute the 3D closest-approach point on the first segment and
    // check if it's near the cursor. Uses infinite-line equations so the result
    // works even when the segments don't strictly overlap — matching Fusion 360.
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

        // Parametric closest-approach between infinite lines:
        //   P1 = A0 + t*Ad    P2 = B0 + s*Bd
        //   solve t, s = minimize |P1 - P2|
        const w0 = new THREE.Vector3().subVectors(A0, B0);
        const a11 = Ad.dot(Ad);
        const a12 = -Ad.dot(Bd);
        const a22 = Bd.dot(Bd);
        const b1 = -Ad.dot(w0);
        const b2 = Bd.dot(w0);
        const det = a11 * a22 - a12 * a12;
        if (Math.abs(det) < 1e-8) continue; // parallel — no unique intersection
        const t = (a22 * b1 - a12 * b2) / det;
        const s = (a11 * b2 - a12 * b1) / det;
        // Keep snaps that lie on (or very near) both segments — within 10% tolerance
        if (t < -0.1 * aLen || t > 1.1 * aLen) continue;
        if (s < -0.1 * bLen || s > 1.1 * bLen) continue;

        const P1 = A0.clone().add(Ad.clone().multiplyScalar(t));
        const P2 = B0.clone().add(Bd.clone().multiplyScalar(s));
        // Only accept if the closest-approach distance is small (i.e. actual intersection)
        if (P1.distanceTo(P2) > 0.5) continue;

        const mid = P1.clone().add(P2).multiplyScalar(0.5);
        const d = worldPt.distanceTo(mid);
        if (d < bestDist) { bestDist = d; best = { worldPos: mid, type: 'intersection' }; }
      }
    }

    return best;
  }, [activeSketch, snapEnabled]);

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

  useEffect(() => {
    if (!activeSketch || activeTool === 'select') return;

    // Plane-aware tangent axes — works for named planes AND custom face planes
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);

    // Project a 3-D point difference onto the plane's 2-D local axes
    const projectToPlane = (pt: SketchPoint, origin: SketchPoint) => {
      const d = new THREE.Vector3(pt.x - origin.x, pt.y - origin.y, pt.z - origin.z);
      return { u: d.dot(t1), v: d.dot(t2) };
    };

    const handleMouseMove = (event: MouseEvent) => {
      const point = getWorldPoint(event);
      if (point) {
        // D65: entity snap — snaps to endpoint/midpoint/center within SNAP_RADIUS
        const snapCandidate = findSnapCandidate(point);
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
            setStatusMessage(`Radius: ${radius.toFixed(2)} — click to place`);
          } else if (activeTool === 'arc') {
            if (drawingPoints.length === 1) {
              const r = point.distanceTo(new THREE.Vector3(start.x, start.y, start.z));
              setStatusMessage(`Arc radius: ${r.toFixed(2)} — click to set start angle`);
            } else {
              setStatusMessage('Click to set end angle');
            }
          } else if (activeTool === 'circle-2point') {
            const radius = point.distanceTo(new THREE.Vector3(start.x, start.y, start.z)) / 2;
            setStatusMessage(`Diameter: ${(radius*2).toFixed(2)}, r=${radius.toFixed(2)}`);
          } else if (activeTool === 'circle-3point') {
            if (drawingPoints.length === 1) setStatusMessage('Click second point on circle');
            else setStatusMessage('Click third point to complete circle');
          } else if (activeTool === 'arc-3point') {
            if (drawingPoints.length === 1) setStatusMessage('Click a point on the arc');
            else setStatusMessage('Click end point to complete arc');
          } else if (activeTool === 'rectangle-center') {
            const sketchPt: SketchPoint = { id: '', x: point.x, y: point.y, z: point.z };
            const { u: du, v: dv } = projectToPlane(sketchPt, start);
            setStatusMessage(`Width: ${(Math.abs(du)*2).toFixed(2)}, Height: ${(Math.abs(dv)*2).toFixed(2)}`);
          } else if (activeTool === 'polygon-edge') {
            setStatusMessage(`Edge length: ${point.distanceTo(new THREE.Vector3(start.x, start.y, start.z)).toFixed(2)}`);
          } else if (activeTool === 'polygon-circumscribed') {
            const apothem = point.distanceTo(new THREE.Vector3(start.x, start.y, start.z));
            setStatusMessage(`Apothem: ${apothem.toFixed(2)} — click to place`);
          } else {
            const dx = point.x - start.x;
            const dy = point.y - start.y;
            const dz = point.z - start.z;
            setStatusMessage(`Δ: ${dx.toFixed(2)}, ${dy.toFixed(2)}, ${dz.toFixed(2)}`);
          }
        } else {
          setStatusMessage(`Click to start ${activeTool.replace(/-/g, ' ')} — ${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}`);
        }
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      // Suppress the click that follows a drag-arc completion
      if (dragJustFinishedRef.current) { dragJustFinishedRef.current = false; return; }
      const point = getWorldPoint(event);
      if (!point) return;

      const sketchPoint: SketchPoint = {
        id: crypto.randomUUID(),
        x: point.x,
        y: point.y,
        z: point.z,
      };

      // D12: Sketch Text — resolve font async, then push entities
      if (activeTool === 'sketch-text') {
        const anchorPt = point;
        const textStr = sketchTextContent;
        const textH = sketchTextHeight;
        setStatusMessage('Placing text…');
        loadDefaultFont().then((font) => {
          const segs2d = fontPathToSegments(font, textStr, 0, 0, textH);
          // Transform 2D font segments to 3D world space using sketch axes
          const seg3d = segs2d.map((s) => {
            const p1 = anchorPt.clone()
              .addScaledVector(t1, s.x1)
              .addScaledVector(t2, s.y1);
            const p2 = anchorPt.clone()
              .addScaledVector(t1, s.x2)
              .addScaledVector(t2, s.y2);
            return { x1: p1.x, y1: p1.y, z1: p1.z, x2: p2.x, y2: p2.y, z2: p2.z };
          });
          commitSketchTextEntities(seg3d);
        }).catch(() => {
          setStatusMessage('Sketch Text: font failed to load — check /fonts/Roboto-Regular.ttf');
        });
        return;
      }

      commitSketchTool({
        activeTool,
        activeSketch,
        sketchPoint,
        drawingPoints,
        setDrawingPoints,
        t1,
        t2,
        projectToPlane,
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
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawingPoints([]);
        setStatusMessage('Drawing cancelled');
      }
    };

    // Right-click stops the current drawing operation at the last placed point;
    // for spline/spline-control tools it commits the curve if ≥2 points are placed.
    const handleContextMenu = (event: MouseEvent) => {
      if (activeTool === 'spline' && drawingPoints.length >= 2) {
        event.preventDefault();
        event.stopPropagation();
        const curve = new THREE.CatmullRomCurve3(
          drawingPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
        );
        const sampledPts = curve.getPoints(Math.max(50, drawingPoints.length * 8));
        const splinePts: typeof drawingPoints = sampledPts.map((p) => ({
          id: crypto.randomUUID(), x: p.x, y: p.y, z: p.z,
        }));
        addSketchEntity({ id: crypto.randomUUID(), type: 'spline', points: splinePts });
        setDrawingPoints([]);
        setStatusMessage(`Spline added (${drawingPoints.length} fit points)`);
        return;
      }
      if (activeTool === 'spline-control' && drawingPoints.length >= 2) {
        event.preventDefault();
        event.stopPropagation();
        // B-spline-like curve: CatmullRom with tension=0 approximates uniform B-spline
        const curve = new THREE.CatmullRomCurve3(
          drawingPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
          false,
          'catmullrom',
          0,
        );
        const sampledPts = curve.getPoints(Math.max(50, drawingPoints.length * 16));
        const splinePts: typeof drawingPoints = sampledPts.map((p) => ({
          id: crypto.randomUUID(), x: p.x, y: p.y, z: p.z,
        }));
        addSketchEntity({ id: crypto.randomUUID(), type: 'spline', points: splinePts });
        setDrawingPoints([]);
        setStatusMessage(`Control Point Spline added (${drawingPoints.length} control points)`);
        return;
      }
      if (drawingPoints.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setDrawingPoints([]);
        setStatusMessage('');
      }
    };

    // D42: line-tool click-drag → tangent arc
    const DRAG_THRESHOLD_PX = 8;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      isDraggingArcRef.current = false;
      dragJustFinishedRef.current = false;
      dragScreenStartRef.current = { x: event.clientX, y: event.clientY };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.buttons !== 1) return; // only while left button held
      const start = dragScreenStartRef.current;
      if (!start) return;
      const isLineMode = activeTool === 'line' || activeTool === 'construction-line' || activeTool === 'centerline';
      if (!isLineMode) return;
      if (drawingPoints.length === 0) return; // need a chain anchor
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!isDraggingArcRef.current && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD_PX) {
        isDraggingArcRef.current = true;
        setStatusMessage('Drag: tangent arc — release to place');
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (!isDraggingArcRef.current) return;
      isDraggingArcRef.current = false;
      dragJustFinishedRef.current = true;
      dragScreenStartRef.current = null;

      if (drawingPoints.length === 0 || !mousePos) return;
      const isLineMode = activeTool === 'line' || activeTool === 'construction-line' || activeTool === 'centerline';
      if (!isLineMode || !activeSketch) return;

      // Get tangent direction from the last committed entity or the drawingPoints direction
      const sk = useCADStore.getState().activeSketch;
      const { t1: _t1, t2: _t2 } = GeometryEngine.getSketchAxes(activeSketch);
      const lastEntity = sk?.entities[sk.entities.length - 1];
      const chainPt = drawingPoints[0];
      let tangentDir: THREE.Vector3;

      if (lastEntity && (lastEntity.type === 'line' || lastEntity.type === 'construction-line' || lastEntity.type === 'centerline')) {
        const a = lastEntity.points[0];
        const b = lastEntity.points[lastEntity.points.length - 1];
        tangentDir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
      } else if (lastEntity && lastEntity.type === 'arc') {
        const c = lastEntity.points[0];
        const r = lastEntity.radius || 1;
        const ea = lastEntity.endAngle ?? Math.PI;
        const radial = new THREE.Vector3(
          _t1.x * Math.cos(ea) + _t2.x * Math.sin(ea),
          _t1.y * Math.cos(ea) + _t2.y * Math.sin(ea),
          _t1.z * Math.cos(ea) + _t2.z * Math.sin(ea),
        );
        const endPtArc = { x: c.x + radial.x * r, y: c.y + radial.y * r, z: c.z + radial.z * r };
        const distToEnd = new THREE.Vector3(endPtArc.x - chainPt.x, endPtArc.y - chainPt.y, endPtArc.z - chainPt.z).length();
        if (distToEnd < 1) {
          const planeNorm = _t1.clone().cross(_t2).normalize();
          tangentDir = radial.clone().cross(planeNorm).normalize();
        } else {
          tangentDir = mousePos.clone().sub(new THREE.Vector3(chainPt.x, chainPt.y, chainPt.z)).normalize();
        }
      } else {
        tangentDir = mousePos.clone().sub(new THREE.Vector3(chainPt.x, chainPt.y, chainPt.z)).normalize();
      }

      const startPt = chainPt;
      const endPtWorld = mousePos;
      const planeNormal2 = _t1.clone().cross(_t2).normalize();
      const normalInPlane = tangentDir.clone().cross(planeNormal2).normalize();
      const chord = new THREE.Vector3(endPtWorld.x - startPt.x, endPtWorld.y - startPt.y, endPtWorld.z - startPt.z);
      const chordLenSq = chord.lengthSq();
      const projOnNormal = chord.dot(normalInPlane);
      if (Math.abs(projOnNormal) < 1e-5 || chordLenSq < 0.001) {
        setStatusMessage('Tangent arc too short — skipped');
        return;
      }
      const d = chordLenSq / (2 * projOnNormal);
      const cx = startPt.x + normalInPlane.x * d;
      const cy = startPt.y + normalInPlane.y * d;
      const cz = startPt.z + normalInPlane.z * d;
      const arcRadius = Math.abs(d);
      const toStart = new THREE.Vector3(startPt.x - cx, startPt.y - cy, startPt.z - cz);
      const toEnd = new THREE.Vector3(endPtWorld.x - cx, endPtWorld.y - cy, endPtWorld.z - cz);
      const startAngle = Math.atan2(toStart.dot(_t2), toStart.dot(_t1));
      const endAngle = Math.atan2(toEnd.dot(_t2), toEnd.dot(_t1));
      const arcCenter: SketchPoint = { id: crypto.randomUUID(), x: cx, y: cy, z: cz };
      const arcEnd: SketchPoint = { id: crypto.randomUUID(), x: endPtWorld.x, y: endPtWorld.y, z: endPtWorld.z };
      addSketchEntity({
        id: crypto.randomUUID(),
        type: 'arc',
        points: [arcCenter],
        radius: arcRadius,
        startAngle,
        endAngle,
      });
      setDrawingPoints([arcEnd]);
      setStatusMessage(`Tangent arc added (r=${arcRadius.toFixed(2)}) — click to continue line`);
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
  }, [activeSketch, activeTool, drawingPoints, mousePos, getWorldPoint, findSnapCandidate, addSketchEntity, replaceSketchEntities, cycleEntityLinetype, setStatusMessage, polygonSides, filletRadius, chamferDist1, chamferDist2, chamferAngle, tangentCircleRadius, conicRho, blendCurveMode, camera, gl, raycaster]);

  // D14: Project / Include Geometry — pick a solid face, project its boundary onto the sketch plane
  useEffect(() => {
    if (!activeSketch || activeTool !== 'sketch-project') return;
    if (!gl || !camera || !raycaster) return;

    const _mouse = new THREE.Vector2();

    const collectMeshes = (): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.isMesh && obj.userData?.pickable) out.push(m);
      });
      return out;
    };

    const handleMove = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      _mouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(_mouse, camera);
      const hits = raycaster.intersectObjects(collectMeshes(), false);
      if (hits.length > 0 && hits[0].faceIndex !== undefined) {
        setStatusMessage(projectLiveLink
          ? 'Click a face to include geometry (live-linked)'
          : 'Click a face to project geometry (one-time)');
      } else {
        setStatusMessage('Project: hover over a solid face to project its outline');
      }
    };

    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const rect = gl.domElement.getBoundingClientRect();
      _mouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(_mouse, camera);
      const hits = raycaster.intersectObjects(collectMeshes(), false);
      if (!hits.length || hits[0].faceIndex === undefined) return;

      const hit = hits[0];
      const result = GeometryEngine.computeCoplanarFaceBoundary(hit.object as THREE.Mesh, hit.faceIndex!);
      if (!result || result.boundary.length < 2) return;

      // Project each boundary point onto the active sketch plane
      const origin = activeSketch.planeOrigin;
      const normal = activeSketch.planeNormal.clone().normalize();

      const projectToSketchPlane = (pt: THREE.Vector3): THREE.Vector3 => {
        // Remove the component along the plane normal (project onto plane)
        const diff = pt.clone().sub(origin);
        const dist = diff.dot(normal);
        return pt.clone().sub(normal.clone().multiplyScalar(dist));
      };

      const projectedPts = result.boundary.map(projectToSketchPlane);

      // Build line entities from consecutive projected points (closed loop)
      const pts = [...projectedPts, projectedPts[0]]; // close the loop
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (a.distanceTo(b) < 0.001) continue; // skip degenerate segments
        const entity: SketchEntity = {
          id: crypto.randomUUID(),
          type: 'line',
          linked: projectLiveLink, // D45: true = Include (live-link), false = Project (one-time copy)
          points: [
            { id: crypto.randomUUID(), x: a.x, y: a.y, z: a.z },
            { id: crypto.randomUUID(), x: b.x, y: b.y, z: b.z },
          ],
        };
        addSketchEntity(entity);
      }
      setStatusMessage(`Projected ${projectedPts.length} points onto sketch — use Break Link to detach`);
    };

    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('click', handleClick);
    return () => {
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('click', handleClick);
    };
  }, [activeTool, activeSketch, gl, camera, raycaster, scene, addSketchEntity, setStatusMessage, projectLiveLink]);

  // S3: Intersection Curve — click a solid face, compute the plane/mesh intersection, add as line entities
  useEffect(() => {
    if (!activeSketch || activeTool !== 'sketch-intersect') return;
    if (!gl || !camera || !raycaster) return;

    const _mouse = new THREE.Vector2();

    const collectMeshes = (): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.isMesh && obj.userData?.pickable) out.push(m);
      });
      return out;
    };

    const handleMove = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      _mouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(_mouse, camera);
      const hits = raycaster.intersectObjects(collectMeshes(), false);
      if (hits.length > 0) {
        setStatusMessage('Click to create intersection curve with sketch plane');
      } else {
        setStatusMessage('Intersect: hover over a solid face');
      }
    };

    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const rect = gl.domElement.getBoundingClientRect();
      _mouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(_mouse, camera);
      const hits = raycaster.intersectObjects(collectMeshes(), false);
      if (!hits.length) return;

      const mesh = hits[0].object as THREE.Mesh;
      const normal = activeSketch.planeNormal.clone().normalize();
      const origin = activeSketch.planeOrigin.clone();
      const sketchPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);

      const polylines = GeometryEngine.computePlaneIntersectionCurve(mesh, sketchPlane);
      if (!polylines.length) {
        setStatusMessage('No intersection found with sketch plane');
        return;
      }

      let segCount = 0;
      for (const polyline of polylines) {
        for (let i = 0; i < polyline.length - 1; i++) {
          const a = polyline[i];
          const b = polyline[i + 1];
          if (a.distanceTo(b) < 0.001) continue;
          const entity: SketchEntity = {
            id: crypto.randomUUID(),
            type: 'line',
            points: [
              { id: crypto.randomUUID(), x: a.x, y: a.y, z: a.z },
              { id: crypto.randomUUID(), x: b.x, y: b.y, z: b.z },
            ],
          };
          addSketchEntity(entity);
          segCount++;
        }
      }
      setStatusMessage(`Intersection curve added: ${segCount} segment${segCount !== 1 ? 's' : ''}`);
    };

    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('click', handleClick);
    return () => {
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('click', handleClick);
    };
  }, [activeTool, activeSketch, gl, camera, raycaster, scene, addSketchEntity, setStatusMessage]);

  // D46: Project to Surface — click a body face, project all sketch line entities onto that mesh surface
  useEffect(() => {
    if (!activeSketch || activeTool !== 'sketch-project-surface') return;
    if (!gl || !camera || !raycaster) return;

    const _mouse = new THREE.Vector2();

    const collectMeshes = (): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.isMesh && obj.userData?.pickable) out.push(m);
      });
      return out;
    };

    const handleMove = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      _mouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(_mouse, camera);
      const hits = raycaster.intersectObjects(collectMeshes(), false);
      if (hits.length > 0) {
        setStatusMessage('Click to project sketch curves onto this surface');
      } else {
        setStatusMessage('Project to Surface: hover over a body face');
      }
    };

    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const rect = gl.domElement.getBoundingClientRect();
      _mouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(_mouse, camera);
      const hits = raycaster.intersectObjects(collectMeshes(), false);
      if (!hits.length) return;

      const mesh = hits[0].object as THREE.Mesh;

      let segCount = 0;
      for (const entity of activeSketch.entities) {
        if (entity.type !== 'line') continue;
        if (entity.points.length < 2) continue;

        // Extract 3D endpoint positions
        const pts3d = entity.points.map(
          (p) => new THREE.Vector3(p.x, p.y, p.z),
        );

        // Project endpoints onto mesh surface
        const projected = GeometryEngine.projectPointsOntoMesh(pts3d, mesh);

        // Discretize along surface to follow curvature
        const refined = GeometryEngine.discretizeCurveOnSurface(projected, mesh, 0.5, 3);

        // Build line entities from the refined polyline
        for (let i = 0; i < refined.length - 1; i++) {
          const a = refined[i];
          const b = refined[i + 1];
          if (a.distanceTo(b) < 0.001) continue;
          const newEntity: SketchEntity = {
            id: crypto.randomUUID(),
            type: 'line',
            points: [
              { id: crypto.randomUUID(), x: a.x, y: a.y, z: a.z },
              { id: crypto.randomUUID(), x: b.x, y: b.y, z: b.z },
            ],
          };
          addSketchEntity(newEntity);
          segCount++;
        }
      }

      setStatusMessage(`Projected ${segCount} segment${segCount !== 1 ? 's' : ''} onto surface`);
      cancelSketchProjectSurfaceTool();
    };

    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('click', handleClick);
    return () => {
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('click', handleClick);
    };
  }, [activeTool, activeSketch, gl, camera, raycaster, scene, addSketchEntity, setStatusMessage, cancelSketchProjectSurfaceTool]);

  // Preview of current drawing operation
  useFrame(() => {
    if (!previewRef.current) return;
    renderSketchPreview({
      previewGroup: previewRef.current,
      drawingPoints,
      mousePos,
      activeSketch,
      activeTool,
      isDraggingArc: isDraggingArcRef.current,
      startV: startVRef.current,
      lineMat: previewMaterial.current,
      constructionMat: constructionPreviewMaterial.current,
      centerlineMat: centerlinePreviewMaterial.current,
      conicRho,
      blendCurveMode,
    });
  });

  // Cursor crosshair at mouse position
  if (!mousePos || !activeSketch) return null;

  // Live dimension labels for drawing tools (D64)
  const showLineDims =
    (activeTool === 'line' || activeTool === 'construction-line' || activeTool === 'centerline' || activeTool === 'midpoint-line')
    && drawingPoints.length >= 1
    && mousePos !== null;
  let lineLengthText = '';
  let lineAngleText = '';
  let lineMidpoint: THREE.Vector3 | null = null;
  let lineAnglePos: THREE.Vector3 | null = null;
  let lineDeltaText = '';
  if (showLineDims) {
    const startPt = drawingPoints[0];
    const startVec = new THREE.Vector3(startPt.x, startPt.y, startPt.z);
    const delta = activeTool === 'midpoint-line'
      ? mousePos.clone().sub(startVec).multiplyScalar(2)
      : mousePos.clone().sub(startVec);
    const len = delta.length();
    const { t1, t2 } = activeSketch
      ? GeometryEngine.getSketchAxes(activeSketch)
      : GeometryEngine.getPlaneAxes('XZ');
    const angRad = Math.atan2(delta.dot(t2), delta.dot(t1));
    const angDeg = (angRad * 180) / Math.PI;
    const du = delta.dot(t1);
    const dv = delta.dot(t2);
    lineLengthText = `${len.toFixed(3)} ${units}`;
    lineAngleText = `${Math.abs(angDeg).toFixed(1)}°`;
    lineDeltaText = `Δ ${du.toFixed(2)}, ${dv.toFixed(2)}`;
    lineMidpoint = startVec.clone().add(mousePos).multiplyScalar(0.5);
    const arcRadiusHUD = Math.min(len * 0.25, 1.5);
    const midAng = angRad / 2;
    lineAnglePos = startVec.clone()
      .addScaledVector(t1, Math.cos(midAng) * arcRadiusHUD * 1.9)
      .addScaledVector(t2, Math.sin(midAng) * arcRadiusHUD * 1.9);
  }

  // Live radius HUD for circle / arc tools
  const showRadiusHUD = (activeTool === 'circle' || activeTool === 'circle-2point' || activeTool === 'arc')
    && drawingPoints.length >= 1
    && mousePos !== null;
  let radiusHUDText = '';
  let radiusHUDPos: THREE.Vector3 | null = null;
  if (showRadiusHUD) {
    const centerPt = drawingPoints[0];
    const centerVec = new THREE.Vector3(centerPt.x, centerPt.y, centerPt.z);
    let r = 0;
    if (activeTool === 'circle-2point') {
      r = mousePos.distanceTo(centerVec) / 2;
    } else {
      r = mousePos.distanceTo(centerVec);
    }
    radiusHUDText = `r=${r.toFixed(3)} ${units}`;
    radiusHUDPos = centerVec.clone().add(mousePos).multiplyScalar(0.5);
  }

  // Shared label styles (themed via themeColors)
  const baseLabelStyle: React.CSSProperties = {
    pointerEvents: 'none',
    userSelect: 'none',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: '11px',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    background: themeColors.bgPanel,
    color: themeColors.textPrimary,
    border: `1px solid ${themeColors.border}`,
    borderRadius: '3px',
    padding: '3px 7px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  };
  const lengthLabelStyle: React.CSSProperties = {
    ...baseLabelStyle,
    borderColor: themeColors.accent,
    color: themeColors.textPrimary,
    background: themeColors.bgPanel,
  };
  const cursorLabelStyle: React.CSSProperties = {
    ...baseLabelStyle,
    background: 'transparent',
    border: 'none',
    boxShadow: 'none',
    color: themeColors.textSecondary,
    transform: 'translate(20px, -22px)',
  };
  const deltaLabelStyle: React.CSSProperties = {
    ...baseLabelStyle,
    background: 'transparent',
    border: 'none',
    boxShadow: 'none',
    fontSize: '10px',
    color: themeColors.textMuted,
    transform: 'translate(20px, 4px)',
  };

  return (
    <>
      <group ref={previewRef}>
        {/* Crosshair cursor */}
        <group position={mousePos}>
          <mesh>
            <ringGeometry args={[0.3, 0.4, 16]} />
            <meshBasicMaterial color={0xff6600} />
          </mesh>
        </group>
      </group>

      {/* Live dimension overlays (D64) — outside previewRef so useFrame doesn't strip them */}
      {showLineDims && lineMidpoint && lineAnglePos && (
        <>
          <Html position={lineMidpoint} center zIndexRange={[100, 0]}>
            <div style={lengthLabelStyle}>{lineLengthText}</div>
          </Html>
          <Html position={lineAnglePos} center zIndexRange={[100, 0]}>
            <div style={baseLabelStyle}>{lineAngleText}</div>
          </Html>
          <Html position={mousePos} zIndexRange={[100, 0]}>
            <div style={cursorLabelStyle}>Specify next point</div>
          </Html>
          <Html position={mousePos} zIndexRange={[100, 0]}>
            <div style={deltaLabelStyle}>{lineDeltaText}</div>
          </Html>
        </>
      )}
      {showRadiusHUD && radiusHUDPos && (
        <Html position={radiusHUDPos} center zIndexRange={[100, 0]}>
          <div style={lengthLabelStyle}>{radiusHUDText}</div>
        </Html>
      )}
      {/* D65: Snap indicator glyph — shown when cursor is snapping to an entity */}
      {snapTarget && mousePos && (
        <Html position={mousePos} center zIndexRange={[300, 0]} style={{ pointerEvents: 'none' }}>
          {snapTarget.type === 'endpoint' && (
            <div style={{ width: 10, height: 10, border: '2px solid #f97316', transform: 'rotate(45deg)', pointerEvents: 'none' }} />
          )}
          {snapTarget.type === 'midpoint' && (
            <div style={{ width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: '11px solid #f97316', pointerEvents: 'none' }} />
          )}
          {snapTarget.type === 'center' && (
            <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid #f97316', pointerEvents: 'none' }} />
          )}
          {snapTarget.type === 'intersection' && (
            <div style={{ width: 12, height: 12, position: 'relative', pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', top: 5, left: 0, width: 12, height: 2, background: '#f97316', transform: 'rotate(45deg)', transformOrigin: 'center' }} />
              <div style={{ position: 'absolute', top: 5, left: 0, width: 12, height: 2, background: '#f97316', transform: 'rotate(-45deg)', transformOrigin: 'center' }} />
            </div>
          )}
        </Html>
      )}
    </>
  );
}
