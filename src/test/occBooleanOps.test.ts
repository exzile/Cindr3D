import { describe, expect, it } from 'vitest';
import type { BRepBody } from '../engine/occ/brepBody';
import { OccHandle } from '../engine/occ/occHandle';
import { performOccBooleanMultiWithInstance, performOccBooleanWithInstance } from '../engine/occ/ops/booleanCore';

function fakeBody(ptr: number): BRepBody {
  return {
    id: `body-${ptr}`,
    revision: 1,
    shape: new OccHandle(ptr, 'TopoDS_Shape', () => undefined),
    faceIds: new Map(),
    edgeIds: new Map(),
    vertexIds: new Map(),
    dispose: () => undefined,
  };
}

function fakeOc(operationLog: string[]) {
  class FakeShapeList {
    readonly shapes: unknown[] = [];

    Append_1(shape: unknown) {
      this.shapes.push(shape);
      operationLog.push(`append:${this.shapes.length}`);
    }

    delete() {
      operationLog.push('list-delete');
    }
  }

  class FakeBooleanOp {
    private readonly resultShape = { ptr: 3000, delete: () => undefined };
    readonly target: unknown;
    readonly tool: unknown;
    readonly name: string;

    constructor(target: unknown, tool: unknown, name: string) {
      this.target = target;
      this.tool = tool;
      this.name = name;
      operationLog.push(name);
    }

    SetNonDestructive(value: boolean) {
      operationLog.push(`non-destructive:${String(value)}`);
    }

    Build() {
      operationLog.push('build');
    }

    IsDone() {
      return true;
    }

    HasErrors() {
      return false;
    }

    Shape() {
      return this.resultShape;
    }

    delete() {
      operationLog.push('delete');
    }
  }

  class FakeBatchBooleanOp {
    private readonly resultShape = { ptr: 4000, delete: () => undefined };
    private operation: unknown;

    SetArguments(shapes: FakeShapeList) {
      operationLog.push(`set-args:${shapes.shapes.length}`);
    }

    SetTools(shapes: FakeShapeList) {
      operationLog.push(`set-tools:${shapes.shapes.length}`);
    }

    SetOperation(operation: unknown) {
      this.operation = operation;
      operationLog.push(`batch-op:${String(operation)}`);
    }

    SetNonDestructive(value: boolean) {
      operationLog.push(`batch-non-destructive:${String(value)}`);
    }

    SetFuzzyValue(value: number) {
      operationLog.push(`batch-fuzzy:${String(value)}`);
    }

    SetRunParallel(value: boolean) {
      operationLog.push(`batch-parallel:${String(value)}`);
    }

    Perform() {
      operationLog.push(`perform:${String(this.operation)}`);
    }

    HasErrors() {
      return false;
    }

    Shape() {
      return this.resultShape;
    }

    delete() {
      operationLog.push('batch-delete');
    }
  }

  return {
    TopoDS_Shape: class {},
    wrapPointer: (ptr: number) => ({ ptr, delete: () => undefined }),
    TopTools_ListOfShape_1: FakeShapeList,
    BOPAlgo_Operation: {
      BOPAlgo_CUT: 'cut-op',
      BOPAlgo_FUSE: 'fuse-op',
      BOPAlgo_COMMON: 'common-op',
    },
    BOPAlgo_BOP_1: FakeBatchBooleanOp,
    BRepAlgoAPI_Cut_3: class extends FakeBooleanOp {
      constructor(target: unknown, tool: unknown) { super(target, tool, 'cut'); }
    },
    BRepAlgoAPI_Fuse_3: class extends FakeBooleanOp {
      constructor(target: unknown, tool: unknown) { super(target, tool, 'fuse'); }
    },
    BRepAlgoAPI_Common_3: class extends FakeBooleanOp {
      constructor(target: unknown, tool: unknown) { super(target, tool, 'common'); }
    },
    TopExp_Explorer_2: class {
      More() { return false; }
      delete() { /* noop */ }
    },
    TopAbs_ShapeEnum: {
      TopAbs_FACE: 4,
      TopAbs_EDGE: 6,
      TopAbs_VERTEX: 7,
      TopAbs_SHAPE: 8,
    },
  };
}

describe('OCC boolean operation helpers', () => {
  it('dispatches subtract, union, and intersect to the matching OCC operation', () => {
    const log: string[] = [];
    const oc = fakeOc(log);
    const a = fakeBody(100);
    const b = fakeBody(200);

    expect(performOccBooleanWithInstance(oc, 'subtract', a, b)?.shape.ptr).toBe(3000);
    expect(performOccBooleanWithInstance(oc, 'union', a, b)?.shape.ptr).toBe(3000);
    expect(performOccBooleanWithInstance(oc, 'intersect', a, b)?.shape.ptr).toBe(3000);

    expect(log).toEqual([
      'cut', 'non-destructive:true', 'build', 'delete',
      'fuse', 'non-destructive:true', 'build', 'delete',
      'common', 'non-destructive:true', 'build', 'delete',
    ]);
  });

  it('runs multiple tool bodies through one OCC batch boolean operation', () => {
    const log: string[] = [];
    const oc = fakeOc(log);
    const target = fakeBody(100);
    const tools = [fakeBody(200), fakeBody(300)];

    const result = performOccBooleanMultiWithInstance(oc, 'subtract', target, tools, {
      id: 'combined',
      sourceFeatureId: 'feature-combine',
      fuzzyValue: 0.001,
      runParallel: true,
    });

    expect(result?.shape.ptr).toBe(4000);
    expect(result?.id).toBe('combined');
    expect(result?.sourceFeatureId).toBe('feature-combine');
    expect(log).toEqual([
      'append:1',
      'append:1',
      'append:2',
      'set-args:1',
      'set-tools:2',
      'batch-op:cut-op',
      'batch-non-destructive:true',
      'batch-fuzzy:0.001',
      'batch-parallel:true',
      'perform:cut-op',
      'batch-delete',
      'list-delete',
      'list-delete',
    ]);
  });

  it('maps batch union and intersect to OCC BOP operations', () => {
    const log: string[] = [];
    const oc = fakeOc(log);
    const target = fakeBody(100);
    const tools = [fakeBody(200), fakeBody(300)];

    performOccBooleanMultiWithInstance(oc, 'union', target, tools);
    performOccBooleanMultiWithInstance(oc, 'intersect', target, tools);

    expect(log).toContain('batch-op:fuse-op');
    expect(log).toContain('perform:fuse-op');
    expect(log).toContain('batch-op:common-op');
    expect(log).toContain('perform:common-op');
    expect(log).not.toContain('fuse');
    expect(log).not.toContain('common');
  });
});
