import { describe, expect, it } from 'vitest';
import { createBRepBody } from '../engine/occ/brepBody';
import { OccHandle } from '../engine/occ/occHandle';
import { shapeFromStep, shapeToStep } from '../engine/occ/stepIO';
import type { OcctRaw } from '../engine/occ/types';

function makeBody() {
  return createBRepBody({
    id: 'body-a',
    shape: new OccHandle(12, 'shape', () => {}),
  });
}

describe('OCC STEP I/O cleanup', () => {
  it('deletes the wrapped shape and writer when STEP transfer fails', () => {
    let rawShapeDeletes = 0;
    let writerDeletes = 0;
    const oc: OcctRaw = {
      TopoDS_Shape: function TopoDSShape() {},
      wrapPointer: () => ({
        delete() {
          rawShapeDeletes += 1;
        },
      }),
      STEPControl_Writer_1: class {
        Transfer() { return 0; }
        delete() { writerDeletes += 1; }
      },
      STEPControl_StepModelType: { STEPControl_AsIs: 0 },
      IFSelect_ReturnStatus: { IFSelect_RetDone: 1 },
      FS: {
        readFile: () => '',
        unlink: () => {},
      },
    };

    const result = shapeToStep(oc, makeBody());

    expect(result.ok).toBe(false);
    expect(rawShapeDeletes).toBe(1);
    expect(writerDeletes).toBe(1);
  });

  it('deletes the reader and unlinks temp input when STEP read fails', () => {
    let readerDeletes = 0;
    let unlinks = 0;
    const oc: OcctRaw = {
      STEPControl_Reader_1: class {
        ReadFile() { return 0; }
        delete() { readerDeletes += 1; }
      },
      IFSelect_ReturnStatus: { IFSelect_RetDone: 1 },
      FS: {
        writeFile: () => {},
        unlink: () => { unlinks += 1; },
      },
    };

    const result = shapeFromStep(oc, 'bad step');

    expect(result.ok).toBe(false);
    expect(readerDeletes).toBe(1);
    expect(unlinks).toBe(1);
  });

  it('deletes the progress range after transferring STEP roots', () => {
    let progressDeletes = 0;
    let readerDeletes = 0;
    const oc: OcctRaw = {
      STEPControl_Reader_1: class {
        ReadFile() { return 1; }
        TransferRoots() {}
        Shape() { return { ptr: 20, delete() {} }; }
        delete() { readerDeletes += 1; }
      },
      Message_ProgressRange_1: class {
        delete() { progressDeletes += 1; }
      },
      IFSelect_ReturnStatus: { IFSelect_RetDone: 1 },
      TopAbs_ShapeEnum: {
        TopAbs_FACE: 1,
        TopAbs_EDGE: 2,
        TopAbs_VERTEX: 3,
        TopAbs_SHAPE: 4,
      },
      TopExp_Explorer_2: class {
        More() { return false; }
        delete() {}
      },
      FS: {
        writeFile: () => {},
        unlink: () => {},
      },
    };

    const result = shapeFromStep(oc, 'ISO-10303-21;');

    expect(result.ok).toBe(true);
    expect(progressDeletes).toBe(1);
    expect(readerDeletes).toBe(1);
    if (result.ok) result.value.dispose();
  });
});
