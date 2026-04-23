import * as THREE from 'three';

const IMPORT_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x8899aa,
  metalness: 0.3,
  roughness: 0.4,
  side: THREE.DoubleSide,
});

export function createImportMaterial(): THREE.MeshPhysicalMaterial {
  return IMPORT_MATERIAL.clone();
}

export function createPlaceholderMesh(name: string): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(20, 20, 20);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xccaa44,
    metalness: 0.2,
    roughness: 0.5,
    transparent: true,
    opacity: 0.8,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${name} (preview)`;
  mesh.castShadow = true;
  return mesh;
}

export function extractCartesianPoints(stepText: string): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const regex = /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stepText)) !== null) {
    points.push(new THREE.Vector3(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])));
  }
  return points;
}

export function createMeshFromPoints(points: THREE.Vector3[], name: string): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  if (points.length >= 3) {
    const centroid = new THREE.Vector3();
    for (const point of points) centroid.add(point);
    centroid.divideScalar(points.length);
    for (let index = 0; index < points.length; index += 1) {
      const p1 = points[index];
      const p2 = points[(index + 1) % points.length];
      vertices.push(centroid.x, centroid.y, centroid.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, createImportMaterial());
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export async function extractZipEntry(bytes: Uint8Array, targetSuffix: string): Promise<string | null> {
  let offset = 0;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  while (offset + 30 < bytes.length) {
    if (!(bytes[offset] === 0x50 && bytes[offset + 1] === 0x4B && bytes[offset + 2] === 0x03 && bytes[offset + 3] === 0x04)) {
      break;
    }

    const generalPurposeBitFlag = bytes[offset + 6] | (bytes[offset + 7] << 8);
    const compression = bytes[offset + 8] | (bytes[offset + 9] << 8);
    let compSize = dv.getUint32(offset + 18, true);
    const nameLen = bytes[offset + 26] | (bytes[offset + 27] << 8);
    const extraLen = bytes[offset + 28] | (bytes[offset + 29] << 8);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;

    if ((generalPurposeBitFlag & 0x0008) !== 0) {
      let ddOffset = dataStart;
      let found = false;
      while (ddOffset + 4 <= bytes.length) {
        if (bytes[ddOffset] === 0x50 && bytes[ddOffset + 1] === 0x4B && bytes[ddOffset + 2] === 0x07 && bytes[ddOffset + 3] === 0x08) {
          compSize = dv.getUint32(ddOffset + 8, true);
          found = true;
          break;
        }
        if (bytes[ddOffset] === 0x50 && bytes[ddOffset + 1] === 0x4B && bytes[ddOffset + 2] === 0x03 && bytes[ddOffset + 3] === 0x04) {
          compSize = ddOffset - dataStart;
          found = true;
          break;
        }
        ddOffset += 1;
      }
      if (!found) break;
    }

    const data = bytes.slice(dataStart, dataStart + compSize);
    if (name.endsWith(targetSuffix)) {
      if (compression === 0) return new TextDecoder().decode(data);
      if (compression === 8) {
        try {
          type DecompressionStreamCtor = new (format: 'deflate-raw' | 'deflate' | 'gzip') => DecompressionStream;
          const DS = (window as Window & { DecompressionStream?: DecompressionStreamCtor }).DecompressionStream;
          if (!DS) return null;
          const ds = new DS('deflate-raw');
          const writer = ds.writable.getWriter();
          const reader = ds.readable.getReader();
          writer.write(data);
          writer.close();
          const chunks: Uint8Array[] = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value as Uint8Array);
          }
          let total = 0;
          for (const chunk of chunks) total += chunk.length;
          const result = new Uint8Array(total);
          let pos = 0;
          for (const chunk of chunks) {
            result.set(chunk, pos);
            pos += chunk.length;
          }
          return new TextDecoder().decode(result);
        } catch (error) {
          console.error('3MF: DEFLATE decompression failed', error);
          return null;
        }
      }
    }

    offset = dataStart + compSize;
  }

  return null;
}

export async function extractF3DMeshData(zipBytes: Uint8Array): Promise<THREE.Mesh | null> {
  let offset = 0;
  const meshVertices: number[] = [];
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

  while (offset < zipBytes.length - 4) {
    if (zipBytes[offset] === 0x50 && zipBytes[offset + 1] === 0x4B && zipBytes[offset + 2] === 0x03 && zipBytes[offset + 3] === 0x04) {
      const nameLen = zipBytes[offset + 26] | (zipBytes[offset + 27] << 8);
      const extraLen = zipBytes[offset + 28] | (zipBytes[offset + 29] << 8);
      const compSize = dv.getUint32(offset + 18, true);
      const fileName = new TextDecoder().decode(zipBytes.slice(offset + 30, offset + 30 + nameLen));

      if (fileName.endsWith('.obj') || fileName.endsWith('.stl')) {
        const dataStart = offset + 30 + nameLen + extraLen;
        const text = new TextDecoder().decode(zipBytes.slice(dataStart, dataStart + compSize));
        if (fileName.endsWith('.obj')) {
          for (const line of text.split('\n')) {
            const parts = line.trim().split(/\s+/);
            if (parts[0] === 'v') meshVertices.push(parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0);
          }
        }
      }
      offset += 30 + nameLen + extraLen + compSize;
    } else {
      break;
    }
  }

  if (meshVertices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshVertices, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, createImportMaterial());
}
