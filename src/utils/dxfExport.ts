/**
 * Minimal DXF R12 writer for sketch entities.
 * Supports LINE, CIRCLE, ARC, LWPOLYLINE (for splines/rectangles).
 * Used by D61: Export Sketch as DXF.
 */

import type { Sketch } from '../types/cad';
import { GeometryEngine } from '../engine/GeometryEngine';
import * as THREE from 'three';

function dxfHeader(): string {
  return `  0\nSECTION\n  2\nHEADER\n  9\n$ACADVER\n  1\nAC1009\n  0\nENDSEC\n`;
}

function dxfTableSection(): string {
  return `  0\nSECTION\n  2\nTABLES\n  0\nENDSEC\n`;
}

function dxfLine(x1: number, y1: number, x2: number, y2: number, layer = '0'): string {
  return [
    `  0\nLINE`,
    `  8\n${layer}`,
    `  10\n${x1.toFixed(6)}`,
    `  20\n${y1.toFixed(6)}`,
    `  30\n0.000000`,
    `  11\n${x2.toFixed(6)}`,
    `  21\n${y2.toFixed(6)}`,
    `  31\n0.000000`,
  ].join('\n') + '\n';
}

function dxfCircle(cx: number, cy: number, r: number, layer = '0'): string {
  return [
    `  0\nCIRCLE`,
    `  8\n${layer}`,
    `  10\n${cx.toFixed(6)}`,
    `  20\n${cy.toFixed(6)}`,
    `  30\n0.000000`,
    `  40\n${r.toFixed(6)}`,
  ].join('\n') + '\n';
}

function dxfArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number, layer = '0'): string {
  // DXF arc: counter-clockwise from startDeg to endDeg
  return [
    `  0\nARC`,
    `  8\n${layer}`,
    `  10\n${cx.toFixed(6)}`,
    `  20\n${cy.toFixed(6)}`,
    `  30\n0.000000`,
    `  40\n${r.toFixed(6)}`,
    `  50\n${startDeg.toFixed(6)}`,
    `  51\n${endDeg.toFixed(6)}`,
  ].join('\n') + '\n';
}

function dxfPolyline(pts: { x: number; y: number }[], closed: boolean, layer = '0'): string {
  const flag = closed ? '1' : '0';
  const lines = [
    `  0\nLWPOLYLINE`,
    `  8\n${layer}`,
    `  90\n${pts.length}`,
    `  70\n${flag}`,
  ];
  for (const p of pts) {
    lines.push(`  10\n${p.x.toFixed(6)}`);
    lines.push(`  20\n${p.y.toFixed(6)}`);
  }
  return lines.join('\n') + '\n';
}

/** Project a 3D sketch point into the sketch plane's 2D (u, v) local coords. */
function projectToUV(
  px: number, py: number, pz: number,
  t1: THREE.Vector3, t2: THREE.Vector3,
  origin: THREE.Vector3,
): { u: number; v: number } {
  const dx = px - origin.x, dy = py - origin.y, dz = pz - origin.z;
  return {
    u: dx * t1.x + dy * t1.y + dz * t1.z,
    v: dx * t2.x + dy * t2.y + dz * t2.z,
  };
}

/**
 * Export a Sketch to a DXF R12 string.
 * The sketch is projected into its own 2D plane (u=t1, v=t2).
 */
export function exportSketchAsDXF(sketch: Sketch): string {
  const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
  const origin = sketch.planeOrigin.clone();
  const proj = (px: number, py: number, pz: number) => projectToUV(px, py, pz, t1, t2, origin);

  let entities = '';

  for (const ent of sketch.entities) {
    switch (ent.type) {
      case 'line':
      case 'construction-line':
      case 'centerline': {
        if (ent.points.length < 2) break;
        const { u: u1, v: v1 } = proj(ent.points[0].x, ent.points[0].y, ent.points[0].z);
        const { u: u2, v: v2 } = proj(ent.points[1].x, ent.points[1].y, ent.points[1].z);
        entities += dxfLine(u1, v1, u2, v2);
        break;
      }
      case 'circle': {
        if (ent.points.length < 1 || ent.radius === undefined) break;
        const { u, v } = proj(ent.points[0].x, ent.points[0].y, ent.points[0].z);
        entities += dxfCircle(u, v, ent.radius);
        break;
      }
      case 'arc': {
        if (ent.points.length < 1 || ent.radius === undefined) break;
        const { u, v } = proj(ent.points[0].x, ent.points[0].y, ent.points[0].z);
        const startDeg = ((ent.startAngle ?? 0) * 180) / Math.PI;
        const endDeg = ((ent.endAngle ?? Math.PI * 2) * 180) / Math.PI;
        entities += dxfArc(u, v, ent.radius, startDeg, endDeg);
        break;
      }
      case 'rectangle': {
        if (ent.points.length < 2) break;
        const p0 = proj(ent.points[0].x, ent.points[0].y, ent.points[0].z);
        const p2 = proj(ent.points[1].x, ent.points[1].y, ent.points[1].z);
        const corners = [
          { x: p0.u, y: p0.v },
          { x: p2.u, y: p0.v },
          { x: p2.u, y: p2.v },
          { x: p0.u, y: p2.v },
        ];
        entities += dxfPolyline(corners, true);
        break;
      }
      case 'spline':
      case 'polygon': {
        // Treat as polyline of the stored sample points
        if (ent.points.length < 2) break;
        const pts2d = ent.points.map((p) => {
          const { u, v } = proj(p.x, p.y, p.z);
          return { x: u, y: v };
        });
        entities += dxfPolyline(pts2d, !!ent.closed);
        break;
      }
      case 'slot': {
        // Slot is stored as sub-entities; emit as polyline of points
        if (ent.points.length < 2) break;
        const pts2d = ent.points.map((p) => {
          const { u, v } = proj(p.x, p.y, p.z);
          return { x: u, y: v };
        });
        entities += dxfPolyline(pts2d, false);
        break;
      }
      case 'point': {
        if (ent.points.length < 1) break;
        const { u, v } = proj(ent.points[0].x, ent.points[0].y, ent.points[0].z);
        entities += `  0\nPOINT\n  8\n0\n  10\n${u.toFixed(6)}\n  20\n${v.toFixed(6)}\n  30\n0.000000\n`;
        break;
      }
    }
  }

  return [
    dxfHeader(),
    dxfTableSection(),
    `  0\nSECTION\n  2\nENTITIES\n`,
    entities,
    `  0\nENDSEC\n`,
    `  0\nEOF\n`,
  ].join('');
}

/** Trigger a browser download of a DXF file. */
export function downloadDXF(sketch: Sketch): void {
  const content = exportSketchAsDXF(sketch);
  const blob = new Blob([content], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sketch.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.dxf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
