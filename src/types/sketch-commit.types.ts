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
}

export type SketchCommitHandler = (ctx: SketchCommitCtx) => boolean;
