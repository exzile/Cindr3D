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
