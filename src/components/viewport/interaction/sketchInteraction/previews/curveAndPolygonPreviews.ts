import * as THREE from 'three';
import { circumcenter2D, findBlendEndpoint, sampleCubicBezier } from '../helpers';
import type { SketchPreviewHelpers } from './types';

const BLEND_PREVIEW_SAMPLES = Array.from({ length: 33 }, () => new THREE.Vector3());
const blendP0 = new THREE.Vector3();
const blendTanRef = new THREE.Vector3();
const blendTangentA = new THREE.Vector3();
const blendP3 = new THREE.Vector3();
const blendTangentB = new THREE.Vector3();

export function renderCurveAndPolygonPreview(activeTool: string, h: SketchPreviewHelpers): boolean {
  const {
    start,
    startV,
    mousePos,
    activeSketch,
    drawingPoints,
    t1,
    t2,
    conicRho,
    addLine,
    circlePoints,
  } = h;

  switch (activeTool) {
    case 'conic': {
      if (drawingPoints.length === 1) {
        addLine([startV, mousePos]);
      } else if (drawingPoints.length === 2) {
        const p0 = startV;
        const p2 = new THREE.Vector3(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z);
        const p1 = mousePos;
        const w = conicRho / (1 - conicRho);
        const previewPts: THREE.Vector3[] = [];
        for (let i = 0; i <= 32; i++) {
          const t = i / 32;
          const b0 = (1 - t) * (1 - t);
          const b1 = 2 * t * (1 - t) * w;
          const b2 = t * t;
          const d = b0 + b1 + b2;
          previewPts.push(
            new THREE.Vector3(
              (b0 * p0.x + b1 * p1.x + b2 * p2.x) / d,
              (b0 * p0.y + b1 * p1.y + b2 * p2.y) / d,
              (b0 * p0.z + b1 * p1.z + b2 * p2.z) / d,
            ),
          );
        }
        addLine(previewPts);
        addLine([p0, p1]);
        addLine([p2, p1]);
      }
      return true;
    }

    case 'polygon':
    case 'polygon-inscribed': {
      const radius = mousePos.distanceTo(startV);
      const polyPts: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        polyPts.push(
          startV
            .clone()
            .addScaledVector(t1, Math.cos(angle) * radius)
            .addScaledVector(t2, Math.sin(angle) * radius),
        );
      }
      addLine(polyPts);
      addLine([startV, mousePos]);
      return true;
    }

    case 'polygon-circumscribed': {
      const apothem = mousePos.distanceTo(startV);
      const radius = apothem / Math.cos(Math.PI / 6);
      const polyPts: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        polyPts.push(
          startV
            .clone()
            .addScaledVector(t1, Math.cos(angle) * radius)
            .addScaledVector(t2, Math.sin(angle) * radius),
        );
      }
      addLine(polyPts);
      addLine([startV, mousePos]);
      return true;
    }

    case 'polygon-edge': {
      if (drawingPoints.length === 1) {
        const edgeVec = mousePos.clone().sub(startV);
        const edgeLen = edgeVec.length();
        const radius = edgeLen / (2 * Math.sin(Math.PI / 6));
        const apothem = edgeLen / (2 * Math.tan(Math.PI / 6));
        const edgeDir = edgeVec.clone().normalize();
        const planeNormal = t1.clone().cross(t2);
        const perpDir = edgeDir.clone().cross(planeNormal).normalize();
        const midV = startV.clone().add(mousePos).multiplyScalar(0.5);
        const centerV = midV.clone().addScaledVector(perpDir, apothem);
        const toP1 = startV.clone().sub(centerV);
        const startAngle = Math.atan2(toP1.dot(t2), toP1.dot(t1));
        const polyPts: THREE.Vector3[] = [];
        for (let i = 0; i <= 6; i++) {
          const angle = startAngle + (i / 6) * Math.PI * 2;
          polyPts.push(
            centerV
              .clone()
              .addScaledVector(t1, Math.cos(angle) * radius)
              .addScaledVector(t2, Math.sin(angle) * radius),
          );
        }
        addLine(polyPts);
        addLine([startV, mousePos]);
      }
      return true;
    }

    case 'spline': {
      if (drawingPoints.length === 0) {
        addLine([startV, mousePos]);
      } else {
        const pts3d = drawingPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
        pts3d.push(mousePos.clone());
        addLine(new THREE.CatmullRomCurve3(pts3d).getPoints(Math.max(50, pts3d.length * 8)));
        for (const cp of drawingPoints) {
          const cv = new THREE.Vector3(cp.x, cp.y, cp.z);
          addLine([cv.clone().addScaledVector(t1, 0.15), cv.clone().addScaledVector(t1, -0.15)]);
          addLine([cv.clone().addScaledVector(t2, 0.15), cv.clone().addScaledVector(t2, -0.15)]);
        }
      }
      return true;
    }

    case 'spline-control': {
      if (drawingPoints.length === 0) {
        addLine([startV, mousePos]);
      } else {
        const pts3d = drawingPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
        pts3d.push(mousePos.clone());
        addLine(new THREE.CatmullRomCurve3(pts3d, false, 'catmullrom', 0).getPoints(Math.max(50, pts3d.length * 16)));
        addLine(pts3d);
        for (const cp of drawingPoints) {
          const cv = new THREE.Vector3(cp.x, cp.y, cp.z);
          const sq = 0.12;
          const c0 = cv.clone().addScaledVector(t1, sq).addScaledVector(t2, sq);
          const c1 = cv.clone().addScaledVector(t1, -sq).addScaledVector(t2, sq);
          const c2 = cv.clone().addScaledVector(t1, -sq).addScaledVector(t2, -sq);
          const c3 = cv.clone().addScaledVector(t1, sq).addScaledVector(t2, -sq);
          addLine([c0, c1, c2, c3, c0]);
        }
      }
      return true;
    }

    case 'blend-curve': {
      if (drawingPoints.length >= 2) {
        blendP0.set(drawingPoints[0].x, drawingPoints[0].y, drawingPoints[0].z);
        blendTanRef.set(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z);
        blendTangentA.subVectors(blendTanRef, blendP0).normalize();
        blendP3.copy(mousePos);
        blendTangentB.subVectors(mousePos, blendP0).normalize();
        if (activeSketch) {
          const hit = findBlendEndpoint(mousePos, activeSketch);
          if (hit) {
            blendP3.copy(hit.endpoint);
            blendTangentB.copy(hit.tangent);
          }
        }
        addLine(sampleCubicBezier(blendP0, blendTangentA, blendP3, blendTangentB, 32, BLEND_PREVIEW_SAMPLES));
        addLine([blendP0.clone().addScaledVector(t1, 0.2), blendP0.clone().addScaledVector(t1, -0.2)]);
        addLine([blendP0.clone().addScaledVector(t2, 0.2), blendP0.clone().addScaledVector(t2, -0.2)]);
      }
      return true;
    }

    case 'slot-3point-arc': {
      if (drawingPoints.length < 2) {
        const lastPt = drawingPoints[drawingPoints.length - 1];
        addLine([new THREE.Vector3(lastPt.x, lastPt.y, lastPt.z), mousePos]);
      } else if (drawingPoints.length === 2) {
        const cc = circumcenter2D(drawingPoints[0], drawingPoints[1], { x: mousePos.x, y: mousePos.y, z: mousePos.z }, t1, t2);
        if (cc) {
          const center = new THREE.Vector3(cc.center.x, cc.center.y, cc.center.z);
          const d0 = new THREE.Vector3(drawingPoints[0].x - cc.center.x, drawingPoints[0].y - cc.center.y, drawingPoints[0].z - cc.center.z);
          const d2 = new THREE.Vector3(drawingPoints[1].x - cc.center.x, drawingPoints[1].y - cc.center.y, drawingPoints[1].z - cc.center.z);
          const sa = Math.atan2(d0.dot(t2), d0.dot(t1));
          const ea = Math.atan2(d2.dot(t2), d2.dot(t1));
          const arcPts: THREE.Vector3[] = [];
          for (let i = 0; i <= 48; i++) {
            const angle = sa + (i / 48) * (ea - sa);
            arcPts.push(center.clone().addScaledVector(t1, Math.cos(angle) * cc.radius).addScaledVector(t2, Math.sin(angle) * cc.radius));
          }
          addLine(arcPts);
        } else {
          addLine([new THREE.Vector3(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z), mousePos]);
        }
      } else {
        const cc = circumcenter2D(drawingPoints[0], drawingPoints[2], drawingPoints[1], t1, t2);
        if (cc) {
          const center = new THREE.Vector3(cc.center.x, cc.center.y, cc.center.z);
          const halfWidth = Math.abs(new THREE.Vector3(mousePos.x - cc.center.x, mousePos.y - cc.center.y, mousePos.z - cc.center.z).length() - cc.radius);
          if (halfWidth > 0.001) {
            addLine(circlePoints(center, cc.radius + halfWidth));
            if (cc.radius > halfWidth) addLine(circlePoints(center, cc.radius - halfWidth));
          }
        }
      }
      return true;
    }

    case 'slot-center-arc': {
      if (drawingPoints.length < 2) {
        const lastPt = drawingPoints[drawingPoints.length - 1];
        addLine([new THREE.Vector3(lastPt.x, lastPt.y, lastPt.z), mousePos]);
      } else if (drawingPoints.length === 2) {
        const centerPt = drawingPoints[0];
        const p0 = drawingPoints[1];
        const radius = new THREE.Vector3(p0.x - centerPt.x, p0.y - centerPt.y, p0.z - centerPt.z).length();
        const center = new THREE.Vector3(centerPt.x, centerPt.y, centerPt.z);
        const d0 = new THREE.Vector3(p0.x - centerPt.x, p0.y - centerPt.y, p0.z - centerPt.z);
        const dM = mousePos.clone().sub(center);
        const sa = Math.atan2(d0.dot(t2), d0.dot(t1));
        const ea = Math.atan2(dM.dot(t2), dM.dot(t1));
        const arcPts: THREE.Vector3[] = [];
        for (let i = 0; i <= 48; i++) {
          const angle = sa + (i / 48) * (ea - sa);
          arcPts.push(center.clone().addScaledVector(t1, Math.cos(angle) * radius).addScaledVector(t2, Math.sin(angle) * radius));
        }
        addLine(arcPts);
      } else {
        const centerPt = drawingPoints[0];
        const p0 = drawingPoints[1];
        const radius = new THREE.Vector3(p0.x - centerPt.x, p0.y - centerPt.y, p0.z - centerPt.z).length();
        const center = new THREE.Vector3(centerPt.x, centerPt.y, centerPt.z);
        const halfWidth = Math.abs(mousePos.clone().sub(center).length() - radius);
        if (halfWidth > 0.001) {
          addLine(circlePoints(center, radius + halfWidth));
          if (radius > halfWidth) addLine(circlePoints(center, radius - halfWidth));
        }
      }
      return true;
    }
  }

  void start;
  return false;
}
