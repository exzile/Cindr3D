import { occDeref, type BRepBody } from '../brepBody';
import type { OcctRaw } from '../types';
import { propagateBooleanIds, type OccBooleanAlgo } from './booleanBase';
import { freeWasmException, occErrorMessage } from '../freeWasmException';

export type OccBooleanOperation = 'subtract' | 'union' | 'intersect';

/**
 * Run a boolean builder's Build(), freeing the WASM-heap exception object if the
 * OCC C++ code throws (otherwise the dropped numeric pointer leaks). Rethrows a
 * plain Error so callers never hold the freed pointer.
 */
function buildBooleanOrThrow(oc: OcctRaw, op: { Build(): void }): void {
  try {
    op.Build();
  } catch (err) {
    const message = occErrorMessage(err);
    freeWasmException(oc, err);
    throw err instanceof Error ? err : new Error(`OCC boolean failed: ${message}`);
  }
}

export interface OccBooleanOptions {
  id?: string;
  sourceFeatureId?: string;
  fuzzyValue?: number;
  runParallel?: boolean;
}

/** Shared interface for the single-pair BRepAlgoAPI_* boolean builders. */
interface OccBooleanBuilder {
  Build(): void;
  IsDone?(): boolean;
  HasErrors?(): boolean;
  Shape(): unknown;
  Modified?(shape: unknown): unknown;
  Generated?(shape: unknown): unknown;
  SetNonDestructive?(value: boolean): void;
  SetFuzzyValue?(value: number): void;
  SetRunParallel?(value: boolean): void;
  delete?(): void;
}

type OccBooleanPairApi = OcctRaw & {
  BRepAlgoAPI_Cut_3: new (target: unknown, tool: unknown) => OccBooleanBuilder;
  BRepAlgoAPI_Fuse_3: new (target: unknown, tool: unknown) => OccBooleanBuilder;
  BRepAlgoAPI_Common_3: new (target: unknown, tool: unknown) => OccBooleanBuilder;
};

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
    buildBooleanOrThrow(oc, op);

    if (op.IsDone?.() === false || op.HasErrors?.()) {
      return null;
    }

    const result = propagateBooleanIds(oc, op as unknown as OccBooleanAlgo, [target, tool]);
    if (options.id) result.id = options.id;
    if (options.sourceFeatureId) result.sourceFeatureId = options.sourceFeatureId;
    return result;
  } finally {
    op.delete?.();
    // NOTE: targetShape/toolShape are occDeref wrapPointer VIEWs — do NOT delete.
    // The OccHandle in body.shape owns the C++ lifetime.
  }
}

export function performOccBooleanWithRawTool(
  oc: OcctRaw,
  operation: OccBooleanOperation,
  target: BRepBody,
  toolShape: unknown,
  options: OccBooleanOptions = {},
): BRepBody | null {
  const targetShape = occDeref(oc, target.shape, oc.TopoDS_Shape);
  const op = createBooleanOperation(oc, operation, targetShape, toolShape);

  try {
    op.SetNonDestructive?.(true);
    if (options.fuzzyValue !== undefined) op.SetFuzzyValue?.(options.fuzzyValue);
    if (options.runParallel !== undefined) op.SetRunParallel?.(options.runParallel);
    buildBooleanOrThrow(oc, op);

    if (op.IsDone?.() === false || op.HasErrors?.()) {
      return null;
    }

    const result = propagateBooleanIds(oc, op as unknown as OccBooleanAlgo, [target]);
    if (options.id) result.id = options.id;
    if (options.sourceFeatureId) result.sourceFeatureId = options.sourceFeatureId;
    return result;
  } finally {
    op.delete?.();
    // NOTE: targetShape is an occDeref wrapPointer VIEW — do NOT delete.
  }
}

function createBooleanOperation(oc: OcctRaw, operation: OccBooleanOperation, targetShape: unknown, toolShape: unknown): OccBooleanBuilder {
  const api = oc as OccBooleanPairApi;
  if (operation === 'subtract') return new api.BRepAlgoAPI_Cut_3(targetShape, toolShape);
  if (operation === 'union') return new api.BRepAlgoAPI_Fuse_3(targetShape, toolShape);
  return new api.BRepAlgoAPI_Common_3(targetShape, toolShape);
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

    const result = propagateBooleanIds(oc, bop as unknown as OccBooleanAlgo, [target, ...tools]);
    if (options.id) result.id = options.id;
    if (options.sourceFeatureId) result.sourceFeatureId = options.sourceFeatureId;
    return result;
  } finally {
    bop.delete?.();
    // NOTE: rawShapes are occDeref wrapPointer VIEWs — do NOT delete.
    toolList.delete();
    objectList.delete();
  }
}

function getBatchBooleanOperation(occ: OccBooleanBatchApi, operation: OccBooleanOperation): unknown {
  if (operation === 'subtract') return occ.BOPAlgo_Operation.BOPAlgo_CUT;
  if (operation === 'union') return occ.BOPAlgo_Operation.BOPAlgo_FUSE;
  return occ.BOPAlgo_Operation.BOPAlgo_COMMON;
}
