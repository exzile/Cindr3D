import * as THREE from 'three';

export function splitByConnectedComponents(
  geometry: THREE.BufferGeometry,
  tolerance = 1e-4,
): THREE.BufferGeometry[] {
  const positions = geometry.attributes.position as THREE.BufferAttribute | undefined;
  if (!positions || positions.count === 0) return [geometry];

  const indices = geometry.index;
  const triCount = indices ? indices.count / 3 : positions.count / 3;
  if (triCount === 0) return [geometry];

  const normals = geometry.attributes.normal as THREE.BufferAttribute | undefined;
  const uvs = geometry.attributes.uv as THREE.BufferAttribute | undefined;
  const inverseTolerance = 1 / tolerance;
  const canonicalOf: number[] = new Array(positions.count);
  const keyToCanonical = new Map<string, number>();

  const keyFor = (vertexIndex: number): string => {
    const x = Math.round(positions.getX(vertexIndex) * inverseTolerance);
    const y = Math.round(positions.getY(vertexIndex) * inverseTolerance);
    const z = Math.round(positions.getZ(vertexIndex) * inverseTolerance);
    return `${x}|${y}|${z}`;
  };

  for (let i = 0; i < positions.count; i++) {
    const key = keyFor(i);
    let canonical = keyToCanonical.get(key);
    if (canonical === undefined) {
      canonical = keyToCanonical.size;
      keyToCanonical.set(key, canonical);
    }
    canonicalOf[i] = canonical;
  }

  const parent = new Int32Array(keyToCanonical.size);
  for (let i = 0; i < parent.length; i++) parent[i] = i;

  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== root) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };

  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootA] = rootB;
  };

  const getTri = (triangleIndex: number): [number, number, number] => {
    if (indices) {
      return [
        indices.getX(triangleIndex * 3),
        indices.getX(triangleIndex * 3 + 1),
        indices.getX(triangleIndex * 3 + 2),
      ];
    }
    return [triangleIndex * 3, triangleIndex * 3 + 1, triangleIndex * 3 + 2];
  };

  for (let triangleIndex = 0; triangleIndex < triCount; triangleIndex++) {
    const [a, b, c] = getTri(triangleIndex);
    union(canonicalOf[a], canonicalOf[b]);
    union(canonicalOf[b], canonicalOf[c]);
  }

  const trianglesByComponent = new Map<number, number[]>();
  for (let triangleIndex = 0; triangleIndex < triCount; triangleIndex++) {
    const [a] = getTri(triangleIndex);
    const root = find(canonicalOf[a]);
    if (!trianglesByComponent.has(root)) trianglesByComponent.set(root, []);
    trianglesByComponent.get(root)!.push(triangleIndex);
  }
  if (trianglesByComponent.size <= 1) return [geometry];

  const result = Array.from(trianglesByComponent.values(), (triangles) => {
    const vertCount = triangles.length * 3;
    const componentPositions: number[] = new Array(vertCount * 3);
    const componentNormals: number[] = normals ? new Array(vertCount * 3) : [];
    const componentUvs: number[] = uvs ? new Array(vertCount * 2) : [];
    let posOff = 0, normOff = 0, uvOff = 0;

    for (const triangleIndex of triangles) {
      for (const vertexIndex of getTri(triangleIndex)) {
        componentPositions[posOff++] = positions.getX(vertexIndex);
        componentPositions[posOff++] = positions.getY(vertexIndex);
        componentPositions[posOff++] = positions.getZ(vertexIndex);
        if (normals) {
          componentNormals[normOff++] = normals.getX(vertexIndex);
          componentNormals[normOff++] = normals.getY(vertexIndex);
          componentNormals[normOff++] = normals.getZ(vertexIndex);
        }
        if (uvs) {
          componentUvs[uvOff++] = uvs.getX(vertexIndex);
          componentUvs[uvOff++] = uvs.getY(vertexIndex);
        }
      }
    }

    const component = new THREE.BufferGeometry();
    component.setAttribute('position', new THREE.Float32BufferAttribute(componentPositions, 3));
    if (normals) component.setAttribute('normal', new THREE.Float32BufferAttribute(componentNormals, 3));
    if (uvs) component.setAttribute('uv', new THREE.Float32BufferAttribute(componentUvs, 2));
    if (!normals) component.computeVertexNormals();
    return component;
  });

  const bounds = new THREE.Box3();
  const center = new THREE.Vector3();
  const centroids = result.map((component) => {
    bounds.setFromBufferAttribute(component.attributes.position as THREE.BufferAttribute);
    bounds.getCenter(center);
    return { x: center.x, y: center.y, z: center.z };
  });

  return result
    .map((_, index) => index)
    .sort((a, b) => {
      const centroidA = centroids[a];
      const centroidB = centroids[b];
      if (Math.abs(centroidA.x - centroidB.x) > 1e-4) return centroidA.x - centroidB.x;
      if (Math.abs(centroidA.y - centroidB.y) > 1e-4) return centroidA.y - centroidB.y;
      return centroidA.z - centroidB.z;
    })
    .map((index) => result[index]);
}

export function bakeMeshWorldGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  mesh.updateMatrixWorld(true);
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  // After applyMatrix4 the position attribute is in world space. Any
  // `_manifoldData` cache (from Manifold-native builders) holds vertex
  // coordinates in the original local frame, so transform those coordinates
  // too before downstream mesh CSG consumers read them.
  //
  // We deep-copy vertProperties because clone() gives a shallow userData copy
  // that would share the array with the live mesh; mutating in place corrupts
  // the rendered mesh. Then apply the world matrix to every position.
  // triVerts are indices, unchanged by a rigid transform.
  //
  // Without this, mesh CSG can hit a false NotManifold path and produce
  // invalid topology from otherwise valid Manifold-native builders.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const md = (geometry.userData as any)?._manifoldData;
  if (md?.vertProperties) {
    const vp = new Float32Array(md.vertProperties as Float32Array);
    const mat = mesh.matrixWorld;
    const v = new THREE.Vector3();
    for (let i = 0; i + 2 < vp.length; i += 3) {
      v.set(vp[i], vp[i + 1], vp[i + 2]).applyMatrix4(mat);
      vp[i] = v.x; vp[i + 1] = v.y; vp[i + 2] = v.z;
    }
    // Break the shallow reference THREE.js BufferGeometry.copy() leaves:
    // clone() does `this.userData = source.userData` (same object), so writing
    // below would also mutate the live mesh's _manifoldData with world-space
    // positions, causing a double-transform on any subsequent fillet/chamfer.
    geometry.userData = { ...geometry.userData };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (geometry.userData as any)._manifoldData = {
      vertProperties: vp,
      triVerts: md.triVerts,
    };
  }
  return geometry;
}

export function extractMeshGeometry(mesh: THREE.Mesh | THREE.Group): THREE.BufferGeometry | null {
  if (mesh instanceof THREE.Mesh) return mesh.geometry.clone();

  let found: THREE.BufferGeometry | null = null;
  mesh.traverse((child) => {
    if (!found && child instanceof THREE.Mesh) found = child.geometry.clone();
  });
  return found;
}
