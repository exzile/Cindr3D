import * as THREE from 'three';
import { unzipSync } from 'fflate';
import type { PlateObject } from '../../types/slicer';

type PlateGeometrySnapshot = {
  positions: number[];
  index: number[] | null;
};

type PlateSnapshotObject = Omit<PlateObject, 'geometry'> & {
  geometry?: PlateGeometrySnapshot | null;
};

export interface PlateSnapshot {
  version: number;
  activePrinterProfileId: string;
  activeMaterialProfileId: string;
  activePrintProfileId: string;
  plate: PlateSnapshotObject[];
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(output: number[], value: number): void {
  output.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(output: number[], value: number): void {
  output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function appendBytes(output: number[], bytes: Uint8Array): void {
  for (const byte of bytes) output.push(byte);
}

function createStoredZip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const output: number[] = [];
  const central: number[] = [];

  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const localOffset = output.length;

    writeUint32(output, 0x04034b50);
    writeUint16(output, 20);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint32(output, crc);
    writeUint32(output, data.length);
    writeUint32(output, data.length);
    writeUint16(output, nameBytes.length);
    writeUint16(output, 0);
    appendBytes(output, nameBytes);
    appendBytes(output, data);

    writeUint32(central, 0x02014b50);
    writeUint16(central, 20);
    writeUint16(central, 20);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, crc);
    writeUint32(central, data.length);
    writeUint32(central, data.length);
    writeUint16(central, nameBytes.length);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, 0);
    writeUint32(central, localOffset);
    appendBytes(central, nameBytes);
  }

  const centralOffset = output.length;
  appendBytes(output, new Uint8Array(central));
  writeUint32(output, 0x06054b50);
  writeUint16(output, 0);
  writeUint16(output, 0);
  writeUint16(output, Object.keys(files).length);
  writeUint16(output, Object.keys(files).length);
  writeUint32(output, central.length);
  writeUint32(output, centralOffset);
  writeUint16(output, 0);
  return new Uint8Array(output);
}

function geometrySnapshot(geometry: unknown): PlateGeometrySnapshot | null {
  if (!(geometry instanceof THREE.BufferGeometry)) return null;
  const position = geometry.getAttribute('position');
  if (!position) return null;
  const index = geometry.getIndex();
  return {
    positions: Array.from(position.array as Float32Array),
    index: index ? Array.from(index.array as Uint16Array | Uint32Array) : null,
  };
}

export function createPlateSnapshot(args: {
  activePrinterProfileId: string;
  activeMaterialProfileId: string;
  activePrintProfileId: string;
  plateObjects: PlateObject[];
}): PlateSnapshot {
  return {
    version: 1,
    activePrinterProfileId: args.activePrinterProfileId,
    activeMaterialProfileId: args.activeMaterialProfileId,
    activePrintProfileId: args.activePrintProfileId,
    plate: args.plateObjects.map((object) => ({
      ...object,
      geometry: geometrySnapshot(object.geometry),
    })),
  };
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="json" ContentType="application/json" />
</Types>`;
}

function relsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;
}

function buildItemTransform(object: PlateSnapshotObject): string {
  const position = object.position ?? { x: 0, y: 0, z: 0 };
  const rotation = object.rotation ?? { x: 0, y: 0, z: 0 };
  const scale = object.scale ?? { x: 1, y: 1, z: 1 };
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(position.x, position.y, position.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(rotation.x),
      THREE.MathUtils.degToRad(rotation.y),
      THREE.MathUtils.degToRad(rotation.z),
    )),
    new THREE.Vector3(
      (object.mirrorX ? -1 : 1) * scale.x,
      (object.mirrorY ? -1 : 1) * scale.y,
      (object.mirrorZ ? -1 : 1) * scale.z,
    ),
  );
  const e = matrix.elements;
  return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]]
    .map((value) => Number.isInteger(value) ? value.toString() : Number(value.toFixed(6)).toString())
    .join(' ');
}

function buildModelXml(snapshot: PlateSnapshot): string {
  const objects = snapshot.plate.map((object, index) => ({ object, id: index + 1 }));
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">Cindr3D</metadata>
  <metadata name="Cindr3DPlateManifest">/Metadata/cindr3d-plate.json</metadata>
  <resources>
`;

  for (const { object, id } of objects) {
    const geometry = object.geometry;
    xml += `    <object id="${id}" type="model" name="${xmlEscape(object.name ?? `Object ${id}`)}">
      <mesh>
        <vertices>
`;
    for (let index = 0; geometry && index < geometry.positions.length; index += 3) {
      xml += `          <vertex x="${geometry.positions[index] ?? 0}" y="${geometry.positions[index + 1] ?? 0}" z="${geometry.positions[index + 2] ?? 0}" />
`;
    }
    xml += `        </vertices>
        <triangles>
`;
    if (geometry?.index) {
      for (let index = 0; index < geometry.index.length; index += 3) {
        xml += `          <triangle v1="${geometry.index[index] ?? 0}" v2="${geometry.index[index + 1] ?? 0}" v3="${geometry.index[index + 2] ?? 0}" />
`;
      }
    } else if (geometry) {
      for (let index = 0; index < geometry.positions.length / 3; index += 3) {
        xml += `          <triangle v1="${index}" v2="${index + 1}" v3="${index + 2}" />
`;
      }
    }
    xml += `        </triangles>
      </mesh>
    </object>
`;
  }

  xml += `  </resources>
  <build>
`;
  for (const { object, id } of objects) {
    xml += `    <item objectid="${id}" transform="${buildItemTransform(object)}" />
`;
  }
  xml += `  </build>
</model>`;
  return xml;
}

export function exportPlateThreeMf(snapshot: PlateSnapshot): Blob {
  const zipped = createStoredZip({
    '[Content_Types].xml': contentTypesXml(),
    '_rels/.rels': relsXml(),
    '3D/3dmodel.model': buildModelXml(snapshot),
    'Metadata/cindr3d-plate.json': JSON.stringify(snapshot),
  });
  const copy = new Uint8Array(zipped.byteLength);
  copy.set(zipped);
  const buffer = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
  return new Blob([buffer], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
}

export function readPlateSnapshotFromThreeMf(bytes: Uint8Array): PlateSnapshot | null {
  try {
    const entries = unzipSync(bytes);
    const manifestEntry = Object.entries(entries).find(([name]) => name.replace(/^\/+/, '').toLowerCase() === 'metadata/cindr3d-plate.json');
    const manifest = manifestEntry?.[1];
    if (!manifest) return null;
    const parsed = JSON.parse(new TextDecoder().decode(manifest)) as PlateSnapshot;
    return Array.isArray(parsed.plate) ? parsed : null;
  } catch {
    return null;
  }
}
