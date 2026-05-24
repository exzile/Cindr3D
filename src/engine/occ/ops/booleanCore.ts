import { occDeref, type BRepBody } from '../brepBody';
import type { OcctRaw } from '../types';
import { propagateBooleanIds } from './booleanBase';

export type OccBooleanOperation = 'subtract' | 'union' | 'intersect';

export interface OccBooleanOptions {
  id?: string;
  sourceFeatureId?: string;
  fuzzyValue?: number;
  runParallel?: boolean;
}

interface OccBooleanBatchApi {
  TopoDS_Shape: unknown;
  TopTools_ListOfShape_1: new () => { Append_1(shape: unknown): void; delete(): void };
  BOPAlgo_BOP_1: new () => {
    SetArguments(shapes: unknown): void;
    SetTools(shapes: unknown): void;
    SetOperation(operation: unknown): void;
    SetNonDestructive?(value: boolean): void;
    SetFuzzyValue?(value: number): void;
    SetRunParallel?(value: boolean): void;
    Perform(): void;
    HasErrors?(): boolean;
    Shape(): unknown;
    Modified?(shape: unknown): unknown;
    Generated?(shape: unknown): unknown;
    delete?(): void;
  };
  BOPAlgo_Operation: {
    BOPAlgo_CUT: unknown;
    BOPAlgo_FUSE: unknown;
    BOPAlgo_COMMON: unknown;
  };
}

export function performOccBooleanWithInstance(
  oc: OcctRaw,
  operation: OccBooleanOperation,
  target: BRepBody,
  tool: BRepBody,
  options: OccBooleanOptions = {},
): BRepBody | null {
  const targetShape = occDeref(oc, target.shape, oc.TopoDS_Shape);
  const toolShape = occDeref(oc, tool.shape, oc.TopoDS_Shape);
  const op = createBooleanOperation(oc, operation, targetShape, toolShape);

  try {
    op.SetNonDestructive?.(true);
    if (options.fuzzyValue !== undefined) op.SetFuzzyValue?.(options.fuzzyValue);
    if (options.runParallel !== undefined) op.SetRunParallel?.(options.runParallel);
    op.Build();

    if (op.IsDone?.() === false || op.HasErrors?.()) {
      return null;
    }

    const result = propagateBooleanIds(oc, op, [target, tool]);
    if (options.id) result.id = options.id;
    if (options.sourceFeatureId) result.sourceFeatureId = options.sourceFeatureId;
    return result;
  } finally {
    op.delete?.();
    targetShape.delete?.();
    toolShape.delete?.();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createBooleanOperation(oc: OcctRaw, operation: OccBooleanOperation, targetShape: any, toolShape: any): any {
  if (operation === 'subtract') return new oc.BRepAlgoAPI_Cut_3(targetShape, toolShape);
  if (operation === 'union') return new oc.BRepAlgoAPI_Fuse_3(targetShape, toolShape);
  return new oc.BRepAlgoAPI_Common_3(targetShape, toolShape);
}

/**
 * Boolean operation with multiple tool bodies in one OCC BOP solve.
 */
export function performOccBooleanMultiWithInstance(
  oc: OcctRaw,
  operation: OccBooleanOperation,
  target: BRepBody,
  tools: BRepBody[],
  options: OccBooleanOptions = {},
): BRepBody | null {
  if (tools.length === 0) return null;

  const occ = oc as OccBooleanBatchApi;
  const objectList = new occ.TopTools_ListOfShape_1();
  const toolList = new occ.TopTools_ListOfShape_1();
  const rawShapes: Array<{ delete?: () => void }> = [];
  const bop = new occ.BOPAlgo_BOP_1();

  try {
    const targetShape = occDeref(oc, target.shape, oc.TopoDS_Shape);
    objectList.Append_1(targetShape);
    rawShapes.push(targetShape);

    for (const tool of tools) {
      const toolShape = occDeref(oc, tool.shape, oc.TopoDS_Shape);
      toolList.Append_1(toolShape);
      rawShapes.push(toolShape);
    }

    bop.SetArguments(objectList);
    bop.SetTools(toolList);
    bop.SetOperation(getBatchBooleanOperation(occ, operation));
    bop.SetNonDestructive?.(true);
    if (options.fuzzyValue !== undefined) bop.SetFuzzyValue?.(options.fuzzyValue);
    if (options.runParallel !== undefined) bop.SetRunParallel?.(options.runParallel);
    bop.Perform();

    if (bop.HasErrors?.()) {
      return null;
    }

    const result = propagateBooleanIds(oc, bop, [target, ...tools]);
    if (options.id) result.id = options.id;
    if (options.sourceFeatureId) result.sourceFeatureId = options.sourceFeatureId;
    return result;
  } finally {
    bop.delete?.();
    for (const rawShape of rawShapes) rawShape.delete?.();
    toolList.delete();
    objectList.delete();
  }
}

function getBatchBooleanOperation(occ: OccBooleanBatchApi, operation: OccBooleanOperation): unknown {
  if (operation === 'subtract') return occ.BOPAlgo_Operation.BOPAlgo_CUT;
  if (operation === 'union') return occ.BOPAlgo_Operation.BOPAlgo_FUSE;
  return occ.BOPAlgo_Operation.BOPAlgo_COMMON;
}
