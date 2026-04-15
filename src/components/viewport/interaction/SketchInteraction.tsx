import { useEffect, useRef, useState, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useThemeStore } from '../../../store/themeStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { clearGroupChildren } from '../../../utils/threeDisposal';
import type { SketchEntity, SketchPoint } from '../../../types/cad';

/** Compute the circumcenter of 3 world-space points that lie on the given sketch plane.
 *  Returns center (world coords) and radius, or null if points are collinear. */
function circumcenter2D(
  p1: {x:number;y:number;z:number},
  p2: {x:number;y:number;z:number},
  p3: {x:number;y:number;z:number},
  t1: THREE.Vector3, t2: THREE.Vector3
): { center: {x:number;y:number;z:number}; radius: number } | null {
  // Project to plane-local 2D
  const proj = (p: {x:number;y:number;z:number}, o: {x:number;y:number;z:number}) => {
    const d = new THREE.Vector3(p.x-o.x, p.y-o.y, p.z-o.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  };
  const a = proj(p2, p1);
  const b = proj(p3, p1);
  const D = 2 * (a.u * b.v - a.v * b.u);
  if (Math.abs(D) < 1e-10) return null; // collinear
  const aa = a.u*a.u + a.v*a.v;
  const bb = b.u*b.u + b.v*b.v;
  const cu = (b.v * aa - a.v * bb) / D;
  const cv = (a.u * bb - b.u * aa) / D;
  const cx = p1.x + t1.x*cu + t2.x*cv;
  const cy = p1.y + t1.y*cu + t2.y*cv;
  const cz = p1.z + t1.z*cu + t2.z*cv;
  const radius = Math.sqrt(cu*cu + cv*cv);
  return { center: {x:cx, y:cy, z:cz}, radius };
}

export default function SketchInteraction() {
  const { camera, gl, raycaster } = useThree();
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
  const themeColors = useThemeStore((s) => s.colors);

  const [drawingPoints, setDrawingPoints] = useState<SketchPoint[]>([]);
  const [mousePos, setMousePos] = useState<THREE.Vector3 | null>(null);
  // D65: snap indicator target
  const [snapTarget, setSnapTarget] = useState<{ worldPos: THREE.Vector3; type: 'endpoint' | 'midpoint' | 'center' } | null>(null);
  const previewRef = useRef<THREE.Group>(null);
  // Stable preview materials — created once, never recreated per frame
  const previewMaterial = useRef(new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 2 }));
  const constructionPreviewMaterial = useRef(new THREE.LineDashedMaterial({
    color: 0xff8800, linewidth: 1, dashSize: 0.3, gapSize: 0.18,
  }));
  const centerlinePreviewMaterial = useRef(new THREE.LineDashedMaterial({
    color: 0x00aa55, linewidth: 1, dashSize: 0.7, gapSize: 0.2,
  }));

  // D42: click-drag tangent arc detection for line tool
  const isDraggingArcRef = useRef(false);
  const dragScreenStartRef = useRef<{ x: number; y: number } | null>(null);

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
        // Plane equation: n·p + d = 0, where d = -n·origin
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

  // D65: find nearest snap candidate (endpoint / midpoint / center) within snap radius
  const SNAP_RADIUS = 4;
  const findSnapCandidate = useCallback((worldPt: THREE.Vector3) => {
    if (!activeSketch || !snapEnabled) return null;
    let bestDist = SNAP_RADIUS;
    let best: { worldPos: THREE.Vector3; type: 'endpoint' | 'midpoint' | 'center' } | null = null;
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

    // Helper: perpendicular to edgeDir within the sketch plane, used by polygon-edge
    const planeDir = (edgeDir: THREE.Vector3, normal: THREE.Vector3) => {
      return edgeDir.clone().cross(normal).normalize();
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
      if (dragJustFinished) { dragJustFinished = false; return; }
      const point = getWorldPoint(event);
      if (!point) return;

      const sketchPoint: SketchPoint = {
        id: crypto.randomUUID(),
        x: point.x,
        y: point.y,
        z: point.z,
      };

      switch (activeTool) {
        case 'line':
        case 'construction-line':
        case 'centerline': {
          const labelMap = {
            'line': 'Line',
            'construction-line': 'Construction line',
            'centerline': 'Centerline',
          } as const;
          const lineLabel = labelMap[activeTool];
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage(`${lineLabel} start placed — click to set end point (right-click to cancel)`);
          } else {
            const entity: SketchEntity = {
              id: crypto.randomUUID(),
              type: activeTool,
              points: [drawingPoints[0], sketchPoint],
            };
            addSketchEntity(entity);
            setDrawingPoints([sketchPoint]); // Chain lines — next start = this end
            setStatusMessage(`${lineLabel} added — click to continue, right-click or Escape to stop`);
          }
          break;
        }
        // D43: Midpoint Line — click midpoint, then one endpoint; other endpoint mirrors
        case 'midpoint-line': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Midpoint Line: midpoint placed — click to set one endpoint');
          } else {
            const midPt = drawingPoints[0];
            // Mirror: other end = midPt + (midPt - endpoint) = 2*midPt - endpoint
            const otherPt: SketchPoint = {
              id: crypto.randomUUID(),
              x: 2 * midPt.x - sketchPoint.x,
              y: 2 * midPt.y - sketchPoint.y,
              z: 2 * midPt.z - sketchPoint.z,
            };
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'line',
              points: [sketchPoint, otherPt],
            });
            setDrawingPoints([]);
            const len = new THREE.Vector3(sketchPoint.x - otherPt.x, sketchPoint.y - otherPt.y, sketchPoint.z - otherPt.z).length();
            setStatusMessage(`Midpoint Line added (length=${len.toFixed(2)})`);
          }
          break;
        }

        case 'circle': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Circle center placed — click to set radius');
          } else {
            const center = drawingPoints[0];
            // Full 3-D distance — correct for every sketch plane
            const radius = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z)
              .distanceTo(new THREE.Vector3(center.x, center.y, center.z));
            if (radius > 0.001) {
              addSketchEntity({
                id: crypto.randomUUID(),
                type: 'circle',
                points: [center],
                radius,
              });
              setStatusMessage(`Circle added (r=${radius.toFixed(2)})`);
            } else {
              setStatusMessage('Circle too small — try again');
            }
            setDrawingPoints([]);
          }
          break;
        }
        case 'rectangle': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Rectangle corner placed — click to set opposite corner');
          } else {
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'rectangle',
              points: [drawingPoints[0], sketchPoint],
              closed: true,
            });
            setDrawingPoints([]);
            setStatusMessage('Rectangle added');
          }
          break;
        }
        case 'arc': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]); // center
            setStatusMessage('Arc center placed — click to set radius & start angle');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]); // start point
            setStatusMessage('Arc start set — click to set end angle');
          } else {
            // Use plane-local 2-D coordinates so angles are correct on every plane
            const center = drawingPoints[0];
            const startPt = drawingPoints[1];
            const { u: u1, v: v1 } = projectToPlane(startPt, center);
            const { u: u2, v: v2 } = projectToPlane(sketchPoint, center);
            const radius = Math.sqrt(u1 * u1 + v1 * v1);
            if (radius > 0.001) {
              addSketchEntity({
                id: crypto.randomUUID(),
                type: 'arc',
                points: [center],
                radius,
                startAngle: Math.atan2(v1, u1),
                endAngle: Math.atan2(v2, u2),
              });
              setStatusMessage('Arc added');
            } else {
              setStatusMessage('Arc too small — try again');
            }
            setDrawingPoints([]);
          }
          break;
        }
        case 'polygon':
        case 'polygon-inscribed': {
          // Inscribed: vertices ON the circle, radius = center-to-vertex distance
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Polygon center placed — click a vertex point to set size (inscribed)');
          } else {
            const center = drawingPoints[0];
            const radius = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z)
              .distanceTo(new THREE.Vector3(center.x, center.y, center.z));
            if (radius > 0.001) {
              const sides = polygonSides;
              for (let i = 0; i < sides; i++) {
                const a1 = (i / sides) * Math.PI * 2;
                const a2 = ((i + 1) / sides) * Math.PI * 2;
                const p1: SketchPoint = { id: crypto.randomUUID(), x: center.x + t1.x * Math.cos(a1) * radius + t2.x * Math.sin(a1) * radius, y: center.y + t1.y * Math.cos(a1) * radius + t2.y * Math.sin(a1) * radius, z: center.z + t1.z * Math.cos(a1) * radius + t2.z * Math.sin(a1) * radius };
                const p2: SketchPoint = { id: crypto.randomUUID(), x: center.x + t1.x * Math.cos(a2) * radius + t2.x * Math.sin(a2) * radius, y: center.y + t1.y * Math.cos(a2) * radius + t2.y * Math.sin(a2) * radius, z: center.z + t1.z * Math.cos(a2) * radius + t2.z * Math.sin(a2) * radius };
                addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [p1, p2] });
              }
              setStatusMessage(`${sides}-gon (inscribed) added (vertex r=${radius.toFixed(2)})`);
            } else { setStatusMessage('Polygon too small — try again'); }
            setDrawingPoints([]);
          }
          break;
        }
        case 'polygon-circumscribed': {
          // Circumscribed: circle is inscribed in the polygon — click sets edge-midpoint distance
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Polygon center placed — click edge midpoint to set size (circumscribed)');
          } else {
            const center = drawingPoints[0];
            const apothem = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z)
              .distanceTo(new THREE.Vector3(center.x, center.y, center.z));
            const sides = polygonSides;
            const radius = apothem / Math.cos(Math.PI / sides); // vertex distance
            if (radius > 0.001) {
              for (let i = 0; i < sides; i++) {
                const a1 = (i / sides) * Math.PI * 2;
                const a2 = ((i + 1) / sides) * Math.PI * 2;
                const p1: SketchPoint = { id: crypto.randomUUID(), x: center.x + t1.x * Math.cos(a1) * radius + t2.x * Math.sin(a1) * radius, y: center.y + t1.y * Math.cos(a1) * radius + t2.y * Math.sin(a1) * radius, z: center.z + t1.z * Math.cos(a1) * radius + t2.z * Math.sin(a1) * radius };
                const p2: SketchPoint = { id: crypto.randomUUID(), x: center.x + t1.x * Math.cos(a2) * radius + t2.x * Math.sin(a2) * radius, y: center.y + t1.y * Math.cos(a2) * radius + t2.y * Math.sin(a2) * radius, z: center.z + t1.z * Math.cos(a2) * radius + t2.z * Math.sin(a2) * radius };
                addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [p1, p2] });
              }
              setStatusMessage(`${sides}-gon (circumscribed) added (apothem=${apothem.toFixed(2)})`);
            } else { setStatusMessage('Polygon too small — try again'); }
            setDrawingPoints([]);
          }
          break;
        }
        case 'polygon-edge': {
          // Edge: click two endpoints of one edge, polygon is constructed from there
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Edge polygon: first edge endpoint placed — click second endpoint');
          } else {
            const p1 = drawingPoints[0];
            const sides = polygonSides;
            const edgeVec = new THREE.Vector3(sketchPoint.x - p1.x, sketchPoint.y - p1.y, sketchPoint.z - p1.z);
            const edgeLen = edgeVec.length();
            if (edgeLen > 0.001) {
              const sideLen = edgeLen;
              const radius = sideLen / (2 * Math.sin(Math.PI / sides)); // circumradius
              const midX = (p1.x + sketchPoint.x) / 2;
              const midY = (p1.y + sketchPoint.y) / 2;
              const midZ = (p1.z + sketchPoint.z) / 2;
              const edgeDir = edgeVec.clone().normalize();
              const planeNormal = t1.clone().cross(t2);
              const perpDir = planeDir(edgeDir, planeNormal);
              const apothem = sideLen / (2 * Math.tan(Math.PI / sides));
              const centerPt = new THREE.Vector3(midX + perpDir.x * apothem, midY + perpDir.y * apothem, midZ + perpDir.z * apothem);
              const toP1 = new THREE.Vector3(p1.x - centerPt.x, p1.y - centerPt.y, p1.z - centerPt.z);
              const startAngle = Math.atan2(toP1.dot(t2), toP1.dot(t1));
              for (let i = 0; i < sides; i++) {
                const a1 = startAngle + (i / sides) * Math.PI * 2;
                const a2 = startAngle + ((i + 1) / sides) * Math.PI * 2;
                const v1: SketchPoint = { id: crypto.randomUUID(), x: centerPt.x + t1.x * Math.cos(a1) * radius + t2.x * Math.sin(a1) * radius, y: centerPt.y + t1.y * Math.cos(a1) * radius + t2.y * Math.sin(a1) * radius, z: centerPt.z + t1.z * Math.cos(a1) * radius + t2.z * Math.sin(a1) * radius };
                const v2: SketchPoint = { id: crypto.randomUUID(), x: centerPt.x + t1.x * Math.cos(a2) * radius + t2.x * Math.sin(a2) * radius, y: centerPt.y + t1.y * Math.cos(a2) * radius + t2.y * Math.sin(a2) * radius, z: centerPt.z + t1.z * Math.cos(a2) * radius + t2.z * Math.sin(a2) * radius };
                addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [v1, v2] });
              }
              setStatusMessage(`${sides}-gon (edge) added (side=${sideLen.toFixed(2)})`);
            } else { setStatusMessage('Edge too small — try again'); }
            setDrawingPoints([]);
          }
          break;
        }
        case 'rectangle-center': {
          // Click 1: center. Click 2: corner → build rectangle symmetric about center
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Center rectangle: center placed — click to set corner');
          } else {
            const center = drawingPoints[0];
            const { u: du, v: dv } = projectToPlane(sketchPoint, center);
            const corner = (u: number, v: number): SketchPoint => ({
              id: crypto.randomUUID(),
              x: center.x + t1.x * u + t2.x * v,
              y: center.y + t1.y * u + t2.y * v,
              z: center.z + t1.z * u + t2.z * v,
            });
            const corners = [
              corner(-du, -dv), corner(du, -dv), corner(du, dv), corner(-du, dv), corner(-du, -dv),
            ];
            for (let i = 0; i < 4; i++) {
              addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [corners[i], corners[i + 1]] });
            }
            setDrawingPoints([]);
            setStatusMessage('Center rectangle added');
          }
          break;
        }
        case 'circle-2point': {
          // Click 1 and Click 2 are the two endpoints of the diameter
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('2-Point Circle: first diameter endpoint placed — click second endpoint');
          } else {
            const p1 = drawingPoints[0];
            const p2 = sketchPoint;
            const cx = (p1.x + p2.x) / 2;
            const cy = (p1.y + p2.y) / 2;
            const cz = (p1.z + p2.z) / 2;
            const radius = new THREE.Vector3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z).length() / 2;
            if (radius > 0.001) {
              const center: SketchPoint = { id: crypto.randomUUID(), x: cx, y: cy, z: cz };
              addSketchEntity({ id: crypto.randomUUID(), type: 'circle', points: [center], radius });
              setStatusMessage(`Circle added (r=${radius.toFixed(2)})`);
            } else { setStatusMessage('Circle too small — try again'); }
            setDrawingPoints([]);
          }
          break;
        }
        case 'circle-3point': {
          // 3 clicks: find circumcircle
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('3-Point Circle: first point placed');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]);
            setStatusMessage('3-Point Circle: second point placed — click third point');
          } else {
            const cc = circumcenter2D(
              { x: drawingPoints[0].x, y: drawingPoints[0].y, z: drawingPoints[0].z },
              { x: drawingPoints[1].x, y: drawingPoints[1].y, z: drawingPoints[1].z },
              { x: sketchPoint.x, y: sketchPoint.y, z: sketchPoint.z },
              t1, t2
            );
            if (cc) {
              addSketchEntity({ id: crypto.randomUUID(), type: 'circle', points: [{ id: crypto.randomUUID(), ...cc.center }], radius: cc.radius });
              setStatusMessage(`3-Point Circle added (r=${cc.radius.toFixed(2)})`);
            } else { setStatusMessage('Points are collinear — cannot form a circle'); }
            setDrawingPoints([]);
          }
          break;
        }
        // D11: Conic Curve — rational Bézier conic defined by start, end, shoulder + rho
        case 'conic': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Conic: start placed — click end point');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]);
            setStatusMessage('Conic: end placed — click shoulder point (tangent intersection)');
          } else {
            // drawingPoints = [P0, P2], sketchPoint = P1 (shoulder)
            const P0 = new THREE.Vector3(drawingPoints[0].x, drawingPoints[0].y, drawingPoints[0].z);
            const P2 = new THREE.Vector3(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z);
            const P1 = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
            const rho = conicRho;
            const w = rho / (1 - rho); // rational weight
            const N_SEGS = 48;
            const pts: SketchPoint[] = [];
            for (let i = 0; i <= N_SEGS; i++) {
              const t = i / N_SEGS;
              const b0 = (1 - t) * (1 - t);
              const b1 = 2 * t * (1 - t) * w;
              const b2 = t * t;
              const denom = b0 + b1 + b2;
              const x = (b0 * P0.x + b1 * P1.x + b2 * P2.x) / denom;
              const y = (b0 * P0.y + b1 * P1.y + b2 * P2.y) / denom;
              const z = (b0 * P0.z + b1 * P1.z + b2 * P2.z) / denom;
              pts.push({ id: crypto.randomUUID(), x, y, z });
            }
            addSketchEntity({ id: crypto.randomUUID(), type: 'spline', points: pts });
            setDrawingPoints([]);
            const shape = rho < 0.5 ? 'ellipse' : rho > 0.5 ? 'hyperbola' : 'parabola';
            setStatusMessage(`Conic (${shape}, ρ=${rho.toFixed(2)}) added`);
          }
          break;
        }

        // D40: 2-Tangent Circle — pick 2 lines, get circle tangent to both at given radius
        case 'circle-2tangent': {
          if (!activeSketch) break;
          type TLine = typeof activeSketch.entities[0] & { type: 'line' };
          const tLines = activeSketch.entities.filter((e): e is TLine => e.type === 'line' && e.points.length >= 2);

          if (drawingPoints.length === 0) {
            // First click — record click point as a sentinel to select nearest line later
            setDrawingPoints([sketchPoint]);
            setStatusMessage('2-Tangent Circle: first line selected — click a second line');
            break;
          }

          // Second click: find the two closest lines to each click point
          const clickVec0 = new THREE.Vector3(drawingPoints[0].x, drawingPoints[0].y, drawingPoints[0].z);
          const clickVec1 = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);

          const distToSeg = (pt: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
            const ab = b.clone().sub(a);
            const ap = pt.clone().sub(a);
            const t2c = Math.max(0, Math.min(1, ap.dot(ab) / (ab.lengthSq() || 1)));
            return a.clone().lerp(b, t2c).distanceTo(pt);
          };

          let bestLine0: TLine | null = null, bestDist0 = Infinity;
          let bestLine1: TLine | null = null, bestDist1 = Infinity;
          for (const l of tLines) {
            const a = new THREE.Vector3(l.points[0].x, l.points[0].y, l.points[0].z);
            const b = new THREE.Vector3(l.points[1].x, l.points[1].y, l.points[1].z);
            const d0 = distToSeg(clickVec0, a, b);
            const d1 = distToSeg(clickVec1, a, b);
            if (d0 < bestDist0) { bestDist0 = d0; bestLine0 = l; }
            if (d1 < bestDist1) { bestDist1 = d1; bestLine1 = l; }
          }

          if (!bestLine0 || !bestLine1 || bestLine0.id === bestLine1.id) {
            setStatusMessage('2-Tangent Circle: need to click two different lines');
            setDrawingPoints([]);
            break;
          }

          // Project both lines into sketch-plane 2D (u, v)
          const toUV = (pt: { x: number; y: number; z: number }) => ({ u: new THREE.Vector3(pt.x, pt.y, pt.z).dot(t1), v: new THREE.Vector3(pt.x, pt.y, pt.z).dot(t2) });
          const a0 = toUV(bestLine0.points[0]), b0 = toUV(bestLine0.points[1]);
          const a1 = toUV(bestLine1.points[0]), b1 = toUV(bestLine1.points[1]);
          // Line equation form: au·x + av·y + c = 0, normalized
          const lineEq = (a: {u:number;v:number}, b: {u:number;v:number}) => {
            const du = b.u - a.u, dv = b.v - a.v;
            const len = Math.sqrt(du*du + dv*dv);
            if (len < 1e-8) return null;
            // Normal to the line (rotated 90°): (-dv, du) / len
            const nu = -dv / len, nv = du / len;
            const c = -(nu * a.u + nv * a.v);
            return { nu, nv, c };
          };
          const eq0 = lineEq(a0, b0), eq1 = lineEq(a1, b1);
          if (!eq0 || !eq1) { setDrawingPoints([]); break; }

          const r = tangentCircleRadius;
          // 4 candidate center lines (offsets on both sides of each line)
          const candidates: { cu: number; cv: number }[] = [];
          for (const s0 of [1, -1]) {
            for (const s1 of [1, -1]) {
              // Offset line 0: nu·x + nv·y + (c + s0*r) = 0
              // Offset line 1: nu·x + nv·y + (c + s1*r) = 0
              // Intersect two 2D lines: [nu0, nv0; nu1, nv1] * [x, y] = [-c0', -c1']
              const c0p = eq0.c + s0 * r, c1p = eq1.c + s1 * r;
              const det = eq0.nu * eq1.nv - eq0.nv * eq1.nu;
              if (Math.abs(det) < 1e-8) continue; // parallel lines
              const cu = ((-c0p) * eq1.nv - (-c1p) * eq0.nv) / det;
              const cv = (eq0.nu * (-c1p) - eq1.nu * (-c0p)) / det;
              candidates.push({ cu, cv });
            }
          }

          if (candidates.length === 0) { setStatusMessage('2-Tangent Circle: lines are parallel, no solution'); setDrawingPoints([]); break; }

          // Pick the candidate closest to the average of the two click points
          const avgU = (toUV(drawingPoints[0]).u + toUV(sketchPoint).u) / 2;
          const avgV = (toUV(drawingPoints[0]).v + toUV(sketchPoint).v) / 2;
          const best = candidates.reduce((acc, c) => {
            const d = Math.hypot(c.cu - avgU, c.cv - avgV);
            return d < acc.d ? { d, c } : acc;
          }, { d: Infinity, c: candidates[0] }).c;

          // Convert back to world coords
          const worldCenter = t1.clone().multiplyScalar(best.cu).add(t2.clone().multiplyScalar(best.cv));
          addSketchEntity({
            id: crypto.randomUUID(), type: 'circle',
            points: [{ id: crypto.randomUUID(), x: worldCenter.x, y: worldCenter.y, z: worldCenter.z }],
            radius: r,
          });
          setDrawingPoints([]);
          setStatusMessage(`2-Tangent Circle added (r=${r.toFixed(2)})`);
          break;
        }

        // D41: 3-Tangent Circle — incircle tangent to three lines
        case 'circle-3tangent': {
          if (!activeSketch) break;
          type TTLine = typeof activeSketch.entities[0] & { type: 'line' };
          const ttLines = activeSketch.entities.filter((e): e is TTLine => e.type === 'line' && e.points.length >= 2);

          if (drawingPoints.length < 2) {
            setDrawingPoints([...drawingPoints, sketchPoint]);
            const remaining = 3 - drawingPoints.length - 1;
            setStatusMessage(`3-Tangent Circle: ${remaining > 0 ? `click ${remaining} more line(s)` : 'click the third line'}`);
            break;
          }

          // Third click — find all 3 lines and compute incircle
          const clickVecs = [...drawingPoints, sketchPoint].map(p => new THREE.Vector3(p.x, p.y, p.z));
          const distToSeg3 = (pt: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
            const ab = b.clone().sub(a);
            const ap = pt.clone().sub(a);
            const t3 = Math.max(0, Math.min(1, ap.dot(ab) / (ab.lengthSq() || 1)));
            return a.clone().lerp(b, t3).distanceTo(pt);
          };
          const selectedLines: TTLine[] = [];
          for (const cv of clickVecs) {
            let bst: TTLine | null = null, bd = Infinity;
            for (const l of ttLines) {
              if (selectedLines.some(s => s.id === l.id)) continue;
              const a3 = new THREE.Vector3(l.points[0].x, l.points[0].y, l.points[0].z);
              const b3 = new THREE.Vector3(l.points[1].x, l.points[1].y, l.points[1].z);
              const d3 = distToSeg3(cv, a3, b3);
              if (d3 < bd) { bd = d3; bst = l; }
            }
            if (bst) selectedLines.push(bst);
          }

          if (selectedLines.length < 3) { setStatusMessage('3-Tangent Circle: need 3 distinct lines'); setDrawingPoints([]); break; }

          const toUV3 = (pt: { x: number; y: number; z: number }) => ({ u: new THREE.Vector3(pt.x, pt.y, pt.z).dot(t1), v: new THREE.Vector3(pt.x, pt.y, pt.z).dot(t2) });
          const lineEq3 = (a: {u:number;v:number}, b: {u:number;v:number}) => {
            const du = b.u - a.u, dv = b.v - a.v;
            const len = Math.sqrt(du*du + dv*dv);
            if (len < 1e-8) return null;
            const nu = -dv / len, nv = du / len;
            return { nu, nv, c: -(nu * a.u + nv * a.v) };
          };

          const eqs = selectedLines.map(l => lineEq3(toUV3(l.points[0]), toUV3(l.points[1])));
          if (eqs.some(e => !e)) { setStatusMessage('3-Tangent Circle: degenerate line'); setDrawingPoints([]); break; }
          const [e0, e1, e2] = eqs as { nu: number; nv: number; c: number }[];

          // Incircle = intersection of bisectors of the 3 lines
          // Try all 8 sign combinations and pick the one whose radius is smallest positive
          let bestCenter: { cu: number; cv: number; r: number } | null = null;
          for (const s0 of [1, -1]) {
            for (const s1 of [1, -1]) {
              for (const s2 of [1, -1]) {
                // System: for each pair of lines, the center is equidistant
                // (nu0·x + nv0·y + c0) * s0 = (nu1·x + nv1·y + c1) * s1
                // Bisector 1: (s0*nu0 - s1*nu1)x + (s0*nv0 - s1*nv1)y + (s0*c0 - s1*c1) = 0
                // Bisector 2: (s1*nu1 - s2*nu2)x + (s1*nv1 - s2*nv2)y + (s1*c1 - s2*c2) = 0
                const A1 = s0*e0.nu - s1*e1.nu, B1 = s0*e0.nv - s1*e1.nv, C1 = -(s0*e0.c - s1*e1.c);
                const A2 = s1*e1.nu - s2*e2.nu, B2 = s1*e1.nv - s2*e2.nv, C2 = -(s1*e1.c - s2*e2.c);
                const det3 = A1*B2 - A2*B1;
                if (Math.abs(det3) < 1e-8) continue;
                const cu3 = (C1*B2 - C2*B1) / det3;
                const cv3 = (A1*C2 - A2*C1) / det3;
                const r3 = Math.abs(e0.nu*cu3 + e0.nv*cv3 + e0.c);
                if (r3 < 0.001) continue;
                if (!bestCenter || r3 < bestCenter.r) bestCenter = { cu: cu3, cv: cv3, r: r3 };
              }
            }
          }

          if (!bestCenter) { setStatusMessage('3-Tangent Circle: could not solve incircle'); setDrawingPoints([]); break; }
          const wc3 = t1.clone().multiplyScalar(bestCenter.cu).add(t2.clone().multiplyScalar(bestCenter.cv));
          addSketchEntity({
            id: crypto.randomUUID(), type: 'circle',
            points: [{ id: crypto.randomUUID(), x: wc3.x, y: wc3.y, z: wc3.z }],
            radius: bestCenter.r,
          });
          setDrawingPoints([]);
          setStatusMessage(`3-Tangent Circle added (r=${bestCenter.r.toFixed(2)})`);
          break;
        }

        case 'arc-3point': {
          // Click start, point on arc, end
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('3-Point Arc: start point placed');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]);
            setStatusMessage('3-Point Arc: through-point placed — click end point');
          } else {
            const cc = circumcenter2D(
              { x: drawingPoints[0].x, y: drawingPoints[0].y, z: drawingPoints[0].z },
              { x: drawingPoints[1].x, y: drawingPoints[1].y, z: drawingPoints[1].z },
              { x: sketchPoint.x, y: sketchPoint.y, z: sketchPoint.z },
              t1, t2
            );
            if (cc) {
              const { u: u1, v: v1 } = projectToPlane(drawingPoints[0], { id:'', x: cc.center.x, y: cc.center.y, z: cc.center.z });
              const { u: u3, v: v3 } = projectToPlane(sketchPoint, { id:'', x: cc.center.x, y: cc.center.y, z: cc.center.z });
              addSketchEntity({
                id: crypto.randomUUID(), type: 'arc',
                points: [{ id: crypto.randomUUID(), ...cc.center }],
                radius: cc.radius,
                startAngle: Math.atan2(v1, u1),
                endAngle: Math.atan2(v3, u3),
              });
              setStatusMessage(`3-Point Arc added (r=${cc.radius.toFixed(2)})`);
            } else { setStatusMessage('Points are collinear — cannot form an arc'); }
            setDrawingPoints([]);
          }
          break;
        }
        case 'point': {
          // Single click creates a real Point entity (rendered as a cross)
          addSketchEntity({ id: crypto.randomUUID(), type: 'point', points: [sketchPoint] });
          setStatusMessage(`Point added (${sketchPoint.x.toFixed(2)}, ${sketchPoint.y.toFixed(2)}, ${sketchPoint.z.toFixed(2)})`);
          break;
        }
        case 'rectangle-3point': {
          // Click 1: base-start, click 2: base-end, click 3: height (projected perpendicular)
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('3-Point Rect: place base start — click base end next');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]);
            setStatusMessage('3-Point Rect: base end placed — click height point');
          } else {
            const p1 = drawingPoints[0];
            const p2 = drawingPoints[1];
            // Base direction in plane
            const edge = new THREE.Vector3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
            const edgeLen = edge.length();
            if (edgeLen < 0.001) {
              setStatusMessage('Base too short — try again');
              setDrawingPoints([]);
              break;
            }
            const edgeDir = edge.clone().normalize();
            const planeNormal = t1.clone().cross(t2).normalize();
            // Perpendicular to edge, inside the sketch plane
            const perpDir = edgeDir.clone().cross(planeNormal).normalize();
            // Signed height = (p3 − p1) · perpDir
            const toP3 = new THREE.Vector3(sketchPoint.x - p1.x, sketchPoint.y - p1.y, sketchPoint.z - p1.z);
            const height = toP3.dot(perpDir);
            if (Math.abs(height) < 0.001) {
              setStatusMessage('Height too small — try again');
              setDrawingPoints([]);
              break;
            }
            const v = (base: SketchPoint, dx: number, dy: number, dz: number): SketchPoint => ({
              id: crypto.randomUUID(),
              x: base.x + dx, y: base.y + dy, z: base.z + dz,
            });
            const hx = perpDir.x * height, hy = perpDir.y * height, hz = perpDir.z * height;
            const corners = [
              p1,
              p2,
              v(p2, hx, hy, hz),
              v(p1, hx, hy, hz),
              p1,
            ];
            for (let i = 0; i < 4; i++) {
              addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [corners[i], corners[i + 1]] });
            }
            setStatusMessage(`3-Point Rectangle added (${edgeLen.toFixed(2)} × ${Math.abs(height).toFixed(2)})`);
            setDrawingPoints([]);
          }
          break;
        }
        case 'arc-tangent': {
          // Tangent arc: takes the end-tangent of the previous sketch entity
          // (a line or arc) and sweeps through the clicked endpoint.
          if (drawingPoints.length === 0) {
            // Peek the last entity in the active sketch
            const store = useCADStore.getState();
            const sk = store.activeSketch;
            const lastEntity = sk?.entities[sk.entities.length - 1];
            if (!lastEntity || (lastEntity.type !== 'line' && lastEntity.type !== 'arc')) {
              setStatusMessage('Tangent Arc: need a previous line or arc to attach to');
              break;
            }
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Tangent Arc: click arc endpoint');
            break;
          }
          const store = useCADStore.getState();
          const sk = store.activeSketch;
          const lastEntity = sk?.entities[sk.entities.length - 1];
          if (!sk || !lastEntity) { setDrawingPoints([]); break; }

          // Compute the start point + tangent direction from the last entity
          let startPt: SketchPoint;
          let tangentDir: THREE.Vector3;
          if (lastEntity.type === 'line') {
            const a = lastEntity.points[0];
            const b = lastEntity.points[lastEntity.points.length - 1];
            startPt = b;
            tangentDir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
          } else {
            // Arc: tangent at endAngle is perpendicular to the radius
            const c = lastEntity.points[0];
            const r = lastEntity.radius || 1;
            const ea = lastEntity.endAngle ?? Math.PI;
            const radial = new THREE.Vector3(
              t1.x * Math.cos(ea) + t2.x * Math.sin(ea),
              t1.y * Math.cos(ea) + t2.y * Math.sin(ea),
              t1.z * Math.cos(ea) + t2.z * Math.sin(ea),
            );
            startPt = { id: '', x: c.x + radial.x * r, y: c.y + radial.y * r, z: c.z + radial.z * r };
            const planeNormal = t1.clone().cross(t2).normalize();
            tangentDir = radial.clone().cross(planeNormal).normalize();
          }
          const endPt = sketchPoint;
          // Circle tangent at startPt with direction tangentDir passing through endPt
          // Center lies along the normal to tangentDir within the sketch plane:
          //   center = startPt + n * d, where n ⟂ tangentDir in plane
          //   |center − endPt| = |center − startPt| = d
          const planeNormal = t1.clone().cross(t2).normalize();
          const normalInPlane = tangentDir.clone().cross(planeNormal).normalize();
          const chord = new THREE.Vector3(endPt.x - startPt.x, endPt.y - startPt.y, endPt.z - startPt.z);
          const chordLenSq = chord.lengthSq();
          const projOnNormal = chord.dot(normalInPlane);
          if (Math.abs(projOnNormal) < 1e-5) {
            setStatusMessage('Tangent Arc: endpoint is colinear with tangent — cannot form arc');
            setDrawingPoints([]);
            break;
          }
          const d = chordLenSq / (2 * projOnNormal);
          const cx = startPt.x + normalInPlane.x * d;
          const cy = startPt.y + normalInPlane.y * d;
          const cz = startPt.z + normalInPlane.z * d;
          const arcRadius = Math.abs(d);
          // Compute plane-local start/end angles
          const toStart = new THREE.Vector3(startPt.x - cx, startPt.y - cy, startPt.z - cz);
          const toEnd = new THREE.Vector3(endPt.x - cx, endPt.y - cy, endPt.z - cz);
          const startAngle = Math.atan2(toStart.dot(t2), toStart.dot(t1));
          const endAngle = Math.atan2(toEnd.dot(t2), toEnd.dot(t1));
          addSketchEntity({
            id: crypto.randomUUID(),
            type: 'arc',
            points: [{ id: crypto.randomUUID(), x: cx, y: cy, z: cz }],
            radius: arcRadius,
            startAngle,
            endAngle,
          });
          setStatusMessage(`Tangent Arc added (r=${arcRadius.toFixed(2)})`);
          setDrawingPoints([]);
          break;
        }
        // ── D8 Slots ───────────────────────────────────────────────────
        // A slot is 2 parallel lines joined by 2 semicircular arcs. We
        // emit them as 2 lines + 2 arc entities in plane-local math so
        // every variant stays flat to the sketch plane.
        case 'slot':
        case 'slot-center': {
          // Center-to-Center Slot: click 1 = first end centre, click 2 =
          // second end centre, click 3 = width (perpendicular offset).
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Slot: place first centre — click second centre next');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]);
            setStatusMessage('Slot: second centre placed — click to set width');
          } else {
            const c1 = drawingPoints[0];
            const c2 = drawingPoints[1];
            const axis = new THREE.Vector3(c2.x - c1.x, c2.y - c1.y, c2.z - c1.z);
            const axisLen = axis.length();
            if (axisLen < 0.001) {
              setStatusMessage('Slot too short — try again');
              setDrawingPoints([]);
              break;
            }
            const axisDir = axis.clone().normalize();
            const planeNormal = t1.clone().cross(t2).normalize();
            const perpDir = axisDir.clone().cross(planeNormal).normalize();
            // Signed half-width = (p3 − c1) · perpDir — user drags perpendicular
            const to3 = new THREE.Vector3(sketchPoint.x - c1.x, sketchPoint.y - c1.y, sketchPoint.z - c1.z);
            const halfWidth = Math.abs(to3.dot(perpDir));
            if (halfWidth < 0.001) {
              setStatusMessage('Slot width must be > 0');
              setDrawingPoints([]);
              break;
            }
            // Four offsets along perpDir
            const a = (p: SketchPoint, sign: 1 | -1): SketchPoint => ({
              id: crypto.randomUUID(),
              x: p.x + perpDir.x * sign * halfWidth,
              y: p.y + perpDir.y * sign * halfWidth,
              z: p.z + perpDir.z * sign * halfWidth,
            });
            const sideA1 = a(c1, 1);
            const sideA2 = a(c2, 1);
            const sideB1 = a(c1, -1);
            const sideB2 = a(c2, -1);
            // Two straight sides
            addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [sideA1, sideA2] });
            addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [sideB1, sideB2] });
            // Two end arcs — angles are plane-local (via t1/t2), perpDir
            // always points in +t2 relative to axisDir so start = +π/2, end = -π/2
            // for the end cap at c1 (swept the long way) and opposite at c2.
            const perpAngleAt = (centre: SketchPoint) => {
              // perpDir relative to axisDir in local coords
              const local = new THREE.Vector3(
                perpDir.dot(t1),
                perpDir.dot(t2),
                0,
              );
              const axisLocal = new THREE.Vector3(
                axisDir.dot(t1),
                axisDir.dot(t2),
                0,
              );
              // start angle (from +t1) of perpDir
              return { local, axisLocal, centre };
            };
            const { local: perpLocal, axisLocal: axisLocal } = perpAngleAt(c1);
            // Start angle of perpDir = atan2(local.y, local.x) in plane coords
            const perpAngle = Math.atan2(perpLocal.y, perpLocal.x);
            const axisAngle = Math.atan2(axisLocal.y, axisLocal.x);
            // Arc at c1: from +perpDir (perpAngle) sweeping opposite to axis
            // through -perpDir. For Fusion-like rendering, we just emit a
            // half-turn of radius = halfWidth at each centre.
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'arc',
              points: [c1],
              radius: halfWidth,
              startAngle: perpAngle,
              endAngle: perpAngle + Math.PI,
            });
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'arc',
              points: [c2],
              radius: halfWidth,
              startAngle: axisAngle - Math.PI / 2, // -perpDir side
              endAngle: axisAngle + Math.PI / 2,   // +perpDir side
            });
            setStatusMessage(`Slot added (${axisLen.toFixed(2)} × ${(halfWidth * 2).toFixed(2)})`);
            setDrawingPoints([]);
          }
          break;
        }
        case 'slot-overall': {
          // Overall Slot: click 1 = one straight-line end (tip of cap),
          // click 2 = opposite end tip, click 3 = width. The two straight
          // sides connect end-to-end at half-width offset from the centre axis.
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Overall Slot: place first end — click second end');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]);
            setStatusMessage('Overall Slot: second end placed — click to set width');
          } else {
            const p1 = drawingPoints[0];
            const p2 = drawingPoints[1];
            const axis = new THREE.Vector3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
            const overallLen = axis.length();
            if (overallLen < 0.001) {
              setStatusMessage('Slot too short — try again');
              setDrawingPoints([]);
              break;
            }
            const axisDir = axis.clone().normalize();
            const planeNormal = t1.clone().cross(t2).normalize();
            const perpDir = axisDir.clone().cross(planeNormal).normalize();
            const to3 = new THREE.Vector3(sketchPoint.x - p1.x, sketchPoint.y - p1.y, sketchPoint.z - p1.z);
            const halfWidth = Math.abs(to3.dot(perpDir));
            if (halfWidth < 0.001 || halfWidth * 2 > overallLen) {
              setStatusMessage('Overall Slot width must be > 0 and < length');
              setDrawingPoints([]);
              break;
            }
            // Centres are inset by halfWidth from the end tips
            const c1: SketchPoint = {
              id: crypto.randomUUID(),
              x: p1.x + axisDir.x * halfWidth,
              y: p1.y + axisDir.y * halfWidth,
              z: p1.z + axisDir.z * halfWidth,
            };
            const c2: SketchPoint = {
              id: crypto.randomUUID(),
              x: p2.x - axisDir.x * halfWidth,
              y: p2.y - axisDir.y * halfWidth,
              z: p2.z - axisDir.z * halfWidth,
            };
            const offset = (p: SketchPoint, sign: 1 | -1): SketchPoint => ({
              id: crypto.randomUUID(),
              x: p.x + perpDir.x * sign * halfWidth,
              y: p.y + perpDir.y * sign * halfWidth,
              z: p.z + perpDir.z * sign * halfWidth,
            });
            addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [offset(c1, 1), offset(c2, 1)] });
            addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [offset(c1, -1), offset(c2, -1)] });
            const axisLocal = new THREE.Vector3(axisDir.dot(t1), axisDir.dot(t2), 0);
            const axisAngle = Math.atan2(axisLocal.y, axisLocal.x);
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'arc',
              points: [c1],
              radius: halfWidth,
              startAngle: axisAngle + Math.PI / 2,
              endAngle: axisAngle + (3 * Math.PI) / 2,
            });
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'arc',
              points: [c2],
              radius: halfWidth,
              startAngle: axisAngle - Math.PI / 2,
              endAngle: axisAngle + Math.PI / 2,
            });
            setStatusMessage(`Overall Slot added (${overallLen.toFixed(2)} × ${(halfWidth * 2).toFixed(2)})`);
            setDrawingPoints([]);
          }
          break;
        }
        case 'slot-center-point': {
          // Center Point Slot: click 1 = slot centre (midpoint between the
          // two cap centres), click 2 = one cap centre (sets axis + length),
          // click 3 = width (perpendicular offset).
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Center Slot: place centre — click end centre');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]);
            setStatusMessage('Center Slot: end placed — click to set width');
          } else {
            const mid = drawingPoints[0];
            const endPt = drawingPoints[1];
            const half = new THREE.Vector3(endPt.x - mid.x, endPt.y - mid.y, endPt.z - mid.z);
            const halfLen = half.length();
            if (halfLen < 0.001) { setStatusMessage('Slot too short'); setDrawingPoints([]); break; }
            const axisDir = half.clone().normalize();
            const planeNormal = t1.clone().cross(t2).normalize();
            const perpDir = axisDir.clone().cross(planeNormal).normalize();
            const to3 = new THREE.Vector3(sketchPoint.x - mid.x, sketchPoint.y - mid.y, sketchPoint.z - mid.z);
            const halfWidth = Math.abs(to3.dot(perpDir));
            if (halfWidth < 0.001) { setStatusMessage('Slot width too small'); setDrawingPoints([]); break; }
            const c1 = endPt;
            const c2: SketchPoint = {
              id: crypto.randomUUID(),
              x: mid.x - axisDir.x * halfLen,
              y: mid.y - axisDir.y * halfLen,
              z: mid.z - axisDir.z * halfLen,
            };
            const off = (p: SketchPoint, sign: 1 | -1): SketchPoint => ({
              id: crypto.randomUUID(),
              x: p.x + perpDir.x * sign * halfWidth,
              y: p.y + perpDir.y * sign * halfWidth,
              z: p.z + perpDir.z * sign * halfWidth,
            });
            addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [off(c1, 1), off(c2, 1)] });
            addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [off(c1, -1), off(c2, -1)] });
            const axisLocal = new THREE.Vector3(axisDir.dot(t1), axisDir.dot(t2), 0);
            const axisAngle = Math.atan2(axisLocal.y, axisLocal.x);
            addSketchEntity({
              id: crypto.randomUUID(), type: 'arc', points: [c1], radius: halfWidth,
              startAngle: axisAngle - Math.PI / 2, endAngle: axisAngle + Math.PI / 2,
            });
            addSketchEntity({
              id: crypto.randomUUID(), type: 'arc', points: [c2], radius: halfWidth,
              startAngle: axisAngle + Math.PI / 2, endAngle: axisAngle + (3 * Math.PI) / 2,
            });
            setStatusMessage(`Center Slot added (${(halfLen * 2).toFixed(2)} × ${(halfWidth * 2).toFixed(2)})`);
            setDrawingPoints([]);
          }
          break;
        }
        // ── D10 Ellipse ────────────────────────────────────────────────
        // Click 1: centre, click 2: major-axis endpoint (sets major radius
        // + rotation), click 3: minor-axis endpoint (signed minor radius).
        // Approximated as a closed polyline of 64 segments in the sketch
        // plane. Stored as a 'spline' entity type so the extrude path still
        // picks it up through the generic points[] handling.
        case 'ellipse': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Ellipse: centre placed — click major-axis endpoint');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]);
            setStatusMessage('Ellipse: major placed — click minor-axis endpoint');
          } else {
            const centre = drawingPoints[0];
            const majorPt = drawingPoints[1];
            const majorVec = new THREE.Vector3(majorPt.x - centre.x, majorPt.y - centre.y, majorPt.z - centre.z);
            const majorLen = majorVec.length();
            if (majorLen < 0.001) { setStatusMessage('Ellipse too small'); setDrawingPoints([]); break; }
            const majorDir = majorVec.clone().normalize();
            const planeNormal = t1.clone().cross(t2).normalize();
            const minorDir = majorDir.clone().cross(planeNormal).normalize();
            const to3 = new THREE.Vector3(sketchPoint.x - centre.x, sketchPoint.y - centre.y, sketchPoint.z - centre.z);
            const minorLen = Math.abs(to3.dot(minorDir));
            if (minorLen < 0.001) { setStatusMessage('Ellipse minor axis too small'); setDrawingPoints([]); break; }
            const segments = 64;
            const pts: SketchPoint[] = [];
            for (let i = 0; i <= segments; i++) {
              const a = (i / segments) * Math.PI * 2;
              const ca = Math.cos(a) * majorLen;
              const sa = Math.sin(a) * minorLen;
              pts.push({
                id: crypto.randomUUID(),
                x: centre.x + majorDir.x * ca + minorDir.x * sa,
                y: centre.y + majorDir.y * ca + minorDir.y * sa,
                z: centre.z + majorDir.z * ca + minorDir.z * sa,
              });
            }
            addSketchEntity({ id: crypto.randomUUID(), type: 'spline', points: pts });
            setStatusMessage(`Ellipse added (${majorLen.toFixed(2)} × ${minorLen.toFixed(2)})`);
            setDrawingPoints([]);
          }
          break;
        }

        // ── D9 Spline (Fit-Point / CatmullRom) ────────────────────────────
        // Clicks accumulate control points; right-click commits the spline.
        case 'spline': {
          setDrawingPoints([...drawingPoints, sketchPoint]);
          const n = drawingPoints.length + 1;
          if (n === 1) {
            setStatusMessage('Spline: first point placed — click to add more points, right-click to finish');
          } else {
            setStatusMessage(`Spline: ${n} points — click to continue, right-click to finish`);
          }
          break;
        }

        // ── D19 Break ──────────────────────────────────────────────────────
        // Click on / near a line: split it at the closest point to the click.
        case 'break': {
          if (!activeSketch) break;
          const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
          let bestEnt: typeof activeSketch.entities[0] | null = null;
          let bestT = 0;
          let bestDist = Infinity;

          for (const ent of activeSketch.entities) {
            if (ent.type !== 'line' || ent.points.length < 2) continue;
            const a = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
            const b = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
            const ab = b.clone().sub(a);
            const len2 = ab.lengthSq();
            if (len2 < 1e-8) continue;
            const t = Math.max(0, Math.min(1, clickPt.clone().sub(a).dot(ab) / len2));
            const closest = a.clone().addScaledVector(ab, t);
            const dist = clickPt.distanceTo(closest);
            if (dist < bestDist) {
              bestDist = dist;
              bestEnt = ent;
              bestT = t;
            }
          }

          // Only act if within a reasonable pick distance (~2 world units)
          if (!bestEnt || bestDist > 2 || bestT <= 0.001 || bestT >= 0.999) {
            setStatusMessage('Break: click closer to a line to split it');
            break;
          }

          const a = bestEnt.points[0];
          const b = bestEnt.points[1];
          const midPt: typeof a = {
            id: crypto.randomUUID(),
            x: a.x + (b.x - a.x) * bestT,
            y: a.y + (b.y - a.y) * bestT,
            z: a.z + (b.z - a.z) * bestT,
          };

          const updated = activeSketch.entities.flatMap((e) => {
            if (e.id !== bestEnt!.id) return [e];
            return [
              { ...e, id: crypto.randomUUID(), points: [a, midPt] },
              { ...e, id: crypto.randomUUID(), points: [midPt, b] },
            ];
          });
          replaceSketchEntities(updated);
          setStatusMessage('Break: line split at selected point');
          break;
        }

        // D57: Linetype conversion — click a line to cycle its type
        case 'linetype-convert': {
          if (!activeSketch) break;
          const ltClickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
          // Find closest line-type entity within snap distance
          let ltBest: typeof activeSketch.entities[0] | null = null;
          let ltBestDist = 3;
          for (const e of activeSketch.entities) {
            if (e.type !== 'line' && e.type !== 'construction-line' && e.type !== 'centerline') continue;
            if (e.points.length < 2) continue;
            const a = new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z);
            const b = new THREE.Vector3(e.points[1].x, e.points[1].y, e.points[1].z);
            const ab = b.clone().sub(a);
            const ap = ltClickPt.clone().sub(a);
            const tc = Math.max(0, Math.min(1, ap.dot(ab) / (ab.lengthSq() || 1)));
            const closest = a.clone().lerp(b, tc);
            const d = ltClickPt.distanceTo(closest);
            if (d < ltBestDist) { ltBestDist = d; ltBest = e; }
          }
          if (ltBest) {
            cycleEntityLinetype(ltBest.id);
            const nextMap: Record<string, string> = { 'line': 'construction-line', 'construction-line': 'centerline', 'centerline': 'line' };
            setStatusMessage(`Linetype → ${nextMap[ltBest.type] ?? ltBest.type}`);
          } else {
            setStatusMessage('Linetype Convert: click near a line to change its type');
          }
          break;
        }

        // ── D17 Trim ───────────────────────────────────────────────────────
        // Click on a segment portion: remove it between nearest intersections.
        case 'trim': {
          if (!activeSketch) break;
          const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);

          // Helper: 2-D line-line intersection parameter along segment a→b
          const lineLineT = (
            ax: number, ay: number, bx: number, by: number,
            cx: number, cy: number, dx: number, dy: number,
          ): { t: number; u: number } | null => {
            const rx = bx - ax, ry = by - ay;
            const sx = dx - cx, sy = dy - cy;
            const cross = rx * sy - ry * sx;
            if (Math.abs(cross) < 1e-10) return null;
            const qx = cx - ax, qy = cy - ay;
            const t = (qx * sy - qy * sx) / cross;
            const u = (qx * ry - qy * rx) / cross;
            return { t, u };
          };

          // Project a 3D point onto a line entity, returning t in [0,1]
          const ptOnLine = (pt: THREE.Vector3, ent: typeof activeSketch.entities[0]): number => {
            if (ent.type !== 'line' || ent.points.length < 2) return -1;
            const a2 = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
            const b2 = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
            const ab2 = b2.clone().sub(a2);
            const len2 = ab2.lengthSq();
            if (len2 < 1e-8) return -1;
            return Math.max(0, Math.min(1, pt.clone().sub(a2).dot(ab2) / len2));
          };

          // Find the line closest to the click
          let bestEnt2: typeof activeSketch.entities[0] | null = null;
          let bestDist2 = Infinity;
          for (const ent of activeSketch.entities) {
            if (ent.type !== 'line' || ent.points.length < 2) continue;
            const a2 = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
            const b2 = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
            const ab2 = b2.clone().sub(a2);
            const len2 = ab2.lengthSq();
            if (len2 < 1e-8) continue;
            const t2 = Math.max(0, Math.min(1, clickPt.clone().sub(a2).dot(ab2) / len2));
            const closest = a2.clone().addScaledVector(ab2, t2);
            const dist = clickPt.distanceTo(closest);
            if (dist < bestDist2) { bestDist2 = dist; bestEnt2 = ent; }
          }

          if (!bestEnt2 || bestDist2 > 2) {
            setStatusMessage('Trim: click closer to a line segment');
            break;
          }

          const trimEnt = bestEnt2;
          // Collect all intersection t-values along trimEnt from every other line
          const intersections: number[] = [0, 1]; // sentinel endpoints
          const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
          const toLocal = (p: typeof activeSketch.entities[0]['points'][0]) => ({
            x: new THREE.Vector3(p.x, p.y, p.z).dot(t1),
            y: new THREE.Vector3(p.x, p.y, p.z).dot(t2),
          });

          const ta0 = toLocal(trimEnt.points[0]);
          const ta1 = toLocal(trimEnt.points[1]);

          for (const other of activeSketch.entities) {
            if (other.id === trimEnt.id || other.type !== 'line' || other.points.length < 2) continue;
            const tb0 = toLocal(other.points[0]);
            const tb1 = toLocal(other.points[1]);
            const res = lineLineT(ta0.x, ta0.y, ta1.x, ta1.y, tb0.x, tb0.y, tb1.x, tb1.y);
            if (res && res.t > 1e-6 && res.t < 1 - 1e-6 && res.u >= 0 && res.u <= 1) {
              intersections.push(res.t);
            }
          }
          intersections.sort((a2, b2) => a2 - b2);

          // Find which interval was clicked
          const clickT = ptOnLine(clickPt, trimEnt);
          let segStart = 0, segEnd = 1;
          for (let k = 0; k < intersections.length - 1; k++) {
            if (clickT >= intersections[k] && clickT <= intersections[k + 1]) {
              segStart = intersections[k];
              segEnd = intersections[k + 1];
              break;
            }
          }

          // Build replacement: keep segments outside the removed interval
          const interpPt = (ent: typeof trimEnt, t3: number): typeof ent.points[0] => ({
            id: crypto.randomUUID(),
            x: ent.points[0].x + (ent.points[1].x - ent.points[0].x) * t3,
            y: ent.points[0].y + (ent.points[1].y - ent.points[0].y) * t3,
            z: ent.points[0].z + (ent.points[1].z - ent.points[0].z) * t3,
          });

          const replacements: typeof activeSketch.entities[0][] = [];
          if (segStart > 1e-6) {
            replacements.push({ ...trimEnt, id: crypto.randomUUID(), points: [trimEnt.points[0], interpPt(trimEnt, segStart)] });
          }
          if (segEnd < 1 - 1e-6) {
            replacements.push({ ...trimEnt, id: crypto.randomUUID(), points: [interpPt(trimEnt, segEnd), trimEnt.points[1]] });
          }

          const updated2 = activeSketch.entities.flatMap((e) =>
            e.id === trimEnt.id ? replacements : [e],
          );
          replaceSketchEntities(updated2);
          setStatusMessage(replacements.length === 0 ? 'Trim: entity removed' : 'Trim: segment trimmed');
          break;
        }

        // ── D18 Extend ─────────────────────────────────────────────────────
        // Click near an endpoint of a line to extend it to the nearest intersection.
        case 'extend': {
          if (!activeSketch) break;
          const clickPt2 = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);

          // Find the line whose nearest endpoint is closest to click
          let extEnt: typeof activeSketch.entities[0] | null = null;
          let extEndIdx: 0 | 1 = 0;
          let extBestDist = Infinity;

          for (const ent of activeSketch.entities) {
            if (ent.type !== 'line' || ent.points.length < 2) continue;
            const p0 = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
            const p1 = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
            const d0 = clickPt2.distanceTo(p0);
            const d1 = clickPt2.distanceTo(p1);
            if (d0 < extBestDist) { extBestDist = d0; extEnt = ent; extEndIdx = 0; }
            if (d1 < extBestDist) { extBestDist = d1; extEnt = ent; extEndIdx = 1; }
          }

          if (!extEnt || extBestDist > 4) {
            setStatusMessage('Extend: click near the endpoint of a line you want to extend');
            break;
          }

          const extA = new THREE.Vector3(extEnt.points[0].x, extEnt.points[0].y, extEnt.points[0].z);
          const extB = new THREE.Vector3(extEnt.points[1].x, extEnt.points[1].y, extEnt.points[1].z);
          const extDir = extEndIdx === 1 ? extB.clone().sub(extA).normalize() : extA.clone().sub(extB).normalize();
          const extOrigin = extEndIdx === 1 ? extB : extA;
          // Plane-local axes for intersection test
          const { t1: extT1, t2: extT2 } = GeometryEngine.getSketchAxes(activeSketch);

          const toLocal2 = (p: typeof activeSketch.entities[0]['points'][0]) => ({
            x: new THREE.Vector3(p.x, p.y, p.z).dot(extT1),
            y: new THREE.Vector3(p.x, p.y, p.z).dot(extT2),
          });
          const lineLineT2 = (
            ax2: number, ay2: number, bx2: number, by2: number,
            cx2: number, cy2: number, dx2: number, dy2: number,
          ): { t: number; u: number } | null => {
            const rx2 = bx2 - ax2, ry2 = by2 - ay2;
            const sx2 = dx2 - cx2, sy2 = dy2 - cy2;
            const cross2 = rx2 * sy2 - ry2 * sx2;
            if (Math.abs(cross2) < 1e-10) return null;
            const qx2 = cx2 - ax2, qy2 = cy2 - ay2;
            const t2r = (qx2 * sy2 - qy2 * sx2) / cross2;
            const u2r = (qx2 * ry2 - qy2 * rx2) / cross2;
            return { t: t2r, u: u2r };
          };

          const extOrigLocal = toLocal2(extEnt.points[extEndIdx]);
          const extDirLocal = { x: extDir.dot(extT1), y: extDir.dot(extT2) };
          const extEnd2 = { x: extOrigLocal.x + extDirLocal.x * 1000, y: extOrigLocal.y + extDirLocal.y * 1000 };

          let closestT: number | null = null;
          for (const other of activeSketch.entities) {
            if (other.id === extEnt.id || other.type !== 'line' || other.points.length < 2) continue;
            const ol0 = toLocal2(other.points[0]);
            const ol1 = toLocal2(other.points[1]);
            const res2 = lineLineT2(extOrigLocal.x, extOrigLocal.y, extEnd2.x, extEnd2.y, ol0.x, ol0.y, ol1.x, ol1.y);
            if (res2 && res2.t > 1e-4 && res2.u >= -0.01 && res2.u <= 1.01) {
              if (closestT === null || res2.t < closestT) closestT = res2.t;
            }
          }

          if (closestT === null) {
            setStatusMessage('Extend: no intersection found along that direction');
            break;
          }

          const newEndPt: typeof extEnt.points[0] = {
            id: crypto.randomUUID(),
            x: extOrigin.x + extDir.x * closestT * 1000,
            y: extOrigin.y + extDir.y * closestT * 1000,
            z: extOrigin.z + extDir.z * closestT * 1000,
          };

          const updExt = activeSketch.entities.map((e) => {
            if (e.id !== extEnt!.id) return e;
            const pts = [...e.points];
            pts[extEndIdx] = newEndPt;
            return { ...e, id: crypto.randomUUID(), points: pts };
          });
          replaceSketchEntities(updExt);
          setStatusMessage('Extend: line extended to nearest intersection');
          break;
        }

        // ── D20 Sketch Offset ──────────────────────────────────────────────
        // Click 1: pick a line entity. Click 2: pick the side (offset direction).
        case 'sketch-offset': {
          if (!activeSketch) break;
          const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);

          if (drawingPoints.length === 0) {
            // First click: find the closest line
            let bestEnt3: typeof activeSketch.entities[0] | null = null;
            let bestDist3 = Infinity;
            for (const ent of activeSketch.entities) {
              if (ent.type !== 'line' || ent.points.length < 2) continue;
              const a3 = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
              const b3 = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
              const ab3 = b3.clone().sub(a3);
              const len23 = ab3.lengthSq();
              if (len23 < 1e-8) continue;
              const t3 = Math.max(0, Math.min(1, clickPt.clone().sub(a3).dot(ab3) / len23));
              const dist = clickPt.distanceTo(a3.clone().addScaledVector(ab3, t3));
              if (dist < bestDist3) { bestDist3 = dist; bestEnt3 = ent; }
            }
            if (!bestEnt3 || bestDist3 > 3) {
              setStatusMessage('Offset: click closer to a line to select it');
              break;
            }
            // Store the selected entity id encoded into drawingPoints[0].id
            setDrawingPoints([{ ...sketchPoint, id: bestEnt3.id }]);
            setStatusMessage('Offset: entity selected — click on the side where you want the offset copy');
          } else {
            // Second click: compute offset direction and distance
            const selectedId = drawingPoints[0].id;
            const ent = activeSketch.entities.find((e) => e.id === selectedId);
            if (!ent || ent.type !== 'line' || ent.points.length < 2) {
              setDrawingPoints([]); break;
            }
            const a4 = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
            const b4 = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
            const ab4 = b4.clone().sub(a4).normalize();
            const planeNorm4 = t1.clone().cross(t2).normalize();
            const perpDir4 = ab4.clone().cross(planeNorm4).normalize();
            const toClick4 = clickPt.clone().sub(a4);
            const signedDist4 = toClick4.dot(perpDir4);
            const d4 = Math.abs(signedDist4);
            const sign4 = signedDist4 > 0 ? 1 : -1;
            if (d4 < 0.001) { setStatusMessage('Offset: click further from the line'); break; }
            addSketchEntity({
              ...ent,
              id: crypto.randomUUID(),
              points: [
                { ...ent.points[0], id: crypto.randomUUID(), x: ent.points[0].x + perpDir4.x * d4 * sign4, y: ent.points[0].y + perpDir4.y * d4 * sign4, z: ent.points[0].z + perpDir4.z * d4 * sign4 },
                { ...ent.points[1], id: crypto.randomUUID(), x: ent.points[1].x + perpDir4.x * d4 * sign4, y: ent.points[1].y + perpDir4.y * d4 * sign4, z: ent.points[1].z + perpDir4.z * d4 * sign4 },
              ],
            });
            setDrawingPoints([]);
            setStatusMessage(`Offset: line copied at distance ${d4.toFixed(2)}`);
          }
          break;
        }

        // ── D16 Sketch Fillet ──────────────────────────────────────────────
        // Click the shared corner of two lines; replaces it with a tangent arc.
        // Two clicks needed: click near a vertex where two lines meet.
        case 'sketch-fillet': {
          if (!activeSketch) break;
          const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
          const r = filletRadius;

          // Find the closest vertex shared by two line entities
          type LineEnt = typeof activeSketch.entities[0] & { type: 'line' };
          const lineEnts = activeSketch.entities.filter((e): e is LineEnt => e.type === 'line' && e.points.length >= 2);

          // Collect all endpoints across all lines
          interface VertexCandidate {
            pos: THREE.Vector3;
            lineIdx: number;
            ptIdx: 0 | 1; // which endpoint on that line
          }
          const vertices: VertexCandidate[] = [];
          lineEnts.forEach((e, i) => {
            vertices.push({ pos: new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z), lineIdx: i, ptIdx: 0 });
            vertices.push({ pos: new THREE.Vector3(e.points[1].x, e.points[1].y, e.points[1].z), lineIdx: i, ptIdx: 1 });
          });

          // Group vertices that are within snap tolerance of each other
          const SNAP_TOL = 0.5;
          let bestCorner: { pos: THREE.Vector3; lines: { idx: number; ptIdx: 0 | 1 }[] } | null = null;
          let bestCornerDist = Infinity;

          for (let i = 0; i < vertices.length; i++) {
            const coinc: typeof vertices = [vertices[i]];
            for (let j = i + 1; j < vertices.length; j++) {
              if (vertices[j].lineIdx === vertices[i].lineIdx) continue;
              if (vertices[j].pos.distanceTo(vertices[i].pos) < SNAP_TOL) {
                coinc.push(vertices[j]);
              }
            }
            if (coinc.length < 2) continue;
            const dist = clickPt.distanceTo(vertices[i].pos);
            if (dist < bestCornerDist) {
              bestCornerDist = dist;
              bestCorner = {
                pos: vertices[i].pos.clone(),
                lines: coinc.map((c) => ({ idx: c.lineIdx, ptIdx: c.ptIdx })),
              };
            }
          }

          if (!bestCorner || bestCornerDist > 4 || bestCorner.lines.length < 2) {
            setStatusMessage('Fillet: click near a corner where two lines meet');
            break;
          }

          const corner = bestCorner.pos;
          // Use the first two lines at the corner
          const li0 = bestCorner.lines[0];
          const li1 = bestCorner.lines[1];
          const ent0 = lineEnts[li0.idx];
          const ent1 = lineEnts[li1.idx];

          // Direction vectors pointing AWAY from the corner along each line
          const otherPt0 = li0.ptIdx === 0 ? ent0.points[1] : ent0.points[0];
          const otherPt1 = li1.ptIdx === 0 ? ent1.points[1] : ent1.points[0];
          const dir0 = new THREE.Vector3(otherPt0.x - corner.x, otherPt0.y - corner.y, otherPt0.z - corner.z).normalize();
          const dir1 = new THREE.Vector3(otherPt1.x - corner.x, otherPt1.y - corner.y, otherPt1.z - corner.z).normalize();

          // Half-angle bisector: fillet center is at distance r/sin(halfAngle) from corner
          const cosA = dir0.dot(dir1);
          const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
          if (sinA < 0.01) { setStatusMessage('Fillet: lines are nearly parallel, cannot fillet'); break; }
          const halfAngle = Math.acos(Math.max(-1, Math.min(1, cosA))) / 2;
          const distToCenter = r / Math.sin(halfAngle);
          const bisector = dir0.clone().add(dir1).normalize();
          const arcCenter = corner.clone().addScaledVector(bisector, distToCenter);

          // Tangent points: where fillet circle meets each line
          const tangent0 = corner.clone().addScaledVector(dir0, r / Math.tan(halfAngle));
          const tangent1 = corner.clone().addScaledVector(dir1, r / Math.tan(halfAngle));

          // Arc angles in the sketch plane
          const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
          const toAngle = (v: THREE.Vector3) => Math.atan2(v.dot(t2), v.dot(t1));
          const arcStart = toAngle(tangent0.clone().sub(arcCenter));
          const arcEnd = toAngle(tangent1.clone().sub(arcCenter));

          // Build replacement entities
          const toSkPt = (v: THREE.Vector3): typeof activeSketch.entities[0]['points'][0] => ({
            id: crypto.randomUUID(), x: v.x, y: v.y, z: v.z,
          });

          const updated3 = activeSketch.entities.flatMap((e) => {
            if (e.id === ent0.id) {
              // Shorten ent0: keep the far end → tangent point
              const farPt = li0.ptIdx === 0 ? e.points[1] : e.points[0];
              const t0Pt = toSkPt(tangent0);
              return [{ ...e, id: crypto.randomUUID(), points: li0.ptIdx === 0 ? [e.points[0], t0Pt] : [t0Pt, farPt] }];
            }
            if (e.id === ent1.id) {
              const farPt2 = li1.ptIdx === 0 ? e.points[1] : e.points[0];
              const t1Pt = toSkPt(tangent1);
              return [{ ...e, id: crypto.randomUUID(), points: li1.ptIdx === 0 ? [e.points[0], t1Pt] : [t1Pt, farPt2] }];
            }
            return [e];
          });

          // Insert fillet arc
          updated3.push({
            id: crypto.randomUUID(),
            type: 'arc',
            points: [toSkPt(arcCenter)],
            radius: r,
            startAngle: arcStart,
            endAngle: arcEnd,
          });
          replaceSketchEntities(updated3);
          setStatusMessage(`Fillet: r=${r.toFixed(2)} applied`);
          break;
        }

        // D47: Sketch Chamfer — equal / two-dist / dist+angle variants
        case 'sketch-chamfer-equal':
        case 'sketch-chamfer-two-dist':
        case 'sketch-chamfer-dist-angle': {
          if (!activeSketch) break;
          const chamferClickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);

          // Reuse the same corner-finder as sketch-fillet
          type CLineEnt = typeof activeSketch.entities[0] & { type: 'line' };
          const chamferLines = activeSketch.entities.filter((e): e is CLineEnt => e.type === 'line' && e.points.length >= 2);
          interface CVtx { pos: THREE.Vector3; lineIdx: number; ptIdx: 0 | 1; }
          const chamferVerts: CVtx[] = [];
          chamferLines.forEach((e, i) => {
            chamferVerts.push({ pos: new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z), lineIdx: i, ptIdx: 0 });
            chamferVerts.push({ pos: new THREE.Vector3(e.points[1].x, e.points[1].y, e.points[1].z), lineIdx: i, ptIdx: 1 });
          });

          const CTOL = 0.5;
          let bestChamferCorner: { pos: THREE.Vector3; lines: { idx: number; ptIdx: 0 | 1 }[] } | null = null;
          let bestChamferDist = Infinity;
          for (let i = 0; i < chamferVerts.length; i++) {
            const coinc: CVtx[] = [chamferVerts[i]];
            for (let j = i + 1; j < chamferVerts.length; j++) {
              if (chamferVerts[j].lineIdx === chamferVerts[i].lineIdx) continue;
              if (chamferVerts[j].pos.distanceTo(chamferVerts[i].pos) < CTOL) coinc.push(chamferVerts[j]);
            }
            if (coinc.length < 2) continue;
            const dist = chamferClickPt.distanceTo(chamferVerts[i].pos);
            if (dist < bestChamferDist) {
              bestChamferDist = dist;
              bestChamferCorner = { pos: chamferVerts[i].pos.clone(), lines: coinc.map((c) => ({ idx: c.lineIdx, ptIdx: c.ptIdx })) };
            }
          }

          if (!bestChamferCorner || bestChamferDist > 4 || bestChamferCorner.lines.length < 2) {
            setStatusMessage('Chamfer: click near a corner where two lines meet');
            break;
          }

          const cCorner = bestChamferCorner.pos;
          const cLi0 = bestChamferCorner.lines[0];
          const cLi1 = bestChamferCorner.lines[1];
          const cEnt0 = chamferLines[cLi0.idx];
          const cEnt1 = chamferLines[cLi1.idx];
          const cOther0 = cLi0.ptIdx === 0 ? cEnt0.points[1] : cEnt0.points[0];
          const cOther1 = cLi1.ptIdx === 0 ? cEnt1.points[1] : cEnt1.points[0];
          const cDir0 = new THREE.Vector3(cOther0.x - cCorner.x, cOther0.y - cCorner.y, cOther0.z - cCorner.z).normalize();
          const cDir1 = new THREE.Vector3(cOther1.x - cCorner.x, cOther1.y - cCorner.y, cOther1.z - cCorner.z).normalize();

          // Determine setback distances based on variant
          let sb0 = chamferDist1;
          let sb1 = chamferDist1;
          if (activeTool === 'sketch-chamfer-two-dist') {
            sb0 = chamferDist1;
            sb1 = chamferDist2;
          } else if (activeTool === 'sketch-chamfer-dist-angle') {
            sb0 = chamferDist1;
            sb1 = chamferDist1 * Math.tan((chamferAngle * Math.PI) / 180);
          }

          // Setback points along each line
          const cTangent0 = cCorner.clone().addScaledVector(cDir0, sb0);
          const cTangent1 = cCorner.clone().addScaledVector(cDir1, sb1);

          const toCSkPt = (v: THREE.Vector3): SketchPoint => ({ id: crypto.randomUUID(), x: v.x, y: v.y, z: v.z });

          const chamferUpdated = activeSketch.entities.flatMap((e) => {
            if (e.id === cEnt0.id) {
              const farPt = cLi0.ptIdx === 0 ? e.points[1] : e.points[0];
              const newCornerPt = toCSkPt(cTangent0);
              return [{ ...e, id: crypto.randomUUID(), points: cLi0.ptIdx === 0 ? [e.points[0], newCornerPt] : [newCornerPt, farPt] }];
            }
            if (e.id === cEnt1.id) {
              const farPt2 = cLi1.ptIdx === 0 ? e.points[1] : e.points[0];
              const newCornerPt2 = toCSkPt(cTangent1);
              return [{ ...e, id: crypto.randomUUID(), points: cLi1.ptIdx === 0 ? [e.points[0], newCornerPt2] : [newCornerPt2, farPt2] }];
            }
            return [e];
          });

          // Insert chamfer line between the two setback points
          chamferUpdated.push({
            id: crypto.randomUUID(),
            type: 'line',
            points: [toCSkPt(cTangent0), toCSkPt(cTangent1)],
          });
          replaceSketchEntities(chamferUpdated);
          setStatusMessage(`Chamfer: ${sb0.toFixed(2)} × ${sb1.toFixed(2)} applied`);
          break;
        }
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawingPoints([]);
        setStatusMessage('Drawing cancelled');
      }
    };

    // Right-click stops the current drawing operation at the last placed point;
    // for spline tool it commits the curve if ≥2 points are placed.
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
      if (drawingPoints.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setDrawingPoints([]);
        setStatusMessage('');
      }
    };

    // D42: line-tool click-drag → tangent arc
    const DRAG_THRESHOLD_PX = 8;
    // Set to true on pointerup after a drag; cleared after first click event that reads it
    let dragJustFinished = false;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      isDraggingArcRef.current = false;
      dragJustFinished = false;
      dragScreenStartRef.current = { x: event.clientX, y: event.clientY };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.buttons !== 1) return; // only while left button held
      const start = dragScreenStartRef.current;
      if (!start) return;
      // Only activate drag-arc when we already have a chain start point
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
      dragJustFinished = true;
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
        // Verify the arc's end point matches chainPt (within tolerance)
        const distToEnd = new THREE.Vector3(endPtArc.x - chainPt.x, endPtArc.y - chainPt.y, endPtArc.z - chainPt.z).length();
        if (distToEnd < 1) {
          const planeNorm = _t1.clone().cross(_t2).normalize();
          tangentDir = radial.clone().cross(planeNorm).normalize();
        } else {
          // Fallback: tangent along drag direction
          tangentDir = mousePos.clone().sub(new THREE.Vector3(chainPt.x, chainPt.y, chainPt.z)).normalize();
        }
      } else {
        // No previous entity — tangent is the drag direction
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
      // Chain: next line starts at arc end
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
  }, [activeSketch, activeTool, drawingPoints, mousePos, getWorldPoint, findSnapCandidate, addSketchEntity, replaceSketchEntities, cycleEntityLinetype, setStatusMessage, filletRadius, chamferDist1, chamferDist2, chamferAngle, tangentCircleRadius, conicRho]);

  // Preview of current drawing operation
  useFrame(() => {
    if (!previewRef.current) return;
    clearGroupChildren(previewRef.current);

    if (drawingPoints.length === 0 || !mousePos) return;

    const material = previewMaterial.current;
    const start = drawingPoints[0];
    const startV = new THREE.Vector3(start.x, start.y, start.z);

    // Plane-aware axis vectors via GeometryEngine helper (named planes + custom face planes)
    const { t1, t2 } = activeSketch
      ? GeometryEngine.getSketchAxes(activeSketch)
      : GeometryEngine.getPlaneAxes('XZ');

    const addLine = (pts: THREE.Vector3[], mat?: THREE.LineBasicMaterial | THREE.LineDashedMaterial) => {
      const m = mat ?? material;
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geom, m);
      // LineDashedMaterial requires per-vertex line distances
      if ((m as THREE.LineDashedMaterial).isLineDashedMaterial) {
        line.computeLineDistances();
      }
      previewRef.current!.add(line);
    };

    const circlePoints = (center: THREE.Vector3, radius: number, segs = 64): THREE.Vector3[] => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push(center.clone().addScaledVector(t1, Math.cos(a) * radius).addScaledVector(t2, Math.sin(a) * radius));
      }
      return pts;
    };

    switch (activeTool) {
      case 'line':
      case 'construction-line':
      case 'centerline': {
        const lineMat: THREE.LineBasicMaterial | THREE.LineDashedMaterial =
          activeTool === 'construction-line' ? constructionPreviewMaterial.current
          : activeTool === 'centerline' ? centerlinePreviewMaterial.current
          : material;

        // D42: if drag-arc mode active, show tangent arc preview instead of line
        if (isDraggingArcRef.current && drawingPoints.length > 0) {
          const sk = useCADStore.getState().activeSketch;
          const lastEntity = sk?.entities[sk.entities.length - 1];
          let tDir: THREE.Vector3;
          if (lastEntity && (lastEntity.type === 'line' || lastEntity.type === 'construction-line' || lastEntity.type === 'centerline')) {
            const a = lastEntity.points[0];
            const b = lastEntity.points[lastEntity.points.length - 1];
            tDir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
          } else {
            tDir = mousePos.clone().sub(startV).normalize();
          }
          const pn = t1.clone().cross(t2).normalize();
          const nip = tDir.clone().cross(pn).normalize();
          const chord2 = mousePos.clone().sub(startV);
          const cLenSq = chord2.lengthSq();
          const proj2 = chord2.dot(nip);
          if (Math.abs(proj2) > 1e-5 && cLenSq > 0.001) {
            const d2 = cLenSq / (2 * proj2);
            const arcCx = startV.x + nip.x * d2;
            const arcCy = startV.y + nip.y * d2;
            const arcCz = startV.z + nip.z * d2;
            const arcCenter2 = new THREE.Vector3(arcCx, arcCy, arcCz);
            const arcR2 = Math.abs(d2);
            const toS = startV.clone().sub(arcCenter2);
            const toE = mousePos.clone().sub(arcCenter2);
            const sa = Math.atan2(toS.dot(t2), toS.dot(t1));
            const ea = Math.atan2(toE.dot(t2), toE.dot(t1));
            const segs2 = 32;
            const arcPrev: THREE.Vector3[] = [];
            for (let i = 0; i <= segs2; i++) {
              const ang = sa + (i / segs2) * (ea - sa);
              arcPrev.push(arcCenter2.clone().addScaledVector(t1, Math.cos(ang) * arcR2).addScaledVector(t2, Math.sin(ang) * arcR2));
            }
            addLine(arcPrev);
          } else {
            addLine([startV, mousePos], lineMat);
          }
          break;
        }

        addLine([startV, mousePos], lineMat);
        // Angle arc visualization (sweep from +t1 axis to current line direction) — always solid
        const lineDelta = mousePos.clone().sub(startV);
        const lineLen = lineDelta.length();
        if (lineLen > 0.001) {
          const lineAngle = Math.atan2(lineDelta.dot(t2), lineDelta.dot(t1));
          const arcRadius = Math.min(lineLen * 0.25, 1.5);
          const segs = 24;
          const arcPts: THREE.Vector3[] = [];
          for (let i = 0; i <= segs; i++) {
            const a = (i / segs) * lineAngle;
            arcPts.push(startV.clone().addScaledVector(t1, Math.cos(a) * arcRadius).addScaledVector(t2, Math.sin(a) * arcRadius));
          }
          addLine(arcPts);
          // Reference baseline along +t1 from start (length matches arc radius for visual reference)
          addLine([startV, startV.clone().addScaledVector(t1, arcRadius)]);
        }
        break;
      }
      case 'midpoint-line': {
        // startV is the midpoint; mousePos is one endpoint; mirror for the other
        const otherEnd = startV.clone().multiplyScalar(2).sub(mousePos);
        addLine([mousePos, otherEnd]);
        // Mark the midpoint with a cross
        const crossSize = 0.3;
        addLine([startV.clone().addScaledVector(t1, -crossSize), startV.clone().addScaledVector(t1, crossSize)]);
        addLine([startV.clone().addScaledVector(t2, -crossSize), startV.clone().addScaledVector(t2, crossSize)]);
        break;
      }

      // D11: Conic curve preview
      case 'conic': {
        if (drawingPoints.length === 1) {
          // Show line from start to mouse (preview of chord)
          addLine([startV, mousePos]);
        } else if (drawingPoints.length === 2) {
          // Show rational Bézier conic preview
          const P0c = startV;
          const P2c = new THREE.Vector3(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z);
          const P1c = mousePos; // shoulder at mouse
          const rhoC = conicRho;
          const wC = rhoC / (1 - rhoC);
          const N_PC = 32;
          const conicPreviewPts: THREE.Vector3[] = [];
          for (let i = 0; i <= N_PC; i++) {
            const tc = i / N_PC;
            const b0c = (1 - tc) * (1 - tc);
            const b1c = 2 * tc * (1 - tc) * wC;
            const b2c = tc * tc;
            const dc = b0c + b1c + b2c;
            conicPreviewPts.push(new THREE.Vector3(
              (b0c * P0c.x + b1c * P1c.x + b2c * P2c.x) / dc,
              (b0c * P0c.y + b1c * P1c.y + b2c * P2c.y) / dc,
              (b0c * P0c.z + b1c * P1c.z + b2c * P2c.z) / dc,
            ));
          }
          addLine(conicPreviewPts);
          // Dashed lines to shoulder
          addLine([P0c, P1c]);
          addLine([P2c, P1c]);
        }
        break;
      }

      case 'rectangle': {
        const delta = mousePos.clone().sub(startV);
        const dt1 = t1.clone().multiplyScalar(delta.dot(t1));
        const dt2 = t2.clone().multiplyScalar(delta.dot(t2));
        addLine([
          startV.clone(),
          startV.clone().add(dt1),
          startV.clone().add(dt1).add(dt2),
          startV.clone().add(dt2),
          startV.clone(),
        ]);
        break;
      }
      case 'circle': {
        const radius = mousePos.distanceTo(startV);
        addLine(circlePoints(startV, radius));
        // Radius indicator line
        addLine([startV, mousePos]);
        break;
      }
      case 'arc': {
        if (drawingPoints.length === 1) {
          // Show radius line from center to mouse
          addLine([startV, mousePos]);
          // Show dashed circle outline at radius
          addLine(circlePoints(startV, mousePos.distanceTo(startV)));
        } else if (drawingPoints.length === 2) {
          // Second point defines the start angle; mouse defines end angle
          const startPt2 = drawingPoints[1];
          const startV2 = new THREE.Vector3(startPt2.x, startPt2.y, startPt2.z);
          const radius = startV2.distanceTo(startV);
          const d1 = startV2.clone().sub(startV);
          const d2 = mousePos.clone().sub(startV);
          const startAngle = Math.atan2(d1.dot(t2), d1.dot(t1));
          const endAngle = Math.atan2(d2.dot(t2), d2.dot(t1));
          const segs = 32;
          const arcPts: THREE.Vector3[] = [];
          for (let i = 0; i <= segs; i++) {
            const a = startAngle + (i / segs) * (endAngle - startAngle);
            arcPts.push(startV.clone().addScaledVector(t1, Math.cos(a) * radius).addScaledVector(t2, Math.sin(a) * radius));
          }
          addLine(arcPts);
          // Show radius lines to start and end
          addLine([startV, startV2]);
          addLine([startV, mousePos.clone().sub(startV).normalize().multiplyScalar(radius).add(startV)]);
        }
        break;
      }
      case 'polygon':
      case 'polygon-inscribed': {
        const radius = mousePos.distanceTo(startV);
        const sides = 6;
        const polyPts: THREE.Vector3[] = [];
        for (let i = 0; i <= sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          polyPts.push(startV.clone().addScaledVector(t1, Math.cos(a) * radius).addScaledVector(t2, Math.sin(a) * radius));
        }
        addLine(polyPts);
        addLine([startV, mousePos]);
        break;
      }
      case 'polygon-circumscribed': {
        // Apothem radius — vertex is further out
        const apothem = mousePos.distanceTo(startV);
        const sides = 6;
        const radius = apothem / Math.cos(Math.PI / sides);
        const polyPts: THREE.Vector3[] = [];
        for (let i = 0; i <= sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          polyPts.push(startV.clone().addScaledVector(t1, Math.cos(a) * radius).addScaledVector(t2, Math.sin(a) * radius));
        }
        addLine(polyPts);
        addLine([startV, mousePos]);
        break;
      }
      case 'polygon-edge': {
        // Two endpoints of first edge — show the full polygon
        if (drawingPoints.length === 1) {
          const sides = 6;
          const edgeVec = mousePos.clone().sub(startV);
          const edgeLen = edgeVec.length();
          const radius = edgeLen / (2 * Math.sin(Math.PI / sides));
          const apothem = edgeLen / (2 * Math.tan(Math.PI / sides));
          const edgeDir = edgeVec.clone().normalize();
          const planeNormal = t1.clone().cross(t2);
          const perpDir = edgeDir.clone().cross(planeNormal).normalize();
          const midV = startV.clone().add(mousePos).multiplyScalar(0.5);
          const centerV = midV.clone().addScaledVector(perpDir, apothem);
          const toP1 = startV.clone().sub(centerV);
          const startAngle = Math.atan2(toP1.dot(t2), toP1.dot(t1));
          const polyPts: THREE.Vector3[] = [];
          for (let i = 0; i <= sides; i++) {
            const a = startAngle + (i / sides) * Math.PI * 2;
            polyPts.push(centerV.clone().addScaledVector(t1, Math.cos(a) * radius).addScaledVector(t2, Math.sin(a) * radius));
          }
          addLine(polyPts);
          addLine([startV, mousePos]); // highlight the first edge
        }
        break;
      }
      case 'rectangle-center': {
        // Center to corner preview
        const delta = mousePos.clone().sub(startV);
        const du = delta.dot(t1);
        const dv = delta.dot(t2);
        const corners = [
          startV.clone().addScaledVector(t1, -du).addScaledVector(t2, -dv),
          startV.clone().addScaledVector(t1,  du).addScaledVector(t2, -dv),
          startV.clone().addScaledVector(t1,  du).addScaledVector(t2,  dv),
          startV.clone().addScaledVector(t1, -du).addScaledVector(t2,  dv),
        ];
        addLine([...corners, corners[0]]);
        addLine([startV, mousePos]); // diagonal line showing center-to-corner
        break;
      }
      case 'circle-2point': {
        // Show circle with center = midpoint of start-mouse, radius = half distance
        const midV = startV.clone().add(mousePos).multiplyScalar(0.5);
        const radius = mousePos.distanceTo(startV) / 2;
        addLine(circlePoints(midV, radius));
        addLine([startV, mousePos]); // diameter line
        break;
      }
      case 'circle-3point': {
        // Show line from last point to mouse
        addLine([startV, mousePos]);
        if (drawingPoints.length === 2) {
          const cc = circumcenter2D(
            { x: drawingPoints[0].x, y: drawingPoints[0].y, z: drawingPoints[0].z },
            { x: drawingPoints[1].x, y: drawingPoints[1].y, z: drawingPoints[1].z },
            { x: mousePos.x, y: mousePos.y, z: mousePos.z },
            t1, t2
          );
          if (cc) {
            const cV = new THREE.Vector3(cc.center.x, cc.center.y, cc.center.z);
            addLine(circlePoints(cV, cc.radius));
          }
        }
        break;
      }
      case 'arc-3point': {
        const lastPt = drawingPoints[drawingPoints.length - 1];
        const lastV = new THREE.Vector3(lastPt.x, lastPt.y, lastPt.z);
        addLine([lastV, mousePos]);
        if (drawingPoints.length === 2) {
          const cc = circumcenter2D(
            { x: drawingPoints[0].x, y: drawingPoints[0].y, z: drawingPoints[0].z },
            { x: drawingPoints[1].x, y: drawingPoints[1].y, z: drawingPoints[1].z },
            { x: mousePos.x, y: mousePos.y, z: mousePos.z },
            t1, t2
          );
          if (cc) {
            const cV = new THREE.Vector3(cc.center.x, cc.center.y, cc.center.z);
            const d1 = new THREE.Vector3(drawingPoints[0].x - cc.center.x, drawingPoints[0].y - cc.center.y, drawingPoints[0].z - cc.center.z);
            const d3 = mousePos.clone().sub(cV);
            const startAngle = Math.atan2(d1.dot(t2), d1.dot(t1));
            const endAngle = Math.atan2(d3.dot(t2), d3.dot(t1));
            const segs = 32;
            const arcPts: THREE.Vector3[] = [];
            for (let i = 0; i <= segs; i++) {
              const a = startAngle + (i / segs) * (endAngle - startAngle);
              arcPts.push(cV.clone().addScaledVector(t1, Math.cos(a) * cc.radius).addScaledVector(t2, Math.sin(a) * cc.radius));
            }
            addLine(arcPts);
          }
        }
        break;
      }
      // Spline preview: CatmullRomCurve3 through placed points + mouse cursor
      case 'spline': {
        if (drawingPoints.length === 0) {
          addLine([startV, mousePos]);
        } else {
          const pts3d = drawingPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
          pts3d.push(mousePos.clone());
          const curve = new THREE.CatmullRomCurve3(pts3d);
          const previewPts = curve.getPoints(Math.max(50, pts3d.length * 8));
          addLine(previewPts);
          // Dot markers at each control point
          for (const cp of drawingPoints) {
            const cv = new THREE.Vector3(cp.x, cp.y, cp.z);
            addLine([cv.clone().addScaledVector(t1, 0.15), cv.clone().addScaledVector(t1, -0.15)]);
            addLine([cv.clone().addScaledVector(t2, 0.15), cv.clone().addScaledVector(t2, -0.15)]);
          }
        }
        break;
      }
    }
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
    // For midpoint-line the effective start is the midpoint, but we show full length
    const delta = activeTool === 'midpoint-line'
      ? mousePos.clone().sub(startVec).multiplyScalar(2) // full line length = 2 * half
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
    // Position angle label along the angle bisector, just outside the arc
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
        </Html>
      )}
    </>
  );
}
