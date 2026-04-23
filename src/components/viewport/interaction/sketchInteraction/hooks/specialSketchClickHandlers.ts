import * as THREE from 'three';
import type { SketchPoint } from '../../../../../types/cad';
import { useCADStore } from '../../../../../store/cadStore';
import { loadDefaultFont, fontPathToSegments } from '../../../../../utils/sketchTextUtil';

interface SpecialClickParams {
  activeTool: string;
  point: THREE.Vector3;
  shiftKey: boolean;
  drawingPoints: SketchPoint[];
  t1: THREE.Vector3;
  t2: THREE.Vector3;
  addSketchEntity: ReturnType<typeof useCADStore.getState>['addSketchEntity'];
  setDrawingPoints: (value: SketchPoint[]) => void;
  setStatusMessage: ReturnType<typeof useCADStore.getState>['setStatusMessage'];
  lineArcModeRef: { current: boolean };
  drawingConstructionRef: { current: boolean };
  sketchTextContent: string;
  sketchTextHeight: number;
  sketchTextBold: boolean;
  sketchTextItalic: boolean;
  commitSketchTextEntities: ReturnType<typeof useCADStore.getState>['commitSketchTextEntities'];
}

export function handleSpecialSketchClick({
  activeTool,
  point,
  shiftKey,
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
}: SpecialClickParams): boolean {
  if (activeTool === 'sketch-text') {
    const anchorPt = point;
    setStatusMessage('Placing text...');
    loadDefaultFont()
      .then((font) => {
        const segs2d = fontPathToSegments(font, sketchTextContent, 0, 0, sketchTextHeight, 8, {
          bold: sketchTextBold,
          italic: sketchTextItalic,
        });
        const seg3d = segs2d.map((s) => {
          const p1 = anchorPt.clone().addScaledVector(t1, s.x1).addScaledVector(t2, s.y1);
          const p2 = anchorPt.clone().addScaledVector(t1, s.x2).addScaledVector(t2, s.y2);
          return { x1: p1.x, y1: p1.y, z1: p1.z, x2: p2.x, y2: p2.y, z2: p2.z };
        });
        commitSketchTextEntities(seg3d);
      })
      .catch(() => {
        setStatusMessage('Sketch Text: font failed to load - check /fonts/Roboto-Regular.ttf');
      });
    return true;
  }

  const isLineToolActive =
    activeTool === 'line' || activeTool === 'construction-line' || activeTool === 'centerline';
  if (isLineToolActive && lineArcModeRef.current && drawingPoints.length >= 1) {
    const startPt = drawingPoints[0];
    const endPtWorld = point;
    const lastEnt = useCADStore.getState().activeSketch?.entities.at(-1);
    let tangentDir: THREE.Vector3;
    if (
      lastEnt &&
      (lastEnt.type === 'line' || lastEnt.type === 'construction-line' || lastEnt.type === 'centerline') &&
      lastEnt.points.length >= 2
    ) {
      const a = lastEnt.points[0];
      const b = lastEnt.points[lastEnt.points.length - 1];
      tangentDir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    } else if (lastEnt && lastEnt.type === 'arc') {
      const c = lastEnt.points[0];
      const r = lastEnt.radius || 1;
      const ea = lastEnt.endAngle ?? Math.PI;
      const radial = new THREE.Vector3(
        t1.x * Math.cos(ea) + t2.x * Math.sin(ea),
        t1.y * Math.cos(ea) + t2.y * Math.sin(ea),
        t1.z * Math.cos(ea) + t2.z * Math.sin(ea),
      );
      const endPtArc = { x: c.x + radial.x * r, y: c.y + radial.y * r, z: c.z + radial.z * r };
      const distToEnd = new THREE.Vector3(endPtArc.x - startPt.x, endPtArc.y - startPt.y, endPtArc.z - startPt.z).length();
      tangentDir = distToEnd < 1
        ? radial.clone().cross(t1.clone().cross(t2).normalize()).normalize()
        : endPtWorld.clone().sub(new THREE.Vector3(startPt.x, startPt.y, startPt.z)).normalize();
    } else {
      tangentDir = endPtWorld.clone().sub(new THREE.Vector3(startPt.x, startPt.y, startPt.z)).normalize();
    }

    const planeNormal = t1.clone().cross(t2).normalize();
    const normalInPlane = tangentDir.clone().cross(planeNormal).normalize();
    const chord = new THREE.Vector3(endPtWorld.x - startPt.x, endPtWorld.y - startPt.y, endPtWorld.z - startPt.z);
    const chordLenSq = chord.lengthSq();
    const projOnNormal = chord.dot(normalInPlane);
    if (Math.abs(projOnNormal) < 1e-5 || chordLenSq < 0.001) {
      setStatusMessage('Tangent arc too short - click further away');
      return true;
    }

    const d = chordLenSq / (2 * projOnNormal);
    const cx = startPt.x + normalInPlane.x * d;
    const cy = startPt.y + normalInPlane.y * d;
    const cz = startPt.z + normalInPlane.z * d;
    const arcRadius = Math.abs(d);
    const toStart = new THREE.Vector3(startPt.x - cx, startPt.y - cy, startPt.z - cz);
    const toEnd = new THREE.Vector3(endPtWorld.x - cx, endPtWorld.y - cy, endPtWorld.z - cz);
    addSketchEntity({
      id: crypto.randomUUID(),
      type: 'arc',
      points: [{ id: crypto.randomUUID(), x: cx, y: cy, z: cz }],
      radius: arcRadius,
      startAngle: Math.atan2(toStart.dot(t2), toStart.dot(t1)),
      endAngle: Math.atan2(toEnd.dot(t2), toEnd.dot(t1)),
      isConstruction: drawingConstructionRef.current || undefined,
    });
    setDrawingPoints([{ id: crypto.randomUUID(), x: endPtWorld.x, y: endPtWorld.y, z: endPtWorld.z }]);
    setStatusMessage(
      `Tangent arc added (r=${arcRadius.toFixed(2)})${drawingConstructionRef.current ? ' [CONSTRUCTION]' : ''} - click next point`,
    );
    return true;
  }

  if (activeTool === 'isoparametric') {
    const dir: 'u' | 'v' = shiftKey ? 'v' : 'u';
    const isoValue = dir === 'u' ? point.dot(t1) : point.dot(t2);
    const along = dir === 'u' ? t2 : t1;
    const fixed = dir === 'u' ? t1 : t2;
    const base = fixed.clone().multiplyScalar(isoValue);
    const p1World = base.clone().addScaledVector(along, -500);
    const p2World = base.clone().addScaledVector(along, 500);
    addSketchEntity({
      id: crypto.randomUUID(),
      type: 'isoparametric',
      points: [
        { id: crypto.randomUUID(), x: p1World.x, y: p1World.y, z: p1World.z },
        { id: crypto.randomUUID(), x: p2World.x, y: p2World.y, z: p2World.z },
      ],
      isConstruction: true,
      isoParamDir: dir,
      isoParamValue: isoValue,
    });
    setStatusMessage(
      `Iso Curve (${dir.toUpperCase()}) placed at ${isoValue.toFixed(2)} - click again for another, Shift+click for V direction`,
    );
    return true;
  }

  return false;
}
