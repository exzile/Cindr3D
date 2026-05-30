import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import type { SketchEntity, SketchPoint } from '../../../../../types/cad';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createSketchTransformActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    sketchMoveDx: 10,
    sketchMoveDy: 0,
    sketchMoveCopy: false,
    setSketchMove: (params) =>
      set((state) => ({
        sketchMoveDx: params.dx ?? state.sketchMoveDx,
        sketchMoveDy: params.dy ?? state.sketchMoveDy,
        sketchMoveCopy: params.copy ?? state.sketchMoveCopy,
      })),
    commitSketchMove: () => {
      const { activeSketch, sketchMoveDx: dx, sketchMoveDy: dy, sketchMoveCopy: copy } = get();
      if (!activeSketch || activeSketch.entities.length === 0) return;
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      const offsetX = t1.x * dx + t2.x * dy;
      const offsetY = t1.y * dx + t2.y * dy;
      const offsetZ = t1.z * dx + t2.z * dy;
      const translatePts = (ents: SketchEntity[]): SketchEntity[] =>
        ents.map((e) => ({
          ...e,
          id: crypto.randomUUID(),
          points: e.points.map((p) => ({ ...p, id: crypto.randomUUID(), x: p.x + offsetX, y: p.y + offsetY, z: p.z + offsetZ })),
        }));
      const translated = translatePts(activeSketch.entities);
      set({
        activeSketch: { ...activeSketch, entities: copy ? [...activeSketch.entities, ...translated] : translated },
        statusMessage: copy ? `Copy moved by (${dx}, ${dy})` : `Sketch moved by (${dx}, ${dy})`,
      });
    },

    sketchScaleFactor: 2,
    setSketchScaleFactor: (f) => set({ sketchScaleFactor: Math.max(0.001, f) }),
    commitSketchScale: () => {
      const { activeSketch, sketchScaleFactor: factor } = get();
      if (!activeSketch || activeSketch.entities.length === 0) return;
      let cx = 0, cy2 = 0, cz = 0, n = 0;
      for (const e of activeSketch.entities) {
        for (const p of e.points) { cx += p.x; cy2 += p.y; cz += p.z; n++; }
      }
      if (n === 0) return;
      cx /= n; cy2 /= n; cz /= n;
      const scaled = activeSketch.entities.map((e) => ({
        ...e,
        id: crypto.randomUUID(),
        points: e.points.map((p) => ({
          ...p,
          id: crypto.randomUUID(),
          x: cx + (p.x - cx) * factor,
          y: cy2 + (p.y - cy2) * factor,
          z: cz + (p.z - cz) * factor,
        })),
        radius: e.radius !== undefined ? Math.abs(e.radius * factor) : undefined,
      }));
      set({
        activeSketch: { ...activeSketch, entities: scaled },
        statusMessage: `Sketch scaled by ${factor}x`,
      });
    },

    sketchRotateAngle: 90,
    setSketchRotateAngle: (a) => set({ sketchRotateAngle: a }),
    commitSketchRotate: () => {
      const { activeSketch, sketchRotateAngle: angleDeg } = get();
      if (!activeSketch || activeSketch.entities.length === 0) return;
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      let cx = 0, cy2 = 0, cz = 0, n = 0;
      for (const e of activeSketch.entities) {
        for (const p of e.points) { cx += p.x; cy2 += p.y; cz += p.z; n++; }
      }
      if (n === 0) return;
      cx /= n; cy2 /= n; cz /= n;
      const angle = (angleDeg * Math.PI) / 180;
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      const rotPt = (p: SketchPoint): SketchPoint => {
        const lx = (p.x - cx) * t1.x + (p.y - cy2) * t1.y + (p.z - cz) * t1.z;
        const ly = (p.x - cx) * t2.x + (p.y - cy2) * t2.y + (p.z - cz) * t2.z;
        const rx = lx * cosA - ly * sinA;
        const ry = lx * sinA + ly * cosA;
        return { ...p, id: crypto.randomUUID(), x: cx + t1.x * rx + t2.x * ry, y: cy2 + t1.y * rx + t2.y * ry, z: cz + t1.z * rx + t2.z * ry };
      };
      const rotated = activeSketch.entities.map((e) => ({
        ...e,
        id: crypto.randomUUID(),
        points: e.points.map(rotPt),
      }));
      set({
        activeSketch: { ...activeSketch, entities: rotated },
        statusMessage: `Sketch rotated ${angleDeg} degrees`,
      });
    },

    sketchOffsetDistance: 2,
    setSketchOffsetDistance: (d) => set({ sketchOffsetDistance: Math.max(0.001, Math.abs(d)) }),

    sketchMirrorAxis: 'vertical',
    setSketchMirrorAxis: (axis) => set({ sketchMirrorAxis: axis }),
    commitSketchMirror: () => {
      const { activeSketch, sketchMirrorAxis } = get();
      if (!activeSketch || activeSketch.entities.length === 0) return;
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      let cx = 0, cy2 = 0, cz = 0, n = 0;
      for (const e of activeSketch.entities) {
        for (const p of e.points) { cx += p.x; cy2 += p.y; cz += p.z; n++; }
      }
      if (n === 0) return;
      cx /= n; cy2 /= n; cz /= n;
      const mirrorPt = (p: SketchPoint): SketchPoint => {
        const lx = (p.x - cx) * t1.x + (p.y - cy2) * t1.y + (p.z - cz) * t1.z;
        const ly = (p.x - cx) * t2.x + (p.y - cy2) * t2.y + (p.z - cz) * t2.z;
        let mx = lx, my = ly;
        if (sketchMirrorAxis === 'horizontal') my = -ly;
        else if (sketchMirrorAxis === 'vertical') mx = -lx;
        else { const tmp = lx; mx = ly; my = tmp; }
        return { ...p, id: crypto.randomUUID(), x: cx + t1.x * mx + t2.x * my, y: cy2 + t1.y * mx + t2.y * my, z: cz + t1.z * mx + t2.z * my };
      };
      const mirrored: SketchEntity[] = activeSketch.entities.map((e) => ({
        ...e,
        id: crypto.randomUUID(),
        points: e.points.map(mirrorPt),
        startAngle: (e.startAngle !== undefined && e.endAngle !== undefined)
          ? (sketchMirrorAxis === 'vertical' ? Math.PI - e.endAngle : -e.endAngle)
          : undefined,
        endAngle: (e.startAngle !== undefined && e.endAngle !== undefined)
          ? (sketchMirrorAxis === 'vertical' ? Math.PI - e.startAngle : -e.startAngle)
          : undefined,
      }));
      set({
        activeSketch: { ...activeSketch, entities: [...activeSketch.entities, ...mirrored] },
        statusMessage: `Mirror: ${mirrored.length} entities added (${sketchMirrorAxis})`,
      });
    },
  };
}
