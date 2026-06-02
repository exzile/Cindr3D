import type { CSSProperties } from "react";
import * as THREE from "three";

export type Vec2 = { x: number; y: number };

export const dimensionAnnotationLineMaterial = new THREE.LineBasicMaterial({
  color: "#111111",
  depthTest: false,
  depthWrite: false,
  transparent: true,
  opacity: 0.95,
});

export const dimensionLabelStyle: CSSProperties = {
  background: "rgba(255, 255, 255, 0.94)",
  border: "1px solid rgba(96, 165, 250, 0.65)",
  borderRadius: 4,
  color: "#1e3a8a",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: "14px",
  padding: "1px 5px",
  whiteSpace: "nowrap",
};

export function toWorld(
  p: Vec2,
  origin: THREE.Vector3,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
): THREE.Vector3 {
  return origin.clone().addScaledVector(t1, p.x).addScaledVector(t2, p.y);
}

export function makeSegments(
  pairs: [Vec2, Vec2][],
  origin: THREE.Vector3,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
): THREE.LineSegments {
  const verts: number[] = [];
  for (const [a, b] of pairs) {
    const wa = toWorld(a, origin, t1, t2);
    const wb = toWorld(b, origin, t1, t2);
    verts.push(wa.x, wa.y, wa.z, wb.x, wb.y, wb.z);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(verts), 3),
  );
  return new THREE.LineSegments(geom, dimensionAnnotationLineMaterial);
}

/** Max segment pairs pre-allocated per annotation (covers all dimension types). */
export const MAX_ANNOTATION_PAIRS = 72;

/**
 * Create a LineSegments with a pre-allocated position buffer (MAX_ANNOTATION_PAIRS × 2
 * vertices). Positions are all zero until filled by writePairsToSegments.
 * Use setDrawRange to control how many pairs are actually rendered.
 */
export function makePreallocatedSegments(): THREE.LineSegments {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(MAX_ANNOTATION_PAIRS * 6), 3),
  );
  geom.setDrawRange(0, 0);
  return new THREE.LineSegments(geom, dimensionAnnotationLineMaterial);
}

/**
 * Write segment pairs into an existing pre-allocated LineSegments in-place.
 * Avoids GPU buffer allocation — only updates the existing Float32Array.
 * Pairs beyond MAX_ANNOTATION_PAIRS are silently truncated.
 */
export function writePairsToSegments(
  segments: THREE.LineSegments,
  pairs: [Vec2, Vec2][],
  origin: THREE.Vector3,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
): void {
  const attr = segments.geometry.attributes["position"] as THREE.BufferAttribute;
  const buf = attr.array as Float32Array;
  const count = Math.min(pairs.length, MAX_ANNOTATION_PAIRS);
  for (let i = 0; i < count; i++) {
    const [a, b] = pairs[i];
    const base = i * 6;
    const wax = origin.x + t1.x * a.x + t2.x * a.y;
    const way = origin.y + t1.y * a.x + t2.y * a.y;
    const waz = origin.z + t1.z * a.x + t2.z * a.y;
    const wbx = origin.x + t1.x * b.x + t2.x * b.y;
    const wby = origin.y + t1.y * b.x + t2.y * b.y;
    const wbz = origin.z + t1.z * b.x + t2.z * b.y;
    buf[base]   = wax; buf[base+1] = way; buf[base+2] = waz;
    buf[base+3] = wbx; buf[base+4] = wby; buf[base+5] = wbz;
  }
  // Zero out any remaining capacity from a previous frame with more pairs
  for (let i = count * 6; i < buf.length; i++) buf[i] = 0;
  attr.needsUpdate = true;
  segments.geometry.setDrawRange(0, count * 2);
}

export function withArrowheads(line: [Vec2, Vec2], size = 0.8): [Vec2, Vec2][] {
  const [start, end] = line;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-8) return [line];
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const arrowLength = Math.min(size, length * 0.35);
  const arrowWidth = arrowLength * 0.55;
  const makeHead = (tip: Vec2, direction: 1 | -1): [Vec2, Vec2][] => {
    const base = {
      x: tip.x - direction * ux * arrowLength,
      y: tip.y - direction * uy * arrowLength,
    };
    return [
      [tip, { x: base.x + px * arrowWidth, y: base.y + py * arrowWidth }],
      [tip, { x: base.x - px * arrowWidth, y: base.y - py * arrowWidth }],
    ];
  };
  return [line, ...makeHead(start, -1), ...makeHead(end, 1)];
}
