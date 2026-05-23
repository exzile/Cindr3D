import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { SketchEntity, SketchPoint } from '../../../../types/cad';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

export function createSketchEditingActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    gridSize: 10,
    setGridSize: (size) => set({ gridSize: size }),
    sketchGridSize: null,
    setSketchGridSize: (size) => set({ sketchGridSize: size }),
    snapEnabled: true,
    setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
    objectSnapEnabled: true,
    setObjectSnapEnabled: (v) => set({ objectSnapEnabled: v }),
    snapToEndpoint: true,
    setSnapToEndpoint: (v) => set({ snapToEndpoint: v }),
    snapToMidpoint: true,
    setSnapToMidpoint: (v) => set({ snapToMidpoint: v }),
    snapToCenter: true,
    setSnapToCenter: (v) => set({ snapToCenter: v }),
    snapToIntersection: true,
    setSnapToIntersection: (v) => set({ snapToIntersection: v }),
    snapToPerpendicular: true,
    setSnapToPerpendicular: (v) => set({ snapToPerpendicular: v }),
    snapToTangent: true,
    setSnapToTangent: (v) => set({ snapToTangent: v }),
    gridVisible: true,
    setGridVisible: (visible) => set({ gridVisible: visible }),
    sketchPolygonSides: 6,
    setSketchPolygonSides: (sides) => set({ sketchPolygonSides: Math.max(3, Math.min(128, Math.round(sides))) }),
    sketchFilletRadius: 2,
    setSketchFilletRadius: (r) => set({ sketchFilletRadius: Math.max(0.01, r) }),
    sketchSlotWidth: 4,
    setSketchSlotWidth: (w) => set({ sketchSlotWidth: Math.max(0.01, w) }),

    sketchRectPatternCountX: 3,
    sketchRectPatternCountY: 2,
    sketchRectPatternSpacingX: 10,
    sketchRectPatternSpacingY: 10,
    setSketchRectPattern: (params) =>
      set((state) => ({
        sketchRectPatternCountX: params.countX ?? state.sketchRectPatternCountX,
        sketchRectPatternCountY: params.countY ?? state.sketchRectPatternCountY,
        sketchRectPatternSpacingX: params.spacingX ?? state.sketchRectPatternSpacingX,
        sketchRectPatternSpacingY: params.spacingY ?? state.sketchRectPatternSpacingY,
      })),
    commitSketchRectPattern: () => {
      const { activeSketch, sketchRectPatternCountX: cx, sketchRectPatternCountY: cy, sketchRectPatternSpacingX: sx, sketchRectPatternSpacingY: sy } = get();
      if (!activeSketch || activeSketch.entities.length === 0) return;
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      const copies: SketchEntity[] = [];
      for (let row = 0; row < cy; row++) {
        for (let col = 0; col < cx; col++) {
          if (row === 0 && col === 0) continue;
          const dx = t1.x * sx * col + t2.x * sy * row;
          const dy = t1.y * sx * col + t2.y * sy * row;
          const dz = t1.z * sx * col + t2.z * sy * row;
          for (const ent of activeSketch.entities) {
            copies.push({
              ...ent,
              id: crypto.randomUUID(),
              points: ent.points.map((p) => ({ ...p, id: crypto.randomUUID(), x: p.x + dx, y: p.y + dy, z: p.z + dz })),
            });
          }
        }
      }
      set({
        activeSketch: { ...activeSketch, entities: [...activeSketch.entities, ...copies] },
        statusMessage: `Rectangular pattern: ${cx}Ã—${cy} (${copies.length} new entities added)`,
      });
    },

    sketchCircPatternCount: 6,
    sketchCircPatternRadius: 10,
    sketchCircPatternAngle: 360,
    setSketchCircPattern: (params) =>
      set((state) => ({
        sketchCircPatternCount: params.count ?? state.sketchCircPatternCount,
        sketchCircPatternRadius: params.radius ?? state.sketchCircPatternRadius,
        sketchCircPatternAngle: params.angle ?? state.sketchCircPatternAngle,
      })),
    commitSketchCircPattern: () => {
      const { activeSketch, sketchCircPatternCount: cnt, sketchCircPatternAngle: totalDeg } = get();
      if (!activeSketch || activeSketch.entities.length === 0) return;
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      let cx = 0, cy2 = 0, cz = 0, ptCount = 0;
      for (const ent of activeSketch.entities) {
        for (const p of ent.points) {
          cx += p.x;
          cy2 += p.y;
          cz += p.z;
          ptCount++;
        }
      }
      if (ptCount === 0) return;
      cx /= ptCount;
      cy2 /= ptCount;
      cz /= ptCount;
      const copies: SketchEntity[] = [];
      const totalRad = (totalDeg * Math.PI) / 180;
      for (let i = 1; i < cnt; i++) {
        const angle = (totalRad / cnt) * i;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        for (const ent of activeSketch.entities) {
          copies.push({
            ...ent,
            id: crypto.randomUUID(),
            points: ent.points.map((p) => {
              const lx = (p.x - cx) * t1.x + (p.y - cy2) * t1.y + (p.z - cz) * t1.z;
              const ly = (p.x - cx) * t2.x + (p.y - cy2) * t2.y + (p.z - cz) * t2.z;
              const rx = lx * cosA - ly * sinA;
              const ry = lx * sinA + ly * cosA;
              return {
                ...p,
                id: crypto.randomUUID(),
                x: cx + t1.x * rx + t2.x * ry,
                y: cy2 + t1.y * rx + t2.y * ry,
                z: cz + t1.z * rx + t2.z * ry,
              };
            }),
          });
        }
      }
      set({
        activeSketch: { ...activeSketch, entities: [...activeSketch.entities, ...copies] },
        statusMessage: `Circular pattern: ${cnt} instances (${copies.length} new entities added)`,
      });
    },

    sketchPathPatternCount: 4,
    sketchPathPatternPathEntityId: '',
    sketchPathPatternAlignment: 'tangent' as 'tangent' | 'fixed',
    setSketchPathPattern: (params) =>
      set((state) => ({
        sketchPathPatternCount: params.count ?? state.sketchPathPatternCount,
        sketchPathPatternPathEntityId: params.pathEntityId ?? state.sketchPathPatternPathEntityId,
        sketchPathPatternAlignment: params.alignment ?? state.sketchPathPatternAlignment,
      })),
    commitSketchPathPattern: () => {
      const { activeSketch, sketchPathPatternCount: cnt, sketchPathPatternPathEntityId: pathId, sketchPathPatternAlignment: alignment } = get();
      if (!activeSketch) return;
      const pathEnt = activeSketch.entities.find((e) => e.id === pathId);
      if (!pathEnt || pathEnt.points.length < 2) {
        set({ statusMessage: 'Pattern on Path: select a path curve with at least 2 points' });
        return;
      }
      const pts = pathEnt.points;
      const segLengths: number[] = [];
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        const dz = pts[i].z - pts[i - 1].z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        segLengths.push(len);
        total += len;
      }
      if (total < 0.001) {
        set({ statusMessage: 'Pattern on Path: path has zero length' });
        return;
      }
      const samplePt = (frac: number) => {
        const target = frac * total;
        let acc = 0;
        for (let i = 0; i < segLengths.length; i++) {
          const segEnd = acc + segLengths[i];
          if (target <= segEnd + 1e-9) {
            const t = segLengths[i] > 0 ? (target - acc) / segLengths[i] : 0;
            const p0 = pts[i];
            const p1 = pts[i + 1];
            const tx = p1.x - p0.x;
            const ty = p1.y - p0.y;
            const tz = p1.z - p0.z;
            const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
            return {
              x: p0.x + tx * t,
              y: p0.y + ty * t,
              z: p0.z + tz * t,
              tx: tx / tLen,
              ty: ty / tLen,
              tz: tz / tLen,
            };
          }
          acc = segEnd;
        }
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        const tx = last.x - prev.x;
        const ty = last.y - prev.y;
        const tz = last.z - prev.z;
        const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
        return { x: last.x, y: last.y, z: last.z, tx: tx / tLen, ty: ty / tLen, tz: tz / tLen };
      };
      const origin = samplePt(0);
      const sourceEnts = activeSketch.entities.filter((e) => e.id !== pathId);
      if (sourceEnts.length === 0) {
        set({ statusMessage: 'Pattern on Path: no entities to pattern (path entity only)' });
        return;
      }
      const copies: SketchEntity[] = [];
      for (let i = 1; i < cnt; i++) {
        const sp = samplePt(i / (cnt - 1));
        const dx = sp.x - origin.x;
        const dy = sp.y - origin.y;
        const dz = sp.z - origin.z;
        for (const ent of sourceEnts) {
          const newEnt: SketchEntity = {
            ...ent,
            id: crypto.randomUUID(),
            points: ent.points.map((p) => ({ ...p, id: crypto.randomUUID(), x: p.x + dx, y: p.y + dy, z: p.z + dz })),
          };
          if (alignment === 'tangent') {
            const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
            const otx = origin.tx * t1.x + origin.ty * t1.y + origin.tz * t1.z;
            const oty = origin.tx * t2.x + origin.ty * t2.y + origin.tz * t2.z;
            const oAngle = Math.atan2(oty, otx);
            const stx = sp.tx * t1.x + sp.ty * t1.y + sp.tz * t1.z;
            const sty = sp.tx * t2.x + sp.ty * t2.y + sp.tz * t2.z;
            const sAngle = Math.atan2(sty, stx);
            const dAngle = sAngle - oAngle;
            const cosA = Math.cos(dAngle);
            const sinA = Math.sin(dAngle);
            let px = 0;
            let py = 0;
            let pz = 0;
            let pc = 0;
            for (const p of newEnt.points) {
              px += p.x;
              py += p.y;
              pz += p.z;
              pc++;
            }
            if (pc > 0) {
              px /= pc;
              py /= pc;
              pz /= pc;
            }
            newEnt.points = newEnt.points.map((p) => {
              const lx = (p.x - px) * t1.x + (p.y - py) * t1.y + (p.z - pz) * t1.z;
              const ly = (p.x - px) * t2.x + (p.y - py) * t2.y + (p.z - pz) * t2.z;
              const rx = lx * cosA - ly * sinA;
              const ry = lx * sinA + ly * cosA;
              return { ...p, id: crypto.randomUUID(), x: px + t1.x * rx + t2.x * ry, y: py + t1.y * rx + t2.y * ry, z: pz + t1.z * rx + t2.z * ry };
            });
          }
          copies.push(newEnt);
        }
      }
      set({
        activeSketch: { ...activeSketch, entities: [...activeSketch.entities, ...copies] },
        statusMessage: `Pattern on Path: ${cnt} instances (${copies.length} new entities added)`,
      });
    },

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
        radius: e.radius !== undefined ? e.radius * Math.abs(factor) : undefined,
      }));
      set({
        activeSketch: { ...activeSketch, entities: scaled },
        statusMessage: `Sketch scaled by ${factor}Ã—`,
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
        statusMessage: `Sketch rotated ${angleDeg}Â°`,
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
