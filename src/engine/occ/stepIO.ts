/**
 * stepIO.ts — STEP round-trip serializer (OCC-2.2).
 *
 * shapeToStep: BRepBody → STEP string (via STEPControl_Writer + Emscripten FS)
 * shapeFromStep: STEP string → BRepBody (via STEPControl_Reader)
 *
 * Uses Emscripten's virtual FS for in-memory I/O: OCC writes to a temp path,
 * we read the string back, then unlink. No actual disk I/O in the browser.
 */
import type { OcctRaw } from './types';
import { occDeref, makeBRepBodyFromOccShape, type BRepBody } from './brepBody';
import { type OccOperationResult, occOk, occErr, occMessage } from './result';
import { occConsole } from './occConsole';

const TMP_WRITE = '/occ_step_out.step';
const TMP_READ  = '/occ_step_in.step';

// ── Write ────────────────────────────────────────────────────────────────────

export function shapeToStep(oc: OcctRaw, body: BRepBody): OccOperationResult<string> {
  let rawShape: unknown;
  try {
    rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (rawShape as any)?.isDeleted === 'function' && (rawShape as any).isDeleted()) {
      return occErr(occMessage('error', 'STEP_SHAPE_DELETED', 'Body shape WASM wrapper is already deleted'));
    }
  } catch (e) {
    return occErr(occMessage('error', 'STEP_DEREF_FAIL', String(e)));
  }
  // NOTE: rawShape is a VIEW from occDeref (returns body.shape._object directly).
  // Do NOT delete it — that would destroy the body's own shape handle.

  let writer: unknown;
  let progress: unknown;
  try {
    writer = new oc.STEPControl_Writer_1();
    progress = new oc.Message_ProgressRange_1();

    // Suppress OCC's verbose STEP transfer statistics from the console.
    // The filter is installed in main.tsx (before OCC WASM loads) and reads
    // occConsole.suppress — see occConsole.ts for the full explanation.
    occConsole.suppress = true;
    let status: unknown;
    let writeStatus: unknown;
    try {
      // STEPControl_Writer.Transfer requires 4 args: shape, mode, compgraph, progressRange
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status = (writer as any).Transfer(rawShape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (status === oc.IFSelect_ReturnStatus.IFSelect_RetDone) writeStatus = (writer as any).Write(TMP_WRITE);
    } finally {
      occConsole.suppress = false;
    }

    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      return occErr(occMessage('error', 'STEP_TRANSFER_FAIL', `STEPControl_Writer.Transfer returned status ${status}`));
    }
    if (writeStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      return occErr(occMessage('error', 'STEP_WRITE_FAIL', `STEPControl_Writer.Write returned status ${writeStatus}`));
    }
  } catch (e) {
    return occErr(occMessage('error', 'STEP_WRITE_EXCEPTION', String(e)));
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (progress as any)?.delete?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (writer as any)?.delete?.();
    // rawShape is a VIEW — do NOT delete.
  }

  let stepString: string;
  try {
    stepString = oc.FS.readFile(TMP_WRITE, { encoding: 'utf8' }) as string;
  } catch (e) {
    return occErr(occMessage('error', 'STEP_FS_READ_FAIL', String(e)));
  } finally {
    try { oc.FS.unlink(TMP_WRITE); } catch { /* best effort */ }
  }

  return occOk(stepString);
}

// ── Read ─────────────────────────────────────────────────────────────────────

export function shapeFromStep(oc: OcctRaw, stepString: string): OccOperationResult<BRepBody> {
  // Write step string to Emscripten FS
  try {
    oc.FS.writeFile(TMP_READ, stepString);
  } catch (e) {
    return occErr(occMessage('error', 'STEP_FS_WRITE_FAIL', String(e)));
  }

  let reader: unknown;
  try {
    reader = new oc.STEPControl_Reader_1();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const readStatus = (reader as any).ReadFile(TMP_READ);
    if (readStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      return occErr(occMessage('error', 'STEP_READ_FAIL', `STEPControl_Reader.ReadFile returned status ${readStatus}`));
    }
    const progress = new oc.Message_ProgressRange_1();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (reader as any).TransferRoots(progress);
    } finally {
      progress.delete?.();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawShape = (reader as any).Shape(1);
    if (!rawShape) {
      return occErr(occMessage('error', 'STEP_NO_SHAPE', 'STEP reader produced no shape'));
    }

    // Build the BRepBody BEFORE the reader is deleted.
    // reader.Shape(1) returns a reference into the reader's internal data —
    // deleting the reader invalidates rawShape.  makeBRepBodyFromOccShape
    // must consume rawShape (and its topology) while the reader is still alive.
    // Pass the reader as an ownedResource so it stays alive as long as the body.
    // rawShape (from reader.Shape(1)) is a reference into the reader's internal
    // storage — deleting the reader would invalidate it.
    const body = makeBRepBodyFromOccShape(oc, rawShape, { ownedResources: [reader as { delete?: () => void }] });
    return occOk(body);
  } catch (e) {
    // Body creation failed — reader was NOT transferred to ownedResources, delete it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { (reader as any)?.delete?.(); } catch { /* already freed */ }
    return occErr(occMessage('error', 'STEP_READ_EXCEPTION', String(e)));
  } finally {
    try { oc.FS.unlink(TMP_READ); } catch { /* best effort */ }
  }
}
