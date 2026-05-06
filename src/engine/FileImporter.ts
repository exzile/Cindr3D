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

    const doc = new DOMParser().parseFromString(modelXml, 'text/xml');
    const objects = doc.querySelectorAll('object');

    for (const obj of objects) {
      if (ext !== 'amf' && obj.getAttribute('type') === 'support') continue;
      const geometry = ext === 'amf' ? this.parseAmfObject(obj) : this.parseThreeMFObject(obj);
      if (!geometry) continue;

      const mesh = new THREE.Mesh(geometry, createImportMaterial());
      mesh.castShadow = true;
      group.add(mesh);
    }

    if (group.children.length === 0) group.add(createPlaceholderMesh(file.name));
    return group;
  }

  private static parseThreeMFObject(obj: Element): THREE.BufferGeometry | null {
    const vertexEls = obj.querySelectorAll('mesh > vertices > vertex');
    const triangleEls = obj.querySelectorAll('mesh > triangles > triangle');
    if (vertexEls.length === 0 || triangleEls.length === 0) return null;

    const positions: number[] = [];
    const indices: number[] = [];

    for (const vertex of vertexEls) {
      positions.push(
        parseFloat(vertex.getAttribute('x') ?? '0'),
        parseFloat(vertex.getAttribute('y') ?? '0'),
        parseFloat(vertex.getAttribute('z') ?? '0'),
      );
    }

    const vertexCount = vertexEls.length;
    for (const triangle of triangleEls) {
      const v1 = parseInt(triangle.getAttribute('v1') ?? '0', 10);
      const v2 = parseInt(triangle.getAttribute('v2') ?? '0', 10);
      const v3 = parseInt(triangle.getAttribute('v3') ?? '0', 10);
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

  private static parseAmfObject(obj: Element): THREE.BufferGeometry | null {
    const vertexEls = obj.querySelectorAll('mesh > vertices > vertex');
    const volumeEls = obj.querySelectorAll('mesh > volume');
    if (vertexEls.length === 0) return null;

    const positions: number[] = [];
    const indices: number[] = [];

    for (const vertex of vertexEls) {
      positions.push(
        parseFloat(vertex.querySelector('coordinates > x')?.textContent ?? '0'),
        parseFloat(vertex.querySelector('coordinates > y')?.textContent ?? '0'),
        parseFloat(vertex.querySelector('coordinates > z')?.textContent ?? '0'),
      );
    }

    const vertexCount = vertexEls.length;
    for (const volume of volumeEls) {
      for (const triangle of volume.querySelectorAll('triangle')) {
        const i1 = parseInt(triangle.querySelector('v1')?.textContent ?? '0', 10);
        const i2 = parseInt(triangle.querySelector('v2')?.textContent ?? '0', 10);
        const i3 = parseInt(triangle.querySelector('v3')?.textContent ?? '0', 10);
        if (i1 < 0 || i1 >= vertexCount || i2 < 0 || i2 >= vertexCount || i3 < 0 || i3 >= vertexCount) continue;
        indices.push(i1, i2, i3);
      }
    }

    if (positions.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (indices.length > 0) geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }
}
