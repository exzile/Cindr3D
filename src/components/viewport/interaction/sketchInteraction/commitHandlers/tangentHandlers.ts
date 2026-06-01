import * as THREE from 'three';
import { useCADStore } from '../../../../../store/cadStore';
import type { SketchPoint } from '../../../../../types/cad';
import { circumcenter2D } from '../helpers';
import { ccwArcThrough, ccwArcTangent } from '../arcAngles';
import type { SketchCommitHandler } from './types';

export const handleTangentSketchCommit: SketchCommitHandler = (ctx) => {
  const {
    activeTool, activeSketch, sketchPoint, drawingPoints, setDrawingPoints,
    t1, t2, projectToPlane, addSketchEntity, addSketchConstraint, setStatusMessage, tangentCircleRadius,
  } = ctx;

  switch (activeTool) {
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

      // Project both lines into sketch-plane 2D (u, v) — subtract planeOrigin first (C3)
      const o2 = activeSketch.planeOrigin;
      const toUV = (pt: { x: number; y: number; z: number }) => {
        const d = new THREE.Vector3(pt.x - o2.x, pt.y - o2.y, pt.z - o2.z);
        return { u: d.dot(t1), v: d.dot(t2) };
      };
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

      // Convert back to world coords — add planeOrigin back (C3)
      const worldCenter = o2.clone().add(t1.clone().multiplyScalar(best.cu)).add(t2.clone().multiplyScalar(best.cv));
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

      // Project into sketch-plane 2D — subtract planeOrigin first (C3)
      const o3 = activeSketch.planeOrigin;
      const toUV3 = (pt: { x: number; y: number; z: number }) => {
        const d = new THREE.Vector3(pt.x - o3.x, pt.y - o3.y, pt.z - o3.z);
        return { u: d.dot(t1), v: d.dot(t2) };
      };
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
      // Add planeOrigin back when converting to world coords (C3)
      const wc3 = o3.clone().add(t1.clone().multiplyScalar(bestCenter.cu)).add(t2.clone().multiplyScalar(bestCenter.cv));
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
      // Fusion 360 interaction order: start → end → through-point (controls curvature).
      // This matches addByThreePoints(start, through, end) in the SDK — the through-point
      // is clicked last so the user can see the arc bending in real time before committing.
      if (drawingPoints.length === 0) {
        setDrawingPoints([sketchPoint]);
        setStatusMessage('3-Point Arc: start placed — click end point');
      } else if (drawingPoints.length === 1) {
        setDrawingPoints([...drawingPoints, sketchPoint]);
        setStatusMessage('3-Point Arc: end placed — click a point on the arc to set curvature');
      } else {
        // drawingPoints[0] = start, drawingPoints[1] = end, sketchPoint = through-point
        const start = drawingPoints[0];
        const end   = drawingPoints[1];
        const cc = circumcenter2D(
          { x: start.x, y: start.y, z: start.z },
          { x: sketchPoint.x, y: sketchPoint.y, z: sketchPoint.z }, // through-point
          { x: end.x, y: end.y, z: end.z },
          t1, t2
        );
        if (cc) {
          const { u: u1, v: v1 } = projectToPlane(start,      { id:'', x: cc.center.x, y: cc.center.y, z: cc.center.z });
          const { u: u2, v: v2 } = projectToPlane(sketchPoint, { id:'', x: cc.center.x, y: cc.center.y, z: cc.center.z });
          const { u: u3, v: v3 } = projectToPlane(end,        { id:'', x: cc.center.x, y: cc.center.y, z: cc.center.z });
          // C1: pick the CCW arc that passes through the through-point (u2, v2).
          const { startAngle, endAngle } = ccwArcThrough(
            Math.atan2(v1, u1), Math.atan2(v2, u2), Math.atan2(v3, u3),
          );
          addSketchEntity({
            id: crypto.randomUUID(), type: 'arc',
            points: [{ id: crypto.randomUUID(), ...cc.center }],
            radius: cc.radius,
            startAngle,
            endAngle,
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
        const corners = [p1, p2, v(p2, hx, hy, hz), v(p1, hx, hy, hz)];
        const lineIds: string[] = [];
        for (let i = 0; i < 4; i++) {
          const eid = crypto.randomUUID();
          lineIds.push(eid);
          addSketchEntity({ id: eid, type: 'line', points: [corners[i], corners[(i + 1) % 4]] });
        }
        for (let i = 0; i < 4; i++) {
          addSketchConstraint({ id: crypto.randomUUID(), type: 'coincident', entityIds: [lineIds[i], lineIds[(i + 1) % 4]], pointIndices: [1, 0] });
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
      // C2: orient the CCW arc so its start tangent matches tangentDir (no cusp).
      const { startAngle, endAngle } = ccwArcTangent(
        Math.atan2(toStart.dot(t2), toStart.dot(t1)),
        Math.atan2(toEnd.dot(t2), toEnd.dot(t1)),
        t1, t2, tangentDir,
      );
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
    default:
      return false;
  }

  return true;
};
