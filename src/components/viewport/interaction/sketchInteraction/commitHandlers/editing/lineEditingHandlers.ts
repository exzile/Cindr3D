import * as THREE from 'three';
import { GeometryEngine } from '../../../../../../engine/GeometryEngine';
import { useCADStore } from '../../../../../../store/cadStore';
import type { SketchPoint } from '../../../../../../types/cad';
import type { SketchCommitHandler } from '../types';

export const handleLineEditingCommit: SketchCommitHandler = (ctx) => {
  const {
    activeTool,
    activeSketch,
    sketchPoint,
    replaceSketchEntities,
    cycleEntityLinetype,
    setStatusMessage,
  } = ctx;

  switch (activeTool) {
    case 'break': {
      if (!activeSketch) return false;
      const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      let bestEnt: typeof activeSketch.entities[0] | null = null;
      let bestT = 0;
      let bestDist = 2; // pick radius in world-space mm
      let bestIsArc = false;
      let bestSplitAngle = 0;

      for (const ent of activeSketch.entities) {
        if (ent.points.length < 1) continue;

        if ((ent.type === 'line' || ent.type === 'construction-line' || ent.type === 'centerline') && ent.points.length >= 2) {
          const a = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
          const b = new THREE.Vector3(ent.points[ent.points.length - 1].x, ent.points[ent.points.length - 1].y, ent.points[ent.points.length - 1].z);
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
            bestIsArc = false;
          }
        }

        if (ent.type === 'arc' && ent.radius != null && ent.points.length >= 1) {
          const center = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
          const r = ent.radius;
          const dist = Math.abs(clickPt.distanceTo(center) - r);
          if (dist < bestDist) {
            // Find the angle of the click projected onto the arc's plane
            const toClick = clickPt.clone().sub(center);
            const angle = Math.atan2(toClick.dot(t2), toClick.dot(t1));
            // Clamp angle inside the arc's sweep
            const sa = ent.startAngle ?? 0;
            let ea = ent.endAngle ?? Math.PI;
            if (ea <= sa) ea += 2 * Math.PI;
            let normAngle = angle - sa;
            while (normAngle < 0) normAngle += 2 * Math.PI;
            if (normAngle > ea - sa) continue; // outside arc sweep
            const fracT = normAngle / (ea - sa);
            if (fracT < 0.01 || fracT > 0.99) continue; // too close to endpoints
            bestDist = dist;
            bestEnt = ent;
            bestIsArc = true;
            bestSplitAngle = sa + normAngle;
          }
        }
      }

      if (!bestEnt || bestDist > 2) {
        setStatusMessage('Break: click closer to a sketch entity to split it');
        return true;
      }

      if (bestIsArc && bestEnt.radius != null) {
        // Split arc into two arcs sharing the split point
        const sa = bestEnt.startAngle ?? 0;
        let ea = bestEnt.endAngle ?? Math.PI;
        if (ea <= sa) ea += 2 * Math.PI;
        const cx = bestEnt.points[0];
        const center = new THREE.Vector3(cx.x, cx.y, cx.z);
        const r = bestEnt.radius;
        const splitPt: SketchPoint = {
          id: crypto.randomUUID(),
          x: center.x + t1.x * r * Math.cos(bestSplitAngle) + t2.x * r * Math.sin(bestSplitAngle),
          y: center.y + t1.y * r * Math.cos(bestSplitAngle) + t2.y * r * Math.sin(bestSplitAngle),
          z: center.z + t1.z * r * Math.cos(bestSplitAngle) + t2.z * r * Math.sin(bestSplitAngle),
        };
        replaceSketchEntities(
          activeSketch.entities.flatMap((e) => {
            if (e.id !== bestEnt!.id) return [e];
            return [
              { ...e, id: crypto.randomUUID(), points: [cx, splitPt], startAngle: sa, endAngle: bestSplitAngle },
              { ...e, id: crypto.randomUUID(), points: [cx, splitPt], startAngle: bestSplitAngle, endAngle: ea > 2 * Math.PI ? ea - 2 * Math.PI : ea },
            ];
          }),
        );
        setStatusMessage('Break: arc split at selected point');
        return true;
      }

      // Line split
      if (bestT <= 0.001 || bestT >= 0.999) {
        setStatusMessage('Break: click farther from the endpoints to split the line');
        return true;
      }
      const a = bestEnt.points[0];
      const b = bestEnt.points[bestEnt.points.length - 1];
      const midPt: SketchPoint = {
        id: crypto.randomUUID(),
        x: a.x + (b.x - a.x) * bestT,
        y: a.y + (b.y - a.y) * bestT,
        z: a.z + (b.z - a.z) * bestT,
      };

      replaceSketchEntities(
        activeSketch.entities.flatMap((e) => {
          if (e.id !== bestEnt!.id) return [e];
          return [
            { ...e, id: crypto.randomUUID(), points: [a, midPt] },
            { ...e, id: crypto.randomUUID(), points: [midPt, b] },
          ];
        }),
      );
      setStatusMessage('Break: line split at selected point');
      return true;
    }

    case 'linetype-convert': {
      if (!activeSketch) return false;
      const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
      let best: typeof activeSketch.entities[0] | null = null;
      let bestDist = 3;
      for (const e of activeSketch.entities) {
        if (e.type !== 'line' && e.type !== 'construction-line' && e.type !== 'centerline') continue;
        if (e.points.length < 2) continue;
        const a = new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z);
        const b = new THREE.Vector3(e.points[1].x, e.points[1].y, e.points[1].z);
        const ab = b.clone().sub(a);
        const ap = clickPt.clone().sub(a);
        const tc = Math.max(0, Math.min(1, ap.dot(ab) / (ab.lengthSq() || 1)));
        const closest = a.clone().lerp(b, tc);
        const dist = clickPt.distanceTo(closest);
        if (dist < bestDist) {
          bestDist = dist;
          best = e;
        }
      }
      if (best) {
        cycleEntityLinetype(best.id);
        const nextMap: Record<string, string> = {
          line: 'construction-line',
          'construction-line': 'centerline',
          centerline: 'line',
        };
        setStatusMessage(`Linetype -> ${nextMap[best.type] ?? best.type}`);
      } else {
        setStatusMessage('Linetype Convert: click near a line to change its type');
      }
      return true;
    }

    case 'trim': {
      if (!activeSketch) return false;
      const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
      const lineLineT = (
        ax: number,
        ay: number,
        bx: number,
        by: number,
        cx: number,
        cy: number,
        dx: number,
        dy: number,
      ): { t: number; u: number } | null => {
        const rx = bx - ax;
        const ry = by - ay;
        const sx = dx - cx;
        const sy = dy - cy;
        const cross = rx * sy - ry * sx;
        if (Math.abs(cross) < 1e-10) return null;
        const qx = cx - ax;
        const qy = cy - ay;
        return {
          t: (qx * sy - qy * sx) / cross,
          u: (qx * ry - qy * rx) / cross,
        };
      };

      const pointOnLine = (pt: THREE.Vector3, ent: typeof activeSketch.entities[0]): number => {
        if (ent.type !== 'line' || ent.points.length < 2) return -1;
        const a = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
        const b = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
        const ab = b.clone().sub(a);
        const len2 = ab.lengthSq();
        if (len2 < 1e-8) return -1;
        return Math.max(0, Math.min(1, pt.clone().sub(a).dot(ab) / len2));
      };

      let target: typeof activeSketch.entities[0] | null = null;
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
          target = ent;
        }
      }

      if (!target || bestDist > 2) {
        setStatusMessage('Trim: click closer to a line segment');
        return true;
      }

      const intersections: number[] = [0, 1];
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      const toLocal = (p: typeof activeSketch.entities[0]['points'][0]) => ({
        x: new THREE.Vector3(p.x, p.y, p.z).dot(t1),
        y: new THREE.Vector3(p.x, p.y, p.z).dot(t2),
      });
      const a0 = toLocal(target.points[0]);
      const a1 = toLocal(target.points[1]);

      for (const other of activeSketch.entities) {
        if (other.id === target.id || other.type !== 'line' || other.points.length < 2) continue;
        const b0 = toLocal(other.points[0]);
        const b1 = toLocal(other.points[1]);
        const res = lineLineT(a0.x, a0.y, a1.x, a1.y, b0.x, b0.y, b1.x, b1.y);
        if (res && res.t > 1e-6 && res.t < 1 - 1e-6 && res.u >= 0 && res.u <= 1) {
          intersections.push(res.t);
        }
      }
      intersections.sort((a, b) => a - b);

      const clickT = pointOnLine(clickPt, target);
      let segStart = 0;
      let segEnd = 1;
      for (let k = 0; k < intersections.length - 1; k++) {
        if (clickT >= intersections[k] && clickT <= intersections[k + 1]) {
          segStart = intersections[k];
          segEnd = intersections[k + 1];
          break;
        }
      }

      const interpPt = (ent: typeof target, t: number): SketchPoint => ({
        id: crypto.randomUUID(),
        x: ent.points[0].x + (ent.points[1].x - ent.points[0].x) * t,
        y: ent.points[0].y + (ent.points[1].y - ent.points[0].y) * t,
        z: ent.points[0].z + (ent.points[1].z - ent.points[0].z) * t,
      });

      const replacements: typeof activeSketch.entities[0][] = [];
      if (segStart > 1e-6) {
        replacements.push({
          ...target,
          id: crypto.randomUUID(),
          points: [target.points[0], interpPt(target, segStart)],
        });
      }
      if (segEnd < 1 - 1e-6) {
        replacements.push({
          ...target,
          id: crypto.randomUUID(),
          points: [interpPt(target, segEnd), target.points[1]],
        });
      }

      replaceSketchEntities(
        activeSketch.entities.flatMap((e) => (e.id === target!.id ? replacements : [e])),
      );
      setStatusMessage(replacements.length === 0 ? 'Trim: entity removed' : 'Trim: segment trimmed');
      return true;
    }

    case 'sketch-offset': {
      if (!activeSketch) return false;
      const distance = useCADStore.getState().sketchOffsetDistance;
      const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);

      let bestEnt: typeof activeSketch.entities[0] | null = null;
      let bestDist = Infinity;

      for (const ent of activeSketch.entities) {
        if (ent.type === 'line' || ent.type === 'construction-line' || ent.type === 'centerline') {
          if (ent.points.length < 2) continue;
          const a = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
          const b = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
          const ab = b.clone().sub(a);
          const len2 = ab.lengthSq();
          if (len2 < 1e-8) continue;
          const t = Math.max(0, Math.min(1, clickPt.clone().sub(a).dot(ab) / len2));
          const closest = a.clone().addScaledVector(ab, t);
          const d = clickPt.distanceTo(closest);
          if (d < bestDist) { bestDist = d; bestEnt = ent; }
        } else if ((ent.type === 'circle' || ent.type === 'arc') && ent.radius !== undefined) {
          const center = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
          const d = Math.abs(clickPt.distanceTo(center) - ent.radius);
          if (d < bestDist) { bestDist = d; bestEnt = ent; }
        }
      }

      if (!bestEnt || bestDist > 10) {
        setStatusMessage('Offset: click closer to a line or circle/arc');
        return true;
      }

      const ent = bestEnt;

      if (ent.type === 'line' || ent.type === 'construction-line' || ent.type === 'centerline') {
        const a3 = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
        const b3 = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
        const dir = b3.clone().sub(a3).normalize();
        // In-plane perpendicular: rotate line dir 90° within the sketch plane
        const t1c = dir.dot(t1);
        const t2c = dir.dot(t2);
        const norm = Math.sqrt(t1c * t1c + t2c * t2c) || 1;
        const perp = t1.clone().multiplyScalar(-t2c / norm).addScaledVector(t2, t1c / norm);
        const signedDist = clickPt.clone().sub(a3).dot(perp);
        const side = signedDist >= 0 ? 1 : -1;
        const offset = perp.clone().multiplyScalar(side * distance);
        const p0: SketchPoint = { id: crypto.randomUUID(), x: ent.points[0].x + offset.x, y: ent.points[0].y + offset.y, z: ent.points[0].z + offset.z };
        const p1: SketchPoint = { id: crypto.randomUUID(), x: ent.points[1].x + offset.x, y: ent.points[1].y + offset.y, z: ent.points[1].z + offset.z };
        addSketchEntity({ id: crypto.randomUUID(), type: ent.type, points: [p0, p1] });
        setStatusMessage(`Offset: line offset by ${distance.toFixed(2)} mm`);
      } else if ((ent.type === 'circle' || ent.type === 'arc') && ent.radius !== undefined) {
        const center = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
        const distToCenter = clickPt.distanceTo(center);
        const inside = distToCenter < ent.radius;
        const newRadius = inside ? ent.radius - distance : ent.radius + distance;
        if (newRadius < 0.001) {
          setStatusMessage('Offset: result radius too small — increase offset distance or use outside offset');
          return true;
        }
        const newCenter: SketchPoint = { id: crypto.randomUUID(), x: center.x, y: center.y, z: center.z };
        addSketchEntity({
          id: crypto.randomUUID(),
          type: ent.type,
          points: [newCenter],
          radius: newRadius,
          ...(ent.startAngle !== undefined ? { startAngle: ent.startAngle } : {}),
          ...(ent.endAngle !== undefined ? { endAngle: ent.endAngle } : {}),
        });
        setStatusMessage(`Offset: ${ent.type} radius ${inside ? 'decreased' : 'increased'} by ${distance.toFixed(2)} mm`);
      }

      return true;
    }

    case 'extend': {
      if (!activeSketch) return false;
      const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
      let target: typeof activeSketch.entities[0] | null = null;
      let endIdx: 0 | 1 = 0;
      let bestDist = Infinity;

      for (const ent of activeSketch.entities) {
        if (ent.type !== 'line' || ent.points.length < 2) continue;
        const p0 = new THREE.Vector3(ent.points[0].x, ent.points[0].y, ent.points[0].z);
        const p1 = new THREE.Vector3(ent.points[1].x, ent.points[1].y, ent.points[1].z);
        const d0 = clickPt.distanceTo(p0);
        const d1 = clickPt.distanceTo(p1);
        if (d0 < bestDist) {
          bestDist = d0;
          target = ent;
          endIdx = 0;
        }
        if (d1 < bestDist) {
          bestDist = d1;
          target = ent;
          endIdx = 1;
        }
      }

      if (!target || bestDist > 4) {
        setStatusMessage('Extend: click near the endpoint of a line you want to extend');
        return true;
      }

      const a = new THREE.Vector3(target.points[0].x, target.points[0].y, target.points[0].z);
      const b = new THREE.Vector3(target.points[1].x, target.points[1].y, target.points[1].z);
      const dir = endIdx === 1 ? b.clone().sub(a).normalize() : a.clone().sub(b).normalize();
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      const toLocal = (p: typeof activeSketch.entities[0]['points'][0]) => ({
        x: new THREE.Vector3(p.x, p.y, p.z).dot(t1),
        y: new THREE.Vector3(p.x, p.y, p.z).dot(t2),
      });
      const lineLineT = (
        ax: number,
        ay: number,
        bx: number,
        by: number,
        cx: number,
        cy: number,
        dx: number,
        dy: number,
      ): { t: number; u: number } | null => {
        const rx = bx - ax;
        const ry = by - ay;
        const sx = dx - cx;
        const sy = dy - cy;
        const cross = rx * sy - ry * sx;
        if (Math.abs(cross) < 1e-10) return null;
        const qx = cx - ax;
        const qy = cy - ay;
        return {
          t: (qx * sy - qy * sx) / cross,
          u: (qx * ry - qy * rx) / cross,
        };
      };

      const origin = toLocal(target.points[endIdx]);
      const dirLocal = { x: dir.dot(t1), y: dir.dot(t2) };
      const far = { x: origin.x + dirLocal.x * 1000, y: origin.y + dirLocal.y * 1000 };
      let bestT = Infinity;
      let bestPoint: THREE.Vector3 | null = null;

      for (const other of activeSketch.entities) {
        if (other.id === target.id || other.type !== 'line' || other.points.length < 2) continue;
        const b0 = toLocal(other.points[0]);
        const b1 = toLocal(other.points[1]);
        const res = lineLineT(origin.x, origin.y, far.x, far.y, b0.x, b0.y, b1.x, b1.y);
        if (!res || res.t <= 1e-6 || res.u < 0 || res.u > 1) continue;
        if (res.t < bestT) {
          bestT = res.t;
          bestPoint = new THREE.Vector3(
            target.points[endIdx].x + dir.x * res.t * 1000,
            target.points[endIdx].y + dir.y * res.t * 1000,
            target.points[endIdx].z + dir.z * res.t * 1000,
          );
        }
      }

      if (!bestPoint) {
        setStatusMessage('Extend: no intersection found in that direction');
        return true;
      }

      const updated = activeSketch.entities.map((e) => {
        if (e.id !== target!.id) return e;
        const p: SketchPoint = { id: crypto.randomUUID(), x: bestPoint!.x, y: bestPoint!.y, z: bestPoint!.z };
        return {
          ...e,
          points: endIdx === 0 ? [p, e.points[1]] : [e.points[0], p],
        };
      });
      replaceSketchEntities(updated);
      setStatusMessage('Extend: line extended to nearest intersection');
      return true;
    }
  }

  return false;
};
