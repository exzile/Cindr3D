import type * as THREE from 'three';
import type { Sketch, SketchPoint } from '../../../../../types/cad';

export interface SketchPreviewCtx {
  previewGroup: THREE.Group;
  drawingPoints: SketchPoint[];
  mousePos: THREE.Vector3 | null;
  activeSketch: Sketch | null;
  activeTool: string;
  isDraggingArc: boolean;
  startV: THREE.Vector3;
  lineMat: THREE.LineBasicMaterial;
  constructionMat: THREE.LineDashedMaterial;
  centerlineMat: THREE.LineDashedMaterial;
  conicRho: number;
  blendCurveMode: 'g1' | 'g2';
}

export interface SketchPreviewHelpers {
  start: SketchPoint;
  startV: THREE.Vector3;
  mousePos: THREE.Vector3;
  activeSketch: Sketch | null;
  drawingPoints: SketchPoint[];
  isDraggingArc: boolean;
  lineMat: THREE.LineBasicMaterial;
  constructionMat: THREE.LineDashedMaterial;
  centerlineMat: THREE.LineDashedMaterial;
  t1: THREE.Vector3;
  t2: THREE.Vector3;
  conicRho: number;
  blendCurveMode: 'g1' | 'g2';
  addLine: (pts: THREE.Vector3[], mat?: THREE.LineBasicMaterial | THREE.LineDashedMaterial) => void;
  circlePoints: (center: THREE.Vector3, radius: number, segs?: number) => THREE.Vector3[];
}
