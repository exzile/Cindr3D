import * as THREE from 'three';

export class STLExporter {
  /**
   * Export a mesh or group as binary STL (industry standard for 3D printing)
   */
  static exportBinary(object: THREE.Object3D): ArrayBuffer {
    const triangles = this.collectTriangles(object);
    const numTriangles = triangles.length;

    // Binary STL format:
    // 80 bytes header + 4 bytes triangle count + 50 bytes per triangle
    const bufferSize = 84 + numTriangles * 50;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // Header (80 bytes) - can be anything
    const header = 'Dzign3D STL Export';
    for (let i = 0; i < 80; i++) {
      view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
    }

    // Triangle count
    view.setUint32(80, numTriangles, true);

    let offset = 84;
    for (const tri of triangles) {
      // Normal vector (3 floats)
      view.setFloat32(offset, tri.normal.x, true); offset += 4;
      view.setFloat32(offset, tri.normal.y, true); offset += 4;
      view.setFloat32(offset, tri.normal.z, true); offset += 4;

      // Vertex 1
      view.setFloat32(offset, tri.v1.x, true); offset += 4;
      view.setFloat32(offset, tri.v1.y, true); offset += 4;
      view.setFloat32(offset, tri.v1.z, true); offset += 4;

      // Vertex 2
      view.setFloat32(offset, tri.v2.x, true); offset += 4;
      view.setFloat32(offset, tri.v2.y, true); offset += 4;
      view.setFloat32(offset, tri.v2.z, true); offset += 4;

      // Vertex 3
      view.setFloat32(offset, tri.v3.x, true); offset += 4;
      view.setFloat32(offset, tri.v3.y, true); offset += 4;
      view.setFloat32(offset, tri.v3.z, true); offset += 4;

      // Attribute byte count
      view.setUint16(offset, 0, true); offset += 2;
    }

    return buffer;
  }

  /**
   * Export a mesh or group as ASCII STL
   */
  static exportASCII(object: THREE.Object3D, name = 'Dzign3D_Model'): string {
    const triangles = this.collectTriangles(object);
    const lines: string[] = [`solid ${name}`];

    for (const tri of triangles) {
      lines.push(`  facet normal ${tri.normal.x} ${tri.normal.y} ${tri.normal.z}`);
      lines.push('    outer loop');
      lines.push(`      vertex ${tri.v1.x} ${tri.v1.y} ${tri.v1.z}`);
      lines.push(`      vertex ${tri.v2.x} ${tri.v2.y} ${tri.v2.z}`);
      lines.push(`      vertex ${tri.v3.x} ${tri.v3.y} ${tri.v3.z}`);
      lines.push('    endloop');
      lines.push('  endfacet');
    }

    lines.push(`endsolid ${name}`);
    return lines.join('\n');
  }

  /**
   * Export as OBJ format
   */
  static exportOBJ(object: THREE.Object3D, name = 'Dzign3D_Model'): string {
    const triangles = this.collectTriangles(object);
    const lines: string[] = [`# ${name}`, `# Exported from Dzign3D`, ''];

    // Collect unique vertices
    const vertexMap = new Map<string, number>();
    const vertices: THREE.Vector3[] = [];

    function getVertexIndex(v: THREE.Vector3): number {
      const key = `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`;
      let idx = vertexMap.get(key);
      if (idx === undefined) {
        idx = vertices.length;
        vertices.push(v);
        vertexMap.set(key, idx);
      }
      return idx + 1; // OBJ is 1-indexed
    }

    for (const v of vertices) {
      lines.push(`v ${v.x} ${v.y} ${v.z}`);
    }

    // First pass: collect all vertices
    for (const tri of triangles) {
      getVertexIndex(tri.v1);
      getVertexIndex(tri.v2);
      getVertexIndex(tri.v3);
    }

    // Write vertices
    for (const v of vertices) {
      lines.push(`v ${v.x} ${v.y} ${v.z}`);
    }

    lines.push('');

    // Write faces
    for (const tri of triangles) {
      const i1 = getVertexIndex(tri.v1);
      const i2 = getVertexIndex(tri.v2);
      const i3 = getVertexIndex(tri.v3);
      lines.push(`f ${i1} ${i2} ${i3}`);
    }

    return lines.join('\n');
  }

  private static collectTriangles(object: THREE.Object3D): Triangle[] {
    const triangles: Triangle[] = [];

    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geometry = child.geometry;
        const posAttr = geometry.getAttribute('position');
        if (!posAttr) return;

        // Apply world transform
        const matrixWorld = child.matrixWorld;

        const index = geometry.getIndex();
        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        const vC = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const cb = new THREE.Vector3();
        const ab = new THREE.Vector3();

        if (index) {
          for (let i = 0; i < index.count; i += 3) {
            const a = index.getX(i);
            const b = index.getX(i + 1);
            const c = index.getX(i + 2);

            vA.fromBufferAttribute(posAttr, a).applyMatrix4(matrixWorld);
            vB.fromBufferAttribute(posAttr, b).applyMatrix4(matrixWorld);
            vC.fromBufferAttribute(posAttr, c).applyMatrix4(matrixWorld);

            cb.subVectors(vC, vB);
            ab.subVectors(vA, vB);
            normal.crossVectors(cb, ab).normalize();

            triangles.push({
              normal: normal.clone(),
              v1: vA.clone(),
              v2: vB.clone(),
              v3: vC.clone(),
            });
          }
        } else {
          for (let i = 0; i < posAttr.count; i += 3) {
            vA.fromBufferAttribute(posAttr, i).applyMatrix4(matrixWorld);
            vB.fromBufferAttribute(posAttr, i + 1).applyMatrix4(matrixWorld);
            vC.fromBufferAttribute(posAttr, i + 2).applyMatrix4(matrixWorld);

            cb.subVectors(vC, vB);
            ab.subVectors(vA, vB);
            normal.crossVectors(cb, ab).normalize();

            triangles.push({
              normal: normal.clone(),
              v1: vA.clone(),
              v2: vB.clone(),
              v3: vC.clone(),
            });
          }
        }
      }
    });

    return triangles;
  }
}

interface Triangle {
  normal: THREE.Vector3;
  v1: THREE.Vector3;
  v2: THREE.Vector3;
  v3: THREE.Vector3;
}

/**
 * Export as 3MF (3D Manufacturing Format) — XML-based zip archive
 * This produces a minimal valid 3MF file compatible with most slicers
 */
export class ThreeMFExporter {
  static async export(object: THREE.Object3D, name = 'Dzign3D_Model'): Promise<Blob> {
    const { vertices, triangles } = this.collectMeshData(object);

    const modelXml = this.buildModelXml(vertices, triangles, name);
    const contentTypes = this.buildContentTypes();
    const rels = this.buildRels();

    // Build ZIP manually (minimal implementation)
    const files: ZipEntry[] = [
      { name: '[Content_Types].xml', data: new TextEncoder().encode(contentTypes) },
      { name: '_rels/.rels', data: new TextEncoder().encode(rels) },
      { name: '3D/3dmodel.model', data: new TextEncoder().encode(modelXml) },
    ];

    return this.buildZip(files);
  }

  private static collectMeshData(object: THREE.Object3D): {
    vertices: number[];
    triangles: number[];
  } {
    const vertices: number[] = [];
    const triangles: number[] = [];
    let vertexOffset = 0;

    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geometry = child.geometry;
        const posAttr = geometry.getAttribute('position');
        if (!posAttr) return;

        const matrixWorld = child.matrixWorld;
        const v = new THREE.Vector3();

        // Add vertices
        for (let i = 0; i < posAttr.count; i++) {
          v.fromBufferAttribute(posAttr, i).applyMatrix4(matrixWorld);
          vertices.push(v.x, v.y, v.z);
        }

        // Add triangles
        const index = geometry.getIndex();
        if (index) {
          for (let i = 0; i < index.count; i += 3) {
            triangles.push(
              index.getX(i) + vertexOffset,
              index.getX(i + 1) + vertexOffset,
              index.getX(i + 2) + vertexOffset
            );
          }
        } else {
          for (let i = 0; i < posAttr.count; i += 3) {
            triangles.push(
              i + vertexOffset,
              i + 1 + vertexOffset,
              i + 2 + vertexOffset
            );
          }
        }

        vertexOffset += posAttr.count;
      }
    });

    return { vertices, triangles };
  }

  private static buildModelXml(vertices: number[], triangles: number[], name: string): string {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">${name}</metadata>
  <metadata name="Application">Dzign3D</metadata>
  <resources>
    <object id="1" type="model" name="${name}">
      <mesh>
        <vertices>\n`;

    for (let i = 0; i < vertices.length; i += 3) {
      xml += `          <vertex x="${vertices[i]}" y="${vertices[i + 1]}" z="${vertices[i + 2]}" />\n`;
    }

    xml += `        </vertices>
        <triangles>\n`;

    for (let i = 0; i < triangles.length; i += 3) {
      xml += `          <triangle v1="${triangles[i]}" v2="${triangles[i + 1]}" v3="${triangles[i + 2]}" />\n`;
    }

    xml += `        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

    return xml;
  }

  private static buildContentTypes(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;
  }

  private static buildRels(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;
  }

  private static buildZip(entries: ZipEntry[]): Blob {
    const parts: Uint8Array[] = [];
    const centralDir: Uint8Array[] = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = new TextEncoder().encode(entry.name);
      const data = entry.data;

      // Local file header
      const localHeader = new ArrayBuffer(30 + nameBytes.length);
      const lhView = new DataView(localHeader);
      lhView.setUint32(0, 0x04034b50, true); // signature
      lhView.setUint16(4, 20, true); // version needed
      lhView.setUint16(6, 0, true); // flags
      lhView.setUint16(8, 0, true); // compression (stored)
      lhView.setUint16(10, 0, true); // mod time
      lhView.setUint16(12, 0, true); // mod date
      lhView.setUint32(14, this.crc32(data), true); // crc32
      lhView.setUint32(18, data.length, true); // compressed size
      lhView.setUint32(22, data.length, true); // uncompressed size
      lhView.setUint16(26, nameBytes.length, true); // name length
      lhView.setUint16(28, 0, true); // extra length
      new Uint8Array(localHeader).set(nameBytes, 30);

      parts.push(new Uint8Array(localHeader));
      parts.push(data);

      // Central directory entry
      const cdEntry = new ArrayBuffer(46 + nameBytes.length);
      const cdView = new DataView(cdEntry);
      cdView.setUint32(0, 0x02014b50, true); // signature
      cdView.setUint16(4, 20, true); // version made by
      cdView.setUint16(6, 20, true); // version needed
      cdView.setUint16(8, 0, true); // flags
      cdView.setUint16(10, 0, true); // compression
      cdView.setUint16(12, 0, true); // mod time
      cdView.setUint16(14, 0, true); // mod date
      cdView.setUint32(16, this.crc32(data), true); // crc32
      cdView.setUint32(20, data.length, true); // compressed size
      cdView.setUint32(24, data.length, true); // uncompressed size
      cdView.setUint16(28, nameBytes.length, true); // name length
      cdView.setUint16(30, 0, true); // extra length
      cdView.setUint16(32, 0, true); // comment length
      cdView.setUint16(34, 0, true); // disk number
      cdView.setUint16(36, 0, true); // internal attrs
      cdView.setUint32(38, 0, true); // external attrs
      cdView.setUint32(42, offset, true); // local header offset
      new Uint8Array(cdEntry).set(nameBytes, 46);

      centralDir.push(new Uint8Array(cdEntry));
      offset += 30 + nameBytes.length + data.length;
    }

    // Central directory
    const cdOffset = offset;
    let cdSize = 0;
    for (const cd of centralDir) {
      parts.push(cd);
      cdSize += cd.length;
    }

    // End of central directory
    const eocd = new ArrayBuffer(22);
    const eocdView = new DataView(eocd);
    eocdView.setUint32(0, 0x06054b50, true); // signature
    eocdView.setUint16(4, 0, true); // disk number
    eocdView.setUint16(6, 0, true); // cd disk
    eocdView.setUint16(8, entries.length, true); // entries on disk
    eocdView.setUint16(10, entries.length, true); // total entries
    eocdView.setUint32(12, cdSize, true); // cd size
    eocdView.setUint32(16, cdOffset, true); // cd offset
    eocdView.setUint16(20, 0, true); // comment length
    parts.push(new Uint8Array(eocd));

    return new Blob(parts.map(p => p.buffer as ArrayBuffer), { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
  }

  private static crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}
