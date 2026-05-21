/**
 * csgWorkerPool — pool of csgWorkers for off-thread body-boolean operations.
 *
 * Maintains POOL_SIZE workers dispatched round-robin. Each `csgAsync` call
 * serialises both input geometries (already world-space), transfers them to a
 * worker, and returns a Promise<BufferGeometry | null>.
 *
 * null is returned on any failure (degenerate geometry, WASM crash, worker
 * error). Callers should fall back to a standalone body in that case.
 */

import * as THREE from 'three';
import { freshWorkerUrl } from './freshWorkerUrl';

const POOL_SIZE = 2;

export type CsgOp = 'union' | 'subtract' | 'intersect';

interface PendingEntry {
  resolve: (result: THREE.BufferGeometry | null) => void;
  workerId: number;
}

let _workers: Worker[] | null = null;
let _nextWorker = 0;
let _requestId = 0;
const _pending = new Map<number, PendingEntry>();

function buildWorker(id: number): Worker {
  const w = new Worker(
    freshWorkerUrl(new URL('./csgWorker.ts', import.meta.url)),
    { type: 'module' },
  );
  w.onmessage = (e: MessageEvent) => {
    const { requestId, positions, normals } = e.data as {
      requestId: number;
      positions: ArrayBuffer | null;
      normals: ArrayBuffer | null;
    };
    const entry = _pending.get(requestId);
    if (!entry) return;
    _pending.delete(requestId);
    if (!positions) { entry.resolve(null); return; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    if (normals) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    entry.resolve(geo);
  };
  w.onerror = () => {
    for (const [reqId, entry] of _pending) {
      if (entry.workerId === id) { _pending.delete(reqId); entry.resolve(null); }
    }
  };
  return w;
}

function getPool(): Worker[] {
  if (_workers) return _workers;
  _workers = Array.from({ length: POOL_SIZE }, (_, i) => buildWorker(i));
  return _workers;
}

function serializeGeometry(geo: THREE.BufferGeometry): { pos: ArrayBuffer; idx: ArrayBuffer | null } {
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const posArr = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    posArr[i * 3]     = posAttr.getX(i);
    posArr[i * 3 + 1] = posAttr.getY(i);
    posArr[i * 3 + 2] = posAttr.getZ(i);
  }
  const idxAttr = geo.index;
  if (!idxAttr) return { pos: posArr.buffer, idx: null };
  const idxArr = new Uint32Array(idxAttr.count);
  for (let i = 0; i < idxAttr.count; i++) idxArr[i] = idxAttr.getX(i);
  return { pos: posArr.buffer, idx: idxArr.buffer };
}

/**
 * Run a CSG boolean off the main thread.
 * Both geometries must already be in world-space (use bakeMeshWorldGeometry).
 * Returns a non-indexed BufferGeometry with positions + normals, or null on failure.
 */
export async function csgAsync(
  geoA: THREE.BufferGeometry,
  geoB: THREE.BufferGeometry,
  operation: CsgOp,
): Promise<THREE.BufferGeometry | null> {
  const pool = getPool();
  const workerIdx = _nextWorker % POOL_SIZE;
  _nextWorker++;
  const reqId = ++_requestId;

  const { pos: posA, idx: idxA } = serializeGeometry(geoA);
  const { pos: posB, idx: idxB } = serializeGeometry(geoB);
  const transferList: ArrayBuffer[] = [posA, posB];
  if (idxA) transferList.push(idxA);
  if (idxB) transferList.push(idxB);

  return new Promise<THREE.BufferGeometry | null>((resolve) => {
    _pending.set(reqId, { resolve, workerId: workerIdx });
    pool[workerIdx].postMessage(
      { type: 'compute', requestId: reqId, operation, posA, idxA: idxA ?? null, posB, idxB: idxB ?? null },
      transferList,
    );
  });
}

// Terminate workers on HMR so the next operation spawns fresh ones with
// the latest engine code (same pattern as SlicerWorker / edgeOpWorker).
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    _workers?.forEach((w) => w.terminate());
    _workers = null;
    _nextWorker = 0;
  });
  import.meta.hot.on('vite:beforeFullReload', () => {
    _workers?.forEach((w) => w.terminate());
    _workers = null;
  });
}
