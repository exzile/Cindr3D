/**
 * Shared utilities for OCC edge ID parsing.
 * Centralises storedEdgeIds and parseOccEdgeSelection so that any change to
 * the OCC edge ID format (e.g. "occ:<bodyId>:<edgeId>") is applied in one place.
 */

/**
 * Normalise a stored edgeIds value to a string[].
 * Accepts: string[] (already parsed), US-unit-separator (0x1f) encoded string,
 * or comma-separated string (legacy format).
 */
export function storedEdgeIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === 'string');
  }
  if (typeof value !== 'string') return [];
  if (value.includes('')) return value.split('').filter(Boolean);
  return value.split(',').filter(Boolean);
}

export type OccEdgeSelection = {
  bodyId: string;
  edgeIds: number[];
  sourceFeatureId?: string;
};

/**
 * Parse a list of "occ:<bodyId>:<edgeId>" strings into a single-body selection.
 * Returns null if any ID is malformed or if IDs span multiple bodies.
 */
export function parseOccEdgeSelection(edgeIds: string[]): OccEdgeSelection | null {
  if (edgeIds.length === 0) return null;
  const parsed = edgeIds.map((id) => {
    const parts = id.split(':');
    if (parts[0] !== 'occ' || !parts[1]) return null;
    const edgeId = Number(parts[2]);
    if (!Number.isInteger(edgeId)) return null;
    const sourceFeatureId = parts[3] === 'feature' && parts[4] ? parts[4] : undefined;
    return { bodyId: parts[1], edgeId, sourceFeatureId };
  });
  if (parsed.some((item) => item === null)) return null;
  const bodyId = parsed[0]!.bodyId;
  if (!parsed.every((item) => item!.bodyId === bodyId)) return null;
  const sourceFeatureId = parsed[0]!.sourceFeatureId;
  if (!parsed.every((item) => item!.sourceFeatureId === sourceFeatureId)) return null;
  return { bodyId, edgeIds: parsed.map((item) => item!.edgeId), sourceFeatureId };
}
