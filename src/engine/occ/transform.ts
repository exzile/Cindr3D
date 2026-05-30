import type * as THREE from 'three';
import type { OcctRaw } from './types';

export type OccTrsfValues = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export function matrix4ToOccTrsfValues(matrix: THREE.Matrix4): OccTrsfValues {
  const e = matrix.elements;
  return [
    e[0], e[4], e[8], e[12],
    e[1], e[5], e[9], e[13],
    e[2], e[6], e[10], e[14],
  ];
}

export function makeOccTrsfFromMatrix(oc: OcctRaw, matrix: THREE.Matrix4): unknown {
  const trsf = new oc.gp_Trsf_1();
  trsf.SetValues(...matrix4ToOccTrsfValues(matrix));
  return trsf;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformOccShape(oc: OcctRaw, shape: any, matrix: THREE.Matrix4): any {
  if (isIdentityMatrix4(matrix)) return shape;

  const trsf = makeOccTrsfFromMatrix(oc, matrix) as { delete(): void };
  const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  const transformedShape = transformer.Shape();

  transformer.delete();
  trsf.delete();
  shape.delete();

  return transformedShape;
}

function isIdentityMatrix4(matrix: THREE.Matrix4): boolean {
  const e = matrix.elements;
  return e[0] === 1 && e[4] === 0 && e[8] === 0 && e[12] === 0 &&
    e[1] === 0 && e[5] === 1 && e[9] === 0 && e[13] === 0 &&
    e[2] === 0 && e[6] === 0 && e[10] === 1 && e[14] === 0 &&
    e[3] === 0 && e[7] === 0 && e[11] === 0 && e[15] === 1;
}
