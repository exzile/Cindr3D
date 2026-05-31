/**
 * OCC-21.4b — Split a solid body by a surface/face tool using
 * BRepAlgoAPI_Splitter_1 (no-arg constructor, then SetArguments/SetTools/Build).
 *
 * Unlike the halfspace-boolean plane split, this can produce N ≥ 2 pieces when
 * the splitting tool is non-planar or intersects the body multiple times.
 *
 * isSplittingToolExtended — when true the tool body is used as-is; when false
 * we use only the faces of the tool that actually intersect the source body.
 * The Splitter itself handles intersection clipping, so this flag is informational
 * for now (full "clamp to bbox" extension is a future enhancement).
 */
import type { OcctRaw } from '../types';
import { occDeref, makeBRepBodyFromOccShape, type BRepBody } from '../brepBody';
import { runEdgeOpBuild } from './adjacency';

// ── Minimal OCC-API surface types ────────────────────────────────────────────

interface OccSplitterBuilder {
  SetArguments(shapes: unknown): void;
  SetTools(shapes: unknown): void;
  Build(progress?: unknown): void;
  IsDone?(): boolean;
  HasErrors?(): boolean;
  Shape(): unknown;
  delete(): void;
}

interface OccListOfShape {
  Append_1(s: unknown): void;
  delete(): void;
}

type OccSplitBodyApi = OcctRaw & {
  BRepAlgoAPI_Splitter_1: new () => OccSplitterBuilder;
  TopTools_ListOfShape_1: new () => OccListOfShape;
  TopExp_Explorer_2: new (shape: unknown, find: unknown, avoid: unknown) => {
    More(): boolean;
    Current(): { delete(): void };
    Next(): void;
    delete(): void;
  };
  TopAbs_ShapeEnum: { TopAbs_SOLID: unknown; TopAbs_SHAPE: unknown };
};

// ── Public API ────────────────────────────────────────────────────────────────

export interface SplitBodyBySurfaceOptions {
  /**
   * When true (Fusion default) the splitting tool is extended to fill the body
   * bounding box.  When false only the tool faces that intersect the argument
   * body are used.  Currently both modes pass the full tool shape to OCC —
   * the Splitter handles intersection clipping automatically.
   */
  isSplittingToolExtended?: boolean;
}

/**
 * Split `body` using `toolBody` as the splitting surface via BRepAlgoAPI_Splitter.
 *
 * Returns an array of BRepBody pieces (may be empty on failure, length 1 if the
 * tool does not intersect the body, or N ≥ 2 on a successful split).
 *
 * VIEW / ownership rules:
 *   - rawBody and rawTool are occDeref VIEWs — never `.delete()` them.
 *   - splitter, argList, toolList are owned — deleted in the finally block.
 *   - Each `exp.Current()` copy is owned — deleted inside the while loop.
 *   - The rawResult from `splitter.Shape()` is a VIEW owned by the splitter —
 *     `makeBRepBodyFromOccShape` copies what it needs before splitter.delete().
 */
export function occSplitBodyBySurface(
  oc: OcctRaw,
  body: BRepBody,
  toolBody: BRepBody,
  options: SplitBodyBySurfaceOptions = {},
): BRepBody[] {
  void options; // isSplittingToolExtended reserved for future bbox-extension logic

  const occ = oc as OccSplitBodyApi;

  if (
    typeof occ.BRepAlgoAPI_Splitter_1 !== 'function' ||
    typeof occ.TopTools_ListOfShape_1 !== 'function'
  ) {
    console.warn('[occSplitBodyBySurface] BRepAlgoAPI_Splitter_1 not available in this WASM build');
    return [];
  }

  // VIEWs — do NOT delete.
  const rawBody = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const rawTool = occDeref(oc, toolBody.shape, oc.TopoDS_Shape);

  const argList = new occ.TopTools_ListOfShape_1();
  const toolList = new occ.TopTools_ListOfShape_1();
  const splitter = new occ.BRepAlgoAPI_Splitter_1();

  try {
    argList.Append_1(rawBody);
    toolList.Append_1(rawTool);

    splitter.SetArguments(argList);
    splitter.SetTools(toolList);

    runEdgeOpBuild(oc, splitter);

    if (splitter.IsDone?.() === false || splitter.HasErrors?.()) {
      console.warn('[occSplitBodyBySurface] Splitter returned errors or not done');
      return [];
    }

    const resultShape = splitter.Shape(); // VIEW — owned by splitter
    const pieces = extractSolids(occ, resultShape);
    return pieces;
  } catch (err) {
    console.warn('[occSplitBodyBySurface] threw:', err);
    return [];
  } finally {
    // Owned — delete in reverse construction order.
    splitter.delete();
    argList.delete();
    toolList.delete();
    // rawBody, rawTool are VIEWs — do NOT delete.
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Walk all TopAbs_SOLID children of a compound result shape and wrap each
 * as a BRepBody.  Each `exp.Current()` copy is owned and deleted here.
 */
function extractSolids(occ: OccSplitBodyApi, resultShape: unknown): BRepBody[] {
  const pieces: BRepBody[] = [];
  const exp = new occ.TopExp_Explorer_2(
    resultShape,
    occ.TopAbs_ShapeEnum.TopAbs_SOLID,
    occ.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  try {
    while (exp.More()) {
      const solid = exp.Current(); // owned copy — delete when done
      try {
        const piece = makeBRepBodyFromOccShape(occ as unknown as OcctRaw, solid, {});
        if (piece) pieces.push(piece);
      } catch (e) {
        console.warn('[occSplitBodyBySurface] Failed to wrap solid piece:', e);
      } finally {
        solid.delete();
      }
      exp.Next();
    }
  } finally {
    exp.delete();
  }
  return pieces;
}
