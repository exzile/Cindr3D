import * as THREE from 'three';
import { useCADStore } from '../../../../store/cadStore';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { Sketch, SketchEntity, SketchPoint } from '../../../../types/cad';
import { circumcenter2D, findBlendEndpoint, sampleCubicBezier } from './helpers';

export interface SketchCommitCtx {
  activeTool: string;
  activeSketch: Sketch;
  sketchPoint: SketchPoint;
  drawingPoints: SketchPoint[];
  setDrawingPoints: (pts: SketchPoint[]) => void;
  t1: THREE.Vector3;
  t2: THREE.Vector3;
  projectToPlane: (pt: SketchPoint, origin: SketchPoint) => { u: number; v: number };
  addSketchEntity: (e: SketchEntity) => void;
  replaceSketchEntities: (entities: SketchEntity[]) => void;
  cycleEntityLinetype: (id: string) => void;
  setStatusMessage: (msg: string) => void;
  polygonSides: number;
  filletRadius: number;
  chamferDist1: number;
  chamferDist2: number;
  chamferAngle: number;
  tangentCircleRadius: number;
  conicRho: number;
  blendCurveMode: 'g1' | 'g2';
}

/** Pure-function dispatcher for the sketch "commit" step triggered on a canvas click. */
export function commitSketchTool(ctx: SketchCommitCtx): void {
  const {
    activeTool, activeSketch, sketchPoint, drawingPoints, setDrawingPoints,
    t1, t2, projectToPlane,
    addSketchEntity, replaceSketchEntities, cycleEntityLinetype, setStatusMessage,
    polygonSides, filletRadius, chamferDist1, chamferDist2, chamferAngle,
    tangentCircleRadius, conicRho, blendCurveMode,
  } = ctx;
  void tangentCircleRadius;

  // Helper: perpendicular to edgeDir within the sketch plane, used by polygon-edge
  const planeDir = (edgeDir: THREE.Vector3, normal: THREE.Vector3) => {
    return edgeDir.clone().cross(normal).normalize();
  };

      switch (activeTool) {
        case 'line':
        case 'construction-line':
        case 'centerline': {
          const labelMap = {
            'line': 'Line',
            'construction-line': 'Construction line',
            'centerline': 'Centerline',
          } as const;
          const lineLabel = labelMap[activeTool];
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage(`${lineLabel} start placed — click to set end point (right-click to cancel)`);
          } else {
            const entity: SketchEntity = {
              id: crypto.randomUUID(),
              type: activeTool,
              points: [drawingPoints[0], sketchPoint],
            };
            addSketchEntity(entity);
            setDrawingPoints([sketchPoint]); // Chain lines — next start = this end
            setStatusMessage(`${lineLabel} added — click to continue, right-click or Escape to stop`);
          }
          break;
        }
        // D43: Midpoint Line — click midpoint, then one endpoint; other endpoint mirrors
        case 'midpoint-line': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Midpoint Line: midpoint placed — click to set one endpoint');
          } else {
            const midPt = drawingPoints[0];
            // Mirror: other end = midPt + (midPt - endpoint) = 2*midPt - endpoint
            const otherPt: SketchPoint = {
              id: crypto.randomUUID(),
              x: 2 * midPt.x - sketchPoint.x,
              y: 2 * midPt.y - sketchPoint.y,
              z: 2 * midPt.z - sketchPoint.z,
            };
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'line',
              points: [sketchPoint, otherPt],
            });
            setDrawingPoints([]);
            const len = new THREE.Vector3(sketchPoint.x - otherPt.x, sketchPoint.y - otherPt.y, sketchPoint.z - otherPt.z).length();
            setStatusMessage(`Midpoint Line added (length=${len.toFixed(2)})`);
          }
          break;
        }

        case 'circle': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Circle center placed — click to set radius');
          } else {
            const center = drawingPoints[0];
            // Full 3-D distance — correct for every sketch plane
            const radius = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z)
              .distanceTo(new THREE.Vector3(center.x, center.y, center.z));
            if (radius > 0.001) {
              addSketchEntity({
                id: crypto.randomUUID(),
                type: 'circle',
                points: [center],
                radius,
              });
              setStatusMessage(`Circle added (r=${radius.toFixed(2)})`);
            } else {
              setStatusMessage('Circle too small — try again');
            }
            setDrawingPoints([]);
          }
          break;
        }
        case 'rectangle': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Rectangle corner placed — click to set opposite corner');
          } else {
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'rectangle',
              points: [drawingPoints[0], sketchPoint],
              closed: true,
            });
            setDrawingPoints([]);
            setStatusMessage('Rectangle added');
          }
          break;
        }
        case 'arc': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]); // center
            setStatusMessage('Arc center placed — click to set radius & start angle');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]); // start point
            setStatusMessage('Arc start set — click to set end angle');
          } else {
            // Use plane-local 2-D coordinates so angles are correct on every plane
            const center = drawingPoints[0];
            const startPt = drawingPoints[1];
            const { u: u1, v: v1 } = projectToPlane(startPt, center);
            const { u: u2, v: v2 } = projectToPlane(sketchPoint, center);
            const radius = Math.sqrt(u1 * u1 + v1 * v1);
            if (radius > 0.001) {
              addSketchEntity({
                id: crypto.randomUUID(),
                type: 'arc',
                points: [center],
                radius,
                startAngle: Math.atan2(v1, u1),
                endAngle: Math.atan2(v2, u2),
              });
              setStatusMessage('Arc added');
            } else {
              setStatusMessage('Arc too small — try again');
            }
            setDrawingPoints([]);
          }
          break;
        }
        case 'polygon':
        case 'polygon-inscribed': {
          // Inscribed: vertices ON the circle, radius = center-to-vertex distance
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Polygon center placed — click a vertex point to set size (inscribed)');
          } else {
            const center = drawingPoints[0];
            const radius = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z)
              .distanceTo(new THREE.Vector3(center.x, center.y, center.z));
            if (radius > 0.001) {
              const sides = polygonSides;
              for (let i = 0; i < sides; i++) {
                const a1 = (i / sides) * Math.PI * 2;
                const a2 = ((i + 1) / sides) * Math.PI * 2;
                const p1: SketchPoint = { id: crypto.randomUUID(), x: center.x + t1.x * Math.cos(a1) * radius + t2.x * Math.sin(a1) * radius, y: center.y + t1.y * Math.cos(a1) * radius + t2.y * Math.sin(a1) * radius, z: center.z + t1.z * Math.cos(a1) * radius + t2.z * Math.sin(a1) * radius };
                const p2: SketchPoint = { id: crypto.randomUUID(), x: center.x + t1.x * Math.cos(a2) * radius + t2.x * Math.sin(a2) * radius, y: center.y + t1.y * Math.cos(a2) * radius + t2.y * Math.sin(a2) * radius, z: center.z + t1.z * Math.cos(a2) * radius + t2.z * Math.sin(a2) * radius };
                addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [p1, p2] });
              }
              setStatusMessage(`${sides}-gon (inscribed) added (vertex r=${radius.toFixed(2)})`);
            } else { setStatusMessage('Polygon too small — try again'); }
            setDrawingPoints([]);
          }
          break;
        }
        case 'polygon-circumscribed': {
          // Circumscribed: circle is inscribed in the polygon — click sets edge-midpoint distance
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Polygon center placed — click edge midpoint to set size (circumscribed)');
          } else {
            const center = drawingPoints[0];
            const apothem = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z)
              .distanceTo(new THREE.Vector3(center.x, center.y, center.z));
            const sides = polygonSides;
            const radius = apothem / Math.cos(Math.PI / sides); // vertex distance
            if (radius > 0.001) {
              for (let i = 0; i < sides; i++) {
                const a1 = (i / sides) * Math.PI * 2;
                const a2 = ((i + 1) / sides) * Math.PI * 2;
                const p1: SketchPoint = { id: crypto.randomUUID(), x: center.x + t1.x * Math.cos(a1) * radius + t2.x * Math.sin(a1) * radius, y: center.y + t1.y * Math.cos(a1) * radius + t2.y * Math.sin(a1) * radius, z: center.z + t1.z * Math.cos(a1) * radius + t2.z * Math.sin(a1) * radius };
                const p2: SketchPoint = { id: crypto.randomUUID(), x: center.x + t1.x * Math.cos(a2) * radius + t2.x * Math.sin(a2) * radius, y: center.y + t1.y * Math.cos(a2) * radius + t2.y * Math.sin(a2) * radius, z: center.z + t1.z * Math.cos(a2) * radius + t2.z * Math.sin(a2) * radius };
                addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [p1, p2] });
              }
              setStatusMessage(`${sides}-gon (circumscribed) added (apothem=${apothem.toFixed(2)})`);
            } else { setStatusMessage('Polygon too small — try again'); }
            setDrawingPoints([]);
          }
          break;
        }
        case 'polygon-edge': {
          // Edge: click two endpoints of one edge, polygon is constructed from there
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Edge polygon: first edge endpoint placed — click second endpoint');
          } else {
            const p1 = drawingPoints[0];
            const sides = polygonSides;
            const edgeVec = new THREE.Vector3(sketchPoint.x - p1.x, sketchPoint.y - p1.y, sketchPoint.z - p1.z);
            const edgeLen = edgeVec.length();
            if (edgeLen > 0.001) {
              const sideLen = edgeLen;
              const radius = sideLen / (2 * Math.sin(Math.PI / sides)); // circumradius
              const midX = (p1.x + sketchPoint.x) / 2;
              const midY = (p1.y + sketchPoint.y) / 2;
              const midZ = (p1.z + sketchPoint.z) / 2;
              const edgeDir = edgeVec.clone().normalize();
              const planeNormal = t1.clone().cross(t2);
              const perpDir = planeDir(edgeDir, planeNormal);
              const apothem = sideLen / (2 * Math.tan(Math.PI / sides));
              const centerPt = new THREE.Vector3(midX + perpDir.x * apothem, midY + perpDir.y * apothem, midZ + perpDir.z * apothem);
              const toP1 = new THREE.Vector3(p1.x - centerPt.x, p1.y - centerPt.y, p1.z - centerPt.z);
              const startAngle = Math.atan2(toP1.dot(t2), toP1.dot(t1));
              for (let i = 0; i < sides; i++) {
                const a1 = startAngle + (i / sides) * Math.PI * 2;
                const a2 = startAngle + ((i + 1) / sides) * Math.PI * 2;
                const v1: SketchPoint = { id: crypto.randomUUID(), x: centerPt.x + t1.x * Math.cos(a1) * radius + t2.x * Math.sin(a1) * radius, y: centerPt.y + t1.y * Math.cos(a1) * radius + t2.y * Math.sin(a1) * radius, z: centerPt.z + t1.z * Math.cos(a1) * radius + t2.z * Math.sin(a1) * radius };
                const v2: SketchPoint = { id: crypto.randomUUID(), x: centerPt.x + t1.x * Math.cos(a2) * radius + t2.x * Math.sin(a2) * radius, y: centerPt.y + t1.y * Math.cos(a2) * radius + t2.y * Math.sin(a2) * radius, z: centerPt.z + t1.z * Math.cos(a2) * radius + t2.z * Math.sin(a2) * radius };
                addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [v1, v2] });
              }
              setStatusMessage(`${sides}-gon (edge) added (side=${sideLen.toFixed(2)})`);
            } else { setStatusMessage('Edge too small — try again'); }
            setDrawingPoints([]);
          }
          break;
        }
        case 'rectangle-center': {
          // Click 1: center. Click 2: corner → build rectangle symmetric about center
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Center rectangle: center placed — click to set corner');
          } else {
            const center = drawingPoints[0];
            const { u: du, v: dv } = projectToPlane(sketchPoint, center);
            const corner = (u: number, v: number): SketchPoint => ({
              id: crypto.randomUUID(),
              x: center.x + t1.x * u + t2.x * v,
              y: center.y + t1.y * u + t2.y * v,
              z: center.z + t1.z * u + t2.z * v,
            });
            const corners = [
              corner(-du, -dv), corner(du, -dv), corner(du, dv), corner(-du, dv), corner(-du, -dv),
            ];
            for (let i = 0; i < 4; i++) {
              addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [corners[i], corners[i + 1]] });
            }
            setDrawingPoints([]);
            setStatusMessage('Center rectangle added');
          }
          break;
        }
        case 'circle-2point': {
          // Click 1 and Click 2 are the two endpoints of the diameter
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('2-Point Circle: first diameter endpoint placed — click second endpoint');
          } else {
            const p1 = drawingPoints[0];
            const p2 = sketchPoint;
            const cx = (p1.x + p2.x) / 2;
            const cy = (p1.y + p2.y) / 2;
            const cz = (p1.z + p2.z) / 2;
            const radius = new THREE.Vector3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z).length() / 2;
            if (radius > 0.001) {
              const center: SketchPoint = { id: crypto.randomUUID(), x: cx, y: cy, z: cz };
              addSketchEntity({ id: crypto.randomUUID(), type: 'circle', points: [center], radius });
              setStatusMessage(`Circle added (r=${radius.toFixed(2)})`);
            } else { setStatusMessage('Circle too small — try again'); }
            setDrawingPoints([]);
          }
          break;
        }
        case 'circle-3point': {
          // 3 clicks: find circumcircle
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('3-Point Circle: first point placed');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]);
            setStatusMessage('3-Point Circle: second point placed — click third point');
          } else {
            const cc = circumcenter2D(
              { x: drawingPoints[0].x, y: drawingPoints[0].y, z: drawingPoints[0].z },
              { x: drawingPoints[1].x, y: drawingPoints[1].y, z: drawingPoints[1].z },
              { x: sketchPoint.x, y: sketchPoint.y, z: sketchPoint.z },
              t1, t2
            );
            if (cc) {
              addSketchEntity({ id: crypto.randomUUID(), type: 'circle', points: [{ id: crypto.randomUUID(), ...cc.center }], radius: cc.radius });
              setStatusMessage(`3-Point Circle added (r=${cc.radius.toFixed(2)})`);
            } else { setStatusMessage('Points are collinear — cannot form a circle'); }
            setDrawingPoints([]);
          }
          break;
        }
        // D11: Conic Curve — rational Bézier conic defined by start, end, shoulder + rho
        case 'conic': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Conic: start placed — click end point');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]);
            setStatusMessage('Conic: end placed — click shoulder point (tangent intersection)');
          } else {
            // drawingPoints = [P0, P2], sketchPoint = P1 (shoulder)
            const P0 = new THREE.Vector3(drawingPoints[0].x, drawingPoints[0].y, drawingPoints[0].z);
            const P2 = new THREE.Vector3(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z);
            const P1 = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
            const rho = conicRho;
            const w = rho / (1 - rho); // rational weight
            const N_SEGS = 48;
            const pts: SketchPoint[] = [];
            for (let i = 0; i <= N_SEGS; i++) {
              const t = i / N_SEGS;
              const b0 = (1 - t) * (1 - t);
              const b1 = 2 * t * (1 - t) * w;
              const b2 = t * t;
              const denom = b0 + b1 + b2;
              const x = (b0 * P0.x + b1 * P1.x + b2 * P2.x) / denom;
              const y = (b0 * P0.y + b1 * P1.y + b2 * P2.y) / denom;
              const z = (b0 * P0.z + b1 * P1.z + b2 * P2.z) / denom;
              pts.push({ id: crypto.randomUUID(), x, y, z });
            }
            addSketchEntity({ id: crypto.randomUUID(), type: 'spline', points: pts });
            setDrawingPoints([]);
            const shape = rho < 0.5 ? 'ellipse' : rho > 0.5 ? 'hyperbola' : 'parabola';
            setStatusMessage(`Conic (${shape}, ρ=${rho.toFixed(2)}) added`);
          }
          break;
        }

        // D40: 2-Tangent Circle — pick 2 lines, get circle tangent to both at given radius
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

          // Project both lines into sketch-plane 2D (u, v)
          const toUV = (pt: { x: number; y: number; z: number }) => ({ u: new THREE.Vector3(pt.x, pt.y, pt.z).dot(t1), v: new THREE.Vector3(pt.x, pt.y, pt.z).dot(t2) });
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

          // Convert back to world coords
          const worldCenter = t1.clone().multiplyScalar(best.cu).add(t2.clone().multiplyScalar(best.cv));
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

          const toUV3 = (pt: { x: number; y: number; z: number }) => ({ u: new THREE.Vector3(pt.x, pt.y, pt.z).dot(t1), v: new THREE.Vector3(pt.x, pt.y, pt.z).dot(t2) });
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
          const wc3 = t1.clone().multiplyScalar(bestCenter.cu).add(t2.clone().multiplyScalar(bestCenter.cv));
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
          // Click start, point on arc, end
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('3-Point Arc: start point placed');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]);
            setStatusMessage('3-Point Arc: through-point placed — click end point');
          } else {
            const cc = circumcenter2D(
              { x: drawingPoints[0].x, y: drawingPoints[0].y, z: drawingPoints[0].z },
              { x: drawingPoints[1].x, y: drawingPoints[1].y, z: drawingPoints[1].z },
              { x: sketchPoint.x, y: sketchPoint.y, z: sketchPoint.z },
              t1, t2
            );
            if (cc) {
              const { u: u1, v: v1 } = projectToPlane(drawingPoints[0], { id:'', x: cc.center.x, y: cc.center.y, z: cc.center.z });
              const { u: u3, v: v3 } = projectToPlane(sketchPoint, { id:'', x: cc.center.x, y: cc.center.y, z: cc.center.z });
              addSketchEntity({
                id: crypto.randomUUID(), type: 'arc',
                points: [{ id: crypto.randomUUID(), ...cc.center }],
                radius: cc.radius,
                startAngle: Math.atan2(v1, u1),
                endAngle: Math.atan2(v3, u3),
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
            const corners = [
              p1,
              p2,
              v(p2, hx, hy, hz),
              v(p1, hx, hy, hz),
              p1,
            ];
            for (let i = 0; i < 4; i++) {
              addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [corners[i], corners[i + 1]] });
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
          const startAngle = Math.atan2(toStart.dot(t2), toStart.dot(t1));
          const endAngle = Math.atan2(toEnd.dot(t2), toEnd.dot(t1));
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
        // every variant stays flat to the sketch plane.
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
            const perpAngleAt = (centre: SketchPoint) => {
              // perpDir relative to axisDir in local coords
              const local = new THREE.Vector3(
                perpDir.dot(t1),
                perpDir.dot(t2),
                0,
              );
              const axisLocal = new THREE.Vector3(
                axisDir.dot(t1),
                axisDir.dot(t2),
                0,
              );
              // start angle (from +t1) of perpDir
              return { local, axisLocal, centre };
            };
            const { local: perpLocal, axisLocal: axisLocal } = perpAngleAt(c1);
            // Start angle of perpDir = atan2(local.y, local.x) in plane coords
            const perpAngle = Math.atan2(perpLocal.y, perpLocal.x);
            const axisAngle = Math.atan2(axisLocal.y, axisLocal.x);
            // Arc at c1: from +perpDir (perpAngle) sweeping opposite to axis
            // through -perpDir. For Fusion-like rendering, we just emit a
            // half-turn of radius = halfWidth at each centre.
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'arc',
              points: [c1],
              radius: halfWidth,
              startAngle: perpAngle,
              endAngle: perpAngle + Math.PI,
            });
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'arc',
              points: [c2],
              radius: halfWidth,
              startAngle: axisAngle - Math.PI / 2, // -perpDir side
              endAngle: axisAngle + Math.PI / 2,   // +perpDir side
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
            // Cap arcs at P0 and P2 ends (semicircles perpendicular to the slot arc)
            const capCenter0: SketchPoint = { id: crypto.randomUUID(), x: p0.x, y: p0.y, z: p0.z };
            const capCenter2: SketchPoint = { id: crypto.randomUUID(), x: p2.x, y: p2.y, z: p2.z };
            // Tangent at arc endpoint = perpendicular to radial direction in plane
            const radialAngle0 = arcSA;
            const capAngle0 = radialAngle0 + Math.PI / 2;
            const radialAngle2 = arcEA;
            const capAngle2 = radialAngle2 - Math.PI / 2;
            addSketchEntity({ id: crypto.randomUUID(), type: 'arc', points: [capCenter0], radius: halfWidth, startAngle: capAngle0, endAngle: capAngle0 + Math.PI });
            addSketchEntity({ id: crypto.randomUUID(), type: 'arc', points: [capCenter2], radius: halfWidth, startAngle: capAngle2, endAngle: capAngle2 + Math.PI });
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
            const capCenter0: SketchPoint = { id: crypto.randomUUID(), x: p0.x, y: p0.y, z: p0.z };
            const capCenter2: SketchPoint = { id: crypto.randomUUID(), x: p2.x, y: p2.y, z: p2.z };
            const capAngle0 = startAngle + Math.PI / 2;
            const capAngle2 = endAngle - Math.PI / 2;
            addSketchEntity({ id: crypto.randomUUID(), type: 'arc', points: [capCenter0], radius: halfWidth, startAngle: capAngle0, endAngle: capAngle0 + Math.PI });
            addSketchEntity({ id: crypto.randomUUID(), type: 'arc', points: [capCenter2], radius: halfWidth, startAngle: capAngle2, endAngle: capAngle2 + Math.PI });
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
        // Click on / near a line: split it at the closest point to the click.
        case 'break': {
          if (!activeSketch) break;
          const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
          let bestEnt: typeof activeSketch.entities[0] | null = null;
          let bestT = 0;
          let bestDist = Infinity;

          for (const ent of activeSketch.entities) {
            if (ent.type !== 'line' || ent.points.length < 2) continue;
            const a = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
            const b = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
            const ab = b.clone().sub(a);
            const len2 = ab.lengthSq();
            if (len2 < 1e-8) continue;
            const t = Math.max(0, Math.min(1, clickPt.clone().sub(a).dot(ab) / len2));
            const closest = a.clone().addScaledVector(ab, t);
            const dist = clickPt.distanceTo(closest);
            if (dist < bestDist) {
              bestDist = dist;
              bestEnt = ent;
              bestT = t;
            }
          }

          // Only act if within a reasonable pick distance (~2 world units)
          if (!bestEnt || bestDist > 2 || bestT <= 0.001 || bestT >= 0.999) {
            setStatusMessage('Break: click closer to a line to split it');
            break;
          }

          const a = bestEnt.points[0];
          const b = bestEnt.points[1];
          const midPt: typeof a = {
            id: crypto.randomUUID(),
            x: a.x + (b.x - a.x) * bestT,
            y: a.y + (b.y - a.y) * bestT,
            z: a.z + (b.z - a.z) * bestT,
          };

          const updated = activeSketch.entities.flatMap((e) => {
            if (e.id !== bestEnt!.id) return [e];
            return [
              { ...e, id: crypto.randomUUID(), points: [a, midPt] },
              { ...e, id: crypto.randomUUID(), points: [midPt, b] },
            ];
          });
          replaceSketchEntities(updated);
          setStatusMessage('Break: line split at selected point');
          break;
        }

        // D57: Linetype conversion — click a line to cycle its type
        case 'linetype-convert': {
          if (!activeSketch) break;
          const ltClickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
          // Find closest line-type entity within snap distance
          let ltBest: typeof activeSketch.entities[0] | null = null;
          let ltBestDist = 3;
          for (const e of activeSketch.entities) {
            if (e.type !== 'line' && e.type !== 'construction-line' && e.type !== 'centerline') continue;
            if (e.points.length < 2) continue;
            const a = new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z);
            const b = new THREE.Vector3(e.points[1].x, e.points[1].y, e.points[1].z);
            const ab = b.clone().sub(a);
            const ap = ltClickPt.clone().sub(a);
            const tc = Math.max(0, Math.min(1, ap.dot(ab) / (ab.lengthSq() || 1)));
            const closest = a.clone().lerp(b, tc);
            const d = ltClickPt.distanceTo(closest);
            if (d < ltBestDist) { ltBestDist = d; ltBest = e; }
          }
          if (ltBest) {
            cycleEntityLinetype(ltBest.id);
            const nextMap: Record<string, string> = { 'line': 'construction-line', 'construction-line': 'centerline', 'centerline': 'line' };
            setStatusMessage(`Linetype → ${nextMap[ltBest.type] ?? ltBest.type}`);
          } else {
            setStatusMessage('Linetype Convert: click near a line to change its type');
          }
          break;
        }

        // ── D17 Trim ───────────────────────────────────────────────────────
        // Click on a segment portion: remove it between nearest intersections.
        case 'trim': {
          if (!activeSketch) break;
          const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);

          // Helper: 2-D line-line intersection parameter along segment a→b
          const lineLineT = (
            ax: number, ay: number, bx: number, by: number,
            cx: number, cy: number, dx: number, dy: number,
          ): { t: number; u: number } | null => {
            const rx = bx - ax, ry = by - ay;
            const sx = dx - cx, sy = dy - cy;
            const cross = rx * sy - ry * sx;
            if (Math.abs(cross) < 1e-10) return null;
            const qx = cx - ax, qy = cy - ay;
            const t = (qx * sy - qy * sx) / cross;
            const u = (qx * ry - qy * rx) / cross;
            return { t, u };
          };

          // Project a 3D point onto a line entity, returning t in [0,1]
          const ptOnLine = (pt: THREE.Vector3, ent: typeof activeSketch.entities[0]): number => {
            if (ent.type !== 'line' || ent.points.length < 2) return -1;
            const a2 = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
            const b2 = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
            const ab2 = b2.clone().sub(a2);
            const len2 = ab2.lengthSq();
            if (len2 < 1e-8) return -1;
            return Math.max(0, Math.min(1, pt.clone().sub(a2).dot(ab2) / len2));
          };

          // Find the line closest to the click
          let bestEnt2: typeof activeSketch.entities[0] | null = null;
          let bestDist2 = Infinity;
          for (const ent of activeSketch.entities) {
            if (ent.type !== 'line' || ent.points.length < 2) continue;
            const a2 = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
            const b2 = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
            const ab2 = b2.clone().sub(a2);
            const len2 = ab2.lengthSq();
            if (len2 < 1e-8) continue;
            const t2 = Math.max(0, Math.min(1, clickPt.clone().sub(a2).dot(ab2) / len2));
            const closest = a2.clone().addScaledVector(ab2, t2);
            const dist = clickPt.distanceTo(closest);
            if (dist < bestDist2) { bestDist2 = dist; bestEnt2 = ent; }
          }

          if (!bestEnt2 || bestDist2 > 2) {
            setStatusMessage('Trim: click closer to a line segment');
            break;
          }

          const trimEnt = bestEnt2;
          // Collect all intersection t-values along trimEnt from every other line
          const intersections: number[] = [0, 1]; // sentinel endpoints
          const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
          const toLocal = (p: typeof activeSketch.entities[0]['points'][0]) => ({
            x: new THREE.Vector3(p.x, p.y, p.z).dot(t1),
            y: new THREE.Vector3(p.x, p.y, p.z).dot(t2),
          });

          const ta0 = toLocal(trimEnt.points[0]);
          const ta1 = toLocal(trimEnt.points[1]);

          for (const other of activeSketch.entities) {
            if (other.id === trimEnt.id || other.type !== 'line' || other.points.length < 2) continue;
            const tb0 = toLocal(other.points[0]);
            const tb1 = toLocal(other.points[1]);
            const res = lineLineT(ta0.x, ta0.y, ta1.x, ta1.y, tb0.x, tb0.y, tb1.x, tb1.y);
            if (res && res.t > 1e-6 && res.t < 1 - 1e-6 && res.u >= 0 && res.u <= 1) {
              intersections.push(res.t);
            }
          }
          intersections.sort((a2, b2) => a2 - b2);

          // Find which interval was clicked
          const clickT = ptOnLine(clickPt, trimEnt);
          let segStart = 0, segEnd = 1;
          for (let k = 0; k < intersections.length - 1; k++) {
            if (clickT >= intersections[k] && clickT <= intersections[k + 1]) {
              segStart = intersections[k];
              segEnd = intersections[k + 1];
              break;
            }
          }

          // Build replacement: keep segments outside the removed interval
          const interpPt = (ent: typeof trimEnt, t3: number): typeof ent.points[0] => ({
            id: crypto.randomUUID(),
            x: ent.points[0].x + (ent.points[1].x - ent.points[0].x) * t3,
            y: ent.points[0].y + (ent.points[1].y - ent.points[0].y) * t3,
            z: ent.points[0].z + (ent.points[1].z - ent.points[0].z) * t3,
          });

          const replacements: typeof activeSketch.entities[0][] = [];
          if (segStart > 1e-6) {
            replacements.push({ ...trimEnt, id: crypto.randomUUID(), points: [trimEnt.points[0], interpPt(trimEnt, segStart)] });
          }
          if (segEnd < 1 - 1e-6) {
            replacements.push({ ...trimEnt, id: crypto.randomUUID(), points: [interpPt(trimEnt, segEnd), trimEnt.points[1]] });
          }

          const updated2 = activeSketch.entities.flatMap((e) =>
            e.id === trimEnt.id ? replacements : [e],
          );
          replaceSketchEntities(updated2);
          setStatusMessage(replacements.length === 0 ? 'Trim: entity removed' : 'Trim: segment trimmed');
          break;
        }

        // ── D18 Extend ─────────────────────────────────────────────────────
        // Click near an endpoint of a line to extend it to the nearest intersection.
        case 'extend': {
          if (!activeSketch) break;
          const clickPt2 = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);

          // Find the line whose nearest endpoint is closest to click
          let extEnt: typeof activeSketch.entities[0] | null = null;
          let extEndIdx: 0 | 1 = 0;
          let extBestDist = Infinity;

          for (const ent of activeSketch.entities) {
            if (ent.type !== 'line' || ent.points.length < 2) continue;
            const p0 = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
            const p1 = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
            const d0 = clickPt2.distanceTo(p0);
            const d1 = clickPt2.distanceTo(p1);
            if (d0 < extBestDist) { extBestDist = d0; extEnt = ent; extEndIdx = 0; }
            if (d1 < extBestDist) { extBestDist = d1; extEnt = ent; extEndIdx = 1; }
          }

          if (!extEnt || extBestDist > 4) {
            setStatusMessage('Extend: click near the endpoint of a line you want to extend');
            break;
          }

          const extA = new THREE.Vector3(extEnt.points[0].x, extEnt.points[0].y, extEnt.points[0].z);
          const extB = new THREE.Vector3(extEnt.points[1].x, extEnt.points[1].y, extEnt.points[1].z);
          const extDir = extEndIdx === 1 ? extB.clone().sub(extA).normalize() : extA.clone().sub(extB).normalize();
          const extOrigin = extEndIdx === 1 ? extB : extA;
          // Plane-local axes for intersection test
          const { t1: extT1, t2: extT2 } = GeometryEngine.getSketchAxes(activeSketch);

          const toLocal2 = (p: typeof activeSketch.entities[0]['points'][0]) => ({
            x: new THREE.Vector3(p.x, p.y, p.z).dot(extT1),
            y: new THREE.Vector3(p.x, p.y, p.z).dot(extT2),
          });
          const lineLineT2 = (
            ax2: number, ay2: number, bx2: number, by2: number,
            cx2: number, cy2: number, dx2: number, dy2: number,
          ): { t: number; u: number } | null => {
            const rx2 = bx2 - ax2, ry2 = by2 - ay2;
            const sx2 = dx2 - cx2, sy2 = dy2 - cy2;
            const cross2 = rx2 * sy2 - ry2 * sx2;
            if (Math.abs(cross2) < 1e-10) return null;
            const qx2 = cx2 - ax2, qy2 = cy2 - ay2;
            const t2r = (qx2 * sy2 - qy2 * sx2) / cross2;
            const u2r = (qx2 * ry2 - qy2 * rx2) / cross2;
            return { t: t2r, u: u2r };
          };

          const extOrigLocal = toLocal2(extEnt.points[extEndIdx]);
          const extDirLocal = { x: extDir.dot(extT1), y: extDir.dot(extT2) };
          const extEnd2 = { x: extOrigLocal.x + extDirLocal.x * 1000, y: extOrigLocal.y + extDirLocal.y * 1000 };

          let closestT: number | null = null;
          for (const other of activeSketch.entities) {
            if (other.id === extEnt.id || other.type !== 'line' || other.points.length < 2) continue;
            const ol0 = toLocal2(other.points[0]);
            const ol1 = toLocal2(other.points[1]);
            const res2 = lineLineT2(extOrigLocal.x, extOrigLocal.y, extEnd2.x, extEnd2.y, ol0.x, ol0.y, ol1.x, ol1.y);
            if (res2 && res2.t > 1e-4 && res2.u >= -0.01 && res2.u <= 1.01) {
              if (closestT === null || res2.t < closestT) closestT = res2.t;
            }
          }

          if (closestT === null) {
            setStatusMessage('Extend: no intersection found along that direction');
            break;
          }

          const newEndPt: typeof extEnt.points[0] = {
            id: crypto.randomUUID(),
            x: extOrigin.x + extDir.x * closestT * 1000,
            y: extOrigin.y + extDir.y * closestT * 1000,
            z: extOrigin.z + extDir.z * closestT * 1000,
          };

          const updExt = activeSketch.entities.map((e) => {
            if (e.id !== extEnt!.id) return e;
            const pts = [...e.points];
            pts[extEndIdx] = newEndPt;
            return { ...e, id: crypto.randomUUID(), points: pts };
          });
          replaceSketchEntities(updExt);
          setStatusMessage('Extend: line extended to nearest intersection');
          break;
        }

        // ── D20 / S12 Sketch Offset ────────────────────────────────────────
        // Click 1: pick a line entity (selects the whole connected chain).
        // Click 2: pick the side (offset direction) → offsets entire chain.
        case 'sketch-offset': {
          if (!activeSketch) break;
          const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);

          // S12: Build adjacency for chain-walking
          const findConnectedChain = (startId: string, entities: typeof activeSketch.entities): typeof activeSketch.entities => {
            const TOL = 0.01;
            const lineEnts = entities.filter((e) => e.type === 'line' && e.points.length >= 2);
            // endpoint-sharing adjacency: for two entities to be adjacent, they share an endpoint
            const sharesEndpoint = (eA: typeof lineEnts[0], eB: typeof lineEnts[0]): boolean => {
              const pts = [
                new THREE.Vector3(eA.points[0].x, eA.points[0].y, eA.points[0].z),
                new THREE.Vector3(eA.points[eA.points.length - 1].x, eA.points[eA.points.length - 1].y, eA.points[eA.points.length - 1].z),
              ];
              const pts2 = [
                new THREE.Vector3(eB.points[0].x, eB.points[0].y, eB.points[0].z),
                new THREE.Vector3(eB.points[eB.points.length - 1].x, eB.points[eB.points.length - 1].y, eB.points[eB.points.length - 1].z),
              ];
              for (const p of pts) for (const q of pts2) if (p.distanceTo(q) < TOL) return true;
              return false;
            };
            const chain: typeof lineEnts = [];
            const visited = new Set<string>();
            const startEnt = lineEnts.find((e) => e.id === startId);
            if (!startEnt) return chain;
            const queue = [startEnt];
            while (queue.length > 0) {
              const cur = queue.shift()!;
              if (visited.has(cur.id)) continue;
              visited.add(cur.id);
              chain.push(cur);
              for (const neighbor of lineEnts) {
                if (!visited.has(neighbor.id) && sharesEndpoint(cur, neighbor)) {
                  queue.push(neighbor);
                }
              }
            }
            return chain;
          };

          if (drawingPoints.length === 0) {
            // First click: find the closest line
            let bestEnt3: typeof activeSketch.entities[0] | null = null;
            let bestDist3 = Infinity;
            for (const ent of activeSketch.entities) {
              if (ent.type !== 'line' || ent.points.length < 2) continue;
              const a3 = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
              const b3 = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
              const ab3 = b3.clone().sub(a3);
              const len23 = ab3.lengthSq();
              if (len23 < 1e-8) continue;
              const t3 = Math.max(0, Math.min(1, clickPt.clone().sub(a3).dot(ab3) / len23));
              const dist = clickPt.distanceTo(a3.clone().addScaledVector(ab3, t3));
              if (dist < bestDist3) { bestDist3 = dist; bestEnt3 = ent; }
            }
            if (!bestEnt3 || bestDist3 > 3) {
              setStatusMessage('Offset: click closer to a line to select it');
              break;
            }
            // Store the selected entity id encoded into drawingPoints[0].id
            const chain12 = findConnectedChain(bestEnt3.id, activeSketch.entities);
            setDrawingPoints([{ ...sketchPoint, id: bestEnt3.id }]);
            const chainNote = chain12.length > 1 ? ` (chain: ${chain12.length} segments)` : '';
            setStatusMessage(`Offset: entity selected${chainNote} — click the side to offset towards`);
          } else {
            // Second click: compute offset direction and add offset copies for entire chain
            const selectedId = drawingPoints[0].id;
            const ent = activeSketch.entities.find((e) => e.id === selectedId);
            if (!ent || ent.type !== 'line' || ent.points.length < 2) {
              setDrawingPoints([]); break;
            }
            // Determine offset sign from first entity
            const a4 = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
            const b4 = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
            const ab4 = b4.clone().sub(a4).normalize();
            const planeNorm4 = t1.clone().cross(t2).normalize();
            const perpDir4 = ab4.clone().cross(planeNorm4).normalize();
            const toClick4 = clickPt.clone().sub(a4);
            const signedDist4 = toClick4.dot(perpDir4);
            const d4 = Math.abs(signedDist4);
            const sign4 = signedDist4 > 0 ? 1 : -1;
            if (d4 < 0.001) { setStatusMessage('Offset: click further from the line'); break; }

            // Walk chain and offset every member
            const chain12b = findConnectedChain(selectedId, activeSketch.entities);
            for (const chainEnt of chain12b) {
              if (chainEnt.type !== 'line' || chainEnt.points.length < 2) continue;
              const ca = new THREE.Vector3(chainEnt.points[0].x, chainEnt.points[0].y, chainEnt.points[0].z);
              const cb = new THREE.Vector3(chainEnt.points[chainEnt.points.length - 1].x, chainEnt.points[chainEnt.points.length - 1].y, chainEnt.points[chainEnt.points.length - 1].z);
              const cab = cb.clone().sub(ca).normalize();
              const cperpDir = cab.clone().cross(planeNorm4).normalize();
              addSketchEntity({
                ...chainEnt,
                id: crypto.randomUUID(),
                points: [
                  { ...chainEnt.points[0], id: crypto.randomUUID(), x: chainEnt.points[0].x + cperpDir.x * d4 * sign4, y: chainEnt.points[0].y + cperpDir.y * d4 * sign4, z: chainEnt.points[0].z + cperpDir.z * d4 * sign4 },
                  { ...chainEnt.points[chainEnt.points.length - 1], id: crypto.randomUUID(), x: chainEnt.points[chainEnt.points.length - 1].x + cperpDir.x * d4 * sign4, y: chainEnt.points[chainEnt.points.length - 1].y + cperpDir.y * d4 * sign4, z: chainEnt.points[chainEnt.points.length - 1].z + cperpDir.z * d4 * sign4 },
                ],
              });
            }
            setDrawingPoints([]);
            const plural = chain12b.length > 1 ? `${chain12b.length} lines` : 'line';
            setStatusMessage(`Offset: ${plural} copied at distance ${d4.toFixed(2)}`);
          }
          break;
        }

        // ── D16 Sketch Fillet ──────────────────────────────────────────────
        // Click the shared corner of two lines; replaces it with a tangent arc.
        // Two clicks needed: click near a vertex where two lines meet.
        case 'sketch-fillet': {
          if (!activeSketch) break;
          const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
          const r = filletRadius;

          // Find the closest vertex shared by two line entities
          type LineEnt = typeof activeSketch.entities[0] & { type: 'line' };
          const lineEnts = activeSketch.entities.filter((e): e is LineEnt => e.type === 'line' && e.points.length >= 2);

          // Collect all endpoints across all lines
          interface VertexCandidate {
            pos: THREE.Vector3;
            lineIdx: number;
            ptIdx: 0 | 1; // which endpoint on that line
          }
          const vertices: VertexCandidate[] = [];
          lineEnts.forEach((e, i) => {
            vertices.push({ pos: new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z), lineIdx: i, ptIdx: 0 });
            vertices.push({ pos: new THREE.Vector3(e.points[1].x, e.points[1].y, e.points[1].z), lineIdx: i, ptIdx: 1 });
          });

          // Group vertices that are within snap tolerance of each other
          const SNAP_TOL = 0.5;
          let bestCorner: { pos: THREE.Vector3; lines: { idx: number; ptIdx: 0 | 1 }[] } | null = null;
          let bestCornerDist = Infinity;

          for (let i = 0; i < vertices.length; i++) {
            const coinc: typeof vertices = [vertices[i]];
            for (let j = i + 1; j < vertices.length; j++) {
              if (vertices[j].lineIdx === vertices[i].lineIdx) continue;
              if (vertices[j].pos.distanceTo(vertices[i].pos) < SNAP_TOL) {
                coinc.push(vertices[j]);
              }
            }
            if (coinc.length < 2) continue;
            const dist = clickPt.distanceTo(vertices[i].pos);
            if (dist < bestCornerDist) {
              bestCornerDist = dist;
              bestCorner = {
                pos: vertices[i].pos.clone(),
                lines: coinc.map((c) => ({ idx: c.lineIdx, ptIdx: c.ptIdx })),
              };
            }
          }

          if (!bestCorner || bestCornerDist > 4 || bestCorner.lines.length < 2) {
            setStatusMessage('Fillet: click near a corner where two lines meet');
            break;
          }

          const corner = bestCorner.pos;
          // Use the first two lines at the corner
          const li0 = bestCorner.lines[0];
          const li1 = bestCorner.lines[1];
          const ent0 = lineEnts[li0.idx];
          const ent1 = lineEnts[li1.idx];

          // Direction vectors pointing AWAY from the corner along each line
          const otherPt0 = li0.ptIdx === 0 ? ent0.points[1] : ent0.points[0];
          const otherPt1 = li1.ptIdx === 0 ? ent1.points[1] : ent1.points[0];
          const dir0 = new THREE.Vector3(otherPt0.x - corner.x, otherPt0.y - corner.y, otherPt0.z - corner.z).normalize();
          const dir1 = new THREE.Vector3(otherPt1.x - corner.x, otherPt1.y - corner.y, otherPt1.z - corner.z).normalize();

          // Half-angle bisector: fillet center is at distance r/sin(halfAngle) from corner
          const cosA = dir0.dot(dir1);
          const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
          if (sinA < 0.01) { setStatusMessage('Fillet: lines are nearly parallel, cannot fillet'); break; }
          const halfAngle = Math.acos(Math.max(-1, Math.min(1, cosA))) / 2;
          const distToCenter = r / Math.sin(halfAngle);
          const bisector = dir0.clone().add(dir1).normalize();
          const arcCenter = corner.clone().addScaledVector(bisector, distToCenter);

          // Tangent points: where fillet circle meets each line
          const tangent0 = corner.clone().addScaledVector(dir0, r / Math.tan(halfAngle));
          const tangent1 = corner.clone().addScaledVector(dir1, r / Math.tan(halfAngle));

          // Arc angles in the sketch plane
          const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
          const toAngle = (v: THREE.Vector3) => Math.atan2(v.dot(t2), v.dot(t1));
          const arcStart = toAngle(tangent0.clone().sub(arcCenter));
          const arcEnd = toAngle(tangent1.clone().sub(arcCenter));

          // Build replacement entities
          const toSkPt = (v: THREE.Vector3): typeof activeSketch.entities[0]['points'][0] => ({
            id: crypto.randomUUID(), x: v.x, y: v.y, z: v.z,
          });

          const updated3 = activeSketch.entities.flatMap((e) => {
            if (e.id === ent0.id) {
              // Shorten ent0: keep the far end → tangent point
              const farPt = li0.ptIdx === 0 ? e.points[1] : e.points[0];
              const t0Pt = toSkPt(tangent0);
              return [{ ...e, id: crypto.randomUUID(), points: li0.ptIdx === 0 ? [e.points[0], t0Pt] : [t0Pt, farPt] }];
            }
            if (e.id === ent1.id) {
              const farPt2 = li1.ptIdx === 0 ? e.points[1] : e.points[0];
              const t1Pt = toSkPt(tangent1);
              return [{ ...e, id: crypto.randomUUID(), points: li1.ptIdx === 0 ? [e.points[0], t1Pt] : [t1Pt, farPt2] }];
            }
            return [e];
          });

          // Insert fillet arc
          updated3.push({
            id: crypto.randomUUID(),
            type: 'arc',
            points: [toSkPt(arcCenter)],
            radius: r,
            startAngle: arcStart,
            endAngle: arcEnd,
          });
          replaceSketchEntities(updated3);
          setStatusMessage(`Fillet: r=${r.toFixed(2)} applied`);
          break;
        }

        // D47: Sketch Chamfer — equal / two-dist / dist+angle variants
        case 'sketch-chamfer-equal':
        case 'sketch-chamfer-two-dist':
        case 'sketch-chamfer-dist-angle': {
          if (!activeSketch) break;
          const chamferClickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);

          // Reuse the same corner-finder as sketch-fillet
          type CLineEnt = typeof activeSketch.entities[0] & { type: 'line' };
          const chamferLines = activeSketch.entities.filter((e): e is CLineEnt => e.type === 'line' && e.points.length >= 2);
          interface CVtx { pos: THREE.Vector3; lineIdx: number; ptIdx: 0 | 1; }
          const chamferVerts: CVtx[] = [];
          chamferLines.forEach((e, i) => {
            chamferVerts.push({ pos: new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z), lineIdx: i, ptIdx: 0 });
            chamferVerts.push({ pos: new THREE.Vector3(e.points[1].x, e.points[1].y, e.points[1].z), lineIdx: i, ptIdx: 1 });
          });

          const CTOL = 0.5;
          let bestChamferCorner: { pos: THREE.Vector3; lines: { idx: number; ptIdx: 0 | 1 }[] } | null = null;
          let bestChamferDist = Infinity;
          for (let i = 0; i < chamferVerts.length; i++) {
            const coinc: CVtx[] = [chamferVerts[i]];
            for (let j = i + 1; j < chamferVerts.length; j++) {
              if (chamferVerts[j].lineIdx === chamferVerts[i].lineIdx) continue;
              if (chamferVerts[j].pos.distanceTo(chamferVerts[i].pos) < CTOL) coinc.push(chamferVerts[j]);
            }
            if (coinc.length < 2) continue;
            const dist = chamferClickPt.distanceTo(chamferVerts[i].pos);
            if (dist < bestChamferDist) {
              bestChamferDist = dist;
              bestChamferCorner = { pos: chamferVerts[i].pos.clone(), lines: coinc.map((c) => ({ idx: c.lineIdx, ptIdx: c.ptIdx })) };
            }
          }

          if (!bestChamferCorner || bestChamferDist > 4 || bestChamferCorner.lines.length < 2) {
            setStatusMessage('Chamfer: click near a corner where two lines meet');
            break;
          }

          const cCorner = bestChamferCorner.pos;
          const cLi0 = bestChamferCorner.lines[0];
          const cLi1 = bestChamferCorner.lines[1];
          const cEnt0 = chamferLines[cLi0.idx];
          const cEnt1 = chamferLines[cLi1.idx];
          const cOther0 = cLi0.ptIdx === 0 ? cEnt0.points[1] : cEnt0.points[0];
          const cOther1 = cLi1.ptIdx === 0 ? cEnt1.points[1] : cEnt1.points[0];
          const cDir0 = new THREE.Vector3(cOther0.x - cCorner.x, cOther0.y - cCorner.y, cOther0.z - cCorner.z).normalize();
          const cDir1 = new THREE.Vector3(cOther1.x - cCorner.x, cOther1.y - cCorner.y, cOther1.z - cCorner.z).normalize();

          // Determine setback distances based on variant
          let sb0 = chamferDist1;
          let sb1 = chamferDist1;
          if (activeTool === 'sketch-chamfer-two-dist') {
            sb0 = chamferDist1;
            sb1 = chamferDist2;
          } else if (activeTool === 'sketch-chamfer-dist-angle') {
            sb0 = chamferDist1;
            sb1 = chamferDist1 * Math.tan((chamferAngle * Math.PI) / 180);
          }

          // Setback points along each line
          const cTangent0 = cCorner.clone().addScaledVector(cDir0, sb0);
          const cTangent1 = cCorner.clone().addScaledVector(cDir1, sb1);

          const toCSkPt = (v: THREE.Vector3): SketchPoint => ({ id: crypto.randomUUID(), x: v.x, y: v.y, z: v.z });

          const chamferUpdated = activeSketch.entities.flatMap((e) => {
            if (e.id === cEnt0.id) {
              const farPt = cLi0.ptIdx === 0 ? e.points[1] : e.points[0];
              const newCornerPt = toCSkPt(cTangent0);
              return [{ ...e, id: crypto.randomUUID(), points: cLi0.ptIdx === 0 ? [e.points[0], newCornerPt] : [newCornerPt, farPt] }];
            }
            if (e.id === cEnt1.id) {
              const farPt2 = cLi1.ptIdx === 0 ? e.points[1] : e.points[0];
              const newCornerPt2 = toCSkPt(cTangent1);
              return [{ ...e, id: crypto.randomUUID(), points: cLi1.ptIdx === 0 ? [e.points[0], newCornerPt2] : [newCornerPt2, farPt2] }];
            }
            return [e];
          });

          // Insert chamfer line between the two setback points
          chamferUpdated.push({
            id: crypto.randomUUID(),
            type: 'line',
            points: [toCSkPt(cTangent0), toCSkPt(cTangent1)],
          });
          replaceSketchEntities(chamferUpdated);
          setStatusMessage(`Chamfer: ${sb0.toFixed(2)} × ${sb1.toFixed(2)} applied`);
          break;
        }

        // ------------------------------------------------------------------
        // D44: Blend Curve (G1 cubic Bezier / G2 quintic Bezier)
        // ------------------------------------------------------------------
        case 'blend-curve': {
          const clickedWorld = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
          const hit = findBlendEndpoint(clickedWorld, activeSketch);
          if (!hit) {
            setStatusMessage('Blend Curve: click near an endpoint of a sketch entity');
            break;
          }

          if (drawingPoints.length === 0) {
            // First click — store P0 and encode tangentA as a second "point" offset
            // We encode: drawingPoints[0] = P0, drawingPoints[1] = P0 + tangentA * 0.001
            const tangentPt: SketchPoint = {
              id: crypto.randomUUID(),
              x: hit.endpoint.x + hit.tangent.x * 0.001,
              y: hit.endpoint.y + hit.tangent.y * 0.001,
              z: hit.endpoint.z + hit.tangent.z * 0.001,
            };
            const endPt: SketchPoint = {
              id: crypto.randomUUID(),
              x: hit.endpoint.x,
              y: hit.endpoint.y,
              z: hit.endpoint.z,
            };
            setDrawingPoints([endPt, tangentPt]);
            setStatusMessage(`Blend Curve: first endpoint set (${blendCurveMode.toUpperCase()}) — click second endpoint`);
          } else if (drawingPoints.length >= 2) {
            // Second click — compute and emit the Bezier blend
            const p0 = new THREE.Vector3(drawingPoints[0].x, drawingPoints[0].y, drawingPoints[0].z);
            const tanRef = new THREE.Vector3(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z);
            const tangentA = tanRef.clone().sub(p0).normalize();
            const p3 = hit.endpoint;
            const tangentB = hit.tangent;

            const samples = sampleCubicBezier(p0, tangentA, p3, tangentB, 32);
            const samplePts: SketchPoint[] = samples.map((v) => ({
              id: crypto.randomUUID(),
              x: v.x,
              y: v.y,
              z: v.z,
            }));

            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'spline',
              points: samplePts,
              closed: false,
            });
            setDrawingPoints([]);
            setStatusMessage(`Blend Curve (${blendCurveMode.toUpperCase()}) added`);
          }
          break;
        }
      }
}
