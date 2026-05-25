import type { BRepTopologyHandle } from './brepBody';

export interface BRepIdAllocator {
  peek(): number;
  next(): number;
  reserve(id: number): void;
}

export interface AssignedTopologyMap {
  ids: Map<number, BRepTopologyHandle>;
  byPtr: Map<number, number>;
}

export function createBRepIdAllocator(start = 1): BRepIdAllocator {
  if (!Number.isInteger(start) || start < 0) {
    throw new RangeError('start must be a non-negative integer');
  }

  let nextId = start;
  const reserved = new Set<number>();

  const takeNext = (): number => {
    while (reserved.has(nextId)) nextId += 1;
    const id = nextId;
    reserved.add(id);
    nextId += 1;
    return id;
  };

  return {
    peek() {
      while (reserved.has(nextId)) nextId += 1;
      return nextId;
    },
    next: takeNext,
    reserve(id: number) {
      if (!Number.isInteger(id) || id < 0) {
        throw new RangeError('reserved id must be a non-negative integer');
      }
      reserved.add(id);
    },
  };
}

export function assignTopologyIds(
  handles: Iterable<BRepTopologyHandle>,
  allocator: BRepIdAllocator = createBRepIdAllocator(),
): AssignedTopologyMap {
  const ids = new Map<number, BRepTopologyHandle>();
  const byPtr = new Map<number, number>();

  for (const handle of handles) {
    const id = allocator.next();
    ids.set(id, handle);
    if (!byPtr.has(handle.ptr)) byPtr.set(handle.ptr, id);
  }

  return { ids, byPtr };
}

export function maxTopologyId(...maps: ReadonlyArray<Map<number, unknown>>): number {
  let max = 0;
  for (const map of maps) {
    for (const id of map.keys()) {
      if (id > max) max = id;
    }
  }
  return max;
}
