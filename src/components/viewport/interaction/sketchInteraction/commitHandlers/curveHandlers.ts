import * as THREE from 'three';
import type { SketchPoint } from '../../../../../types/cad';
import { circumcenter2D } from '../helpers';
import type { SketchCommitHandler } from './types';

export const handleCurveSketchCommit: SketchCommitHandler = (ctx) => {
  const {
    activeTool, sketchPoint, drawingPoints, setDrawingPoints,
    t1, t2, addSketchEntity, setStatusMessage,
  } = ctx;

  switch (activeTool) {
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
        // C4: both caps anchored to axisAngle — perpAngle is no longer used.
        const axisAngle = Math.atan2(axisDir.dot(t2), axisDir.dot(t1));
        // Arc at c1: from +perpDir (perpAngle) sweeping opposite to axis
        // through -perpDir. For Fusion-like rendering, we just emit a
        // half-turn of radius = halfWidth at each centre.
        // C4: both caps anchored to axisAngle so they face outward from the slot ends.
        // c1 is the "back" end (axis goes from c1→c2), so its cap faces axisAngle+π.
        // c2 is the "front" end, cap faces axisAngle (same as slot-overall / slot-center-point).
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
    case 'slot-3point-arc': {
      // Three Point Arc Slot: click 1 = arc start P0, click 2 = arc end P2,
      // click 3 = point on arc (determines curvature), click 4 = width.
      if (drawingPoints.length === 0) {
        setDrawingPoints([sketchPoint]);
        setStatusMessage('Arc Slot: arc start placed — click arc end point');
      } else if (drawingPoints.length === 1) {
        setDrawingPoints([...drawingPoints, sketchPoint]);
        setStatusMessage('Arc Slot: arc end placed — click a point on the arc');
      } else if (drawingPoints.length === 2) {
        setDrawingPoints([...drawingPoints, sketchPoint]);
        setStatusMessage('Arc Slot: arc defined — click to set slot width');
      } else {
        const p0 = drawingPoints[0];
        const p2 = drawingPoints[1];
        const pMid = drawingPoints[2];
        const cc = circumcenter2D(p0, pMid, p2, t1, t2);
        if (!cc) { setStatusMessage('Arc points are collinear — try again'); setDrawingPoints([]); break; }
        const { center: C, radius: R } = cc;
        // half-width = distance from arc (at nearest point) to click4, via perp offset
        const toClick4 = new THREE.Vector3(sketchPoint.x - C.x, sketchPoint.y - C.y, sketchPoint.z - C.z);
        const distToC = toClick4.length();
        const halfWidth = Math.abs(distToC - R);
        if (halfWidth < 0.001) { setStatusMessage('Slot width too small'); setDrawingPoints([]); break; }
        // Arc angles
        const startAngle = Math.atan2(
          new THREE.Vector3(p0.x - C.x, p0.y - C.y, p0.z - C.z).dot(t2),
          new THREE.Vector3(p0.x - C.x, p0.y - C.y, p0.z - C.z).dot(t1),
        );
        const endAngle = Math.atan2(
          new THREE.Vector3(p2.x - C.x, p2.y - C.y, p2.z - C.z).dot(t2),
          new THREE.Vector3(p2.x - C.x, p2.y - C.y, p2.z - C.z).dot(t1),
        );
        // Determine sweep direction using pMid
        const midAngle = Math.atan2(
          new THREE.Vector3(pMid.x - C.x, pMid.y - C.y, pMid.z - C.z).dot(t2),
          new THREE.Vector3(pMid.x - C.x, pMid.y - C.y, pMid.z - C.z).dot(t1),
        );
        // Check if midAngle is between startAngle and endAngle CCW
        const normalizeAngle = (a: number, ref: number) => {
          let d = a - ref;
          while (d < 0) d += Math.PI * 2;
          return d;
        };
        const midFromStart = normalizeAngle(midAngle, startAngle);
        const endFromStart = normalizeAngle(endAngle, startAngle);
        // If mid is not between start and end CCW, swap to make the arc go the other way
        const [arcSA, arcEA] = midFromStart < endFromStart
          ? [startAngle, endAngle]
          : [endAngle, startAngle];
        // Outer arc (R + halfWidth) and inner arc (R - halfWidth)
        const rOuter = R + halfWidth;
        const rInner = Math.max(0.001, R - halfWidth);
        addSketchEntity({ id: crypto.randomUUID(), type: 'arc', points: [{ id: crypto.randomUUID(), x: C.x, y: C.y, z: C.z }], radius: rOuter, startAngle: arcSA, endAngle: arcEA });
        addSketchEntity({ id: crypto.randomUUID(), type: 'arc', points: [{ id: crypto.randomUUID(), x: C.x, y: C.y, z: C.z }], radius: rInner, startAngle: arcSA, endAngle: arcEA });
        // Cap arcs at P0 and P2 ends.
        // C5: derive cap orientation from the actual radial direction of each endpoint,
        // independent of the arcSA/arcEA swap above.  When p0 is the arc START the cap
        // faces "backward" (from p0Radial−π to p0Radial); when p0 is the arc END (after
        // swap) it faces "forward" (from p0Radial to p0Radial+π).
        const capCenter0: SketchPoint = { id: crypto.randomUUID(), x: p0.x, y: p0.y, z: p0.z };
        const capCenter2: SketchPoint = { id: crypto.randomUUID(), x: p2.x, y: p2.y, z: p2.z };
        const toP0vec = new THREE.Vector3(p0.x - C.x, p0.y - C.y, p0.z - C.z);
        const toP2vec = new THREE.Vector3(p2.x - C.x, p2.y - C.y, p2.z - C.z);
        const p0RadialAngle = Math.atan2(toP0vec.dot(t2), toP0vec.dot(t1));
        const p2RadialAngle = Math.atan2(toP2vec.dot(t2), toP2vec.dot(t1));
        const p0IsStart = midFromStart < endFromStart; // true = arc was NOT swapped
        const [cap0SA, cap0EA] = p0IsStart
          ? [p0RadialAngle - Math.PI, p0RadialAngle]
          : [p0RadialAngle, p0RadialAngle + Math.PI];
        const [cap2SA, cap2EA] = p0IsStart
          ? [p2RadialAngle, p2RadialAngle + Math.PI]
          : [p2RadialAngle - Math.PI, p2RadialAngle];
        addSketchEntity({ id: crypto.randomUUID(), type: 'arc', points: [capCenter0], radius: halfWidth, startAngle: cap0SA, endAngle: cap0EA });
        addSketchEntity({ id: crypto.randomUUID(), type: 'arc', points: [capCenter2], radius: halfWidth, startAngle: cap2SA, endAngle: cap2EA });
        setStatusMessage(`Arc Slot added (R=${R.toFixed(2)}, w=${(halfWidth * 2).toFixed(2)})`);
        setDrawingPoints([]);
      }
      break;
    }
    case 'slot-center-arc': {
      // Center Point Arc Slot: click 1 = arc center C, click 2 = arc start P0,
      // click 3 = arc end P2, click 4 = width.
      if (drawingPoints.length === 0) {
        setDrawingPoints([sketchPoint]);
        setStatusMessage('Center Arc Slot: arc centre placed — click arc start');
      } else if (drawingPoints.length === 1) {
        setDrawingPoints([...drawingPoints, sketchPoint]);
        setStatusMessage('Center Arc Slot: start placed — click arc end');
      } else if (drawingPoints.length === 2) {
        setDrawingPoints([...drawingPoints, sketchPoint]);
        setStatusMessage('Center Arc Slot: arc defined — click to set slot width');
      } else {
        const C = drawingPoints[0];
        const p0 = drawingPoints[1];
        const p2 = drawingPoints[2];
        const R = new THREE.Vector3(p0.x - C.x, p0.y - C.y, p0.z - C.z).length();
        if (R < 0.001) { setStatusMessage('Arc too small'); setDrawingPoints([]); break; }
        const startAngle = Math.atan2(
          new THREE.Vector3(p0.x - C.x, p0.y - C.y, p0.z - C.z).dot(t2),
          new THREE.Vector3(p0.x - C.x, p0.y - C.y, p0.z - C.z).dot(t1),
        );
        const endAngle = Math.atan2(
          new THREE.Vector3(p2.x - C.x, p2.y - C.y, p2.z - C.z).dot(t2),
          new THREE.Vector3(p2.x - C.x, p2.y - C.y, p2.z - C.z).dot(t1),
        );
        const toClick4 = new THREE.Vector3(sketchPoint.x - C.x, sketchPoint.y - C.y, sketchPoint.z - C.z);
        const halfWidth = Math.abs(toClick4.length() - R);
        if (halfWidth < 0.001) { setStatusMessage('Slot width too small'); setDrawingPoints([]); break; }
        const rOuter = R + halfWidth;
        const rInner = Math.max(0.001, R - halfWidth);
        const cPt: SketchPoint = { id: crypto.randomUUID(), x: C.x, y: C.y, z: C.z };
        addSketchEntity({ id: crypto.randomUUID(), type: 'arc', points: [{ ...cPt, id: crypto.randomUUID() }], radius: rOuter, startAngle, endAngle });
        addSketchEntity({ id: crypto.randomUUID(), type: 'arc', points: [{ ...cPt, id: crypto.randomUUID() }], radius: rInner, startAngle, endAngle });
        // C5: cap at p0 faces backward from arc start (startAngle−π → startAngle);
        // cap at p2 faces forward from arc end (endAngle → endAngle+π).
        const capCenter0: SketchPoint = { id: crypto.randomUUID(), x: p0.x, y: p0.y, z: p0.z };
        const capCenter2: SketchPoint = { id: crypto.randomUUID(), x: p2.x, y: p2.y, z: p2.z };
        addSketchEntity({ id: crypto.randomUUID(), type: 'arc', points: [capCenter0], radius: halfWidth, startAngle: startAngle - Math.PI, endAngle: startAngle });
        addSketchEntity({ id: crypto.randomUUID(), type: 'arc', points: [capCenter2], radius: halfWidth, startAngle: endAngle, endAngle: endAngle + Math.PI });
        setStatusMessage(`Center Arc Slot added (R=${R.toFixed(2)}, w=${(halfWidth * 2).toFixed(2)})`);
        setDrawingPoints([]);
      }
      break;
    }
    // ── D10 / S5 Ellipse ──────────────────────────────────────────
    // Click 1: centre, click 2: major-axis endpoint (sets major radius
    // + rotation), click 3: minor-axis endpoint (perpendicular distance).
    // Stored as a proper analytic 'ellipse' entity.
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
        // Rotation is angle of major axis from t1
        const rotation = Math.atan2(majorDir.dot(t2), majorDir.dot(t1));
        addSketchEntity({
          id: crypto.randomUUID(),
          type: 'ellipse',
          points: [{ id: crypto.randomUUID(), x: centre.x, y: centre.y, z: centre.z }],
          cx: centre.x,
          cy: centre.y,
          majorRadius: majorLen,
          minorRadius: minorLen,
          rotation,
          isConstruction: false,
        });
        setStatusMessage(`Ellipse added (${majorLen.toFixed(2)} × ${minorLen.toFixed(2)})`);
        setDrawingPoints([]);
      }
      break;
    }

    // ── S6 Elliptical Arc ──────────────────────────────────────────
    // Click 1: centre, click 2: major-axis endpoint, click 3: minor
    // axis endpoint, click 4: end angle (arc sweeps from major-axis
    // direction (angle=0) to the clicked angle).
    case 'elliptical-arc': {
      if (drawingPoints.length === 0) {
        setDrawingPoints([sketchPoint]);
        setStatusMessage('Elliptical Arc: centre placed — click major-axis endpoint');
      } else if (drawingPoints.length === 1) {
        setDrawingPoints([...drawingPoints, sketchPoint]);
        setStatusMessage('Elliptical Arc: major placed — click minor-axis endpoint');
      } else if (drawingPoints.length === 2) {
        setDrawingPoints([...drawingPoints, sketchPoint]);
        setStatusMessage('Elliptical Arc: minor placed — click end-angle point');
      } else {
        const centre = drawingPoints[0];
        const majorPt = drawingPoints[1];
        const majorVec = new THREE.Vector3(majorPt.x - centre.x, majorPt.y - centre.y, majorPt.z - centre.z);
        const majorLen = majorVec.length();
        if (majorLen < 0.001) { setStatusMessage('Elliptical arc too small'); setDrawingPoints([]); break; }
        const majorDir = majorVec.clone().normalize();
        const planeNormal = t1.clone().cross(t2).normalize();
        const minorDir = majorDir.clone().cross(planeNormal).normalize();
        const to3 = new THREE.Vector3(drawingPoints[2].x - centre.x, drawingPoints[2].y - centre.y, drawingPoints[2].z - centre.z);
        const minorLen = Math.abs(to3.dot(minorDir));
        if (minorLen < 0.001) { setStatusMessage('Elliptical arc minor axis too small'); setDrawingPoints([]); break; }
        const rotation = Math.atan2(majorDir.dot(t2), majorDir.dot(t1));
        // End angle: angle from centre to click 4, measured in the local ellipse frame
        const toEnd = new THREE.Vector3(sketchPoint.x - centre.x, sketchPoint.y - centre.y, sketchPoint.z - centre.z);
        const endAngle = Math.atan2(toEnd.dot(minorDir), toEnd.dot(majorDir));
        addSketchEntity({
          id: crypto.randomUUID(),
          type: 'elliptical-arc',
          points: [{ id: crypto.randomUUID(), x: centre.x, y: centre.y, z: centre.z }],
          cx: centre.x,
          cy: centre.y,
          majorRadius: majorLen,
          minorRadius: minorLen,
          rotation,
          startAngle: 0,
          endAngle,
          isConstruction: false,
        });
        setStatusMessage(`Elliptical Arc added (${majorLen.toFixed(2)} × ${minorLen.toFixed(2)}, sweep ${(endAngle * 180 / Math.PI).toFixed(1)}°)`);
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

    // ── S9 Control Point Spline (B-spline / Bezier hull) ───────────────
    // Clicks accumulate hull control points; right-click commits.
    case 'spline-control': {
      setDrawingPoints([...drawingPoints, sketchPoint]);
      const nc = drawingPoints.length + 1;
      if (nc === 1) {
        setStatusMessage('Control Point Spline: first control point placed — click to add more, right-click to finish');
      } else {
        setStatusMessage(`Control Point Spline: ${nc} control points — click to continue, right-click to finish`);
      }
      break;
    }

    // ── D19 Break ──────────────────────────────────────────────────────
    default:
      return false;
  }

  return true;
};
