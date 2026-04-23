import * as THREE from 'three';
import { useCADStore } from '../../../../../store/cadStore';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import type { SketchPoint } from '../../../../../types/cad';

export function finalizeSplineFromContextMenu(
  activeTool: string,
  drawingPoints: SketchPoint[],
  addSketchEntity: ReturnType<typeof useCADStore.getState>['addSketchEntity'],
  setDrawingPoints: (value: SketchPoint[]) => void,
  setStatusMessage: ReturnType<typeof useCADStore.getState>['setStatusMessage'],
): boolean {
  if (activeTool === 'spline' && drawingPoints.length >= 2) {
    const curve = new THREE.CatmullRomCurve3(drawingPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
    const splinePts = curve.getPoints(Math.max(50, drawingPoints.length * 8)).map((p) => ({
      id: crypto.randomUUID(),
      x: p.x,
      y: p.y,
      z: p.z,
    }));
    addSketchEntity({ id: crypto.randomUUID(), type: 'spline', points: splinePts });
    setDrawingPoints([]);
    setStatusMessage(`Spline added (${drawingPoints.length} fit points)`);
    return true;
  }

  if (activeTool === 'spline-control' && drawingPoints.length >= 2) {
    const curve = new THREE.CatmullRomCurve3(
      drawingPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
      false,
      'catmullrom',
      0,
    );
    const splinePts = curve.getPoints(Math.max(50, drawingPoints.length * 16)).map((p) => ({
      id: crypto.randomUUID(),
      x: p.x,
      y: p.y,
      z: p.z,
    }));
    addSketchEntity({ id: crypto.randomUUID(), type: 'spline', points: splinePts });
    setDrawingPoints([]);
    setStatusMessage(`Control Point Spline added (${drawingPoints.length} control points)`);
    return true;
  }

  return false;
}

export function commitDraggedTangentArc(params: {
  activeTool: string;
  activeSketch: ReturnType<typeof useCADStore.getState>['activeSketch'];
  drawingPoints: SketchPoint[];
  mousePos: THREE.Vector3 | null;
  addSketchEntity: ReturnType<typeof useCADStore.getState>['addSketchEntity'];
  setDrawingPoints: (value: SketchPoint[]) => void;
  setStatusMessage: ReturnType<typeof useCADStore.getState>['setStatusMessage'];
}): boolean {
  const { activeTool, activeSketch, drawingPoints, mousePos, addSketchEntity, setDrawingPoints, setStatusMessage } = params;
  if (!mousePos || !activeSketch || drawingPoints.length === 0) return false;
  if (!['line', 'construction-line', 'centerline'].includes(activeTool)) return false;

  const sk = useCADStore.getState().activeSketch;
  const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
  const lastEntity = sk?.entities[sk.entities.length - 1];
  const chainPt = drawingPoints[0];
  let tangentDir: THREE.Vector3;

  if (lastEntity && ['line', 'construction-line', 'centerline'].includes(lastEntity.type)) {
    const a = lastEntity.points[0];
    const b = lastEntity.points[lastEntity.points.length - 1];
    tangentDir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
  } else if (lastEntity && lastEntity.type === 'arc') {
    const c = lastEntity.points[0];
    const r = lastEntity.radius || 1;
    const ea = lastEntity.endAngle ?? Math.PI;
    const radial = new THREE.Vector3(
      t1.x * Math.cos(ea) + t2.x * Math.sin(ea),
      t1.y * Math.cos(ea) + t2.y * Math.sin(ea),
      t1.z * Math.cos(ea) + t2.z * Math.sin(ea),
    );
    const endPtArc = { x: c.x + radial.x * r, y: c.y + radial.y * r, z: c.z + radial.z * r };
    const distToEnd = new THREE.Vector3(endPtArc.x - chainPt.x, endPtArc.y - chainPt.y, endPtArc.z - chainPt.z).length();
    if (distToEnd < 1) {
      const planeNorm = t1.clone().cross(t2).normalize();
      tangentDir = radial.clone().cross(planeNorm).normalize();
    } else {
      tangentDir = mousePos.clone().sub(new THREE.Vector3(chainPt.x, chainPt.y, chainPt.z)).normalize();
    }
  } else {
    tangentDir = mousePos.clone().sub(new THREE.Vector3(chainPt.x, chainPt.y, chainPt.z)).normalize();
  }

  const planeNormal = t1.clone().cross(t2).normalize();
  const normalInPlane = tangentDir.clone().cross(planeNormal).normalize();
  const chord = new THREE.Vector3(mousePos.x - chainPt.x, mousePos.y - chainPt.y, mousePos.z - chainPt.z);
  const chordLenSq = chord.lengthSq();
  const projOnNormal = chord.dot(normalInPlane);
  if (Math.abs(projOnNormal) < 1e-5 || chordLenSq < 0.001) {
    setStatusMessage('Tangent arc too short - skipped');
    return true;
  }

  const d = chordLenSq / (2 * projOnNormal);
  const cx = chainPt.x + normalInPlane.x * d;
  const cy = chainPt.y + normalInPlane.y * d;
  const cz = chainPt.z + normalInPlane.z * d;
  const arcRadius = Math.abs(d);
  const toStart = new THREE.Vector3(chainPt.x - cx, chainPt.y - cy, chainPt.z - cz);
  const toEnd = new THREE.Vector3(mousePos.x - cx, mousePos.y - cy, mousePos.z - cz);
  addSketchEntity({
    id: crypto.randomUUID(),
    type: 'arc',
    points: [{ id: crypto.randomUUID(), x: cx, y: cy, z: cz }],
    radius: arcRadius,
    startAngle: Math.atan2(toStart.dot(t2), toStart.dot(t1)),
    endAngle: Math.atan2(toEnd.dot(t2), toEnd.dot(t1)),
  });
  setDrawingPoints([{ id: crypto.randomUUID(), x: mousePos.x, y: mousePos.y, z: mousePos.z }]);
  setStatusMessage(`Tangent arc added (r=${arcRadius.toFixed(2)}) - click to continue line`);
  return true;
}
