export interface VoronoiModule {
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;

  // Smoke test — returns 1.0 once the module instantiates.
  _answer(): number;

  // Build a Voronoi diagram from a packed segment buffer.
  //   segPtr   — byte offset into HEAPF64 of length segCount*4
  //              (x0, y0, x1, y1 per segment, mm units)
  //   segCount — number of segments
  // Returns 0 on success, -1 on degenerate input, -2 on internal failure.
  _buildVoronoi(segPtr: number, segCount: number): number;

  // Fill a 4-int buffer at outPtr (HEAP32 offset) with
  //   [vertexCount, edgeCount, vertexSourceRefTotal, edgePointTotal]
  _getCounts(outPtr: number): void;

  // Emit-side accessors. Each returns elements written or -1 on capacity
  // mismatch. Call _getCounts first to size the buffers.
  _emitVertices(outPtr: number, capacityDoubles: number): number;
  _emitVertexSourceCsr(rowStarts: number, rowCapacity: number,
                       data: number, dataCapacity: number): number;
  _emitEdges(outPtr: number, capacityInts: number): number;
  _emitEdgePointsCsr(rowStarts: number, rowCapacity: number,
                     data: number, dataCapacity: number): number;

  // Free internal state before building the next diagram.
  _resetVoronoi(): void;
}

export default function createVoronoiModule(
  options?: { locateFile?(path: string): string }
): Promise<VoronoiModule>;
