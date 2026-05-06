export interface VoronoiModule {
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

export default function createVoronoiModule(
  options?: { locateFile?(path: string): string }
): Promise<VoronoiModule>;
