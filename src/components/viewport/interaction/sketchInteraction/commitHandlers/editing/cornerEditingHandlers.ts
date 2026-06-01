import * as THREE from 'three';
import type { SketchPoint } from '../../../../../../types/cad';
import type { SketchCommitHandler } from '../types';
import { findFilletCorner, computeFilletGeometry } from '../../cornerFilletGeometry';

export const handleCornerEditingCommit: SketchCommitHandler = (ctx) => {
  const {
    activeTool,
    activeSketch,
    sketchPoint,
    replaceActiveSketchGeometry,
    setStatusMessage,
    filletRadius,
    chamferDist1,
    chamferDist2,
    chamferAngle,
  } = ctx;

  switch (activeTool) {
    case 'sketch-fillet': {
      if (!activeSketch) return false;
      const r = filletRadius;
      const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);

      const cornerInfo = findFilletCorner(activeSketch, clickPt, 4);
      if (!cornerInfo) {
        setStatusMessage('Fillet: click near a corner where two lines meet');
        return true;
      }
      const geo = computeFilletGeometry(activeSketch, cornerInfo, r);
      if (!geo) {
        setStatusMessage('Fillet: lines are nearly parallel, cannot fillet');
        return true;
      }
      const { ent0, ptIdx0, ent1, ptIdx1 } = cornerInfo;
      const { center, tangent0, tangent1, arcStart, arcEnd } = geo;
      const toPt = (v: THREE.Vector3): SketchPoint => ({ id: crypto.randomUUID(), x: v.x, y: v.y, z: v.z });

      const updated = activeSketch.entities.flatMap((e) => {
        if (e.id === ent0.id) {
          // Replace the corner endpoint with the tangent; keep the far end and the
          // same entity ID so existing constraints (H/V etc.) survive.
          const farPt = ptIdx0 === 0 ? e.points[1] : e.points[0];
          const t0Pt = toPt(tangent0);
          return [{ ...e, points: ptIdx0 === 0 ? [t0Pt, farPt] : [farPt, t0Pt] }];
        }
        if (e.id === ent1.id) {
          const farPt = ptIdx1 === 0 ? e.points[1] : e.points[0];
          const t1Pt = toPt(tangent1);
          return [{ ...e, points: ptIdx1 === 0 ? [t1Pt, farPt] : [farPt, t1Pt] }];
        }
        return [e];
      });

      updated.push({
        id: crypto.randomUUID(),
        type: 'arc',
        points: [toPt(center)],
        radius: r,
        startAngle: arcStart,
        endAngle: arcEnd,
      });
      // Drop the coincident weld that joined the two filleted lines at the corner.
      // If left in place, the solver pulls the trimmed tangent points back together
      // and collapses the fillet to a sharp corner again.
      const keptConstraints = (activeSketch.constraints ?? []).filter(
        (c) => !(c.entityIds.includes(ent0.id) && c.entityIds.includes(ent1.id)),
      );
      replaceActiveSketchGeometry(updated, keptConstraints);
      setStatusMessage(`Fillet: r=${r.toFixed(2)} applied`);
      return true;
    }

    case 'sketch-chamfer-equal':
    case 'sketch-chamfer-two-dist':
    case 'sketch-chamfer-dist-angle': {
      if (!activeSketch) return false;
      const clickPt = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
      type LineEnt = typeof activeSketch.entities[0] & { type: 'line' };
      const lineEnts = activeSketch.entities.filter((e): e is LineEnt => e.type === 'line' && e.points.length >= 2);
      const verts: { pos: THREE.Vector3; lineIdx: number; ptIdx: 0 | 1 }[] = [];
      lineEnts.forEach((e, i) => {
        verts.push({ pos: new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z), lineIdx: i, ptIdx: 0 });
        verts.push({ pos: new THREE.Vector3(e.points[1].x, e.points[1].y, e.points[1].z), lineIdx: i, ptIdx: 1 });
      });

      let bestCorner: { pos: THREE.Vector3; lines: { idx: number; ptIdx: 0 | 1 }[] } | null = null;
      let bestDist = Infinity;
      for (let i = 0; i < verts.length; i++) {
        const coinc = [verts[i]];
        for (let j = i + 1; j < verts.length; j++) {
          if (verts[j].lineIdx === verts[i].lineIdx) continue;
          if (verts[j].pos.distanceTo(verts[i].pos) < 0.5) coinc.push(verts[j]);
        }
        if (coinc.length < 2) continue;
        const dist = clickPt.distanceTo(verts[i].pos);
        if (dist < bestDist) {
          bestDist = dist;
          bestCorner = {
            pos: verts[i].pos.clone(),
            lines: coinc.map((c) => ({ idx: c.lineIdx, ptIdx: c.ptIdx })),
          };
        }
      }

      if (!bestCorner || bestDist > 4 || bestCorner.lines.length < 2) {
        setStatusMessage('Chamfer: click near a corner where two lines meet');
        return true;
      }

      const corner = bestCorner.pos;
      const li0 = bestCorner.lines[0];
      const li1 = bestCorner.lines[1];
      const ent0 = lineEnts[li0.idx];
      const ent1 = lineEnts[li1.idx];
      const otherPt0 = li0.ptIdx === 0 ? ent0.points[1] : ent0.points[0];
      const otherPt1 = li1.ptIdx === 0 ? ent1.points[1] : ent1.points[0];
      const dir0 = new THREE.Vector3(otherPt0.x - corner.x, otherPt0.y - corner.y, otherPt0.z - corner.z).normalize();
      const dir1 = new THREE.Vector3(otherPt1.x - corner.x, otherPt1.y - corner.y, otherPt1.z - corner.z).normalize();

      const sb0 = chamferDist1;
      let sb1 = chamferDist1;
      if (activeTool === 'sketch-chamfer-two-dist') {
        sb1 = chamferDist2;
      } else if (activeTool === 'sketch-chamfer-dist-angle') {
        sb1 = chamferDist1 * Math.tan((chamferAngle * Math.PI) / 180);
      }

      const p0 = corner.clone().addScaledVector(dir0, sb0);
      const p1 = corner.clone().addScaledVector(dir1, sb1);
      const toPt = (v: THREE.Vector3): SketchPoint => ({ id: crypto.randomUUID(), x: v.x, y: v.y, z: v.z });
      const updated = activeSketch.entities.flatMap((e) => {
        if (e.id === ent0.id) {
          const farPt = li0.ptIdx === 0 ? e.points[1] : e.points[0];
          const newPt = toPt(p0);
          return [{ ...e, points: li0.ptIdx === 0 ? [newPt, farPt] : [farPt, newPt] }];
        }
        if (e.id === ent1.id) {
          const farPt = li1.ptIdx === 0 ? e.points[1] : e.points[0];
          const newPt = toPt(p1);
          return [{ ...e, points: li1.ptIdx === 0 ? [newPt, farPt] : [farPt, newPt] }];
        }
        return [e];
      });
      updated.push({
        id: crypto.randomUUID(),
        type: 'line',
        points: [toPt(p0), toPt(p1)],
      });
      // Drop the coincident weld between the two chamfered lines so the solver
      // doesn't pull the trimmed endpoints back to the original sharp corner.
      const keptConstraints = (activeSketch.constraints ?? []).filter(
        (c) => !(c.entityIds.includes(ent0.id) && c.entityIds.includes(ent1.id)),
      );
      replaceActiveSketchGeometry(updated, keptConstraints);
      setStatusMessage(`Chamfer: ${sb0.toFixed(2)} x ${sb1.toFixed(2)} applied`);
      return true;
    }
  }

  return false;
};
