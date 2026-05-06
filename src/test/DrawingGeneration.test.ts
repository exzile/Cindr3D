import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Feature } from '../types/cad';
import { drawingToDxf, drawingToPdf, drawingToSvg, generateDrawingSheet } from '../drawing';

function makeBoxFeature(): Feature {
  return {
    id: 'box',
    name: 'Box',
    type: 'primitive',
    params: { kind: 'box' },
    mesh: new THREE.Mesh(new THREE.BoxGeometry(20, 10, 30), new THREE.MeshBasicMaterial()),
    visible: true,
    suppressed: false,
    timestamp: Date.now(),
  };
}

describe('drawing generation', () => {
  it('generates orthographic views from visible model bounds', () => {
    const sheet = generateDrawingSheet([makeBoxFeature()], 'mm', 'Fixture');

    expect(sheet.bounds?.size).toEqual([20, 10, 30]);
    expect(sheet.views.map((view) => view.id)).toEqual(['top', 'front', 'right']);
    expect(sheet.views[0].dimensions.map((dimension) => dimension.label)).toEqual(['Width', 'Depth']);
  });

  it('exports svg, dxf, and pdf payloads', () => {
    const sheet = generateDrawingSheet([makeBoxFeature()]);

    expect(drawingToSvg(sheet)).toContain('<svg');
    expect(drawingToDxf(sheet)).toContain('SECTION');
    expect(drawingToPdf(sheet)).toContain('%PDF-1.1');
  });
});
