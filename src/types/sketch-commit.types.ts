import * as THREE from 'three';
import type { Sketch, SketchConstraint, SketchEntity, SketchPoint } from './cad';

export interface SketchCommitCtx {
  activeTool: string;
  activeSketch: Sketch;
  sketchPoint: SketchPoint;
  drawingPoints: SketchPoint[];
  setDrawingPoints: (pts: SketchPoint[]) => void;
  t1: THREE.Vector3;
  t2: THREE.Vector3;
  projectToPlane: (pt: SketchPoint, origin: SketchPoint) => { u: number; v: number };
  addSketchEntity: (e: SketchEntity) => void;
  addSketchConstraint: (c: SketchConstraint) => void;
  replaceSketchEntities: (entities: SketchEntity[]) => void;
  replaceActiveSketchGeometry: (entities: SketchEntity[], constraints: SketchConstraint[]) => void;
  cycleEntityLinetype: (id: string) => void;
  setStatusMessage: (msg: string) => void;
  polygonSides: number;
  filletRadius: number;
  chamferDist1: number;
  chamferDist2: number;
  chamferAngle: number;
  tangentCircleRadius: number;
  conicRho: number;
  blendCurveMode: 'g1' | 'g2';
  /** A10: inference constraint to auto-apply when a line is committed (horizontal/vertical). */
  inferenceConstraint?: 'horizontal' | 'vertical' | null;
  /** A10: callback invoked by basic line commit with the new entity's id — used to apply inference constraint. */
  onEntityCommitted?: (id: string) => void;
}

export type SketchCommitHandler = (ctx: SketchCommitCtx) => boolean;
