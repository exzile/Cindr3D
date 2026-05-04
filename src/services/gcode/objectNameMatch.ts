/**
 * Match plate-object names to slicer-emitted object labels.
 *
 * Slicers add suffixes that don't exist on the original Cindr3D plate
 * object — PrusaSlicer/SuperSlicer append "_id_<n>_copy_<n>", "_<id>",
 * or "_instance_<n>", and Cura sometimes adds ".stl" extensions or
 * 4+ digit instance counters. Substring matching alone produces false
 * positives ("Cube" hitting "Cube_holder") and false negatives ("Tower"
 * missing "Tower_id_0_copy_1").
 *
 * normalizeObjectName() strips the well-known suffixes; matchObjectNames()
 * compares two normalized names with exact / substring fallbacks.
 */

const SUFFIX_PATTERNS: RegExp[] = [
  /_id_\d+(?:_copy_\d+)?$/i,        // PrusaSlicer: "_id_0", "_id_2_copy_1"
  /_(?:copy|instance)_?\d*$/i,      // generic: "_copy_3", "_instance"
  /_\d{4,}$/,                       // 4+ digit IDs (timestamps, instance counts)
  /\.\w{2,4}$/,                     // file extensions: ".stl", ".obj", ".3mf"
];

export function normalizeObjectName(name: string): string {
  let result = name.trim().toLowerCase();
  // Apply suffix-strippers iteratively so chained suffixes like
  // "Cube.stl_id_0_copy_1" collapse to "cube".
  for (let i = 0; i < 3; i++) {
    let changed = false;
    for (const pattern of SUFFIX_PATTERNS) {
      const next = result.replace(pattern, '');
      if (next !== result) { result = next; changed = true; }
    }
    if (!changed) break;
  }
  return result;
}

/**
 * Match two object names from different sources (plate object vs. slicer label).
 * Returns true when they refer to the same logical object after normalization.
 */
export function matchObjectNames(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizeObjectName(a);
  const nb = normalizeObjectName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Substring fallback only when one is clearly a prefix/suffix of the other —
  // refuse to match if both names are short and differ (e.g. "a" vs "ab").
  const minLen = Math.min(na.length, nb.length);
  if (minLen < 3) return false;
  return na.includes(nb) || nb.includes(na);
}

/**
 * Convenience: find the best-matching item in a list by name.
 * Prefers exact normalized matches over substring matches.
 */
export function findMatchingObject<T>(
  plateName: string | undefined,
  candidates: readonly T[],
  getName: (item: T) => string,
): T | null {
  if (!plateName) return null;
  const np = normalizeObjectName(plateName);
  if (!np) return null;

  let exact: T | null = null;
  let fuzzy: T | null = null;
  for (const item of candidates) {
    const nc = normalizeObjectName(getName(item));
    if (!nc) continue;
    if (nc === np) { exact = item; break; }
    if (!fuzzy && (np.includes(nc) || nc.includes(np)) && Math.min(np.length, nc.length) >= 3) {
      fuzzy = item;
    }
  }
  return exact ?? fuzzy;
}
