import * as THREE from 'three';
import type { Sketch } from '../../../../types/cad';
import { SURFACE_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { EXTRUDE_MATERIAL } from '../../materials';
import { sketchToShape as sketchToShapeImpl } from '../sketch/sketchProfiles';

export type RevolveDirection = 'one-side' | 'symmetric' | 'two-sides';

/**
 * Single source of truth for turning the panel's angle / angle2 / direction
 * into a lathe start angle + total sweep (radians). Shared by the committed
 * renderer (RevolveBody), the live preview (RevolveTool) and STL export so
 * symmetric / two-sides revolves look identical everywhere.
 *
 *  - one-side : start 0,         sweep = angle
 *  - symmetric: start -angle/2,  sweep = angle           (centred on the profile)
 *  - two-sides: start -angle2,   sweep = angle + angle2   (angle one way, angle2 the other)
 */
export function resolveRevolveSweep(
  angleDeg: number,
  angle2Deg: number,
  direction: RevolveDirection,
): { phiStart: number; sweep: number } {
  const a = THREE.MathUtils.degToRad(angleDeg);
  const a2 = THREE.MathUtils.degToRad(angle2Deg);
  if (direction === 'symmetric') return { phiStart: -a / 2, sweep: a };
  if (direction === 'two-sides') return { phiStart: -a2, sweep: a + a2 };
  return { phiStart: 0, sweep: a };
}

export function revolveFaceBoundary(
  boundary: THREE.Vector3[],
  axisDir: THREE.Vector3,
  sweep: number,
  isSurface = false,
  phiStart = 0,
): THREE.Mesh | null {
  if (boundary.length < 3) return null;

  const segments = 64;
  const pointCount = boundary.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const rotation = new THREE.Quaternion();
  const point = new THREE.Vector3();
  const axis = axisDir.clone().normalize();

  for (let segment = 0; segment <= segments; segment++) {
    rotation.setFromAxisAngle(axis, phiStart + (sweep / segments) * segment);
    for (let i = 0; i < pointCount; i++) {
      point.copy(boundary[i]).applyQuaternion(rotation);
      positions.push(point.x, point.y, point.z);
    }
  }

  for (let segment = 0; segment < segments; segment++) {
    for (let i = 0; i < pointCount; i++) {
      const a = segment * pointCount + i;
      const b = segment * pointCount + ((i + 1) % pointCount);
      const c = (segment + 1) * pointCount + ((i + 1) % pointCount);
      const d = (segment + 1) * pointCount + i;
      indices.push(a, b, c, a, c, d);
    }
  }

  if (!isSurface && sweep < 2 * Math.PI - 0.01) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const vertex of boundary) {
      cx += vertex.x;
      cy += vertex.y;
      cz += vertex.z;
    }
    cx /= pointCount;
    cy /= pointCount;
    cz /= pointCount;

    // Start cap — rotated to phiStart so it meets the first side ring.
    rotation.setFromAxisAngle(axis, phiStart);
    const startCenter = positions.length / 3;
    point.set(cx, cy, cz).applyQuaternion(rotation);
    positions.push(point.x, point.y, point.z);
    for (let i = 0; i < pointCount; i++) {
      point.copy(boundary[i]).applyQuaternion(rotation);
      positions.push(point.x, point.y, point.z);
    }
    for (let i = 0; i < pointCount; i++) {
      indices.push(startCenter, startCenter + 1 + ((i + 1) % pointCount), startCenter + 1 + i);
    }

    // End cap — rotated to phiStart + sweep.
    rotation.setFromAxisAngle(axis, phiStart + sweep);
    point.set(cx, cy, cz).applyQuaternion(rotation);
    const endCenter = positions.length / 3;
    positions.push(point.x, point.y, point.z);
    for (let i = 0; i < pointCount; i++) {
      point.copy(boundary[i]).applyQuaternion(rotation);
      positions.push(point.x, point.y, point.z);
    }
    for (let i = 0; i < pointCount; i++) {
      indices.push(endCenter, endCenter + 1 + i, endCenter + 1 + ((i + 1) % pointCount));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, isSurface ? SURFACE_MATERIAL : EXTRUDE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function revolveSketch(
  sketch: Sketch,
  sweep: number,
  axis: THREE.Vector3,
  phiStart = 0,
): THREE.Mesh | null {
  if (sketch.entities.length === 0) return null;

  const shape = sketchToShapeImpl(sketch);
  if (!shape) return null;

  const points = shape.getPoints(64);
  const minX = points.reduce((min, point) => Math.min(min, point.x), Infinity);
  const maxX = points.reduce((max, point) => Math.max(max, point.x), -Infinity);
  if (minX < -1e-3 && maxX > 1e-3) return null;

  const lathePoints = points.map((point) => new THREE.Vector2(Math.abs(point.x), point.y));
  const geometry = new THREE.LatheGeometry(lathePoints, 64, phiStart, sweep);
  const targetAxis = axis.clone().normalize();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const cosine = yAxis.dot(targetAxis);

  if (cosine < 0.9999) {
    const rotationAxis = new THREE.Vector3().crossVectors(yAxis, targetAxis);
    if (rotationAxis.lengthSq() > 1e-10) {
      const rotationAngle = Math.acos(Math.max(-1, Math.min(1, cosine)));
      geometry.applyMatrix4(new THREE.Matrix4().makeRotationAxis(rotationAxis.normalize(), rotationAngle));
    } else if (cosine < -0.9999) {
      geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI));
    }
  }

  const mesh = new THREE.Mesh(geometry, EXTRUDE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function coilGeometry(
  outerRadius: number,
  wireRadius: number,
  pitch: number,
  turns: number,
): THREE.BufferGeometry {
  const frameCount = Math.max(32, Math.round(turns * 32));
  const profileCount = 12;
  const helixPoints: THREE.Vector3[] = [];

  for (let i = 0; i <= frameCount; i++) {
    const angle = (i / frameCount) * turns * Math.PI * 2;
    helixPoints.push(
      new THREE.Vector3(
        outerRadius * Math.cos(angle),
        (angle / (Math.PI * 2)) * pitch,
        outerRadius * Math.sin(angle),
      ),
    );
  }

  const curve = new THREE.CatmullRomCurve3(helixPoints, false, 'centripetal');
  const frames = curve.computeFrenetFrames(frameCount, false);
  const curvePoints = curve.getPoints(frameCount);
  const profilePoints: [number, number][] = [];

  for (let i = 0; i < profileCount; i++) {
    const angle = (i / profileCount) * Math.PI * 2;
    profilePoints.push([wireRadius * Math.cos(angle), wireRadius * Math.sin(angle)]);
  }
  profilePoints.push(profilePoints[0]);

  const ringSize = profilePoints.length;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= frameCount; i++) {
    const frameIndex = Math.min(i, frameCount - 1);
    const origin = curvePoints[i] ?? curvePoints[curvePoints.length - 1];
    const normal = frames.normals[frameIndex];
    const binormal = frames.binormals[frameIndex];
    for (const [u, v] of profilePoints) {
      positions.push(
        origin.x + normal.x * u + binormal.x * v,
        origin.y + normal.y * u + binormal.y * v,
        origin.z + normal.z * u + binormal.z * v,
      );
    }
  }

  for (let i = 0; i < frameCount; i++) {
    for (let j = 0; j < ringSize - 1; j++) {
      const a = i * ringSize + j;
      const b = a + 1;
      const c = a + ringSize;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const startCenter = positions.length / 3;
  const startPoint = curvePoints[0];
  positions.push(startPoint.x, startPoint.y, startPoint.z);
  for (let i = 0; i < ringSize - 1; i++) indices.push(startCenter, i + 1, i);

  const endCenter = positions.length / 3;
  const endPoint = curvePoints[frameCount];
  positions.push(endPoint.x, endPoint.y, endPoint.z);
  const base = frameCount * ringSize;
  for (let i = 0; i < ringSize - 1; i++) indices.push(endCenter, base + i, base + i + 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
