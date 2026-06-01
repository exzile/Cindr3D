import * as THREE from 'three';
import type { SketchPreviewHelpers } from './types';

export function renderEllipsePreview(activeTool: string, h: SketchPreviewHelpers): boolean {
  const { start, startV, mousePos, drawingPoints, t1, t2, addLine, circlePoints, constructionMat } = h;

  const buildEllipse = (
    majorLen: number,
    minorLen: number,
    rotation: number,
    uptoAngle = Math.PI * 2,
  ) => {
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const tt = (i / 64) * uptoAngle;
      const u = majorLen * Math.cos(tt) * cosR - minorLen * Math.sin(tt) * sinR;
      const v = majorLen * Math.cos(tt) * sinR + minorLen * Math.sin(tt) * cosR;
      pts.push(startV.clone().addScaledVector(t1, u).addScaledVector(t2, v));
    }
    return pts;
  };

  const pn = t1.clone().cross(t2).normalize();
  // Full-diameter axis line through the centre (Fusion shows axes both ways).
  const axisLine = (dir: THREE.Vector3, len: number) =>
    [startV.clone().addScaledVector(dir, -len), startV.clone().addScaledVector(dir, len)];

  switch (activeTool) {
    case 'ellipse': {
      if (drawingPoints.length === 1) {
        // Step 1 — "Place first axis point": defining the major axis. Show the
        // full major axis through the centre, a dashed reference circle (radius =
        // major), and a dashed perpendicular guide for the minor direction.
        const majorVec = mousePos.clone().sub(startV);
        const majorLen = majorVec.length();
        if (majorLen > 0.001) {
          const majorDir = majorVec.clone().normalize();
          const minorDir = majorDir.clone().cross(pn).normalize();
          addLine(circlePoints(startV, majorLen), constructionMat);
          addLine(axisLine(majorDir, majorLen));
          addLine(axisLine(minorDir, majorLen * 0.6), constructionMat);
        } else {
          addLine([startV, mousePos]);
        }
      } else if (drawingPoints.length === 2) {
        // Step 2 — "Place point on ellipse": defining the minor axis. Show the
        // reference circle, both axes, and the live ellipse.
        const majorPt = drawingPoints[1];
        const majorVec = new THREE.Vector3(majorPt.x - start.x, majorPt.y - start.y, majorPt.z - start.z);
        const majorLen = majorVec.length();
        if (majorLen > 0.001) {
          const majorDir = majorVec.clone().normalize();
          const minorDir = majorDir.clone().cross(pn).normalize();
          const minorLen = Math.abs(mousePos.clone().sub(startV).dot(minorDir));
          const rotation = Math.atan2(majorDir.dot(t2), majorDir.dot(t1));
          addLine(circlePoints(startV, majorLen), constructionMat);
          addLine(buildEllipse(majorLen, minorLen, rotation));
          addLine(axisLine(majorDir, majorLen));
          if (minorLen > 0.001) addLine(axisLine(minorDir, minorLen), constructionMat);
        }
      }
      return true;
    }

    case 'elliptical-arc': {
      if (drawingPoints.length === 1) {
        addLine([startV, mousePos]);
      } else if (drawingPoints.length === 2) {
        const majorPt = drawingPoints[1];
        const majorVec = new THREE.Vector3(majorPt.x - start.x, majorPt.y - start.y, majorPt.z - start.z);
        const majorLen = majorVec.length();
        if (majorLen > 0.001) {
          const majorDir = majorVec.clone().normalize();
          const minorDir = majorDir.clone().cross(pn).normalize();
          const minorLen = Math.abs(mousePos.clone().sub(startV).dot(minorDir));
          const rotation = Math.atan2(majorDir.dot(t2), majorDir.dot(t1));
          addLine(buildEllipse(majorLen, minorLen, rotation));
          addLine([startV, new THREE.Vector3(majorPt.x, majorPt.y, majorPt.z)]);
        }
      } else if (drawingPoints.length === 3) {
        const majorPt = drawingPoints[1];
        const majorVec = new THREE.Vector3(majorPt.x - start.x, majorPt.y - start.y, majorPt.z - start.z);
        const majorLen = majorVec.length();
        if (majorLen > 0.001) {
          const majorDir = majorVec.clone().normalize();
          const minorDir = majorDir.clone().cross(pn).normalize();
          const to3 = new THREE.Vector3(
            drawingPoints[2].x - start.x,
            drawingPoints[2].y - start.y,
            drawingPoints[2].z - start.z,
          );
          const minorLen = Math.abs(to3.dot(minorDir));
          if (minorLen > 0.001) {
            const rotation = Math.atan2(majorDir.dot(t2), majorDir.dot(t1));
            const endAngle = Math.atan2(mousePos.clone().sub(startV).dot(minorDir), mousePos.clone().sub(startV).dot(majorDir));
            addLine(buildEllipse(majorLen, minorLen, rotation, endAngle));
            addLine([startV, mousePos]);
          }
        }
      }
      return true;
    }
  }

  return false;
}
