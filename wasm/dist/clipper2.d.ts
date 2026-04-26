export interface Clipper2Module {
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;

  _clipperAnswer(): number;
  _offsetPaths(pointsPtr: number, pathCountsPtr: number, pathCount: number,
               delta: number, joinType: number, miterLimit: number,
               arcTolerance: number, precision: number): number;
  _getOffsetCounts(outPtr: number): void;
  _emitOffsetPathCounts(outPtr: number, capacityInts: number): number;
  _emitOffsetPoints(outPtr: number, capacityDoubles: number): number;
  _resetOffsetPaths(): void;

  _booleanPaths(subjPointsPtr: number, subjCountsPtr: number, subjCount: number,
                clipPointsPtr: number, clipCountsPtr: number, clipCount: number,
                op: number, fillRule: number, precision: number): number;
}

export default function createClipper2Module(
  options?: { locateFile?(path: string): string }
): Promise<Clipper2Module>;
