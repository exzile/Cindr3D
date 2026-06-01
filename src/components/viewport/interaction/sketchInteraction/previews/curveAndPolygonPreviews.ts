import * as THREE from 'three';
import { circumcenter2D, findBlendEndpoint, sampleCubicBezier } from '../helpers';
import { polygonVertexPositions, polygonLoop } from '../polygonGeometry';
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
    polygonSides,
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
      // Cursor is a VERTEX: size = distance, orientation = cursor angle.
      const cursorDist = mousePos.distanceTo(startV);
      const d = mousePos.clone().sub(startV);
      const baseAngle = Math.atan2(d.dot(t2), d.dot(t1));
      const verts = polygonVertexPositions(startV, cursorDist, polygonSides, baseAngle, 'inscribed', t1, t2);
      // Fusion draws the reference circle: for inscribed it passes through the vertices.
      if (cursorDist > 0.01) addLine(circlePoints(startV, cursorDist));
      addLine(polygonLoop(verts));
      addLine([startV, mousePos]);
      return true;
    }

    case 'polygon-circumscribed': {
      // Cursor is an EDGE MIDPOINT: apothem = distance, orientation = cursor angle.
      const apothem = mousePos.distanceTo(startV);
      const d = mousePos.clone().sub(startV);
      const baseAngle = Math.atan2(d.dot(t2), d.dot(t1));
      const verts = polygonVertexPositions(startV, apothem, polygonSides, baseAngle, 'circumscribed', t1, t2);
      // Fusion draws the reference circle: for circumscribed it is the INSCRIBED circle,
      // tangent to every edge (radius = apothem). The vertices poke outside it.
      if (apothem > 0.01) addLine(circlePoints(startV, apothem));
      addLine(polygonLoop(verts));
      addLine([startV, mousePos]);
      return true;
    }

    case 'polygon-edge': {
      if (drawingPoints.length === 1) {
        const edgeVec = mousePos.clone().sub(startV);
        const edgeLen = edgeVec.length();
        const radius = edgeLen / (2 * Math.sin(Math.PI / polygonSides));
        const apothem = edgeLen / (2 * Math.tan(Math.PI / polygonSides));
        const edgeDir = edgeVec.clone().normalize();
        const planeNormal = t1.clone().cross(t2);
        const perpDir = edgeDir.clone().cross(planeNormal).normalize();
        const midV = startV.clone().add(mousePos).multiplyScalar(0.5);
        const centerV = midV.clone().addScaledVector(perpDir, apothem);
        const toP1 = startV.clone().sub(centerV);
        const startAngle = Math.atan2(toP1.dot(t2), toP1.dot(t1));
        const polyPts: THREE.Vector3[] = [];
        for (let i = 0; i <= polygonSides; i++) {
          const angle = startAngle + (i / polygonSides) * Math.PI * 2;
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

    case 'slot':
    case 'slot-center': {
      if (drawingPoints.length === 1) {
        // Axis preview: c1 → cursor
        addLine([startV, mousePos]);
      } else if (drawingPoints.length === 2) {
        // Full slot outline + dashed centerline
        const c1 = startV;
        const c2 = new THREE.Vector3(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z);
        const axisVec = c2.clone().sub(c1);
        if (axisVec.length() < 0.001) return true;
        const axisDir = axisVec.clone().normalize();
        const planeNormal = t1.clone().cross(t2).normalize();
        const perpDir = axisDir.clone().cross(planeNormal).normalize();
        const halfWidth = Math.abs(mousePos.clone().sub(c1).dot(perpDir));
        if (halfWidth < 0.001) return true;
        addLine([c1.clone().addScaledVector(perpDir, halfWidth), c2.clone().addScaledVector(perpDir, halfWidth)]);
        addLine([c1.clone().addScaledVector(perpDir, -halfWidth), c2.clone().addScaledVector(perpDir, -halfWidth)]);
        const axisAngle = Math.atan2(axisDir.dot(t2), axisDir.dot(t1));
        const CAP_SEGS = 24;
        const cap1Pts: THREE.Vector3[] = [];
        const cap2Pts: THREE.Vector3[] = [];
        for (let i = 0; i <= CAP_SEGS; i++) {
          const a1 = axisAngle + Math.PI / 2 + (i / CAP_SEGS) * Math.PI;
          cap1Pts.push(c1.clone().addScaledVector(t1, Math.cos(a1) * halfWidth).addScaledVector(t2, Math.sin(a1) * halfWidth));
          const a2 = axisAngle - Math.PI / 2 + (i / CAP_SEGS) * Math.PI;
          cap2Pts.push(c2.clone().addScaledVector(t1, Math.cos(a2) * halfWidth).addScaledVector(t2, Math.sin(a2) * halfWidth));
        }
        addLine(cap1Pts);
        addLine(cap2Pts);
        addLine([c1.clone(), c2.clone()], h.centerlineMat);
      }
      return true;
    }

    case 'slot-center-point': {
      if (drawingPoints.length === 1) {
        // Show axis from mid → cursor (one half-length)
        addLine([startV, mousePos]);
      } else if (drawingPoints.length === 2) {
        // Full slot outline symmetric about startV, + dashed centerline
        const mid = startV;
        const endPt = new THREE.Vector3(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z);
        const half = endPt.clone().sub(mid);
        const halfLen = half.length();
        if (halfLen < 0.001) return true;
        const axisDir = half.clone().normalize();
        const planeNormal = t1.clone().cross(t2).normalize();
        const perpDir = axisDir.clone().cross(planeNormal).normalize();
        const halfWidth = Math.abs(mousePos.clone().sub(mid).dot(perpDir));
        if (halfWidth < 0.001) return true;
        // c1 = endPt (forward cap), c2 = mirror across mid (backward cap)
        const c1 = endPt.clone();
        const c2 = mid.clone().addScaledVector(axisDir, -halfLen);
        addLine([c1.clone().addScaledVector(perpDir, halfWidth), c2.clone().addScaledVector(perpDir, halfWidth)]);
        addLine([c1.clone().addScaledVector(perpDir, -halfWidth), c2.clone().addScaledVector(perpDir, -halfWidth)]);
        const axisAngle = Math.atan2(axisDir.dot(t2), axisDir.dot(t1));
        const CAP_SEGS = 24;
        const cap1Pts: THREE.Vector3[] = [];
        const cap2Pts: THREE.Vector3[] = [];
        for (let i = 0; i <= CAP_SEGS; i++) {
          // c1 is +axisDir end: cap faces forward (axisAngle-π/2 → axisAngle+π/2)
          const a1 = axisAngle - Math.PI / 2 + (i / CAP_SEGS) * Math.PI;
          cap1Pts.push(c1.clone().addScaledVector(t1, Math.cos(a1) * halfWidth).addScaledVector(t2, Math.sin(a1) * halfWidth));
          // c2 is -axisDir end: cap faces backward (axisAngle+π/2 → axisAngle+3π/2)
          const a2 = axisAngle + Math.PI / 2 + (i / CAP_SEGS) * Math.PI;
          cap2Pts.push(c2.clone().addScaledVector(t1, Math.cos(a2) * halfWidth).addScaledVector(t2, Math.sin(a2) * halfWidth));
        }
        addLine(cap1Pts);
        addLine(cap2Pts);
        addLine([c1.clone(), c2.clone()], h.centerlineMat);
      }
      return true;
    }

    case 'slot-overall': {
      if (drawingPoints.length === 1) {
        // Step 1→2: axis line from first end tip to cursor
        addLine([startV, mousePos]);
      } else if (drawingPoints.length === 2) {
        // Step 2→3: full slot outline + dashed centerline
        const p1 = startV;
        const p2 = new THREE.Vector3(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z);
        const axisVec = p2.clone().sub(p1);
        const overallLen = axisVec.length();
        if (overallLen < 0.001) return true;
        const axisDir = axisVec.clone().normalize();
        const planeNormal = t1.clone().cross(t2).normalize();
        const perpDir = axisDir.clone().cross(planeNormal).normalize();
        const toMouse = mousePos.clone().sub(p1);
        // Cap halfWidth at half overallLen so the preview never inverts
        const halfWidth = Math.min(Math.abs(toMouse.dot(perpDir)), overallLen * 0.499);
        if (halfWidth < 0.001) return true;
        const c1 = p1.clone().addScaledVector(axisDir, halfWidth);
        const c2 = p2.clone().addScaledVector(axisDir, -halfWidth);
        // Two straight sides
        addLine([
          c1.clone().addScaledVector(perpDir, halfWidth),
          c2.clone().addScaledVector(perpDir, halfWidth),
        ]);
        addLine([
          c1.clone().addScaledVector(perpDir, -halfWidth),
          c2.clone().addScaledVector(perpDir, -halfWidth),
        ]);
        // Two semicircular caps — 24 segments each
        const axisAngle = Math.atan2(axisDir.dot(t2), axisDir.dot(t1));
        const capPts1: THREE.Vector3[] = [];
        const capPts2: THREE.Vector3[] = [];
        const CAP_SEGS = 24;
        for (let i = 0; i <= CAP_SEGS; i++) {
          const a1 = axisAngle + Math.PI / 2 + (i / CAP_SEGS) * Math.PI;
          capPts1.push(c1.clone().addScaledVector(t1, Math.cos(a1) * halfWidth).addScaledVector(t2, Math.sin(a1) * halfWidth));
          const a2 = axisAngle - Math.PI / 2 + (i / CAP_SEGS) * Math.PI;
          capPts2.push(c2.clone().addScaledVector(t1, Math.cos(a2) * halfWidth).addScaledVector(t2, Math.sin(a2) * halfWidth));
        }
        addLine(capPts1);
        addLine(capPts2);
        // Dashed construction centerline c1→c2
        addLine([c1.clone(), c2.clone()], h.centerlineMat);
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
