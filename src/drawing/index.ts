import * as THREE from 'three';
import type { Feature } from '../types/cad';

export type DrawingUnits = 'mm' | 'in';

export interface DrawingDimension {
  axis: 'x' | 'y' | 'z';
  label: string;
  value: number;
}

export interface DrawingView {
  id: 'top' | 'front' | 'right';
  label: string;
  dimensions: DrawingDimension[];
}

export interface DrawingSheet {
  title: string;
  units: DrawingUnits;
  generatedAt: string;
  bounds?: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  views: DrawingView[];
}

function tupleFromVector(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function getFeatureBounds(features: Feature[]): DrawingSheet['bounds'] {
  const bounds = new THREE.Box3();
  let hasGeometry = false;

  for (const feature of features) {
    if (!feature.visible || feature.suppressed || !feature.mesh) continue;
    const object = feature.mesh as THREE.Object3D;
    bounds.expandByObject(object);
    hasGeometry = true;
  }

  if (!hasGeometry || bounds.isEmpty()) return undefined;

  const size = new THREE.Vector3();
  bounds.getSize(size);
  return {
    min: tupleFromVector(bounds.min),
    max: tupleFromVector(bounds.max),
    size: tupleFromVector(size),
  };
}

function dimensionsForView(id: DrawingView['id'], size: [number, number, number]): DrawingDimension[] {
  if (id === 'top') {
    return [
      { axis: 'x', label: 'Width', value: size[0] },
      { axis: 'z', label: 'Depth', value: size[2] },
    ];
  }
  if (id === 'front') {
    return [
      { axis: 'x', label: 'Width', value: size[0] },
      { axis: 'y', label: 'Height', value: size[1] },
    ];
  }
  return [
    { axis: 'z', label: 'Depth', value: size[2] },
    { axis: 'y', label: 'Height', value: size[1] },
  ];
}

export function generateDrawingSheet(features: Feature[], units: DrawingUnits = 'mm', title = 'Untitled drawing'): DrawingSheet {
  const bounds = getFeatureBounds(features);
  const size = bounds?.size ?? [0, 0, 0];
  const views: DrawingView[] = [
    { id: 'top', label: 'Top', dimensions: dimensionsForView('top', size) },
    { id: 'front', label: 'Front', dimensions: dimensionsForView('front', size) },
    { id: 'right', label: 'Right', dimensions: dimensionsForView('right', size) },
  ];

  return {
    title,
    units,
    generatedAt: new Date().toISOString(),
    bounds,
    views,
  };
}

export function drawingToSvg(sheet: DrawingSheet): string {
  const viewLabels = sheet.views.map((view, index) => {
    const x = 70 + index * 160;
    return `<g><rect x="${x}" y="80" width="120" height="90" fill="none" stroke="#17201f"/><text x="${x}" y="195">${view.label}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="360" viewBox="0 0 560 360"><title>${sheet.title}</title><text x="28" y="36">${sheet.title}</text>${viewLabels}<text x="28" y="330">${sheet.units}</text></svg>`;
}

export function drawingToDxf(sheet: DrawingSheet): string {
  const labels = sheet.views.map((view) => `0\nTEXT\n1\n${view.label}`).join('\n');
  return `0\nSECTION\n2\nENTITIES\n${labels}\n0\nENDSEC\n0\nEOF\n`;
}

export function drawingToPdf(sheet: DrawingSheet): string {
  return `%PDF-1.1
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 560 360] >>
endobj
% ${sheet.title}
%%EOF`;
}
