// Fast printability sanity-check for plate objects. Runs on the main thread
// so the viewport can show warnings *before* the user commits to a slice.
//
// Checks performed per plate object:
//   - Overhang triangles — downward-facing faces beyond the overhang angle
//     that are not supported by the build plate or by a triangle below.
//     We approximate "supported" by the triangle's world-space Z: a triangle
//     sitting on the plate (z <= plate height + tolerance) is always fine.
//   - Thin walls — detected by a bounding-box ratio heuristic. Fully-correct
//     thin-wall detection requires slicing; this only catches obvious cases.
//   - Off-plate — any part of the bounding box outside the build volume.
//
// Returns a per-object `Report` with severity and a triangle index mask
// highlighting problem triangles so the viewport can paint them red.

import * as THREE from 'three';
import type { PlateObject, PrinterProfile, PrintProfile } from '../types/slicer';
import { normalizeRotationRadians, normalizeScale } from '../utils/slicerTransforms';

export type IssueKind =
  | 'overhang'
  | 'off-plate'
  | 'tiny-features'
  | 'no-geometry'
  | 'missing-supports';

export interface Issue {
  kind: IssueKind;
  severity: 'info' | 'warning' | 'error';
  message: string;
  /** Triangle indices (into the geometry's index buffer, or 3-vertex groups
   *  when un-indexed) that participate in the issue. */
  triangles?: number[];
}

export interface ObjectReport {
  objectId: string;
  objectName: string;
  issues: Issue[];
  /** Union of all triangles implicated in any issue — used for highlighting. */
  highlightedTriangles: Set<number>;
}

export interface PrintabilityReport {
  objects: ObjectReport[];
  totals: {
    errors: number;
    warnings: number;
    info: number;
  };
}

const EPS = 1e-4;

function severityOrder(s: Issue['severity']): number {
  return s === 'error' ? 2 : s === 'warning' ? 1 : 0;
}

export function checkPrintability(
  plateObjects: PlateObject[],
  printer: PrinterProfile,
  print: PrintProfile,
): PrintabilityReport {
  const report: PrintabilityReport = { objects: [], totals: { errors: 0, warnings: 0, info: 0 } };

  for (const obj of plateObjects) {
    const issues: Issue[] = [];
    const highlighted = new Set<number>();
    const geo = (obj as { geometry?: THREE.BufferGeometry }).geometry;

    // 1. No geometry.
    if (!geo || !(geo instanceof THREE.BufferGeometry) || !geo.attributes.position) {
      issues.push({ kind: 'no-geometry', severity: 'warning',
        message: 'Placeholder without real geometry — slice result will be empty.' });
      pushReport(report, obj, issues, highlighted);
      continue;
    }

    const pos = obj.position as { x: number; y: number; z: number };
    const rot = normalizeRotationRadians((obj as { rotation?: unknown }).rotation);
    const scl = normalizeScale((obj as { scale?: unknown }).scale);
    const qRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.x, rot.y, rot.z, 'XYZ'));

    // 2. Off-plate: project scaled+rotated bbox corners to world and test.
    const localBB = new THREE.Box3(
      new THREE.Vector3(obj.boundingBox.min.x, obj.boundingBox.min.y, obj.boundingBox.min.z),
      new THREE.Vector3(obj.boundingBox.max.x, obj.boundingBox.max.y, obj.boundingBox.max.z),
    );
    const corners = cornersOf(localBB).map((c) => {
      c.set(c.x * scl.x, c.y * scl.y, c.z * scl.z).applyQuaternion(qRot).add(new THREE.Vector3(pos.x, pos.y, pos.z));
      return c;
    });
    const world = new THREE.Box3().setFromPoints(corners);
    const bv = printer.buildVolume;
    const outside = world.min.x < -EPS || world.min.y < -EPS || world.min.z < -EPS ||
      world.max.x > bv.x + EPS || world.max.y > bv.y + EPS || world.max.z > bv.z + EPS;
    if (outside) {
      issues.push({
        kind: 'off-plate', severity: 'error',
        message: 'Model extends past the build volume — move, scale down, or rotate before slicing.',
      });
    }

    // 3. Overhang scan — transform each triangle's normal into world space
    // and count how many point downward past the threshold. Highlight them
    // so the viewport can paint them red.
    const supportsEnabled = print.supportEnabled ?? false;
    const overhangAngleDeg = print.supportAngle ?? 45;
    const cosThreshold = Math.cos((overhangAngleDeg * Math.PI) / 180);
    const position = geo.attributes.position;
    const indexAttr = geo.getIndex();
    const triCount = indexAttr ? indexAttr.count / 3 : position.count / 3;
    const plateZ = 0;
    const zTol = 0.5; // triangles touching the plate are fine regardless of angle
    const normal = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();

    let overhangCount = 0;
    const overhangTris: number[] = [];

    for (let t = 0; t < triCount; t++) {
      const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
      const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(position, i0).set(a.x * scl.x, a.y * scl.y, a.z * scl.z)
        .applyQuaternion(qRot).add(new THREE.Vector3(pos.x, pos.y, pos.z));
      b.fromBufferAttribute(position, i1).set(b.x * scl.x, b.y * scl.y, b.z * scl.z)
        .applyQuaternion(qRot).add(new THREE.Vector3(pos.x, pos.y, pos.z));
      c.fromBufferAttribute(position, i2).set(c.x * scl.x, c.y * scl.y, c.z * scl.z)
        .applyQuaternion(qRot).add(new THREE.Vector3(pos.x, pos.y, pos.z));
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      normal.crossVectors(e1, e2);
      if (normal.lengthSq() < EPS) continue;
      normal.normalize();

      // Clamp into [-1, 1] before checking threshold (FP drift safety).
      const dz = Math.max(-1, Math.min(1, normal.z));
      // A downward-facing face beyond the overhang angle is a problem if
      // the triangle isn't sitting on the plate.
      const minZ = Math.min(a.z, b.z, c.z);
      if (dz < -cosThreshold && minZ > plateZ + zTol) {
        overhangCount++;
        overhangTris.push(t);
        highlighted.add(t);
      }
    }

    if (overhangCount > 0) {
      const pct = (overhangCount / triCount) * 100;
      const msg = supportsEnabled
        ? `${overhangCount} overhanging triangles (${pct.toFixed(1)}%) — supports are enabled.`
        : `${overhangCount} overhanging triangles (${pct.toFixed(1)}%) — enable supports or rotate the model.`;
      issues.push({
        kind: supportsEnabled ? 'overhang' : 'missing-supports',
        severity: supportsEnabled ? 'info' : 'warning',
        message: msg,
        triangles: overhangTris,
      });
    }

    // 4. Tiny features — if the smallest XY extent is under 2× nozzle, the
    //    walls won't reliably form.
    const world2 = world.getSize(new THREE.Vector3());
    const nozzle = printer.nozzleDiameter ?? 0.4;
    const wallWidth = print.wallLineWidth ?? nozzle;
    const minXY = Math.min(world2.x, world2.y);
    if (minXY < 2 * wallWidth && minXY > 0) {
      issues.push({
        kind: 'tiny-features', severity: 'warning',
        message: `Smallest XY span is ${minXY.toFixed(2)} mm — narrower than 2 walls (${(2 * wallWidth).toFixed(2)} mm).`,
      });
    }

    pushReport(report, obj, issues, highlighted);
  }

  return report;
}

function pushReport(
  report: PrintabilityReport,
  obj: PlateObject,
  issues: Issue[],
  highlighted: Set<number>,
) {
  report.objects.push({
    objectId: obj.id,
    objectName: obj.name,
    issues,
    highlightedTriangles: highlighted,
  });
  for (const i of issues) {
    if (i.severity === 'error') report.totals.errors++;
    else if (i.severity === 'warning') report.totals.warnings++;
    else report.totals.info++;
  }
}

function cornersOf(bb: THREE.Box3): THREE.Vector3[] {
  return [
    new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
    new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
    new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z),
    new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z),
    new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
    new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
    new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
    new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z),
  ];
}

export function worstSeverity(issues: Issue[]): Issue['severity'] | null {
  if (issues.length === 0) return null;
  return issues.reduce<Issue['severity']>(
    (acc, i) => (severityOrder(i.severity) > severityOrder(acc) ? i.severity : acc),
    'info',
  );
}
