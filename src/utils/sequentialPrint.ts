export interface SequentialPrintBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface SequentialPrintObject {
  id: string;
  label: string;
  bounds: SequentialPrintBounds;
}

export interface SequentialPrintClearance {
  gantryHeight?: number;
  printheadMinX?: number;
  printheadMaxX?: number;
  printheadMinY?: number;
  printheadMaxY?: number;
}

export interface SequentialPrintWarning {
  objectId: string;
  label: string;
  message: string;
}

export interface SequentialPrintPlan {
  orderedIds: string[];
  warnings: SequentialPrintWarning[];
}

function center(bounds: SequentialPrintBounds): { x: number; y: number } {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function distanceSquared(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function overlaps(a: SequentialPrintBounds, b: SequentialPrintBounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function expandForPrinthead(
  bounds: SequentialPrintBounds,
  clearance: SequentialPrintClearance,
): SequentialPrintBounds {
  return {
    minX: bounds.minX + Math.min(0, clearance.printheadMinX ?? 0),
    maxX: bounds.maxX + Math.max(0, clearance.printheadMaxX ?? 0),
    minY: bounds.minY + Math.min(0, clearance.printheadMinY ?? 0),
    maxY: bounds.maxY + Math.max(0, clearance.printheadMaxY ?? 0),
    minZ: bounds.minZ,
    maxZ: bounds.maxZ,
  };
}

function orderNearestNeighbor(objects: SequentialPrintObject[]): SequentialPrintObject[] {
  const remaining = [...objects].sort((a, b) => {
    const ac = center(a.bounds);
    const bc = center(b.bounds);
    return ac.y - bc.y || ac.x - bc.x;
  });
  const ordered: SequentialPrintObject[] = [];
  let current = { x: 0, y: 0 };

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const candidateCenter = center(remaining[i].bounds);
      const distance = distanceSquared(current, candidateCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    current = center(next.bounds);
  }

  return ordered;
}

export function buildSequentialPrintPlan(
  objects: SequentialPrintObject[],
  clearance: SequentialPrintClearance,
): SequentialPrintPlan {
  if (objects.length <= 1) {
    return { orderedIds: objects.map((object) => object.id), warnings: [] };
  }

  const ordered = orderNearestNeighbor(objects);
  const warnings: SequentialPrintWarning[] = [];
  const gantryHeight = clearance.gantryHeight;
  if (typeof gantryHeight !== 'number' || gantryHeight <= 0) {
    warnings.push({
      objectId: ordered[0].id,
      label: ordered[0].label,
      message: 'Sequential printing is enabled without a configured gantry height.',
    });
  }

  const finished: SequentialPrintObject[] = [];
  for (const object of ordered) {
    const height = object.bounds.maxZ - object.bounds.minZ;
    if (typeof gantryHeight === 'number' && gantryHeight > 0 && height > gantryHeight) {
      warnings.push({
        objectId: object.id,
        label: object.label,
        message: `${object.label} is ${height.toFixed(1)}mm tall, above the ${gantryHeight.toFixed(1)}mm gantry clearance.`,
      });
    }

    const sweptBounds = expandForPrinthead(object.bounds, clearance);
    for (const previous of finished) {
      const previousHeight = previous.bounds.maxZ - previous.bounds.minZ;
      if (
        overlaps(sweptBounds, previous.bounds)
        && (typeof gantryHeight !== 'number' || gantryHeight <= 0 || previousHeight > gantryHeight)
      ) {
        warnings.push({
          objectId: object.id,
          label: object.label,
          message: `${object.label} printhead clearance overlaps finished object ${previous.label}.`,
        });
      }
    }
    finished.push(object);
  }

  return {
    orderedIds: ordered.map((object) => object.id),
    warnings,
  };
}

export function formatSequentialPrintWarnings(warnings: SequentialPrintWarning[]): string {
  if (warnings.length === 0) return '';
  return [
    '; SEQUENTIAL_PRINT_WARNINGS_START',
    ...warnings.map((warning) => `; WARNING: ${warning.message}`),
    '; SEQUENTIAL_PRINT_WARNINGS_END',
  ].join('\n');
}
