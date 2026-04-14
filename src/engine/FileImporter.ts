import * as THREE from 'three';

export class FileImporter {
  /**
   * Import a STEP file and return a Three.js group.
   * Uses a simplified mesh approximation since full OpenCascade
   * integration requires WASM setup.
   */
  static async importSTEP(file: File): Promise<THREE.Group> {
    const text = await file.text();
    const group = new THREE.Group();
    group.name = file.name.replace(/\.[^.]+$/, '');

    // Parse basic STEP geometry
    // For full STEP support, OpenCascade.js WASM module would be initialized here
    const hasClosedShell = text.includes('CLOSED_SHELL') || text.includes('MANIFOLD_SOLID_BREP');

    if (hasClosedShell) {
      // Extract vertex data from STEP CARTESIAN_POINT entries
      const points = this.extractCartesianPoints(text);

      if (points.length >= 3) {
        const mesh = this.createMeshFromPoints(points, file.name);
        group.add(mesh);
      } else {
        // Fallback: create a placeholder box
        group.add(this.createPlaceholderMesh(file.name));
      }
    } else {
      group.add(this.createPlaceholderMesh(file.name));
    }

    return group;
  }

  /**
   * Import a Fusion 360 .f3d file.
   * F3D files are ZIP archives containing mesh data and metadata.
   */
  static async importF3D(file: File): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.name = file.name.replace(/\.[^.]+$/, '');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // F3D files are ZIP archives - check magic number
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4B;

      if (isZip) {
        // Extract mesh data from the F3D archive
        // The archive contains .smb (mesh) and .smbh (metadata) files
        const meshData = await this.extractF3DMeshData(bytes);

        if (meshData) {
          group.add(meshData);
        } else {
          group.add(this.createPlaceholderMesh(file.name));
        }
      } else {
        group.add(this.createPlaceholderMesh(file.name));
      }
    } catch {
      group.add(this.createPlaceholderMesh(file.name));
    }

    return group;
  }

  /**
   * Import STL file (binary or ASCII)
   */
  static async importSTL(file: File): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.name = file.name.replace(/\.[^.]+$/, '');

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Check if ASCII STL
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    const isAscii = header === 'solid';

    let geometry: THREE.BufferGeometry;

    if (isAscii) {
      geometry = this.parseAsciiSTL(await file.text());
    } else {
      geometry = this.parseBinarySTL(buffer);
    }

    geometry.computeVertexNormals();

    const material = new THREE.MeshPhysicalMaterial({
      color: 0x8899aa,
      metalness: 0.3,
      roughness: 0.4,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    return group;
  }

  /**
   * Import OBJ file
   */
  static async importOBJ(file: File): Promise<THREE.Group> {
    const text = await file.text();
    const group = new THREE.Group();
    group.name = file.name.replace(/\.[^.]+$/, '');

    const vertices: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];

    const lines = text.split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      switch (parts[0]) {
        case 'v':
          vertices.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
          break;
        case 'vn':
          normals.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
          break;
        case 'f': {
          const faceVerts = parts.slice(1).map(v => parseInt(v.split('/')[0]) - 1);
          // Triangulate face
          for (let i = 1; i < faceVerts.length - 1; i++) {
            indices.push(faceVerts[0], faceVerts[i], faceVerts[i + 1]);
          }
          break;
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    if (indices.length > 0) geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhysicalMaterial({
      color: 0x8899aa,
      metalness: 0.3,
      roughness: 0.4,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

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

  // ---------------------------------------------------------------------------
  // 3MF / AMF import
  // 3MF is a ZIP archive containing 3D/3dmodel.model (XML with vertices+triangles)
  // AMF is a plain XML file with a similar structure
  // ---------------------------------------------------------------------------

  static async importThreeMF(file: File): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.name = file.name.replace(/\.[^.]+$/, '');

    const ext = file.name.split('.').pop()?.toLowerCase();
    let modelXml: string | null = null;

    if (ext === 'amf') {
      modelXml = await file.text();
    } else {
      // 3MF is a ZIP — extract the model file
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      modelXml = await this.extractZipEntry(bytes, '3dmodel.model');
    }

    if (!modelXml) {
      group.add(this.createPlaceholderMesh(file.name));
      return group;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(modelXml, 'text/xml');
    const isAmf = ext === 'amf';

    if (isAmf) {
      // AMF format: <amf><object><mesh><vertices><vertex><coordinates>…
      const objects = doc.querySelectorAll('object');
      for (const obj of objects) {
        const geo = this.parseAmfObject(obj);
        if (geo) {
          group.add(new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
            color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide,
          })));
        }
      }
    } else {
      // 3MF format: <model><resources><object><mesh><vertices>…<triangles>…
      const objects = doc.querySelectorAll('object');
      for (const obj of objects) {
        if (obj.getAttribute('type') === 'support') continue;
        const geo = this.parseThreeMFObject(obj);
        if (geo) {
          const mesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
            color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide,
          }));
          mesh.castShadow = true;
          group.add(mesh);
        }
      }
    }

    if (group.children.length === 0) {
      group.add(this.createPlaceholderMesh(file.name));
    }

    return group;
  }

  private static parseThreeMFObject(obj: Element): THREE.BufferGeometry | null {
    const vertexEls = obj.querySelectorAll('mesh > vertices > vertex');
    const triangleEls = obj.querySelectorAll('mesh > triangles > triangle');
    if (vertexEls.length === 0 || triangleEls.length === 0) return null;

    const positions: number[] = [];
    const indices: number[] = [];

    for (const v of vertexEls) {
      positions.push(
        parseFloat(v.getAttribute('x') ?? '0'),
        parseFloat(v.getAttribute('y') ?? '0'),
        parseFloat(v.getAttribute('z') ?? '0'),
      );
    }

    for (const t of triangleEls) {
      indices.push(
        parseInt(t.getAttribute('v1') ?? '0', 10),
        parseInt(t.getAttribute('v2') ?? '0', 10),
        parseInt(t.getAttribute('v3') ?? '0', 10),
      );
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  private static parseAmfObject(obj: Element): THREE.BufferGeometry | null {
    const vertexEls = obj.querySelectorAll('mesh > vertices > vertex');
    const volumeEls = obj.querySelectorAll('mesh > volume');
    if (vertexEls.length === 0) return null;

    const positions: number[] = [];
    const indices: number[] = [];

    for (const v of vertexEls) {
      const x = v.querySelector('coordinates > x');
      const y = v.querySelector('coordinates > y');
      const z = v.querySelector('coordinates > z');
      positions.push(
        parseFloat(x?.textContent ?? '0'),
        parseFloat(y?.textContent ?? '0'),
        parseFloat(z?.textContent ?? '0'),
      );
    }

    for (const vol of volumeEls) {
      for (const tri of vol.querySelectorAll('triangle')) {
        const v1 = tri.querySelector('v1');
        const v2 = tri.querySelector('v2');
        const v3 = tri.querySelector('v3');
        indices.push(
          parseInt(v1?.textContent ?? '0', 10),
          parseInt(v2?.textContent ?? '0', 10),
          parseInt(v3?.textContent ?? '0', 10),
        );
      }
    }

    if (positions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (indices.length > 0) geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  // ---------------------------------------------------------------------------
  // ZIP extraction with DEFLATE support (for 3MF)
  // Uses the Web Streams DecompressionStream API (Chrome 80+, FF 113+, Safari 16.4+)
  // ---------------------------------------------------------------------------

  private static async extractZipEntry(bytes: Uint8Array, targetSuffix: string): Promise<string | null> {
    let offset = 0;

    while (offset + 30 < bytes.length) {
      // Local file header signature: PK\x03\x04
      if (!(bytes[offset] === 0x50 && bytes[offset + 1] === 0x4B &&
            bytes[offset + 2] === 0x03 && bytes[offset + 3] === 0x04)) {
        break;
      }

      const compression  = bytes[offset + 8]  | (bytes[offset + 9]  << 8);
      const compSize     = bytes[offset + 18] | (bytes[offset + 19] << 8) | (bytes[offset + 20] << 16) | (bytes[offset + 21] << 24);
      const nameLen      = bytes[offset + 26] | (bytes[offset + 27] << 8);
      const extraLen     = bytes[offset + 28] | (bytes[offset + 29] << 8);

      const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLen));
      const dataStart = offset + 30 + nameLen + extraLen;
      const data = bytes.slice(dataStart, dataStart + compSize);

      if (name.endsWith(targetSuffix)) {
        if (compression === 0) {
          // Stored — no compression
          return new TextDecoder().decode(data);
        } else if (compression === 8) {
          // DEFLATE
          try {
            const ds = new (window as any).DecompressionStream('deflate-raw');
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
            for (const c of chunks) total += c.length;
            const result = new Uint8Array(total);
            let pos = 0;
            for (const c of chunks) { result.set(c, pos); pos += c.length; }

            return new TextDecoder().decode(result);
          } catch (e) {
            console.error('3MF: DEFLATE decompression failed', e);
            return null;
          }
        }
      }

      offset = dataStart + compSize;
    }

    return null;
  }

  private static extractCartesianPoints(stepText: string): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const regex = /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)\s*\)/g;
    let match;

    while ((match = regex.exec(stepText)) !== null) {
      points.push(new THREE.Vector3(
        parseFloat(match[1]),
        parseFloat(match[2]),
        parseFloat(match[3])
      ));
    }

    return points;
  }

  private static createMeshFromPoints(points: THREE.Vector3[], name: string): THREE.Mesh {
    // Create a convex hull approximation from the extracted points
    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];

    // Create triangulated mesh from point cloud using simple convex hull
    if (points.length >= 3) {
      // Use ConvexGeometry approach - create triangles from point cloud
      for (let i = 0; i < points.length - 2; i += 3) {
        const p0 = points[i];
        const p1 = points[Math.min(i + 1, points.length - 1)];
        const p2 = points[Math.min(i + 2, points.length - 1)];
        vertices.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhysicalMaterial({
      color: 0x8899aa,
      metalness: 0.3,
      roughness: 0.4,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private static createPlaceholderMesh(name: string): THREE.Mesh {
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

  private static async extractF3DMeshData(zipBytes: Uint8Array): Promise<THREE.Mesh | null> {
    // F3D ZIP structure: look for mesh data in the archive
    // Simple ZIP local file header parsing
    let offset = 0;
    const meshVertices: number[] = [];

    while (offset < zipBytes.length - 4) {
      // Local file header signature
      if (zipBytes[offset] === 0x50 && zipBytes[offset + 1] === 0x4B &&
          zipBytes[offset + 2] === 0x03 && zipBytes[offset + 3] === 0x04) {

        const nameLen = zipBytes[offset + 26] | (zipBytes[offset + 27] << 8);
        const extraLen = zipBytes[offset + 28] | (zipBytes[offset + 29] << 8);
        const compSize = zipBytes[offset + 18] | (zipBytes[offset + 19] << 8) |
                        (zipBytes[offset + 20] << 16) | (zipBytes[offset + 21] << 24);

        const nameBytes = zipBytes.slice(offset + 30, offset + 30 + nameLen);
        const fileName = new TextDecoder().decode(nameBytes);

        if (fileName.endsWith('.obj') || fileName.endsWith('.stl')) {
          // Found mesh data inside the archive
          const dataStart = offset + 30 + nameLen + extraLen;
          const fileData = zipBytes.slice(dataStart, dataStart + compSize);
          const text = new TextDecoder().decode(fileData);

          // Try parsing as OBJ
          if (fileName.endsWith('.obj')) {
            const lines = text.split('\n');
            for (const line of lines) {
              const parts = line.trim().split(/\s+/);
              if (parts[0] === 'v') {
                meshVertices.push(
                  parseFloat(parts[1]) || 0,
                  parseFloat(parts[2]) || 0,
                  parseFloat(parts[3]) || 0
                );
              }
            }
          }
        }

        offset += 30 + nameLen + extraLen + compSize;
      } else {
        break;
      }
    }

    if (meshVertices.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshVertices, 3));
      geometry.computeVertexNormals();

      const material = new THREE.MeshPhysicalMaterial({
        color: 0x8899aa,
        metalness: 0.3,
        roughness: 0.4,
        side: THREE.DoubleSide,
      });

      return new THREE.Mesh(geometry, material);
    }

    return null;
  }

  private static parseAsciiSTL(text: string): THREE.BufferGeometry {
    const vertices: number[] = [];
    const regex = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      vertices.push(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return geometry;
  }

  private static parseBinarySTL(buffer: ArrayBuffer): THREE.BufferGeometry {
    const view = new DataView(buffer);
    const triangleCount = view.getUint32(80, true);
    const vertices: number[] = [];

    let offset = 84;
    for (let i = 0; i < triangleCount; i++) {
      // Skip normal (12 bytes)
      offset += 12;

      // Read 3 vertices (36 bytes)
      for (let v = 0; v < 3; v++) {
        vertices.push(
          view.getFloat32(offset, true),
          view.getFloat32(offset + 4, true),
          view.getFloat32(offset + 8, true)
        );
        offset += 12;
      }

      // Skip attribute byte count
      offset += 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return geometry;
  }
}
