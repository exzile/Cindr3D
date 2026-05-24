import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { occSphereWithInstance } from '../engine/occ/ops/sphere';
import { occTorusWithInstance } from '../engine/occ/ops/torus';
import { matrix4ToOccTrsfValues } from '../engine/occ/transform';

type FakeShape = {
  ptr: number;
  faces?: number[];
  edges?: number[];
  vertices?: number[];
  deleted: number;
  delete(): void;
};

function fakeShape(
  ptr: number,
  topology: Pick<FakeShape, 'faces' | 'edges' | 'vertices'> = {},
): FakeShape {
  return {
    ptr,
    faces: topology.faces ?? [],
    edges: topology.edges ?? [],
    vertices: topology.vertices ?? [],
    deleted: 0,
    delete() {
      this.deleted += 1;
    },
  };
}

function makeFakeOcc() {
  const sphereShape = fakeShape(100, {
    faces: [101],
    edges: [201, 202],
    vertices: [301, 302],
  });
  const torusShape = fakeShape(400, {
    faces: [401],
    edges: [501, 502],
    vertices: [601, 602],
  });
  const makerDeletes = { sphere: 0, torus: 0 };

  class Explorer {
    private readonly ids: number[];
    private index = 0;

    constructor(shape: FakeShape, kind: number) {
      this.ids =
        kind === 1
          ? shape.faces ?? []
          : kind === 2
            ? shape.edges ?? []
            : shape.vertices ?? [];
    }

    More() {
      return this.index < this.ids.length;
    }

    Current() {
      return fakeShape(this.ids[this.index]);
    }

    Next() {
      this.index += 1;
    }

    delete() {
      // no-op
    }
  }

  const oc = {
    TopAbs_ShapeEnum: {
      TopAbs_FACE: 1,
      TopAbs_EDGE: 2,
      TopAbs_VERTEX: 3,
      TopAbs_SHAPE: 4,
    },
    TopExp_Explorer_2: Explorer,
    TopoDS: {
      Face_1: (shape: FakeShape) => fakeShape(shape.ptr),
      Edge_1: (shape: FakeShape) => fakeShape(shape.ptr),
      Vertex_1: (shape: FakeShape) => fakeShape(shape.ptr),
    },
    BRepPrimAPI_MakeSphere_2: class {
      radius: number;
      constructor(radius: number) {
        this.radius = radius;
      }
      Shape() {
        return sphereShape;
      }
      delete() {
        makerDeletes.sphere += 1;
      }
    },
    BRepPrimAPI_MakeTorus_2: class {
      majorRadius: number;
      minorRadius: number;
      constructor(majorRadius: number, minorRadius: number) {
        this.majorRadius = majorRadius;
        this.minorRadius = minorRadius;
      }
      Shape() {
        return torusShape;
      }
      delete() {
        makerDeletes.torus += 1;
      }
    },
  };

  return { oc, sphereShape, torusShape, makerDeletes };
}

describe('OCC primitive operation helpers', () => {
  it('converts THREE Matrix4 values to OCC row-major transform values', () => {
    const matrix = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    matrix.setPosition(10, 20, 30);

    const values = matrix4ToOccTrsfValues(matrix);

    expect(values[0]).toBeCloseTo(0);
    expect(values[1]).toBeCloseTo(-1);
    expect(values[4]).toBeCloseTo(1);
    expect(values[5]).toBeCloseTo(0);
    expect(values[3]).toBe(10);
    expect(values[7]).toBe(20);
    expect(values[11]).toBe(30);
  });

  it('creates a sphere BRep body with topology ids', () => {
    const { oc, sphereShape, makerDeletes } = makeFakeOcc();

    const sphere = occSphereWithInstance(oc, 5, {
      id: 'sphere-test',
      sourceFeatureId: 'feature-sphere',
    });

    expect(sphere.id).toBe('sphere-test');
    expect(sphere.sourceFeatureId).toBe('feature-sphere');
    expect(sphere.faceIds.size).toBe(1);
    expect(sphere.edgeIds.size).toBe(2);
    expect(sphere.vertexIds.size).toBe(2);
    expect(makerDeletes.sphere).toBe(1);

    sphere.dispose();
    expect(sphereShape.deleted).toBe(1);
  });

  it('creates a torus BRep body with topology ids', () => {
    const { oc, torusShape, makerDeletes } = makeFakeOcc();

    const torus = occTorusWithInstance(oc, 8, 2, {
      id: 'torus-test',
      sourceFeatureId: 'feature-torus',
    });

    expect(torus.id).toBe('torus-test');
    expect(torus.sourceFeatureId).toBe('feature-torus');
    expect(torus.faceIds.size).toBe(1);
    expect(torus.edgeIds.size).toBe(2);
    expect(torus.vertexIds.size).toBe(2);
    expect(makerDeletes.torus).toBe(1);

    torus.dispose();
    expect(torusShape.deleted).toBe(1);
  });

  it('validates sphere and torus dimensions', () => {
    const { oc } = makeFakeOcc();

    expect(() => occSphereWithInstance(oc, 0)).toThrow(RangeError);
    expect(() => occTorusWithInstance(oc, 5, 0)).toThrow(RangeError);
    expect(() => occTorusWithInstance(oc, 5, 5)).toThrow(RangeError);
  });
});
