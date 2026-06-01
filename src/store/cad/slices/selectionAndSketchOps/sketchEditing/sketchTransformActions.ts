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

      // SKETCH-1.3: support picking an existing sketch line as the mirror axis
      const isPicked = sketchMirrorAxis !== 'horizontal' && sketchMirrorAxis !== 'vertical' && sketchMirrorAxis !== 'diagonal';
      let axisOrigin = { lx: 0, ly: 0 };
      let axisDirLx = 0, axisDirLy = 1; // local 2D direction

      if (isPicked) {
        const axisEnt = activeSketch.entities.find((e) => e.id === sketchMirrorAxis && e.points.length >= 2);
        if (!axisEnt) {
          set({ statusMessage: 'Mirror: picked line not found in sketch' });
          return;
        }
        const p0 = axisEnt.points[0];
        const p1 = axisEnt.points[1];
        axisOrigin = {
          lx: p0.x * t1.x + p0.y * t1.y + p0.z * t1.z,
          ly: p0.x * t2.x + p0.y * t2.y + p0.z * t2.z,
        };
        const dl = {
          lx: (p1.x - p0.x) * t1.x + (p1.y - p0.y) * t1.y + (p1.z - p0.z) * t1.z,
          ly: (p1.x - p0.x) * t2.x + (p1.y - p0.y) * t2.y + (p1.z - p0.z) * t2.z,
        };
        const dlen = Math.sqrt(dl.lx * dl.lx + dl.ly * dl.ly) || 1;
        axisDirLx = dl.lx / dlen;
        axisDirLy = dl.ly / dlen;
      } else {
        // Fixed-axis: centroid as pivot
        let cx = 0, cy2 = 0, cz = 0, n = 0;
        for (const e of activeSketch.entities) {
          for (const p of e.points) { cx += p.x; cy2 += p.y; cz += p.z; n++; }
        }
        if (n === 0) return;
        cx /= n; cy2 /= n; cz /= n;
        axisOrigin = {
          lx: cx * t1.x + cy2 * t1.y + cz * t1.z,
          ly: cx * t2.x + cy2 * t2.y + cz * t2.z,
        };
        if (sketchMirrorAxis === 'horizontal') { axisDirLx = 1; axisDirLy = 0; }
        else if (sketchMirrorAxis === 'vertical') { axisDirLx = 0; axisDirLy = 1; }
        else { axisDirLx = 1 / Math.SQRT2; axisDirLy = 1 / Math.SQRT2; }
      }

      // Reflect a local 2D point across the axis line (origin + direction)
      const reflectLocal = (lx: number, ly: number): { lx: number; ly: number } => {
        const ox = lx - axisOrigin.lx, oy = ly - axisOrigin.ly;
        const dot = ox * axisDirLx + oy * axisDirLy;
        const projX = dot * axisDirLx, projY = dot * axisDirLy;
        return { lx: axisOrigin.lx + 2 * projX - ox, ly: axisOrigin.ly + 2 * projY - oy };
      };

      const mirrorPt = (p: SketchPoint): SketchPoint => {
        const lx = p.x * t1.x + p.y * t1.y + p.z * t1.z;
        const ly = p.x * t2.x + p.y * t2.y + p.z * t2.z;
        const { lx: mx, ly: my } = reflectLocal(lx, ly);
        return { ...p, id: crypto.randomUUID(), x: t1.x * mx + t2.x * my, y: t1.y * mx + t2.y * my, z: t1.z * mx + t2.z * my };
      };

      const label = isPicked ? 'picked line' : sketchMirrorAxis;
      const entitiesToMirror = isPicked
        ? activeSketch.entities.filter((e) => e.id !== sketchMirrorAxis)
        : activeSketch.entities;

      const mirrored: SketchEntity[] = entitiesToMirror.map((e) => ({
        ...e,
        id: crypto.randomUUID(),
        points: e.points.map(mirrorPt),
        // Arc angle reflection for picked-line axis: use general formula (negate relative to axis normal)
        startAngle: (e.startAngle !== undefined && e.endAngle !== undefined && !isPicked)
          ? (sketchMirrorAxis === 'vertical' ? Math.PI - e.endAngle : -e.endAngle)
          : e.startAngle,
        endAngle: (e.startAngle !== undefined && e.endAngle !== undefined && !isPicked)
          ? (sketchMirrorAxis === 'vertical' ? Math.PI - e.startAngle : -e.startAngle)
          : e.endAngle,
      }));
      set({
        activeSketch: { ...activeSketch, entities: [...activeSketch.entities, ...mirrored] },
        statusMessage: `Mirror: ${mirrored.length} entities added (${label})`,
      });
    },
  };
}
