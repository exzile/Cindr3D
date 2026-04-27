export interface ArachneModule {
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;

  _arachneAnswer(): number;
  _arachneConfigValueCount(): number;
  _generateArachnePaths(pointsPtr: number, pathCountsPtr: number, pathCount: number,
                        configValuesPtr: number, configValueCount: number): number;
  _getArachneCounts(outPtr: number): void;
  _emitArachnePathCounts(outPtr: number, capacityInts: number): number;
  _emitArachnePathMeta(outPtr: number, capacityInts: number): number;
  _emitArachnePoints(outPtr: number, capacityDoubles: number): number;
  _getArachneInnerContourCounts(outPtr: number): void;
  _emitArachneInnerContourPathCounts(outPtr: number, capacityInts: number): number;
  _emitArachneInnerContourPoints(outPtr: number, capacityDoubles: number): number;
  _resetArachnePaths(): void;
}

export default function createArachneModule(
  options?: { locateFile?(path: string): string }
): Promise<ArachneModule>;
