import { useEffect, useRef, useState, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useThemeStore } from '../../../store/themeStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { SketchPoint, SnapType } from '../../../types/cad';
import { renderSketchPreview } from './sketchInteraction/previewTool';
import { useSketchProjectionTools } from './sketchInteraction/hooks/useSketchProjectionTools';
import { useSketchDimensionTool } from './sketchInteraction/hooks/useSketchDimensionTool';
import { useSketchConstraintTool } from './sketchInteraction/hooks/useSketchConstraintTool';
import { useSketchInteractionEvents } from './sketchInteraction/hooks/useSketchInteractionEvents';
import { SketchInteractionHud } from './sketchInteraction/SketchInteractionHud';
import type { InferenceResult } from './sketchInteraction/sketchInference';

// Module-level scratch vectors for the snap hot path.
// findSnapCandidate runs on every mousemove; reusing these eliminates
// ~600+ per-frame Vector3 allocations with 50 sketch entities.
const _tmpP0 = new THREE.Vector3();
const _tmpP1 = new THREE.Vector3();
const _tmpSeg = new THREE.Vector3();
const _tmpWp = new THREE.Vector3();
const _tmpFoot = new THREE.Vector3();
const _tmpCenter = new THREE.Vector3();
const _tmpTp = new THREE.Vector3();
const _tmpOc = new THREE.Vector3();
// A4c line-line intersection scratch (separate from above to avoid clobbering in nested loops)
const _llA0 = new THREE.Vector3();
const _llAd = new THREE.Vector3();
const _llB0 = new THREE.Vector3();
const _llBd = new THREE.Vector3();
const _llW0 = new THREE.Vector3();

export default function SketchInteraction() {
  const { camera, gl, raycaster, scene, size: viewportSize } = useThree();
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
  const sketchTextContent      = useCADStore((s) => s.sketchTextContent);
  const sketchTextHeight       = useCADStore((s) => s.sketchTextHeight);
  const sketchTextBold         = useCADStore((s) => s.sketchTextBold);
  const sketchTextItalic       = useCADStore((s) => s.sketchTextItalic);
  const sketchTextCharSpacing  = useCADStore((s) => s.sketchTextCharSpacing);
  const sketchTextFlipH        = useCADStore((s) => s.sketchTextFlipH);
  const sketchTextFlipV        = useCADStore((s) => s.sketchTextFlipV);
  const sketchTextHAlign       = useCADStore((s) => s.sketchTextHAlign);
  const sketchTextVAlign       = useCADStore((s) => s.sketchTextVAlign);
  const commitSketchTextEntities = useCADStore((s) => s.commitSketchTextEntities);
  // D45: Project / Include live-link toggle
  const projectLiveLink = useCADStore((s) => s.projectLiveLink);
  // D46: Project to Surface
  const cancelSketchProjectSurfaceTool = useCADStore((s) => s.cancelSketchProjectSurfaceTool);
  // D47: Intersection Curve
  const cancelSketchIntersectionCurveTool = useCADStore((s) => s.cancelSketchIntersectionCurveTool);
  // D48: Spun Profile
  const cancelSketchSpunProfileTool = useCADStore((s) => s.cancelSketchSpunProfileTool);
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
  const [snapTarget, setSnapTarget] = useState<{ worldPos: THREE.Vector3; type: SnapType } | null>(null);
  // Midpoint hover markers — segments whose midpoint should be shown as a dim triangle
  const [hoverMidpoints, setHoverMidpoints] = useState<THREE.Vector3[]>([]);
  const previewRef = useRef<THREE.Group>(null);
  // Stable preview materials — created once, never recreated per frame
  const previewMaterial = useRef(new THREE.LineBasicMaterial({
    color: 0xc2410c, linewidth: 2, depthTest: false, depthWrite: false,
  }));
  const constructionPreviewMaterial = useRef(new THREE.LineDashedMaterial({
    color: 0x7c2d12, linewidth: 1, dashSize: 0.3, gapSize: 0.18, depthTest: false, depthWrite: false,
  }));
  const centerlinePreviewMaterial = useRef(new THREE.LineDashedMaterial({
    color: 0x00aa55, linewidth: 1, dashSize: 0.7, gapSize: 0.2, depthTest: false, depthWrite: false,
  }));

  // Scratch Vector3 for useFrame — avoids per-frame allocation
  const startVRef = useRef(new THREE.Vector3());
  // Scratch objects for getRawWorldPoint — avoids per-mousemove allocation
  const _mouseScratch = useRef(new THREE.Vector2());
  const _intersectionScratch = useRef(new THREE.Vector3());

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

  // A10: inference result ref — shared between event handler (writes) and useFrame (reads).
  const inferenceRef = useRef<InferenceResult | null>(null);
  // A10: dashed material for inference guide lines (orange-ish, distinct from construction).
  const inferenceGuideMaterial = useRef(new THREE.LineDashedMaterial({
    color: 0xf97316, linewidth: 1, dashSize: 0.4, gapSize: 0.2, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8,
  }));

  // Dispose the shared preview materials when SketchInteraction unmounts.
  useEffect(() => {
    const mat = previewMaterial.current;
    const constMat = constructionPreviewMaterial.current;
    const cenMat = centerlinePreviewMaterial.current;
    const constrModeMat = constructionModePreviewMaterial.current;
    const inferMat = inferenceGuideMaterial.current;
    return () => {
      mat.dispose();
      constMat.dispose();
      cenMat.dispose();
      constrModeMat.dispose();
      inferMat.dispose();
    };
  }, []);

  // Clear in-progress drawing when the user switches tools
  useEffect(() => {
    setDrawingPoints([]);
    setMousePos(null);
    setSnapTarget(null);
    inferenceRef.current = null;
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
    // objectSnapEnabled is the master snap toggle: when off, nothing snaps (including grid).
    if (!objectSnapEnabled) return point;
    if (!snapEnabled && !sketchSnapEnabled) return point;
    if (!activeSketch) return point;

    // A1: snap to the displayed grid spacing, not gridSize/10; honor per-sketch override.
    const snap = (activeSketch as { gridSize?: number }).gridSize ?? gridSize;
    const origin = activeSketch.planeOrigin ?? new THREE.Vector3(0, 0, 0);
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const fromOrigin = point.clone().sub(origin);
    const u = Math.round(fromOrigin.dot(t1) / snap) * snap;
    const v = Math.round(fromOrigin.dot(t2) / snap) * snap;

    return origin.clone()
      .addScaledVector(t1, u)
      .addScaledVector(t2, v);
  }, [objectSnapEnabled, snapEnabled, sketchSnapEnabled, gridSize, activeSketch]);

  // D65 / S8 / NAV-24: find nearest snap candidate within snap radius.
  // Supports endpoint, midpoint, center, intersection (existing) +
  // perpendicular and tangent (NAV-24).
  const SNAP_PIXELS = 12; // screen-space snap radius in pixels (A2)
  const findSnapCandidate = useCallback((worldPt: THREE.Vector3, drawStart?: THREE.Vector3 | null) => {
    if (!activeSketch || !snapEnabled) return null;
    // NAV-24: master object-snap gate
    if (!objectSnapEnabled) return null;
    // A2: compute world-units-per-pixel at cursor depth for zoom-independent snap radius.
    const camToPoint = worldPt.clone().sub(camera.position);
    const depth = Math.max(camToPoint.length(), 0.1);
    let worldUnitsPerPx = 1;
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const pc = camera as THREE.PerspectiveCamera;
      worldUnitsPerPx = (2 * Math.tan((pc.fov * Math.PI / 180) / 2) * depth) / viewportSize.height;
    } else if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const oc = camera as THREE.OrthographicCamera;
      worldUnitsPerPx = (oc.top - oc.bottom) / viewportSize.height;
    }
    const SNAP_RADIUS = SNAP_PIXELS * worldUnitsPerPx;
    let bestDist = SNAP_RADIUS;
    let bestPriority = 99;
    let best: { worldPos: THREE.Vector3; type: SnapType } | null = null;
    // A3: priority order (lower = higher priority). A higher-priority snap within
    // SNAP_RADIUS beats a lower-priority snap that is geometrically closer.
    const SNAP_PRIORITY: Record<string, number> = {
      endpoint: 1, center: 1,
      intersection: 2,
      midpoint: 3, perpendicular: 3, tangent: 3,
      nearest: 4,
      grid: 5,
    };
    const considerCandidate = (
      worldPos: THREE.Vector3,
      type: SnapType,
    ) => {
      const d = worldPt.distanceTo(worldPos);
      if (d > SNAP_RADIUS) return; // outside grab radius — ignore
      const priority = SNAP_PRIORITY[type] ?? 4;
      // A higher-priority type wins even if slightly farther; same priority → closest wins
      if (priority < bestPriority || (priority === bestPriority && d < bestDist)) {
        bestDist = d;
        bestPriority = priority;
        best = { worldPos: worldPos.clone(), type };
      }
    };

    // Compute sketch axes once — getSketchAxes is not free on custom planes
    const { t1: snapT1, t2: snapT2 } = GeometryEngine.getSketchAxes(activeSketch);

    for (const e of activeSketch.entities) {
      if ((e.type === 'line' || e.type === 'construction-line' || e.type === 'centerline') && e.points.length >= 2) {
        const ep0 = e.points[0], ep1 = e.points[e.points.length - 1];
        // Endpoint snap — reuse _tmpP0
        if (snapToEndpoint) {
          considerCandidate(_tmpP0.set(ep0.x, ep0.y, ep0.z), 'endpoint');
          considerCandidate(_tmpP0.set(ep1.x, ep1.y, ep1.z), 'endpoint');
        }
        // Midpoint snap — reuse _tmpP0
        if (snapToMidpoint) {
          considerCandidate(_tmpP0.set((ep0.x + ep1.x) / 2, (ep0.y + ep1.y) / 2, (ep0.z + ep1.z) / 2), 'midpoint');
        }
        // Build P0/P1/seg once for perpendicular + nearest (avoids 4 allocs per line)
        _tmpP0.set(ep0.x, ep0.y, ep0.z);
        _tmpP1.set(ep1.x, ep1.y, ep1.z);
        _tmpSeg.subVectors(_tmpP1, _tmpP0);
        const segLen2 = _tmpSeg.lengthSq();
        if (segLen2 > 1e-10) {
          // Perpendicular snap
          if (snapToPerpendicular) {
            const t = _tmpWp.copy(worldPt).sub(_tmpP0).dot(_tmpSeg) / segLen2;
            if (t >= 0 && t <= 1) {
              considerCandidate(_tmpFoot.copy(_tmpP0).addScaledVector(_tmpSeg, t), 'perpendicular');
            }
          }
          // A5: nearest on-curve snap
          {
            const t = Math.max(0, Math.min(1, _tmpWp.copy(worldPt).sub(_tmpP0).dot(_tmpSeg) / segLen2));
            considerCandidate(_tmpFoot.copy(_tmpP0).addScaledVector(_tmpSeg, t), 'nearest');
          }
        }
      } else if ((e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse' || e.type === 'elliptical-arc') && e.points.length >= 1) {
        const cp = e.points[0];
        _tmpCenter.set(cp.x, cp.y, cp.z);
        // Center snap — A6: include ellipse / elliptical-arc (center = points[0])
        if (snapToCenter) {
          considerCandidate(_tmpCenter, 'center');
        }
        // A7: arc midpoint = point at (startAngle + endAngle) / 2 on the arc
        if (snapToMidpoint && e.type === 'arc' && typeof e.startAngle === 'number' && typeof e.endAngle === 'number') {
          const r = e.radius ?? 0;
          let ea = e.endAngle;
          if (ea <= e.startAngle) ea += 2 * Math.PI;
          const midA = (e.startAngle + ea) / 2;
          considerCandidate(
            _tmpTp.copy(_tmpCenter).addScaledVector(snapT1, Math.cos(midA) * r).addScaledVector(snapT2, Math.sin(midA) * r),
            'midpoint',
          );
        }
        // A5: nearest on-curve snap for circles and arcs (radial projection)
        if ((e.type === 'circle' || e.type === 'arc') && (e.radius ?? 0) > 0) {
          _tmpWp.subVectors(worldPt, _tmpCenter); // toWorld
          const dist = _tmpWp.length();
          if (dist > 1e-6) {
            considerCandidate(_tmpFoot.copy(_tmpCenter).addScaledVector(_tmpWp, e.radius! / dist), 'nearest');
          }
        }
        // Tangent snap
        const hasExplicitRadius = typeof e.radius === 'number' && e.radius > 1e-6;
        const hasTwoPoints = e.points.length >= 2;
        if (snapToTangent && drawStart && (hasExplicitRadius || hasTwoPoints) && activeSketch) {
          const r = hasExplicitRadius
            ? e.radius!
            : _tmpCenter.distanceTo(_tmpP0.set(e.points[1].x, e.points[1].y, e.points[1].z));
          if (r > 1e-6) {
            _tmpOc.subVectors(_tmpCenter, drawStart); // dVec = center - drawStart
            const dist = _tmpOc.length();
            if (dist > r) {
              const du = _tmpOc.dot(snapT1);
              const dv = _tmpOc.dot(snapT2);
              const alpha = Math.asin(r / dist);
              const baseAngle = Math.atan2(dv, du);
              for (const sign of [-1, 1]) {
                const angle = baseAngle + sign * (Math.PI / 2 - alpha);
                considerCandidate(
                  _tmpTp.copy(_tmpCenter).addScaledVector(snapT1, Math.cos(angle) * r).addScaledVector(snapT2, Math.sin(angle) * r),
                  'tangent',
                );
              }
            }
          }
        }
      }
    }

    // A8: emit exact geometric endpoints from entity data instead of scanning all mesh vertices.
    // This is O(entities) rather than O(all mesh verts) and is tessellation-independent.
    if (snapToEndpoint) {
      for (const e of activeSketch!.entities) {
        if (e.type === 'line' || e.type === 'construction-line' || e.type === 'centerline') {
          // Already handled above in the per-entity loop — skip (endpoint/midpoint done there)
          continue;
        }
        if (e.type === 'arc' && e.points.length >= 1 && typeof e.startAngle === 'number' && typeof e.endAngle === 'number') {
          _tmpCenter.set(e.points[0].x, e.points[0].y, e.points[0].z);
          const r = e.radius ?? 0;
          for (const angle of [e.startAngle, e.endAngle]) {
            considerCandidate(
              _tmpTp.copy(_tmpCenter).addScaledVector(snapT1, Math.cos(angle) * r).addScaledVector(snapT2, Math.sin(angle) * r),
              'endpoint',
            );
          }
        }
        if (e.type === 'spline' && e.points.length >= 2) {
          for (const pt of e.points) {
            considerCandidate(_tmpP0.set(pt.x, pt.y, pt.z), 'endpoint');
          }
        }
        if (e.type === 'rectangle' && e.points.length >= 2) {
          const origin_r = activeSketch!.planeOrigin;
          const p0 = e.points[0], p1 = e.points[1];
          _tmpP0.set(p0.x - origin_r.x, p0.y - origin_r.y, p0.z - origin_r.z);
          _tmpP1.set(p1.x - origin_r.x, p1.y - origin_r.y, p1.z - origin_r.z);
          const u0 = _tmpP0.dot(snapT1), v0 = _tmpP0.dot(snapT2);
          const u1 = _tmpP1.dot(snapT1), v1 = _tmpP1.dot(snapT2);
          for (const [u, v] of [[u0,v0],[u1,v0],[u1,v1],[u0,v1]] as [number,number][]) {
            considerCandidate(
              _tmpFoot.copy(origin_r).addScaledVector(snapT1, u).addScaledVector(snapT2, v),
              'endpoint',
            );
          }
        }
      }
    }

    // S8 / NAV-24 + A4: intersection snaps — line-line, line-circle, circle-circle
    if (snapToIntersection) {
      const lineEntities = activeSketch!.entities.filter(
        (e) =>
          (e.type === 'line' ||
            e.type === 'construction-line' ||
            e.type === 'centerline') &&
          e.points.length >= 2,
      );
      const circleEntities = activeSketch!.entities.filter(
        (e) => (e.type === 'circle' || e.type === 'arc') && e.points.length >= 1 && (e.radius ?? 0) > 0
      );

      // Limit O(n²) intersection tests to lines near the cursor (generous 10× snap radius).
      // With many polygon edges this avoids ~51k pair checks per mousemove.
      const intersectRadius = SNAP_RADIUS * 10;
      const nearLines = lineEntities.length > 30
        ? lineEntities.filter((e) => {
            const p0 = e.points[0];
            const p1 = e.points[e.points.length - 1];
            const mx = (p0.x + p1.x) * 0.5, my = (p0.y + p1.y) * 0.5, mz = (p0.z + p1.z) * 0.5;
            const halfLen = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 + (p1.z - p0.z) ** 2) * 0.5;
            return worldPt.distanceTo(_tmpWp.set(mx, my, mz)) <= intersectRadius + halfLen;
          })
        : lineEntities;

      // A4a: line-circle intersections (analytic)
      for (const line of nearLines) {
        _tmpP0.set(line.points[0].x, line.points[0].y, line.points[0].z);              // L0
        _tmpP1.set(line.points[line.points.length - 1].x, line.points[line.points.length - 1].y, line.points[line.points.length - 1].z); // L1
        _tmpSeg.subVectors(_tmpP1, _tmpP0); // Ld
        const lLen = _tmpSeg.length();
        if (lLen < 1e-6) continue;
        for (const circ of circleEntities) {
          _tmpCenter.set(circ.points[0].x, circ.points[0].y, circ.points[0].z); // C
          const r = circ.radius ?? 0;
          _tmpOc.subVectors(_tmpP0, _tmpCenter); // oc = L0 - C
          const a2 = _tmpSeg.dot(_tmpSeg);
          const b2 = 2 * _tmpOc.dot(_tmpSeg);
          const c2 = _tmpOc.dot(_tmpOc) - r * r;
          const disc = b2 * b2 - 4 * a2 * c2;
          if (disc < 0) continue;
          const sqrtDisc = Math.sqrt(disc);
          for (const sign of [-1, 1]) {
            const t = (-b2 + sign * sqrtDisc) / (2 * a2);
            if (t < -0.05 || t > 1.05) continue;
            considerCandidate(_tmpFoot.copy(_tmpP0).addScaledVector(_tmpSeg, t), 'intersection');
          }
        }
      }

      // A4b: circle-circle intersections (analytic)
      for (let i = 0; i < circleEntities.length; i++) {
        const eA = circleEntities[i];
        _tmpP0.set(eA.points[0].x, eA.points[0].y, eA.points[0].z); // cA
        const rA = eA.radius ?? 0;
        for (let j = i + 1; j < circleEntities.length; j++) {
          const eB = circleEntities[j];
          _tmpP1.set(eB.points[0].x, eB.points[0].y, eB.points[0].z); // cB
          const rB = eB.radius ?? 0;
          const d = _tmpP0.distanceTo(_tmpP1);
          if (d < 1e-6 || d > rA + rB + 1e-4 || d < Math.abs(rA - rB) - 1e-4) continue;
          // Project onto sketch plane to solve 2D intersection
          _tmpOc.subVectors(_tmpP0, activeSketch!.planeOrigin);  // oA
          _tmpWp.subVectors(_tmpP1, activeSketch!.planeOrigin);   // oB
          const uA = _tmpOc.dot(snapT1), vA = _tmpOc.dot(snapT2);
          const uB = _tmpWp.dot(snapT1), vB = _tmpWp.dot(snapT2); // oB = _tmpWp
          const du = uB - uA, dv = vB - vA;
          const a3 = (rA * rA - rB * rB + du * du + dv * dv) / (2 * d * d);
          const midU = uA + a3 * du, midV = vA + a3 * dv;
          const h2 = rA * rA / (d * d) - a3 * a3;
          if (h2 < 0) continue;
          const h = Math.sqrt(h2);
          const px = h * dv, py = -h * du;
          for (const s of [-1, 1]) {
            const iu = midU + s * px, iv = midV + s * py;
            considerCandidate(
              _tmpFoot.copy(activeSketch!.planeOrigin).addScaledVector(snapT1, iu).addScaledVector(snapT2, iv),
              'intersection',
            );
          }
        }
      }

      // A4c: line-line intersections — uses module-level scratch vectors _llA0/Ad/B0/Bd/W0.
      for (let i = 0; i < nearLines.length; i++) {
        const a = nearLines[i];
        _llA0.set(a.points[0].x, a.points[0].y, a.points[0].z);
        _llAd.set(
          a.points[a.points.length - 1].x - a.points[0].x,
          a.points[a.points.length - 1].y - a.points[0].y,
          a.points[a.points.length - 1].z - a.points[0].z,
        );
        const aLen = _llAd.length();
        if (aLen < 1e-6) continue;
        _llAd.divideScalar(aLen);

        for (let j = i + 1; j < nearLines.length; j++) {
          const b = nearLines[j];
          _llB0.set(b.points[0].x, b.points[0].y, b.points[0].z);
          _llBd.set(
            b.points[b.points.length - 1].x - b.points[0].x,
            b.points[b.points.length - 1].y - b.points[0].y,
            b.points[b.points.length - 1].z - b.points[0].z,
          );
          const bLen = _llBd.length();
          if (bLen < 1e-6) continue;
          _llBd.divideScalar(bLen);

          _llW0.subVectors(_llA0, _llB0);
          const a11 = _llAd.dot(_llAd);
          const a12 = -_llAd.dot(_llBd);
          const a22 = _llBd.dot(_llBd);
          const b1 = -_llAd.dot(_llW0);
          const b2 = _llBd.dot(_llW0);
          const det = a11 * a22 - a12 * a12;
          if (Math.abs(det) < 1e-8) continue;
          const t = (a22 * b1 - a12 * b2) / det;
          const s = (a11 * b2 - a12 * b1) / det;
          if (t < -0.1 * aLen || t > 1.1 * aLen) continue;
          if (s < -0.1 * bLen || s > 1.1 * bLen) continue;

          const P1 = _tmpP0.copy(_llA0).addScaledVector(_llAd, t);
          const P2 = _tmpP1.copy(_llB0).addScaledVector(_llBd, s);
          if (P1.distanceTo(P2) > 0.5) continue;

          // P1 and P2 are in _tmpP0/_tmpP1; use _tmpFoot for the midpoint
          considerCandidate(_tmpFoot.addVectors(P1, P2).multiplyScalar(0.5), 'intersection');
        }
      }
    }

    return best;
  }, [activeSketch, snapEnabled, objectSnapEnabled, snapToEndpoint, snapToMidpoint, snapToCenter, snapToIntersection, snapToPerpendicular, snapToTangent, camera, viewportSize]);

  // Returns midpoints of all line segments the cursor is hovering near (within HOVER_RADIUS of
  // the perpendicular foot on the segment). Used to show dim triangle markers before snapping.
  const HOVER_MIDPOINT_RADIUS = SNAP_PIXELS * 2; // ~24px in world units at typical zoom
  const findHoverMidpoints = useCallback((worldPt: THREE.Vector3): THREE.Vector3[] => {
    if (!activeSketch || (!snapEnabled && !sketchSnapEnabled) || !objectSnapEnabled || !snapToMidpoint) {
      return [];
    }
    const result: THREE.Vector3[] = [];
    for (const e of activeSketch.entities) {
      if (
        (e.type === 'line' || e.type === 'construction-line' || e.type === 'centerline') &&
        e.points.length >= 2
      ) {
        _tmpP0.set(e.points[0].x, e.points[0].y, e.points[0].z);
        const last = e.points[e.points.length - 1];
        _tmpP1.set(last.x, last.y, last.z);
        _tmpSeg.subVectors(_tmpP1, _tmpP0);
        const segLen2 = _tmpSeg.lengthSq();
        if (segLen2 < 1e-10) continue;
        const t = _tmpP1.subVectors(worldPt, _tmpP0).dot(_tmpSeg) / segLen2;
        if (t < 0 || t > 1) continue;
        _tmpP1.copy(_tmpP0).addScaledVector(_tmpSeg, t);
        const dist = worldPt.distanceTo(_tmpP1);
        if (dist <= HOVER_MIDPOINT_RADIUS) {
          const last2 = e.points[e.points.length - 1];
          result.push(new THREE.Vector3(
            (e.points[0].x + last2.x) * 0.5,
            (e.points[0].y + last2.y) * 0.5,
            (e.points[0].z + last2.z) * 0.5,
          ));
        }
      }
    }
    return result;
  }, [activeSketch, snapEnabled, sketchSnapEnabled, objectSnapEnabled, snapToMidpoint, HOVER_MIDPOINT_RADIUS]);

  // Raw intersection with the sketch plane — no grid snap applied.
  // Used for object-snap and hover detection so that non-grid-aligned
  // points (e.g. midpoints of odd-length lines) are always reachable.
  const getRawWorldPoint = useCallback((event: MouseEvent): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    _mouseScratch.current.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(_mouseScratch.current, camera);
    const plane = getSketchPlane();
    const hit = raycaster.ray.intersectPlane(plane, _intersectionScratch.current);
    return hit ? hit.clone() : null;
  }, [camera, gl, raycaster, getSketchPlane]);

  const getWorldPoint = useCallback((event: MouseEvent): THREE.Vector3 | null => {
    const raw = getRawWorldPoint(event);
    if (!raw) return null;
    return snapToGrid(raw);
  }, [getRawWorldPoint, snapToGrid]);

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
    cancelSketchIntersectionCurveTool,
    cancelSketchSpunProfileTool,
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
    getRawWorldPoint,
    findSnapCandidate,
    addSketchEntity,
    addSketchConstraint,
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
    sketchTextCharSpacing,
    sketchTextFlipH,
    sketchTextFlipV,
    sketchTextHAlign,
    sketchTextVAlign,
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
    inferenceRef,
  });


  // Stable scratch objects for inference guide line reuse across frames.
  const _inferGuideGeom = useRef<THREE.BufferGeometry | null>(null);
  const _inferGuideLine = useRef<THREE.Line | null>(null);

  // Dispose the lazily-created inference-guide geometry on unmount. The line's
  // material is the shared inferenceGuideMaterial singleton (disposed above), so
  // only its BufferGeometry needs cleanup here.
  useEffect(() => () => {
    _inferGuideGeom.current?.dispose();
    _inferGuideGeom.current = null;
    _inferGuideLine.current = null;
  }, []);

  // Preview of current drawing operation
  useFrame(({ invalidate }) => {
    if (!previewRef.current) return;
    // S10: when construction-mode toggle is active, use cyan dashed material for preview
    const activeLine = drawingConstructionRef.current
      ? constructionModePreviewMaterial.current
      : previewMaterial.current;
    const drew = renderSketchPreview({
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
      polygonSides,
    });

    // A10: render inference guide line when active.
    const inf = inferenceRef.current;
    if (inf && previewRef.current) {
      if (!_inferGuideGeom.current) {
        _inferGuideGeom.current = new THREE.BufferGeometry();
        _inferGuideLine.current = new THREE.Line(_inferGuideGeom.current, inferenceGuideMaterial.current);
        _inferGuideLine.current.renderOrder = 1002;
        previewRef.current.add(_inferGuideLine.current);
      } else if (!previewRef.current.children.includes(_inferGuideLine.current!)) {
        previewRef.current.add(_inferGuideLine.current!);
      }
      _inferGuideGeom.current.setFromPoints([inf.guideFrom, inf.guideTo]);
      _inferGuideLine.current!.computeLineDistances();
      if (!drew) invalidate();
    } else if (_inferGuideLine.current && previewRef.current.children.includes(_inferGuideLine.current)) {
      previewRef.current.remove(_inferGuideLine.current);
      if (!drew) invalidate();
    }

    // Only invalidate when the preview actually changed — prevents a self-sustaining
    // render loop that causes <Html> glyphs (polygon center badges) to reproject and
    // rewrite DOM on every frame, causing visible flicker.
    if (drew) invalidate();
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
        hoverMidpoints={hoverMidpoints}
      />
    </group>
  );
}
