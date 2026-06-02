import * as THREE from 'three';
import {
  createImportMaterial,
  createMeshFromPoints,
  createPlaceholderMesh,
  extractCartesianPoints,
  extractF3DMeshData,
  extractZipEntry,
} from './fileImporter/helpers';
import { autoRepairMeshGeometry } from '../meshRepair';

type XmlObjectRecord = {
  attrs: Record<string, string>;
  body: string;
};

function decodeXmlText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function readXmlAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([\w:-]+)\s*=\s*(["'])(.*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const key = match[1].split(':').pop() ?? match[1];
    attrs[key] = decodeXmlText(match[3]);
  }
  return attrs;
}

function readXmlBlocks(source: string, tag: string): XmlObjectRecord[] {
  const pattern = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'gi');
  const blocks: XmlObjectRecord[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    blocks.push({ attrs: readXmlAttributes(match[1]), body: match[2] });
  }
  return blocks;
}

function readXmlElements(source: string, tag: string): XmlObjectRecord[] {
  const pattern = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>)`, 'gi');
  const elements: XmlObjectRecord[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    elements.push({ attrs: readXmlAttributes(match[1]), body: match[2] ?? '' });
  }
  return elements;
}

function readXmlText(source: string, tag: string): string | null {
  const pattern = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i');
  const match = source.match(pattern);
  return match ? decodeXmlText(match[1].trim()) : null;
}

function finiteNumber(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

export class FileImporter {
  static async importSTEP(file: File): Promise<THREE.Group> {
    const text = await file.text();
    const group = new THREE.Group();
    group.name = file.name.replace(/\.[^.]+$/, '');

    const hasClosedShell = text.includes('CLOSED_SHELL') || text.includes('MANIFOLD_SOLID_BREP');
    if (!hasClosedShell) {
      group.add(createPlaceholderMesh(file.name));
      return group;
    }

    const points = extractCartesianPoints(text);
    group.add(points.length >= 3 ? createMeshFromPoints(points, file.name) : createPlaceholderMesh(file.name));
    return group;
  }

  static async importF3D(file: File): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.name = file.name.replace(/\.[^.]+$/, '');

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      const mesh = isZip ? await extractF3DMeshData(bytes) : null;
      group.add(mesh ?? createPlaceholderMesh(file.name));
    } catch {
      group.add(createPlaceholderMesh(file.name));
    }

    return group;
  }

  static async importSTL(file: File): Promise<THREE.Group> {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    const group = new THREE.Group();
    group.name = file.name.replace(/\.[^.]+$/, '');

    const rawGeometry = new STLLoader().parse(await file.arrayBuffer());
    const geometry = autoRepairMeshGeometry(rawGeometry);
    if (geometry !== rawGeometry) rawGeometry.dispose();

    const mesh = new THREE.Mesh(geometry, createImportMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }

  static async importOBJ(file: File): Promise<THREE.Group> {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    const group = new OBJLoader().parse(await file.text());
    group.name = file.name.replace(/\.[^.]+$/, '');

    const material = createImportMaterial();
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = material;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return group;
  }

  static async importFile(file: File): Promise<THREE.Group> {
    const ext = file.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'step':
      case 'stp':
        return this.importSTEP(file);
      case 'f3d':
        return this.importF3D(file);
      case 'stl':
        return this.importSTL(file);
      case 'obj':
        return this.importOBJ(file);
      case '3mf':
      case 'amf':
        return this.importThreeMF(file);
      default:
        throw new Error(`Unsupported file format: .${ext}`);
    }
  }

  static async importThreeMF(file: File): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.name = file.name.replace(/\.[^.]+$/, '');

    const ext = file.name.split('.').pop()?.toLowerCase();
    const modelXml = ext === 'amf'
      ? await file.text()
      : await extractZipEntry(new Uint8Array(await file.arrayBuffer()), '3dmodel.model');

    if (!modelXml) {
      group.add(createPlaceholderMesh(file.name));
      return group;
    }

    const objects = readXmlBlocks(modelXml, 'object');

    for (const obj of objects) {
      if (ext !== 'amf' && obj.attrs.type === 'support') continue;
      const geometry = ext === 'amf' ? this.parseAmfObjectXml(obj.body) : this.parseThreeMFObjectXml(obj.body);
      if (!geometry) continue;

      const mesh = new THREE.Mesh(geometry, createImportMaterial());
      mesh.castShadow = true;
      group.add(mesh);
    }

    if (group.children.length === 0) group.add(createPlaceholderMesh(file.name));
    return group;
  }

  private static parseThreeMFObjectXml(source: string): THREE.BufferGeometry | null {
    const vertexEls = readXmlElements(source, 'vertex');
    const triangleEls = readXmlElements(source, 'triangle');
    if (vertexEls.length === 0 || triangleEls.length === 0) return null;

    const positions: number[] = [];
    const indices: number[] = [];

    for (const vertex of vertexEls) {
      positions.push(
        finiteNumber(vertex.attrs.x),
        finiteNumber(vertex.attrs.y),
        finiteNumber(vertex.attrs.z),
      );
    }

    const vertexCount = vertexEls.length;
    for (const triangle of triangleEls) {
      const v1 = Number.parseInt(triangle.attrs.v1 ?? '0', 10);
      const v2 = Number.parseInt(triangle.attrs.v2 ?? '0', 10);
      const v3 = Number.parseInt(triangle.attrs.v3 ?? '0', 10);
      if (v1 < 0 || v1 >= vertexCount || v2 < 0 || v2 >= vertexCount || v3 < 0 || v3 >= vertexCount) continue;
      indices.push(v1, v2, v3);
    }

    if (indices.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private static parseAmfObjectXml(source: string): THREE.BufferGeometry | null {
    const vertexEls = readXmlBlocks(source, 'vertex');
    const triangleEls = readXmlBlocks(source, 'triangle');
    if (vertexEls.length === 0 || triangleEls.length === 0) return null;

    const positions: number[] = [];
    const indices: number[] = [];

    for (const vertex of vertexEls) {
      positions.push(
        finiteNumber(readXmlText(vertex.body, 'x')),
        finiteNumber(readXmlText(vertex.body, 'y')),
        finiteNumber(readXmlText(vertex.body, 'z')),
      );
    }

    const vertexCount = vertexEls.length;
    for (const triangle of triangleEls) {
      const v1 = Number.parseInt(readXmlText(triangle.body, 'v1') ?? '0', 10);
      const v2 = Number.parseInt(readXmlText(triangle.body, 'v2') ?? '0', 10);
      const v3 = Number.parseInt(readXmlText(triangle.body, 'v3') ?? '0', 10);
      if (v1 < 0 || v1 >= vertexCount || v2 < 0 || v2 >= vertexCount || v3 < 0 || v3 >= vertexCount) continue;
      indices.push(v1, v2, v3);
    }

    if (indices.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

}
