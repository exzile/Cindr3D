import * as THREE from 'three';
import type { SketchPoint, SketchEntity, SketchConstraint } from '../../../../../types/cad';
import { circumcenter2D } from '../helpers';
import type { SketchCommitHandler } from './types';

function planeDir(edgeDir: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 {
  return edgeDir.clone().cross(normal).normalize();
}

function applyPolygonConstraints(
  lineIds: string[],
  addSketchConstraint: (c: SketchConstraint) => void,
) {
  const n = lineIds.length;
  if (n < 3) return;
  // coincident: end of line[i] shares position with start of line[(i+1)%n]
  for (let i = 0; i < n; i++) {
    addSketchConstraint({
      id: crypto.randomUUID(),
      type: 'coincident',
      entityIds: [lineIds[i], lineIds[(i + 1) % n]],
      pointIndices: [1, 0],
    });
  }
  // equal: all side lengths equal to first side
  for (let i = 1; i < n; i++) {
    addSketchConstraint({
      id: crypto.randomUUID(),
      type: 'equal',
      entityIds: [lineIds[0], lineIds[i]],
    });
  }
  // polygon constraint carrying all side entityIds for solver
  addSketchConstraint({
    id: crypto.randomUUID(),
    type: 'polygon',
    entityIds: lineIds,
  });
}

export const handleBasicSketchCommit: SketchCommitHandler = (ctx) => {
  const {
    activeTool, activeSketch, sketchPoint, drawingPoints, setDrawingPoints,
    t1, t2, projectToPlane,
    addSketchEntity, addSketchConstraint, setStatusMessage,
    polygonSides, conicRho,
  } = ctx;
  void activeSketch;

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
          const lineIds: string[] = [];
          for (let i = 0; i < sides; i++) {
            const a1 = (i / sides) * Math.PI * 2;
            const a2 = ((i + 1) / sides) * Math.PI * 2;
            const p1: SketchPoint = { id: crypto.randomUUID(), x: center.x + t1.x * Math.cos(a1) * radius + t2.x * Math.sin(a1) * radius, y: center.y + t1.y * Math.cos(a1) * radius + t2.y * Math.sin(a1) * radius, z: center.z + t1.z * Math.cos(a1) * radius + t2.z * Math.sin(a1) * radius };
            const p2: SketchPoint = { id: crypto.randomUUID(), x: center.x + t1.x * Math.cos(a2) * radius + t2.x * Math.sin(a2) * radius, y: center.y + t1.y * Math.cos(a2) * radius + t2.y * Math.sin(a2) * radius, z: center.z + t1.z * Math.cos(a2) * radius + t2.z * Math.sin(a2) * radius };
            const eid = crypto.randomUUID();
            lineIds.push(eid);
            addSketchEntity({ id: eid, type: 'line', points: [p1, p2] });
          }
          applyPolygonConstraints(lineIds, addSketchConstraint);
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
          const lineIds: string[] = [];
          for (let i = 0; i < sides; i++) {
            const a1 = (i / sides) * Math.PI * 2;
            const a2 = ((i + 1) / sides) * Math.PI * 2;
            const p1: SketchPoint = { id: crypto.randomUUID(), x: center.x + t1.x * Math.cos(a1) * radius + t2.x * Math.sin(a1) * radius, y: center.y + t1.y * Math.cos(a1) * radius + t2.y * Math.sin(a1) * radius, z: center.z + t1.z * Math.cos(a1) * radius + t2.z * Math.sin(a1) * radius };
            const p2: SketchPoint = { id: crypto.randomUUID(), x: center.x + t1.x * Math.cos(a2) * radius + t2.x * Math.sin(a2) * radius, y: center.y + t1.y * Math.cos(a2) * radius + t2.y * Math.sin(a2) * radius, z: center.z + t1.z * Math.cos(a2) * radius + t2.z * Math.sin(a2) * radius };
            const eid = crypto.randomUUID();
            lineIds.push(eid);
            addSketchEntity({ id: eid, type: 'line', points: [p1, p2] });
          }
          applyPolygonConstraints(lineIds, addSketchConstraint);
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
          const lineIds: string[] = [];
          for (let i = 0; i < sides; i++) {
            const a1 = startAngle + (i / sides) * Math.PI * 2;
            const a2 = startAngle + ((i + 1) / sides) * Math.PI * 2;
            const v1: SketchPoint = { id: crypto.randomUUID(), x: centerPt.x + t1.x * Math.cos(a1) * radius + t2.x * Math.sin(a1) * radius, y: centerPt.y + t1.y * Math.cos(a1) * radius + t2.y * Math.sin(a1) * radius, z: centerPt.z + t1.z * Math.cos(a1) * radius + t2.z * Math.sin(a1) * radius };
            const v2: SketchPoint = { id: crypto.randomUUID(), x: centerPt.x + t1.x * Math.cos(a2) * radius + t2.x * Math.sin(a2) * radius, y: centerPt.y + t1.y * Math.cos(a2) * radius + t2.y * Math.sin(a2) * radius, z: centerPt.z + t1.z * Math.cos(a2) * radius + t2.z * Math.sin(a2) * radius };
            const eid = crypto.randomUUID();
            lineIds.push(eid);
            addSketchEntity({ id: eid, type: 'line', points: [v1, v2] });
          }
          applyPolygonConstraints(lineIds, addSketchConstraint);
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

    default:
      return false;
  }

  return true;
};
