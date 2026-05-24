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

const TMP_WRITE = '/occ_step_out.step';
const TMP_READ  = '/occ_step_in.step';

// ── Write ────────────────────────────────────────────────────────────────────

export function shapeToStep(oc: OcctRaw, body: BRepBody): OccOperationResult<string> {
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);

  let writer: unknown;
  try {
    writer = new oc.STEPControl_Writer_1();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (writer as any).Transfer(rawShape, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      return occErr(occMessage('error', 'STEP_TRANSFER_FAIL', `STEPControl_Writer.Transfer returned status ${status}`));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writeStatus = (writer as any).Write(TMP_WRITE);
    if (writeStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      return occErr(occMessage('error', 'STEP_WRITE_FAIL', `STEPControl_Writer.Write returned status ${writeStatus}`));
    }
  } catch (e) {
    return occErr(occMessage('error', 'STEP_WRITE_EXCEPTION', String(e)));
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (writer as any)?.delete?.();
    rawShape.delete?.();
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

  let rawShape: unknown;
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
    rawShape = (reader as any).Shape(1);
  } catch (e) {
    return occErr(occMessage('error', 'STEP_READ_EXCEPTION', String(e)));
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reader as any)?.delete?.();
    try { oc.FS.unlink(TMP_READ); } catch { /* best effort */ }
  }

  if (!rawShape) {
    return occErr(occMessage('error', 'STEP_NO_SHAPE', 'STEP reader produced no shape'));
  }

  try {
    const body = makeBRepBodyFromOccShape(oc, rawShape);
    return occOk(body);
  } catch (e) {
    return occErr(occMessage('error', 'STEP_BODY_WRAP_FAIL', String(e)));
  }
}
