import * as THREE from 'three';
import type { SketchPreviewHelpers } from './types';

export function renderEllipsePreview(activeTool: string, h: SketchPreviewHelpers): boolean {
  const { start, startV, mousePos, drawingPoints, t1, t2, addLine } = h;

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

  switch (activeTool) {
    case 'ellipse': {
      if (drawingPoints.length === 1) {
        addLine([startV, mousePos]);
      } else if (drawingPoints.length === 2) {
        const majorPt = drawingPoints[1];
        const majorVec = new THREE.Vector3(majorPt.x - start.x, majorPt.y - start.y, majorPt.z - start.z);
        const majorLen = majorVec.length();
        if (majorLen > 0.001) {
          const majorDir = majorVec.clone().normalize();
          const pn = t1.clone().cross(t2).normalize();
          const minorDir = majorDir.clone().cross(pn).normalize();
          const minorLen = Math.abs(mousePos.clone().sub(startV).dot(minorDir));
          const rotation = Math.atan2(majorDir.dot(t2), majorDir.dot(t1));
          addLine(buildEllipse(majorLen, minorLen, rotation));
          const majorV = new THREE.Vector3(majorPt.x, majorPt.y, majorPt.z);
          addLine([startV, majorV]);
          addLine([
            startV,
            startV.clone().addScaledVector(t1, minorDir.dot(t1) * minorLen).addScaledVector(t2, minorDir.dot(t2) * minorLen),
          ]);
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
          const pn = t1.clone().cross(t2).normalize();
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
          const pn = t1.clone().cross(t2).normalize();
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
