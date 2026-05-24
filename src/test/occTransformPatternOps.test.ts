import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OccHandle } from '../engine/occ/occHandle';
import { createBRepBody } from '../engine/occ/brepBody';
import { occMirrorWithInstance } from '../engine/occ/ops/mirror';
import {
  occCircularPatternWithInstance,
  occRectangularPatternWithInstance,
} from '../engine/occ/ops/pattern';
import { occScaleWithInstance } from '../engine/occ/ops/scale';

type FakeShape = {
  ptr: number;
  faces: number[];
  edges: number[];
  vertices: number[];
  deleted: number;
  delete(): void;
};

function fakeShape(ptr: number, faces = [ptr + 1], edges = [ptr + 2], vertices = [ptr + 3]): FakeShape {
  return {
    ptr,
    faces,
    edges,
    vertices,
    deleted: 0,
    delete() {
      this.deleted += 1;
    },
  };
}

function fakeBody(shape = fakeShape(10)) {
  return createBRepBody({
    id: `body-${shape.ptr}`,
    shape: new OccHandle(shape.ptr, 'TopoDS_Shape', () => shape.delete()),
    faceIds: new Map([[0, new OccHandle(shape.faces[0], 'TopoDS_Face', () => undefined)]]),
    edgeIds: new Map([[0, new OccHandle(shape.edges[0], 'TopoDS_Edge', () => undefined)]]),
    vertexIds: new Map([[0, new OccHandle(shape.vertices[0], 'TopoDS_Vertex', () => undefined)]]),
  });
}

function makeFakeOcc() {
  let nextPtr = 1000;
  const shapes = new Map<number, FakeShape>();
  const calls = {
    mirror: 0,
    scale: [] as Array<{ x: number; y: number; z: number; factor: number }>,
    diag: [] as Array<{ x: number; y: number; z: number }>,
    translations: [] as Array<{ x: number; y: number; z: number }>,
    rotations: [] as number[],
    fuse: 0,
  };

  const addShape = (shape: FakeShape) => {
    shapes.set(shape.ptr, shape);
    return shape;
  };

  class Explorer {
    private readonly ids: number[];
    private index = 0;

    constructor(shape: FakeShape, kind: number) {
      this.ids = kind === 1 ? shape.faces : kind === 2 ? shape.edges : shape.vertices;
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

  class Transform {
    private readonly result = addShape(fakeShape(nextPtr++));
    constructor() {}
    Shape() {
      return this.result;
    }
    delete() {
      // no-op
    }
  }

  class Fuse {
    private readonly result = addShape(fakeShape(nextPtr++));
    constructor() {
      calls.fuse += 1;
    }
    SetNonDestructive() {
      // no-op
    }
    Build() {
      // no-op
    }
    IsDone() {
      return true;
    }
    HasErrors() {
      return false;
    }
    Shape() {
      return this.result;
    }
    delete() {
      // no-op
    }
  }

  const oc = {
    TopoDS_Shape: class {},
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
    wrapPointer: (ptr: number) => shapes.get(ptr) ?? addShape(fakeShape(ptr)),
    gp_Pnt_3: class {
      x: number;
      y: number;
      z: number;
      constructor(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
      }
      delete() {}
    },
    gp_Dir_4: class {
      x: number;
      y: number;
      z: number;
      constructor(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
      }
      delete() {}
    },
    gp_Ax1_2: class {
      origin: unknown;
      direction: unknown;
      constructor(origin: unknown, direction: unknown) {
        this.origin = origin;
        this.direction = direction;
      }
      delete() {}
    },
    gp_Ax2_2: class {
      origin: unknown;
      direction: unknown;
      constructor(origin: unknown, direction: unknown) {
        this.origin = origin;
        this.direction = direction;
      }
      delete() {}
    },
    gp_Vec_4: class {
      x: number;
      y: number;
      z: number;
      constructor(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
      }
      delete() {}
    },
    gp_Mat_1: class {
      SetDiag(x: number, y: number, z: number) {
        calls.diag.push({ x, y, z });
      }
      delete() {}
    },
    gp_GTrsf_1: class {
      SetVectorialPart() {
        // no-op
      }
      delete() {}
    },
    gp_Trsf_1: class {
      SetMirror_3() {
        calls.mirror += 1;
      }
      SetScale(point: { x: number; y: number; z: number }, factor: number) {
        calls.scale.push({ x: point.x, y: point.y, z: point.z, factor });
      }
      SetTranslation_1(vec: { x: number; y: number; z: number }) {
        calls.translations.push({ x: vec.x, y: vec.y, z: vec.z });
      }
      SetRotation(_axis: unknown, angle: number) {
        calls.rotations.push(angle);
      }
      delete() {}
    },
    BRepBuilderAPI_Transform_2: Transform,
    BRepBuilderAPI_GTransform_2: class extends Transform {
      IsDone() {
        return true;
      }
    },
    BRepAlgoAPI_Fuse_3: Fuse,
    Message_ProgressRange_1: class {
      delete() {}
    },
  };

  return { oc, addShape, calls };
}

describe('OCC transform and pattern operation helpers', () => {
  it('mirrors a body across a plane using an OCC transform', () => {
    const { oc, addShape, calls } = makeFakeOcc();
    const sourceShape = addShape(fakeShape(20));
    const body = fakeBody(sourceShape);

    const result = occMirrorWithInstance(oc, body, {
      origin: new THREE.Vector3(0, 0, 0),
      normal: new THREE.Vector3(0, 1, 0),
    }, { id: 'mirrored' });

    expect(result?.id).toBe('mirrored');
    expect(result?.faceIds.size).toBe(1);
    expect(calls.mirror).toBe(1);

    body.dispose();
    result?.dispose();
  });

  it('scales a body uniformly or non-uniformly', () => {
    const { oc, addShape, calls } = makeFakeOcc();
    const body = fakeBody(addShape(fakeShape(30)));

    const uniform = occScaleWithInstance(
      oc,
      body,
      new THREE.Vector3(1, 2, 3),
      2,
      { id: 'uniform-scale' },
    );
    const nonUniform = occScaleWithInstance(
      oc,
      body,
      new THREE.Vector3(0, 0, 0),
      { x: 2, y: 1, z: 0.5 },
      { id: 'nonuniform-scale' },
    );

    expect(uniform?.id).toBe('uniform-scale');
    expect(nonUniform?.id).toBe('nonuniform-scale');
    expect(calls.scale).toEqual([{ x: 1, y: 2, z: 3, factor: 2 }]);
    expect(calls.diag).toEqual([{ x: 2, y: 1, z: 0.5 }]);

    body.dispose();
    uniform?.dispose();
    nonUniform?.dispose();
  });

  it('builds rectangular and circular pattern copies', () => {
    const { oc, addShape, calls } = makeFakeOcc();
    const body = fakeBody(addShape(fakeShape(40)));

    const rectangular = occRectangularPatternWithInstance(
      oc,
      body,
      2,
      10,
      2,
      5,
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      { id: 'rect-pattern' },
    );
    const circular = occCircularPatternWithInstance(
      oc,
      body,
      { origin: new THREE.Vector3(), direction: new THREE.Vector3(0, 0, 1) },
      4,
      Math.PI * 2,
      { id: 'circular-pattern' },
    );

    expect(rectangular?.id).toBe('rect-pattern');
    expect(circular?.id).toBe('circular-pattern');
    expect(calls.translations).toEqual([
      { x: 0, y: 5, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 5, z: 0 },
    ]);
    expect(calls.rotations).toEqual([
      Math.PI / 2,
      Math.PI,
      (Math.PI * 3) / 2,
    ]);
    expect(calls.fuse).toBe(6);

    body.dispose();
    rectangular?.dispose();
    circular?.dispose();
  });
});
