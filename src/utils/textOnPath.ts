import type { SketchEntity, SketchPoint } from '../types/cad';

export interface UV { u: number; v: number; }

/**
 * Sample a sketch entity into a dense 2D polyline in sketch (u,v) coordinates.
 * Supports the entity types usable as a text baseline. `project` maps a
 * SketchPoint to plane coords; arc/circle radii are already in plane units.
 */
export function samplePath2D(entity: SketchEntity, project: (p: SketchPoint) => UV): UV[] {
  switch (entity.type) {
    case 'line':
    case 'construction-line':
    case 'centerline': {
      if (entity.points.length < 2) return [];
      return [project(entity.points[0]), project(entity.points[entity.points.length - 1])];
    }
    case 'spline': {
      return entity.points.map(project);
    }
    case 'arc': {
      if (!entity.points[0] || !entity.radius) return [];
      const c = project(entity.points[0]);
      const r = entity.radius;
      const sa = entity.startAngle ?? 0;
      let ea = entity.endAngle ?? Math.PI;
      if (ea <= sa) ea += Math.PI * 2;
      const span = ea - sa;
      const n = Math.max(16, Math.ceil((span / (Math.PI * 2)) * 96));
      const pts: UV[] = [];
      for (let i = 0; i <= n; i++) {
        const a = sa + (i / n) * span;
        pts.push({ u: c.u + Math.cos(a) * r, v: c.v + Math.sin(a) * r });
      }
      return pts;
    }
    case 'circle': {
      if (!entity.points[0] || !entity.radius) return [];
      const c = project(entity.points[0]);
      const r = entity.radius;
      const n = 96;
      const pts: UV[] = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ u: c.u + Math.cos(a) * r, v: c.v + Math.sin(a) * r });
      }
      return pts;
    }
    case 'ellipse':
    case 'elliptical-arc': {
      if (!entity.points[0] || !entity.majorRadius || !entity.minorRadius) return [];
      const c = project(entity.points[0]);
      const rot = entity.rotation ?? 0;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      const sa = entity.type === 'ellipse' ? 0 : (entity.startAngle ?? 0);
      let ea = entity.type === 'ellipse' ? Math.PI * 2 : (entity.endAngle ?? Math.PI);
      if (ea <= sa) ea += Math.PI * 2;
      const span = ea - sa;
      const n = Math.max(24, Math.ceil((span / (Math.PI * 2)) * 96));
      const pts: UV[] = [];
      for (let i = 0; i <= n; i++) {
        const a = sa + (i / n) * span;
        const x = entity.majorRadius * Math.cos(a);
        const y = entity.minorRadius * Math.sin(a);
        pts.push({ u: c.u + cos * x - sin * y, v: c.v + sin * x + cos * y });
      }
      return pts;
    }
    default:
      return [];
  }
}

export interface ArcTable { pts: UV[]; cum: number[]; total: number; }

/** Build a cumulative arc-length table for a polyline. */
export function buildArcTable(pts: UV[]): ArcTable {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].u - pts[i - 1].u, pts[i].v - pts[i - 1].v));
  }
  return { pts, cum, total: cum[cum.length - 1] || 0 };
}

/**
 * Map a glyph-space point (x = distance along baseline, y = height above
 * baseline) onto the path: walk arc-length `x` along the polyline to a base
 * point, then offset by `y` along the left normal. Returns plane (u,v) coords.
 * Beyond the path end, extrapolates along the final tangent so long strings
 * don't collapse.
 */
export function mapAlongPath(table: ArcTable, x: number, y: number): UV {
  const { pts, cum, total } = table;
  if (pts.length < 2) return { u: x, v: y };

  let s = x;
  let i = 0;
  if (s <= 0) {
    i = 0;
  } else if (s >= total) {
    i = pts.length - 2;
  } else {
    // binary search for the segment containing s
    let lo = 0, hi = pts.length - 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid + 1] < s) lo = mid + 1; else hi = mid;
    }
    i = lo;
  }

  const a = pts[i], b = pts[i + 1];
  const segLen = Math.max(1e-9, cum[i + 1] - cum[i]);
  let tParam = (s - cum[i]) / segLen;
  // allow extrapolation past the ends
  if (s < 0) tParam = (s - cum[i]) / segLen;
  const baseU = a.u + (b.u - a.u) * tParam;
  const baseV = a.v + (b.v - a.v) * tParam;

  // unit tangent and left normal
  let tu = b.u - a.u, tv = b.v - a.v;
  const tl = Math.hypot(tu, tv) || 1;
  tu /= tl; tv /= tl;
  const nu = -tv, nv = tu;

  return { u: baseU + y * nu, v: baseV + y * nv };
}
