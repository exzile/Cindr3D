import * as THREE from 'three';
import type { BRepBody } from '../../../../../engine/occ/brepBody';
import { performOccBooleanWithInstance } from '../../../../../engine/occ/ops/booleanCore';
import { transformOccShape } from '../../../../../engine/occ/transform';

export function buildDrillTransform(drillDir: THREE.Vector3, startPos: THREE.Vector3): THREE.Matrix4 {
  const zAxis = new THREE.Vector3(0, 0, 1);
  const mat4 = new THREE.Matrix4();
  const dot = drillDir.dot(zAxis);

  if (Math.abs(dot - 1) < 1e-6) {
    mat4.identity();
  } else if (Math.abs(dot + 1) < 1e-6) {
    mat4.makeRotationX(Math.PI);
  } else {
    const quat = new THREE.Quaternion().setFromUnitVectors(zAxis, drillDir);
    mat4.makeRotationFromQuaternion(quat);
  }
  mat4.setPosition(startPos);
  return mat4;
}

export function buildOccConeShape(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  r1: number,
  r2: number,
  h: number,
  transform: THREE.Matrix4,
): { shape: unknown; ownedResources: Array<{ delete?: () => void }> } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (oc as any).BRepPrimAPI_MakeCone_1 !== 'function') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coneMaker = new (oc as any).BRepPrimAPI_MakeCone_1(r1, r2, h);
    let shape = coneMaker.Shape() as unknown;
    const ownedResources: Array<{ delete?: () => void }> = [coneMaker as { delete(): void }];
    shape = transformOccShape(oc, shape, transform);
    return { shape, ownedResources };
  } catch {
    return null;
  }
}

export function unionPiece(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  toolBody: BRepBody,
  piece: BRepBody,
  sourceFeatureId: string,
): BRepBody {
  const fused = performOccBooleanWithInstance(oc, 'union', toolBody, piece, { sourceFeatureId });
  piece.dispose();
  if (fused) {
    toolBody.dispose();
    return fused;
  }
  return toolBody;
}
