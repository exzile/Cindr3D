import * as THREE from 'three';
import { useCADStore } from '../../../../store/cadStore';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { clearGroupChildren } from '../../../../utils/threeDisposal';
import type { Sketch, SketchPoint } from '../../../../types/cad';
import { circumcenter2D, sampleCubicBezier, findBlendEndpoint } from './helpers';

// Pre-allocated buffers for blend-curve preview — avoids per-frame allocs
const BLEND_PREVIEW_SAMPLES = Array.from({ length: 33 }, () => new THREE.Vector3());
const _blendP0 = new THREE.Vector3();
const _blendTanRef = new THREE.Vector3();
const _blendTangentA = new THREE.Vector3();
const _blendP3 = new THREE.Vector3();
const _blendTangentB = new THREE.Vector3();

export interface SketchPreviewCtx {
  previewGroup: THREE.Group;
  drawingPoints: SketchPoint[];
  mousePos: THREE.Vector3 | null;
  activeSketch: Sketch | null;
  activeTool: string;
  isDraggingArc: boolean;
  startV: THREE.Vector3;
  lineMat: THREE.LineBasicMaterial;
  constructionMat: THREE.LineDashedMaterial;
  centerlineMat: THREE.LineDashedMaterial;
  conicRho: number;
  blendCurveMode: 'g1' | 'g2';
}

/** Pure-function renderer for the live sketch preview, driven from useFrame. */
export function renderSketchPreview(ctx: SketchPreviewCtx): void {
  const {
    previewGroup, drawingPoints, mousePos, activeSketch, activeTool,
    isDraggingArc, startV, lineMat, constructionMat, centerlineMat, conicRho, blendCurveMode,
  } = ctx;

    if (!previewGroup) return;
    clearGroupChildren(previewGroup);

    if (drawingPoints.length === 0 || !mousePos) return;

    const material = lineMat;
    const start = drawingPoints[0];
    startV.set(start.x, start.y, start.z);

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
      previewGroup.add(line);
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
          activeTool === 'construction-line' ? constructionMat
          : activeTool === 'centerline' ? centerlineMat
          : material;

        // D42: if drag-arc mode active, show tangent arc preview instead of line
        if (isDraggingArc && drawingPoints.length > 0) {
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

      // Control Point Spline preview: B-spline hull with tension=0 + control polygon
      case 'spline-control': {
        if (drawingPoints.length === 0) {
          addLine([startV, mousePos]);
        } else {
          const pts3d = drawingPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
          pts3d.push(mousePos.clone());
          // CatmullRom with tension=0 approximates a uniform B-spline
          const curve = new THREE.CatmullRomCurve3(pts3d, false, 'catmullrom', 0);
          const previewPts = curve.getPoints(Math.max(50, pts3d.length * 16));
          addLine(previewPts);
          // Control polygon — thin lines connecting each hull point
          addLine(pts3d);
          // Square markers at each placed control point (distinguishes from fit-point circles)
          const sq = 0.12;
          for (const cp of drawingPoints) {
            const cv = new THREE.Vector3(cp.x, cp.y, cp.z);
            const c0 = cv.clone().addScaledVector(t1,  sq).addScaledVector(t2,  sq);
            const c1 = cv.clone().addScaledVector(t1, -sq).addScaledVector(t2,  sq);
            const c2 = cv.clone().addScaledVector(t1, -sq).addScaledVector(t2, -sq);
            const c3 = cv.clone().addScaledVector(t1,  sq).addScaledVector(t2, -sq);
            addLine([c0, c1, c2, c3, c0]);
          }
        }
        break;
      }

      case 'slot-3point-arc': {
        // Clicks 0-1: show line from last point to mouse
        // Click 2: show circumscribed arc through P0, pMid, mouse
        // Click 3: show outer + inner arc outline + caps
        if (drawingPoints.length < 2) {
          const lastPt = drawingPoints[drawingPoints.length - 1];
          addLine([new THREE.Vector3(lastPt.x, lastPt.y, lastPt.z), mousePos]);
        } else if (drawingPoints.length === 2) {
          // Show arc preview through P0, P2 (click 1 & 2) with mouse as pMid
          const cc = circumcenter2D(
            drawingPoints[0], drawingPoints[1],
            { x: mousePos.x, y: mousePos.y, z: mousePos.z },
            t1, t2
          );
          if (cc) {
            const cV = new THREE.Vector3(cc.center.x, cc.center.y, cc.center.z);
            const d0 = new THREE.Vector3(drawingPoints[0].x - cc.center.x, drawingPoints[0].y - cc.center.y, drawingPoints[0].z - cc.center.z);
            const d2 = new THREE.Vector3(drawingPoints[1].x - cc.center.x, drawingPoints[1].y - cc.center.y, drawingPoints[1].z - cc.center.z);
            const sa = Math.atan2(d0.dot(t2), d0.dot(t1));
            const ea = Math.atan2(d2.dot(t2), d2.dot(t1));
            const segs = 48;
            const arcPts: THREE.Vector3[] = [];
            for (let i = 0; i <= segs; i++) {
              const a = sa + (i / segs) * (ea - sa);
              arcPts.push(cV.clone().addScaledVector(t1, Math.cos(a) * cc.radius).addScaledVector(t2, Math.sin(a) * cc.radius));
            }
            addLine(arcPts);
          } else {
            addLine([new THREE.Vector3(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z), mousePos]);
          }
        } else {
          // 3 points placed, mouse sets width — show slot outline preview
          const p0 = drawingPoints[0];
          const p2 = drawingPoints[1];
          const pMid = drawingPoints[2];
          const cc = circumcenter2D(p0, pMid, p2, t1, t2);
          if (cc) {
            const { center: C, radius: R } = cc;
            const cV = new THREE.Vector3(C.x, C.y, C.z);
            const toMouse = new THREE.Vector3(mousePos.x - C.x, mousePos.y - C.y, mousePos.z - C.z);
            const halfWidth = Math.abs(toMouse.length() - R);
            if (halfWidth > 0.001) {
              addLine(circlePoints(cV, R + halfWidth));
              if (R > halfWidth) addLine(circlePoints(cV, R - halfWidth));
            }
          }
        }
        break;
      }
      case 'slot-center-arc': {
        if (drawingPoints.length < 2) {
          const lastPt = drawingPoints[drawingPoints.length - 1];
          addLine([new THREE.Vector3(lastPt.x, lastPt.y, lastPt.z), mousePos]);
        } else if (drawingPoints.length === 2) {
          // Show arc from P0 sweeping to mouse around C
          const C = drawingPoints[0];
          const p0 = drawingPoints[1];
          const R = new THREE.Vector3(p0.x - C.x, p0.y - C.y, p0.z - C.z).length();
          const cV = new THREE.Vector3(C.x, C.y, C.z);
          const d0 = new THREE.Vector3(p0.x - C.x, p0.y - C.y, p0.z - C.z);
          const dM = mousePos.clone().sub(cV);
          const sa = Math.atan2(d0.dot(t2), d0.dot(t1));
          const ea = Math.atan2(dM.dot(t2), dM.dot(t1));
          const segs = 48;
          const arcPts: THREE.Vector3[] = [];
          for (let i = 0; i <= segs; i++) {
            const a = sa + (i / segs) * (ea - sa);
            arcPts.push(cV.clone().addScaledVector(t1, Math.cos(a) * R).addScaledVector(t2, Math.sin(a) * R));
          }
          addLine(arcPts);
        } else {
          // 3 points placed, mouse sets width — show slot outline preview
          const C = drawingPoints[0];
          const p0 = drawingPoints[1];
          const R = new THREE.Vector3(p0.x - C.x, p0.y - C.y, p0.z - C.z).length();
          const cV = new THREE.Vector3(C.x, C.y, C.z);
          const toMouse = mousePos.clone().sub(cV);
          const halfWidth = Math.abs(toMouse.length() - R);
          if (halfWidth > 0.001) {
            addLine(circlePoints(cV, R + halfWidth));
            if (R > halfWidth) addLine(circlePoints(cV, R - halfWidth));
          }
        }
        break;
      }
      case 'ellipse': {
        if (drawingPoints.length === 1) {
          // Preview: line from centre to mouse (major axis direction)
          addLine([startV, mousePos]);
        } else if (drawingPoints.length === 2) {
          // Preview: full ellipse with computed major/minor
          const majorPt = drawingPoints[1];
          const majorVec = new THREE.Vector3(majorPt.x - start.x, majorPt.y - start.y, majorPt.z - start.z);
          const majorLen = majorVec.length();
          if (majorLen > 0.001) {
            const majorDir = majorVec.clone().normalize();
            const pn = t1.clone().cross(t2).normalize();
            const minorDir = majorDir.clone().cross(pn).normalize();
            const toMouse = mousePos.clone().sub(startV);
            const minorLen = Math.abs(toMouse.dot(minorDir));
            const rotation = Math.atan2(majorDir.dot(t2), majorDir.dot(t1));
            const cosR = Math.cos(rotation);
            const sinR = Math.sin(rotation);
            const ellipsePts: THREE.Vector3[] = [];
            const segs = 64;
            for (let i = 0; i <= segs; i++) {
              const tt = (i / segs) * Math.PI * 2;
              const u = majorLen * Math.cos(tt) * cosR - minorLen * Math.sin(tt) * sinR;
              const v = majorLen * Math.cos(tt) * sinR + minorLen * Math.sin(tt) * cosR;
              ellipsePts.push(startV.clone().addScaledVector(t1, u).addScaledVector(t2, v));
            }
            addLine(ellipsePts);
            // Major axis line
            const majorV = new THREE.Vector3(majorPt.x, majorPt.y, majorPt.z);
            addLine([startV, majorV]);
            // Minor radius line to mouse projection
            addLine([startV, startV.clone().addScaledVector(t1, minorDir.dot(t1) * minorLen).addScaledVector(t2, minorDir.dot(t2) * minorLen)]);
          }
        }
        break;
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
            const toMouse = mousePos.clone().sub(startV);
            const minorLen = Math.abs(toMouse.dot(minorDir));
            const rotation = Math.atan2(majorDir.dot(t2), majorDir.dot(t1));
            const cosR = Math.cos(rotation);
            const sinR = Math.sin(rotation);
            // Show ghost full ellipse
            const ellipsePts: THREE.Vector3[] = [];
            const segs = 64;
            for (let i = 0; i <= segs; i++) {
              const tt = (i / segs) * Math.PI * 2;
              const u = majorLen * Math.cos(tt) * cosR - minorLen * Math.sin(tt) * sinR;
              const v = majorLen * Math.cos(tt) * sinR + minorLen * Math.sin(tt) * cosR;
              ellipsePts.push(startV.clone().addScaledVector(t1, u).addScaledVector(t2, v));
            }
            addLine(ellipsePts);
            const majorV = new THREE.Vector3(majorPt.x, majorPt.y, majorPt.z);
            addLine([startV, majorV]);
          }
        } else if (drawingPoints.length === 3) {
          // All geometry defined — show arc from 0 to mouse angle
          const majorPt = drawingPoints[1];
          const majorVec = new THREE.Vector3(majorPt.x - start.x, majorPt.y - start.y, majorPt.z - start.z);
          const majorLen = majorVec.length();
          if (majorLen > 0.001) {
            const majorDir = majorVec.clone().normalize();
            const pn = t1.clone().cross(t2).normalize();
            const minorDir = majorDir.clone().cross(pn).normalize();
            const to3 = new THREE.Vector3(drawingPoints[2].x - start.x, drawingPoints[2].y - start.y, drawingPoints[2].z - start.z);
            const minorLen = Math.abs(to3.dot(minorDir));
            if (minorLen > 0.001) {
              const rotation = Math.atan2(majorDir.dot(t2), majorDir.dot(t1));
              const cosR = Math.cos(rotation);
              const sinR = Math.sin(rotation);
              const toMouse = mousePos.clone().sub(startV);
              const endAngle = Math.atan2(toMouse.dot(minorDir), toMouse.dot(majorDir));
              const segs = 64;
              const arcPts: THREE.Vector3[] = [];
              for (let i = 0; i <= segs; i++) {
                const tt = (i / segs) * endAngle;
                const u = majorLen * Math.cos(tt) * cosR - minorLen * Math.sin(tt) * sinR;
                const v = majorLen * Math.cos(tt) * sinR + minorLen * Math.sin(tt) * cosR;
                arcPts.push(startV.clone().addScaledVector(t1, u).addScaledVector(t2, v));
              }
              addLine(arcPts);
              addLine([startV, mousePos]);
            }
          }
        }
        break;
      }

      case 'blend-curve': {
        void blendCurveMode;
        if (drawingPoints.length >= 2) {
          // First endpoint already picked (stored in drawingPoints[0]),
          // tangentA encoded as drawingPoints[1] - drawingPoints[0]
          _blendP0.set(drawingPoints[0].x, drawingPoints[0].y, drawingPoints[0].z);
          _blendTanRef.set(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z);
          _blendTangentA.subVectors(_blendTanRef, _blendP0).normalize();

          // Try to find nearest endpoint at mouse for live preview
          _blendP3.copy(mousePos);
          _blendTangentB.subVectors(mousePos, _blendP0).normalize();
          if (activeSketch) {
            const hit = findBlendEndpoint(mousePos, activeSketch);
            if (hit) {
              _blendP3.copy(hit.endpoint);
              _blendTangentB.copy(hit.tangent);
            }
          }

          const samples = sampleCubicBezier(_blendP0, _blendTangentA, _blendP3, _blendTangentB, 32, BLEND_PREVIEW_SAMPLES);
          addLine(samples);

          // Cross marker at first endpoint
          addLine([_blendP0.clone().addScaledVector(t1, 0.2), _blendP0.clone().addScaledVector(t1, -0.2)]);
          addLine([_blendP0.clone().addScaledVector(t2, 0.2), _blendP0.clone().addScaledVector(t2, -0.2)]);
        }
        break;
      }
    }
}
