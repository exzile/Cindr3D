import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { createAlignActions } from "./meshTransform/alignActions";
import { createMirrorActions } from "./meshTransform/mirrorActions";
import { createTransformScaleActions } from "./meshTransform/transformScaleActions";

export function createMeshTransformActions(context: CADSliceContext): Partial<CADState> {
  return {
    ...createTransformScaleActions(context),
    ...createAlignActions(context),
    ...createMirrorActions(context),
  };
}
