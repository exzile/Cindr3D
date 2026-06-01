import * as THREE from 'three';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { clearGroupChildren } from '../../../../utils/threeDisposal';
import type { SketchPreviewCtx } from './previews/types';
import { renderBasicShapePreview } from './previews/basicShapePreviews';
import { renderCurveAndPolygonPreview } from './previews/curveAndPolygonPreviews';
import { renderEllipsePreview } from './previews/ellipsePreviews';

const SKETCH_PREVIEW_RENDER_ORDER = 1001;
const PREVIEW_FINGERPRINT_CACHE = new Map<string, string>();
const CACHE_MAX = 32;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    PREVIEW_FINGERPRINT_CACHE.clear();
  });
}

function setFingerprint(key: string, value: string): void {
  if (PREVIEW_FINGERPRINT_CACHE.has(key)) {
    PREVIEW_FINGERPRINT_CACHE.delete(key);
  } else if (PREVIEW_FINGERPRINT_CACHE.size >= CACHE_MAX) {
    const oldest = PREVIEW_FINGERPRINT_CACHE.keys().next().value;
    if (oldest !== undefined) PREVIEW_FINGERPRINT_CACHE.delete(oldest);
  }
  PREVIEW_FINGERPRINT_CACHE.set(key, value);
}

function previewFingerprint(ctx: SketchPreviewCtx): string {
  const m = ctx.mousePos;
  const ms = m ? `${m.x.toFixed(4)}|${m.y.toFixed(4)}|${m.z.toFixed(4)}` : 'null';
  const dp = ctx.drawingPoints
    .map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`)
    .join(';');
  return `${ctx.activeTool}|${ms}|${dp}|${ctx.isDraggingArc}|${ctx.conicRho}|${ctx.blendCurveMode}|${ctx.polygonSides}`;
}

export type { SketchPreviewCtx } from './previews/types';

/** Returns true if the preview geometry was redrawn, false if the fingerprint matched (no-op). */
export function renderSketchPreview(ctx: SketchPreviewCtx): boolean {
  const {
    previewGroup,
    drawingPoints,
    mousePos,
    activeSketch,
    activeTool,
    isDraggingArc,
    startV,
    lineMat,
    constructionMat,
    centerlineMat,
    conicRho,
    blendCurveMode,
    polygonSides,
  } = ctx;

  if (!previewGroup) return false;

  const fp = previewFingerprint(ctx);
  if (PREVIEW_FINGERPRINT_CACHE.get(previewGroup.uuid) === fp) return false;
  setFingerprint(previewGroup.uuid, fp);

  clearGroupChildren(previewGroup);
  if (drawingPoints.length === 0 || !mousePos) return true;

  const start = drawingPoints[0];
  startV.set(start.x, start.y, start.z);
  const { t1, t2 } = activeSketch
    ? GeometryEngine.getSketchAxes(activeSketch)
    : GeometryEngine.getPlaneAxes('XZ');

  const addLine = (
    pts: THREE.Vector3[],
    mat?: THREE.LineBasicMaterial | THREE.LineDashedMaterial,
  ) => {
    const material = mat ?? lineMat;
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geom, material);
    line.renderOrder = SKETCH_PREVIEW_RENDER_ORDER;
    if ((material as THREE.LineDashedMaterial).isLineDashedMaterial) {
      line.computeLineDistances();
    }
    previewGroup.add(line);
  };

  const circlePoints = (center: THREE.Vector3, radius: number, segs = 64): THREE.Vector3[] => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(center.clone().addScaledVector(t1, Math.cos(a) * radius).addScaledVector(t2, Math.sin(a) * radius));
    }
    return pts;
  };

  const helpers = {
    start,
    startV,
    mousePos,
    activeSketch,
    drawingPoints,
    isDraggingArc,
    lineMat,
    constructionMat,
    centerlineMat,
    t1,
    t2,
    conicRho,
    blendCurveMode,
    polygonSides,
    addLine,
    circlePoints,
  };

  if (renderBasicShapePreview(activeTool, helpers)) return true;
  if (renderCurveAndPolygonPreview(activeTool, helpers)) return true;
  renderEllipsePreview(activeTool, helpers);
  return true;
}
