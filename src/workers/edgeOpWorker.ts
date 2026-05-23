/**
 * edgeOpWorker — runs fillet/chamfer CSG off the main thread so the canvas
 * stays fully responsive during live preview drag.
 *
 * Protocol (all messages are plain objects; transferables listed after data):
 *
 *   Main → Worker
 *     { type:'compute', requestId:number, srcGeoPositions:ArrayBuffer,
 *       edges:{ax,ay,az,bx,by,bz}[], toolType:'fillet'|'chamfer',
 *       value:number, segments:number, fast:boolean }
 *     transfer: [srcGeoPositions]
 *
 *   Worker → Main
 *     { type:'result', requestId:number, positions:ArrayBuffer|null }
 *     transfer: [positions]  (or no transfer when null)
 *
 * srcGeoPositions is a flat Float32Array of xyz triples (non-indexed geometry).
 * positions in the result is the same layout; main thread reconstructs a
 * BufferGeometry from it and calls computeVertexNormals().
 *
 * Manifold WASM is initialised once on first message receipt, then reused for
 * all subsequent CSG operations in this worker (same singleton pattern as main
 * thread). Falls back to three-bvh-csg if Manifold init fails.
 */

import * as THREE from 'three';
import { initManifold } from '../engine/geometryEngine/core/solid/manifoldWasm';
import { computeFilletGeometry } from '../utils/geometry/filletGeometry';
import { computeChamferGeometry } from '../utils/geometry/chamferGeometry';
import type { PickedEdge } from '../utils/geometry/edgeCutCore';

// Init Manifold WASM once per worker process (runs in background while idle).
// If this rejects we still work — csg.ts falls back to three-bvh-csg.
const _manifoldReady: Promise<void> = initManifold()
  .then(() => undefined)
  .catch(() => {
    console.warn('[edgeOpWorker] manifold× → bvh-fbk');
  });

interface EdgeData {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
}

interface ComputeMsg {
  type: 'compute';
  requestId: number;
  srcGeoPositions: ArrayBuffer;
  edges: EdgeData[];
  toolType: 'fillet' | 'chamfer';
  value: number;
  segments: number;
  fast: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).onmessage = async (e: MessageEvent<ComputeMsg>) => {
  const msg = e.data;
  if (msg.type !== 'compute') return;

  // Ensure Manifold is ready before the first CSG call so we don't race
  // (subsequent calls return immediately from the resolved promise).
  await _manifoldReady;

  const { requestId, srcGeoPositions, edges, toolType, value, segments, fast } = msg;

  // Reconstruct source geometry from transferred positions buffer.
  const srcGeo = new THREE.BufferGeometry();
  const posArr = new Float32Array(srcGeoPositions);
  srcGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  // Normals needed for per-face shading after CSG; compute from positions.
  srcGeo.computeVertexNormals();

  // Deserialise edges.
  const pickedEdges: PickedEdge[] = edges.map((ed) => ({
    a: new THREE.Vector3(ed.ax, ed.ay, ed.az),
    b: new THREE.Vector3(ed.bx, ed.by, ed.bz),
  }));

  let result: THREE.BufferGeometry | null = null;
  try {
    result =
      toolType === 'fillet'
        ? computeFilletGeometry(srcGeo, pickedEdges, value, segments, fast)
        : computeChamferGeometry(srcGeo, pickedEdges, value, undefined, fast);
  } catch {
    // CSG errors are expected for degenerate geometry; result stays null.
  }

  srcGeo.dispose();

  if (!result || result.attributes.position.count === 0) {
    result?.dispose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).postMessage({ type: 'result', requestId, positions: null });
    return;
  }

  // Copy positions and normals before disposing so the buffers are ours to transfer.
  // Normals are the creased normals from toCreasedNormals inside computeEdgeCutGeometry;
  // transferring them preserves smooth shading on the fillet surface.
  const posCopy = (result.attributes.position.array as Float32Array).slice();
  const normAttr = result.attributes.normal;
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
