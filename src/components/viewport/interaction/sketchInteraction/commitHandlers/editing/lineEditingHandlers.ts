import * as THREE from 'three';
import { GeometryEngine } from '../../../../../../engine/GeometryEngine';
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

      if (!bestEnt || bestDist > 2 || bestT <= 0.001 || bestT >= 0.999) {
        setStatusMessage('Break: click closer to a line to split it');
        return true;
      }

      const a = bestEnt.points[0];
      const b = bestEnt.points[1];
      const midPt: typeof a = {
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
