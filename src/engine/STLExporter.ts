import * as THREE from 'three';
import { STLExporter as ThreeSTLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { zipSync } from 'fflate';

const _stlExporter = new ThreeSTLExporter();
const _objExporter = new OBJExporter();

export class STLExporter {
  static exportBinary(object: THREE.Object3D): ArrayBuffer {
    const dv = _stlExporter.parse(object, { binary: true }) as DataView;
    // Copy into a plain ArrayBuffer to avoid SharedArrayBuffer typing issues
    const out = new ArrayBuffer(dv.byteLength);
    new Uint8Array(out).set(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
    return out;
  }

  static exportASCII(object: THREE.Object3D): string {
    return _stlExporter.parse(object) as string;
  }

  static exportOBJ(object: THREE.Object3D): string {
    return _objExporter.parse(object);
  }

  }

/**
 * Export as 3MF (3D Manufacturing Format) — XML-based zip archive
 * This produces a minimal valid 3MF file compatible with most slicers
 */
export class ThreeMFExporter {
  static async export(object: THREE.Object3D, name = 'Dzign3D_Model'): Promise<Blob> {
    const { vertices, triangles } = this.collectMeshData(object);

    const enc = new TextEncoder();
    const zipped = zipSync({
      '[Content_Types].xml': enc.encode(this.buildContentTypes()),
      '_rels/.rels':         enc.encode(this.buildRels()),
      '3D/3dmodel.model':    enc.encode(this.buildModelXml(vertices, triangles, name)),
    });

    // Copy zipped Uint8Array into a fresh ArrayBuffer to satisfy strict ArrayBuffer BlobPart typing
    const copy = new Uint8Array(zipped.byteLength);
    copy.set(zipped);
    return new Blob([copy.buffer], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
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

  }
