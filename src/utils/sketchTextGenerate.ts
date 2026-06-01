import * as THREE from 'three';
import { loadFont, fontPathToContours } from './sketchTextUtil';
import { resolveFace } from './fontRegistry';
import { samplePath2D, buildArcTable, mapAlongPath } from './textOnPath';
import type { SketchEntity, SketchTextMeta } from '../types/cad';

/** One closed glyph contour in world (sketch-plane) coordinates. */
export type TextContour3D = Array<{ x: number; y: number; z: number }>;

/**
 * Generate the closed 3D glyph contours for a Sketch Text object.
 *
 * Resolves the requested font face (family + bold/italic), loads it (cached),
 * extracts each glyph outline/counter as a closed 2D contour honoring all
 * formatting, then maps every contour point onto the sketch plane via the basis
 * vectors anchored at `meta.anchor`. Each contour becomes one closed sketch
 * entity, so text participates in profile detection and can be extruded.
 *
 * Shared by first-placement (canvas click) and re-edit (double-click → OK).
 */
export async function generateText3DContours(
  t1: THREE.Vector3,
  t2: THREE.Vector3,
  meta: SketchTextMeta,
): Promise<TextContour3D[]> {
  const face = resolveFace(meta.font, meta.bold, meta.italic);
  const font = await loadFont(face.url);
  const contours2d = fontPathToContours(font, meta.content, meta.height, 8, {
    bold: meta.bold,
    italic: meta.italic,
    shear: face.shear,
    charSpacing: meta.charSpacing,
    flipH: meta.flipH,
    flipV: meta.flipV,
    hAlign: meta.hAlign,
    vAlign: meta.vAlign,
  });
  const anchor = new THREE.Vector3(meta.anchor.x, meta.anchor.y, meta.anchor.z);
  return contours2d.map((contour) =>
    contour.map((p) => {
      const v = anchor.clone().addScaledVector(t1, p.x).addScaledVector(t2, p.y);
      return { x: v.x, y: v.y, z: v.z };
    }),
  );
}

/**
 * Generate closed glyph contours bent along a baseline curve (text-on-path).
 *
 * Lays glyphs out flat (left-aligned, baseline at y=0), then maps each contour
 * point onto the path: its x becomes arc-length along the curve and its y an
 * offset along the curve's normal. `origin`/`t1`/`t2` define the sketch plane;
 * `pathEntity` is the baseline curve (line/arc/spline/circle/ellipse).
 */
export async function generateTextAlongPathContours(
  origin: THREE.Vector3,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
  pathEntity: SketchEntity,
  meta: SketchTextMeta,
): Promise<TextContour3D[]> {
  const face = resolveFace(meta.font, meta.bold, meta.italic);
  const font = await loadFont(face.url);
  const contours2d = fontPathToContours(font, meta.content, meta.height, 8, {
    bold: meta.bold,
    italic: meta.italic,
    shear: face.shear,
    charSpacing: meta.charSpacing,
    flipH: meta.flipH,
    flipV: meta.flipV,
    hAlign: 'left',           // x must start at 0 = path start
    vAlign: meta.vAlign,
  });

  const project = (p: { x: number; y: number; z: number }) => {
    const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    return { u: d.dot(t1), v: d.dot(t2) };
  };
  const poly = samplePath2D(pathEntity, project);
  if (poly.length < 2) {
    // Degenerate path → fall back to a straight baseline at the path's start.
    return generateText3DContours(t1, t2, meta);
  }
  const table = buildArcTable(poly);

  return contours2d.map((contour) =>
    contour.map((p) => {
      const uv = mapAlongPath(table, p.x, p.y);
      const v = origin.clone().addScaledVector(t1, uv.u).addScaledVector(t2, uv.v);
      return { x: v.x, y: v.y, z: v.z };
    }),
  );
}
