import { handleCornerEditingCommit } from './editing/cornerEditingHandlers';
import { handleCurveEditingCommit } from './editing/curveEditingHandlers';
import { handleLineEditingCommit } from './editing/lineEditingHandlers';
import type { SketchCommitHandler } from './types';

export const handleEditingSketchCommit: SketchCommitHandler = (ctx) => {
  if (handleLineEditingCommit(ctx)) return true;
  if (handleCornerEditingCommit(ctx)) return true;
  if (handleCurveEditingCommit(ctx)) return true;
  return false;
};
