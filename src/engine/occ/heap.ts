import type { OcctInstance } from './types';

export interface OccAllocation {
  ptr: number;
  bytes: number;
  free(): void;
}

export function alignByteCount(bytes: number, alignment = 8): number {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError('bytes must be a non-negative finite number');
  }
  if (!Number.isInteger(alignment) || alignment <= 0) {
    throw new RangeError('alignment must be a positive integer');
  }
  return Math.ceil(bytes / alignment) * alignment;
}

export function mallocAligned(occ: Pick<OcctInstance, 'malloc' | 'free'>, bytes: number, alignment = 8): OccAllocation {
  const alignedBytes = alignByteCount(bytes, alignment);
  const ptr = occ.malloc(alignedBytes);
  let freed = false;

  return {
    ptr,
    bytes: alignedBytes,
    free() {
      if (freed) return;
      freed = true;
      occ.free(ptr);
    },
  };
}
