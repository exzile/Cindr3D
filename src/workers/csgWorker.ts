/**
 * csgWorker — runs body-boolean CSG (union/subtract/intersect) off the main thread.
 *
 * Protocol (all messages are plain objects; transferables listed after data):
 *
 *   Main → Worker
 *     { type:'compute', requestId:number, operation:'union'|'subtract'|'intersect',
 *       posA:ArrayBuffer, idxA:ArrayBuffer|null,
 *       posB:ArrayBuffer, idxB:ArrayBuffer|null }
 *     transfer: [posA, posB, idxA?, idxB?]
 *
 *   Worker → Main
 *     { type:'result', requestId:number, positions:ArrayBuffer|null, normals:ArrayBuffer|null }
 *     transfer: [positions, normals] when non-null
 *
 * Geometry is world-space (caller bakes the matrix before serialising).
 * Manifold WASM initialises once on first message.
 * Falls back to three-bvh-csg if Manifold init fails.
 */

import * as THREE from 'three';
import { initManifold } from '../engine/geometryEngine/core/solid/manifoldWasm';
import { csgSubtract, csgUnion, csgIntersect } from '../engine/geometryEngine/core/solid/csg';

const _manifoldReady: Promise<void> = initManifold()
  .then(() => undefined)
  .catch(() => {
    console.warn('[csgWorker] Manifold WASM init failed — using three-bvh-csg fallback');
  });

type CsgOp = 'union' | 'subtract' | 'intersect';

interface ComputeMsg {
  type: 'compute';
  requestId: number;
  operation: CsgOp;
  posA: ArrayBuffer;
  idxA: ArrayBuffer | null;
  posB: ArrayBuffer;
  idxB: ArrayBuffer | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).onmessage = async (e: MessageEvent<ComputeMsg>) => {
  const msg = e.data;
  if (msg.type !== 'compute') return;

  await _manifoldReady;

  const { requestId, operation, posA, idxA, posB, idxB } = msg;

  const geoA = new THREE.BufferGeometry();
  geoA.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posA), 3));
  if (idxA) geoA.setIndex(new THREE.BufferAttribute(new Uint32Array(idxA), 1));

  const geoB = new THREE.BufferGeometry();
  geoB.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posB), 3));
  if (idxB) geoB.setIndex(new THREE.BufferAttribute(new Uint32Array(idxB), 1));

  let result: THREE.BufferGeometry | null = null;
  try {
    if (operation === 'subtract') result = csgSubtract(geoA, geoB);
    else if (operation === 'union') result = csgUnion(geoA, geoB);
    else result = csgIntersect(geoA, geoB);
  } catch {
    // CSG errors on degenerate geometry — result stays null
  }

  geoA.dispose();
  geoB.dispose();

  const posCount = (result?.attributes.position as THREE.BufferAttribute | undefined)?.count ?? 0;
  if (!result || posCount === 0) {
    result?.dispose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).postMessage({ type: 'result', requestId, positions: null, normals: null });
    return;
  }

  const posCopy = ((result.attributes.position as THREE.BufferAttribute).array as Float32Array).slice();
  const normAttr = result.attributes.normal as THREE.BufferAttribute | undefined;
  const normCopy = normAttr ? (normAttr.array as Float32Array).slice() : null;
  result.dispose();

  const transferList: ArrayBuffer[] = [posCopy.buffer];
  if (normCopy) transferList.push(normCopy.buffer);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (self as any).postMessage(
    { type: 'result', requestId, positions: posCopy.buffer, normals: normCopy?.buffer ?? null },
    transferList,
  );
};
