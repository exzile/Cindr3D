// ARACHNE-9.1D — TS adapter over the boost::polygon::voronoi WASM module.
//
// Public surface mirrors voronoi.ts exactly so callers can swap
// implementations via the ArachneBackend interface added in 9.2B. All
// inputs/outputs use the same THREE.Vector2 / VoronoiGraph types as the
// pure-JS path; the only thing that changes is who runs the sweep-line.
//
// The WASM module is single-instance (one diagram in flight at a time).
// We serialise calls behind a Promise queue so concurrent layer-slicer
// workers can share one module instance without trampling each other's
// emit caches.

import * as THREE from 'three';

import { signedArea } from '../../geometry/contourUtils';
import type { VoronoiEdge, VoronoiGraph, VoronoiSourceEdge, VoronoiVertex } from './voronoi';

// The dist module is an ES6 default export: `createVoronoiModule(opts) =>
// Promise<VoronoiModule>`. Built by wasm/build.sh, checked into
// wasm/dist/. Vite resolves the .wasm via its asset pipeline (configured
// in vite.config.ts under 9.1B).
//
// We import lazily so the WASM payload doesn't land in the worker's
// initial chunk. The first call to `buildEdgeVoronoiWasm` triggers the
// fetch + instantiate; subsequent calls reuse the cached instance.

const EPS = 1e-7;

interface VoronoiModule {
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _answer(): number;
  _buildVoronoi(segPtr: number, segCount: number): number;
  _getCounts(outPtr: number): void;
  _emitVertices(outPtr: number, capacityDoubles: number): number;
  _emitVertexSourceCsr(rowStarts: number, rowCapacity: number,
                       data: number, dataCapacity: number): number;
  _emitEdges(outPtr: number, capacityInts: number): number;
  _emitEdgePointsCsr(rowStarts: number, rowCapacity: number,
                     data: number, dataCapacity: number): number;
  _resetVoronoi(): void;
}

let modulePromise: Promise<VoronoiModule> | null = null;

async function loadModule(): Promise<VoronoiModule> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    // The dist file path is relative to this TS source. Vite rewrites
    // the import to a content-hashed asset URL at build time and serves
    // the .wasm sidecar via the asset config in 9.1B's vite.config.ts.
    //
    // We use a relative dynamic import so the module loader resolves
    // through Vite, not Node's resolution algorithm (which the slicer
    // worker context doesn't have).
    const factory = (await import('../../../../../wasm/dist/voronoi.js')).default;

    // In node / jsdom contexts (vitest), the loader's default fetch path
    // resolves wasm/dist/voronoi.wasm against jsdom's http://localhost
    // base URL, which then ENOENTs through fs. Detect node and bypass
    // by reading the .wasm into memory and passing it as wasmBinary.
    const factoryOpts: { wasmBinary?: ArrayBuffer; locateFile?(p: string): string } = {};
    const maybeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
    if (maybeProcess?.versions?.node) {
      const nodePrefix = 'node';
      const fs = await import(`${nodePrefix}:fs/promises`);
      const url = await import(`${nodePrefix}:url`);
      const path = await import(`${nodePrefix}:path`);
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const wasmPath = path.resolve(here, '../../../../../wasm/dist/voronoi.wasm');
      const buf = await fs.readFile(wasmPath);
      factoryOpts.wasmBinary = buf.buffer.slice(
        buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    }

    const mod: VoronoiModule = await factory(factoryOpts);
    // Smoke test — surface a clear error if the module loaded but the
    // exports table is somehow broken (e.g. wrong EXPORTED_FUNCTIONS).
    if (typeof mod._answer !== 'function' || mod._answer() !== 1) {
      throw new Error('voronoiWasm: module loaded but _answer() check failed');
    }
    return mod;
  })();
  return modulePromise;
}

let inFlight: Promise<unknown> | null = null;

/** Drop-in replacement for `buildEdgeVoronoi` from voronoi.ts.
 *  The C++ side keeps one diagram in static state, so we serialise
 *  every call behind the previous one's settle (success or failure). */
export async function buildEdgeVoronoiWasm(
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][] = [],
): Promise<VoronoiGraph> {
  const prev = inFlight;
  const next = (async () => {
    if (prev) { try { await prev; } catch { /* prior caller owns its error */ } }
    return runOnce(outerContour, holeContours);
  })();
  inFlight = next;
  try {
    return await next;
  } finally {
    if (inFlight === next) inFlight = null;
  }
}

async function runOnce(
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][],
): Promise<VoronoiGraph> {
  const mod = await loadModule();
  const sourceEdges = buildSourceEdges(outerContour, holeContours);
  if (sourceEdges.length === 0) {
    return { sourceEdges: [], vertices: [], edges: [] };
  }

  // Marshal segments → HEAPF64 [x0, y0, x1, y1] per segment.
  const segCount = sourceEdges.length;
  const segBytes = segCount * 4 * 8;
  const segPtr = mod._malloc(segBytes);
  if (!segPtr) throw new Error('voronoiWasm: malloc failed for segment buffer');

  try {
    const segView = new Float64Array(mod.HEAPF64.buffer, segPtr, segCount * 4);
    for (let i = 0; i < segCount; i++) {
      const s = sourceEdges[i];
      segView[i * 4    ] = s.a.x;
      segView[i * 4 + 1] = s.a.y;
      segView[i * 4 + 2] = s.b.x;
      segView[i * 4 + 3] = s.b.y;
    }

    const status = mod._buildVoronoi(segPtr, segCount);
    if (status !== 0) {
      throw new Error(`voronoiWasm: _buildVoronoi returned ${status}`);
    }

    // Counts: [vertexCount, edgeCount, vertexSourceRefTotal, edgePointTotal]
    const countsPtr = mod._malloc(4 * 4);
    if (!countsPtr) throw new Error('voronoiWasm: malloc failed for counts buffer');
    let vertexCount = 0, edgeCount = 0, sourceRefTotal = 0, edgePointTotal = 0;
    try {
      mod._getCounts(countsPtr);
      const counts = new Int32Array(mod.HEAP32.buffer, countsPtr, 4);
      vertexCount    = counts[0];
      edgeCount      = counts[1];
      sourceRefTotal = counts[2];
      edgePointTotal = counts[3];
    } finally {
      mod._free(countsPtr);
    }

    // Allocate emit buffers in a single combined block to limit
    // malloc/free chatter. Layout (bytes):
    //   verts        : vertexCount * 3 * 8
    //   vertCsrRows  : (vertexCount + 1) * 4
    //   vertCsrData  : sourceRefTotal * 4
    //   edges        : edgeCount * 4 * 4
    //   edgeCsrRows  : (edgeCount + 1) * 4
    //   edgeCsrData  : edgePointTotal * 8
    const vertsBytes       = vertexCount * 3 * 8;
    const vertCsrRowsBytes = (vertexCount + 1) * 4;
    const vertCsrDataBytes = sourceRefTotal * 4;
    const edgesBytes       = edgeCount * 4 * 4;
    const edgeCsrRowsBytes = (edgeCount + 1) * 4;
    // edgePointTotal is point count; each point = 2 doubles (x, y) = 16 bytes.
    const edgeCsrDataDoubles = edgePointTotal * 2;
    const edgeCsrDataBytes = edgeCsrDataDoubles * 8;

    // Float64Array requires its byteOffset to be a multiple of 8.
    // _malloc returns 16-aligned, but interior 4-byte sections may shift
    // a following double buffer off-alignment. Pad before each double
    // section. align8 rounds up.
    const align8 = (n: number) => (n + 7) & ~7;

    let off = 0;
    const vertsOff       = off;                                     off += vertsBytes;
    off = align8(off);  // vertCsrRows is int32 (4-align ok), but stay aligned
    const vertCsrRowsOff = off;                                     off += vertCsrRowsBytes;
    const vertCsrDataOff = off;                                     off += vertCsrDataBytes;
    off = align8(off);
    const edgesOff       = off;                                     off += edgesBytes;
    const edgeCsrRowsOff = off;                                     off += edgeCsrRowsBytes;
    off = align8(off);
    const edgeCsrDataOff = off;                                     off += edgeCsrDataBytes;
    const totalBytes = off;

    const block = mod._malloc(totalBytes || 8);
    if (!block) throw new Error('voronoiWasm: malloc failed for emit block');

    try {
      const vertsPtr       = block + vertsOff;
      const vertCsrRowsPtr = block + vertCsrRowsOff;
      const vertCsrDataPtr = block + vertCsrDataOff;
      const edgesPtr       = block + edgesOff;
      const edgeCsrRowsPtr = block + edgeCsrRowsOff;
      const edgeCsrDataPtr = block + edgeCsrDataOff;

      if (vertexCount > 0
          && mod._emitVertices(vertsPtr, vertexCount * 3) < 0) {
        throw new Error('voronoiWasm: _emitVertices capacity mismatch');
      }
      if (vertexCount > 0
          && mod._emitVertexSourceCsr(
              vertCsrRowsPtr, vertexCount + 1,
              vertCsrDataPtr, sourceRefTotal) < 0) {
        throw new Error('voronoiWasm: _emitVertexSourceCsr capacity mismatch');
      }
      if (edgeCount > 0
          && mod._emitEdges(edgesPtr, edgeCount * 4) < 0) {
        throw new Error('voronoiWasm: _emitEdges capacity mismatch');
      }
      if (edgeCount > 0
          && mod._emitEdgePointsCsr(
              edgeCsrRowsPtr, edgeCount + 1,
              edgeCsrDataPtr, edgeCsrDataDoubles) < 0) {
        throw new Error('voronoiWasm: _emitEdgePointsCsr capacity mismatch');
      }

      // Reconstruct VoronoiGraph from the flat buffers. We slice the
      // typed arrays into the heap (copy semantics) so the JS-side
      // result outlives the next _malloc/_free cycle.
      const vertsView = vertexCount > 0
        ? new Float64Array(mod.HEAPF64.buffer, vertsPtr, vertexCount * 3)
        : new Float64Array(0);
      const vertCsrRows = vertexCount > 0
        ? new Int32Array(mod.HEAP32.buffer, vertCsrRowsPtr, vertexCount + 1)
        : new Int32Array(0);
      const vertCsrData = sourceRefTotal > 0
        ? new Int32Array(mod.HEAP32.buffer, vertCsrDataPtr, sourceRefTotal)
        : new Int32Array(0);
      const edgesView = edgeCount > 0
        ? new Int32Array(mod.HEAP32.buffer, edgesPtr, edgeCount * 4)
        : new Int32Array(0);
      const edgeCsrRows = edgeCount > 0
        ? new Int32Array(mod.HEAP32.buffer, edgeCsrRowsPtr, edgeCount + 1)
        : new Int32Array(0);
      const edgeCsrData = edgePointTotal > 0
        ? new Float64Array(mod.HEAPF64.buffer, edgeCsrDataPtr, edgePointTotal)
        : new Float64Array(0);

      const vertices: VoronoiVertex[] = new Array(vertexCount);
      for (let i = 0; i < vertexCount; i++) {
        const x = vertsView[i * 3    ];
        const y = vertsView[i * 3 + 1];
        const r = vertsView[i * 3 + 2];
        const refStart = vertCsrRows[i];
        const refEnd   = vertCsrRows[i + 1];
        const sourceEdgeIds: number[] = new Array(refEnd - refStart);
        for (let k = refStart; k < refEnd; k++) {
          sourceEdgeIds[k - refStart] = vertCsrData[k];
        }
        vertices[i] = {
          id: i,
          point: new THREE.Vector2(x, y),
          radius: r,
          sourceEdgeIds,
        };
      }

      const edges: VoronoiEdge[] = new Array(edgeCount);
      for (let i = 0; i < edgeCount; i++) {
        const from = edgesView[i * 4    ];
        const to   = edgesView[i * 4 + 1];
        const srcA = edgesView[i * 4 + 2];
        const srcB = edgesView[i * 4 + 3];
        const ptStart = edgeCsrRows[i];
        const ptEnd   = edgeCsrRows[i + 1];
        const points: THREE.Vector2[] = new Array(ptEnd - ptStart);
        for (let k = ptStart; k < ptEnd; k++) {
          points[k - ptStart] = new THREE.Vector2(
            edgeCsrData[k * 2    ],
            edgeCsrData[k * 2 + 1],
          );
        }
        edges[i] = {
          id: i,
          from,
          to,
          sourceEdgeIds: [srcA, srcB],
          points,
        };
      }

      return { sourceEdges, vertices, edges };
    } finally {
      mod._free(block);
      mod._resetVoronoi();
    }
  } finally {
    mod._free(segPtr);
  }
}

// ----------------------------------------------------------------------
// Helpers (mirror voronoi.ts so the segment id space matches across the
// JS and WASM backends — required by 9.1E test parameterisation).
// ----------------------------------------------------------------------

function cleanContour(contour: THREE.Vector2[]): THREE.Vector2[] {
  if (contour.length <= 1) return contour.map((p) => p.clone());
  const cleaned: THREE.Vector2[] = [];
  for (const point of contour) {
    const prev = cleaned[cleaned.length - 1];
    if (!prev || prev.distanceToSquared(point) > EPS * EPS) cleaned.push(point.clone());
  }
  if (cleaned.length > 1
      && cleaned[0].distanceToSquared(cleaned[cleaned.length - 1]) <= EPS * EPS) {
    cleaned.pop();
  }
  return cleaned;
}

function normalizeOuter(c: THREE.Vector2[]) {
  const x = cleanContour(c);
  return signedArea(x) < 0 ? x.reverse() : x;
}

function normalizeHole(c: THREE.Vector2[]) {
  const x = cleanContour(c);
  return signedArea(x) > 0 ? x.reverse() : x;
}

function buildSourceEdges(
  outer: THREE.Vector2[],
  holes: THREE.Vector2[][],
): VoronoiSourceEdge[] {
  const contours = [normalizeOuter(outer), ...holes.map(normalizeHole)];
  const result: VoronoiSourceEdge[] = [];
  for (let ci = 0; ci < contours.length; ci++) {
    const contour = contours[ci];
    if (contour.length < 2) continue;
    for (let ei = 0; ei < contour.length; ei++) {
      const a = contour[ei];
      const b = contour[(ei + 1) % contour.length];
      if (a.distanceToSquared(b) <= EPS * EPS) continue;
      result.push({
        id: result.length,
        contourIndex: ci,
        edgeIndex: ei,
        isHole: ci > 0,
        a,
        b,
      });
    }
  }
  return result;
}
