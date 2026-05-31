import * as THREE from 'three';
import { useCADStore } from '../../../../../store/cadStore';
import { circumcenter2D } from '../helpers';
import { ccwArcToCursor, ccwArcThrough, ccwArcTangent, sampleCcwArc } from '../arcAngles';
import type { SketchPreviewHelpers } from './types';

export function renderBasicShapePreview(activeTool: string, h: SketchPreviewHelpers): boolean {
  const {
    start,
    startV,
    mousePos,
    activeSketch,
    drawingPoints,
    isDraggingArc,
    lineMat,
    constructionMat,
    centerlineMat,
    t1,
    t2,
    addLine,
    circlePoints,
  } = h;

  switch (activeTool) {
    case 'line':
    case 'construction-line':
    case 'centerline': {
      const currentLineMat: THREE.LineBasicMaterial | THREE.LineDashedMaterial =
        activeTool === 'construction-line'
          ? constructionMat
          : activeTool === 'centerline'
            ? centerlineMat
            : lineMat;

      if (isDraggingArc && drawingPoints.length > 0) {
        const sk = useCADStore.getState().activeSketch;
        const lastEntity = sk?.entities[sk.entities.length - 1];
        let tangentDir: THREE.Vector3;
        if (
          lastEntity &&
          (lastEntity.type === 'line' ||
            lastEntity.type === 'construction-line' ||
            lastEntity.type === 'centerline')
        ) {
          const a = lastEntity.points[0];
          const b = lastEntity.points[lastEntity.points.length - 1];
          tangentDir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
        } else {
          tangentDir = mousePos.clone().sub(startV).normalize();
        }
        const planeNormal = t1.clone().cross(t2).normalize();
        const normalInPlane = tangentDir.clone().cross(planeNormal).normalize();
        const chord = mousePos.clone().sub(startV);
        const chordLenSq = chord.lengthSq();
        const projected = chord.dot(normalInPlane);
        if (Math.abs(projected) > 1e-5 && chordLenSq > 0.001) {
          const radius = chordLenSq / (2 * projected);
          const arcCenter = startV.clone().addScaledVector(normalInPlane, radius);
          const arcRadius = Math.abs(radius);
          const toStart = startV.clone().sub(arcCenter);
          const toEnd = mousePos.clone().sub(arcCenter);
          // Match the dragged-tangent-arc commit: orient so the arc leaves the
          // junction smoothly (no cusp) and the preview matches the committed arc.
          const { startAngle, endAngle } = ccwArcTangent(
            Math.atan2(toStart.dot(t2), toStart.dot(t1)),
            Math.atan2(toEnd.dot(t2), toEnd.dot(t1)),
            t1, t2, tangentDir,
          );
          addLine(sampleCcwArc(arcCenter, arcRadius, startAngle, endAngle, t1, t2));
        } else {
          addLine([startV, mousePos], currentLineMat);
        }
        return true;
      }

      addLine([startV, mousePos], currentLineMat);
      const lineDelta = mousePos.clone().sub(startV);
      const lineLen = lineDelta.length();
      if (lineLen > 0.001) {
        const lineAngle = Math.atan2(lineDelta.dot(t2), lineDelta.dot(t1));
        const arcRadius = Math.min(lineLen * 0.25, 1.5);
        const arcPts: THREE.Vector3[] = [];
        for (let i = 0; i <= 24; i++) {
          const angle = (i / 24) * lineAngle;
          arcPts.push(
            startV
              .clone()
              .addScaledVector(t1, Math.cos(angle) * arcRadius)
              .addScaledVector(t2, Math.sin(angle) * arcRadius),
          );
        }
        addLine(arcPts);
        addLine([startV, startV.clone().addScaledVector(t1, arcRadius)]);
      }
      return true;
    }

    case 'midpoint-line': {
      const otherEnd = startV.clone().multiplyScalar(2).sub(mousePos);
      addLine([mousePos, otherEnd]);
      const crossSize = 0.3;
      addLine([startV.clone().addScaledVector(t1, -crossSize), startV.clone().addScaledVector(t1, crossSize)]);
      addLine([startV.clone().addScaledVector(t2, -crossSize), startV.clone().addScaledVector(t2, crossSize)]);
      return true;
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
      return true;
    }

    case 'circle': {
      addLine(circlePoints(startV, mousePos.distanceTo(startV)));
      addLine([startV, mousePos]);
      return true;
    }

    case 'arc': {
      if (drawingPoints.length === 1) {
        const radius = mousePos.distanceTo(startV);
        // Always draw a small crosshair at the center so the placed point is
        // visible immediately after the first click (before cursor movement).
        const cross = 0.4;
        addLine([startV.clone().addScaledVector(t1, -cross), startV.clone().addScaledVector(t1, cross)]);
        addLine([startV.clone().addScaledVector(t2, -cross), startV.clone().addScaledVector(t2, cross)]);
        if (radius > 0.01) {
          addLine([startV, mousePos]);
          addLine(circlePoints(startV, radius));
        }
      } else if (drawingPoints.length === 2) {
        const startPt = drawingPoints[1];
        const startVec = new THREE.Vector3(startPt.x, startPt.y, startPt.z);
        const radius = startVec.distanceTo(startV);
        const d1 = startVec.clone().sub(startV);
        const d2 = mousePos.clone().sub(startV);
        // Same minor-arc-toward-cursor logic + CCW sampling as the commit handler,
        // so the preview matches the committed arc exactly.
        const { startAngle, endAngle } = ccwArcToCursor(
          Math.atan2(d1.dot(t2), d1.dot(t1)),
          Math.atan2(d2.dot(t2), d2.dot(t1)),
        );
        addLine(sampleCcwArc(startV, radius, startAngle, endAngle, t1, t2));
        addLine([startV, startVec]);
        addLine([startV, mousePos.clone().sub(startV).normalize().multiplyScalar(radius).add(startV)]);
      }
      return true;
    }

    case 'rectangle-center': {
      const delta = mousePos.clone().sub(startV);
      const du = delta.dot(t1);
      const dv = delta.dot(t2);
      const corners = [
        startV.clone().addScaledVector(t1, -du).addScaledVector(t2, -dv),
        startV.clone().addScaledVector(t1, du).addScaledVector(t2, -dv),
        startV.clone().addScaledVector(t1, du).addScaledVector(t2, dv),
        startV.clone().addScaledVector(t1, -du).addScaledVector(t2, dv),
      ];
      addLine([...corners, corners[0]]);
      addLine([startV, mousePos]);
      return true;
    }

    case 'circle-2point': {
      const midV = startV.clone().add(mousePos).multiplyScalar(0.5);
      addLine(circlePoints(midV, mousePos.distanceTo(startV) / 2));
      addLine([startV, mousePos]);
      return true;
    }

    case 'circle-3point': {
      addLine([startV, mousePos]);
      if (drawingPoints.length === 2) {
        const cc = circumcenter2D(
          { x: drawingPoints[0].x, y: drawingPoints[0].y, z: drawingPoints[0].z },
          { x: drawingPoints[1].x, y: drawingPoints[1].y, z: drawingPoints[1].z },
          { x: mousePos.x, y: mousePos.y, z: mousePos.z },
          t1,
          t2,
        );
        if (cc) addLine(circlePoints(new THREE.Vector3(cc.center.x, cc.center.y, cc.center.z), cc.radius));
      }
      return true;
    }

    case 'arc-3point': {
      // Step 1 (start placed, cursor → end): rubber-band LINE + a gentle bow arc so the
      // user can see they're drawing an arc.  Through-point defaults to the perpendicular
      // midpoint (quarter-chord offset) giving a natural-looking preview.
      if (drawingPoints.length === 1) {
        const chord = mousePos.clone().sub(startV);
        const chordLen = chord.length();
        addLine([startV, mousePos]);
        if (chordLen > 0.1) {
          // Perpendicular to chord in the sketch plane: rotate chord 90° via t1/t2.
          const du = chord.dot(t1);
          const dv = chord.dot(t2);
          const perpWorld = t1.clone().multiplyScalar(-dv).add(t2.clone().multiplyScalar(du)).normalize();
          const midPt = startV.clone().add(mousePos).multiplyScalar(0.5);
          const throughPt = midPt.clone().addScaledVector(perpWorld, chordLen * 0.25);
          const cc = circumcenter2D(
            { x: startV.x, y: startV.y, z: startV.z },
            { x: throughPt.x, y: throughPt.y, z: throughPt.z },
            { x: mousePos.x, y: mousePos.y, z: mousePos.z },
            t1, t2,
          );
          if (cc) {
            const center = new THREE.Vector3(cc.center.x, cc.center.y, cc.center.z);
            const d1 = startV.clone().sub(center);
            const dMid = throughPt.clone().sub(center);
            const d3 = mousePos.clone().sub(center);
            const { startAngle, endAngle } = ccwArcThrough(
              Math.atan2(d1.dot(t2), d1.dot(t1)),
              Math.atan2(dMid.dot(t2), dMid.dot(t1)),
              Math.atan2(d3.dot(t2), d3.dot(t1)),
            );
            addLine(sampleCcwArc(center, cc.radius, startAngle, endAngle, t1, t2));
          }
        }
      }
      // Step 2 (start + end placed, cursor → through-point / curvature control):
      // show live arc with cursor as the through-point — matches the commit handler.
      if (drawingPoints.length === 2) {
        const endPt = drawingPoints[1];
        const endV  = new THREE.Vector3(endPt.x, endPt.y, endPt.z);
        addLine([endV, mousePos]);
        const cc = circumcenter2D(
          { x: drawingPoints[0].x, y: drawingPoints[0].y, z: drawingPoints[0].z },
          { x: mousePos.x, y: mousePos.y, z: mousePos.z },            // cursor = through-point
          { x: endPt.x, y: endPt.y, z: endPt.z },
          t1, t2,
        );
        if (cc) {
          const center = new THREE.Vector3(cc.center.x, cc.center.y, cc.center.z);
          const d1   = new THREE.Vector3(drawingPoints[0].x - cc.center.x, drawingPoints[0].y - cc.center.y, drawingPoints[0].z - cc.center.z);
          const dMid = mousePos.clone().sub(center);                   // through-point = cursor
          const d3   = endV.clone().sub(center);
          const { startAngle, endAngle } = ccwArcThrough(
            Math.atan2(d1.dot(t2), d1.dot(t1)),
            Math.atan2(dMid.dot(t2), dMid.dot(t1)),
            Math.atan2(d3.dot(t2), d3.dot(t1)),
          );
          addLine(sampleCcwArc(center, cc.radius, startAngle, endAngle, t1, t2));
        }
      }
      return true;
    }
  }

  void activeSketch;
  void start;
  return false;
}
