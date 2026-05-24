// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OcctRaw = any;

export interface OcctInstance {
  readonly oc: OcctRaw;
  readonly heap32: Int32Array;
  readonly heapF64: Float64Array;
  malloc(bytes: number): number;
  free(ptr: number): void;
  finalize(): Promise<void>;
}
