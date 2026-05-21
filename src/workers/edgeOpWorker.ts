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
 */

import * as THREE from 'three';
import { computeFilletGeometry } from '../utils/geometry/filletGeometry';
import { computeChamferGeometry } from '../utils/geometry/chamferGeometry';
import type { PickedEdge } from '../utils/geometry/edgeCutCore';

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
(self as any).onmessage = (e: MessageEvent<ComputeMsg>) => {
  const msg = e.data;
  if (msg.type !== 'compute') return;

  const { requestId, srcGeoPositions, edges, toolType, value, segments, fast } = msg;

  // Reconstruct source geometry from transferred positions buffer.
  const srcGeo = new THREE.BufferGeometry();
  const posArr = new Float32Array(srcGeoPositions);
  srcGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  // three-bvh-csg's Evaluator requires a normal attribute on any geometry it
  // operates on. The main-thread path gets normals for free from the live mesh
  // clone; here we compute them from positions before passing into CSG.
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
