/**
 * Parse M486 object-label markers out of a G-code stream.
 *
 * Supports the labels emitted by PrusaSlicer / SuperSlicer / OrcaSlicer and
 * by the Cura "Label Objects" post-processing script:
 *
 *   M486 T<n>                          ; declares total object count (optional)
 *   M486 S<id> A"<name>"               ; start of object (Prusa-style)
 *   M486 S<id>                         ; start of object (id only)
 *   M486 S-1                           ; non-object lines between/around
 *   ; printing object <name>           ; Cura comment block, often paired with M486 S<id>
 *
 * The parser is intentionally tolerant: it will extract ids from any of the
 * forms above, attach a name when one is available (from `A"..."` or the
 * preceding `; printing object` comment), and ignore unrelated content.
 */

export interface M486Label {
  id: number;
  name: string;
}

const M486_LINE = /^\s*M486\b([^;]*)/i;
const S_PARAM = /\bS(-?\d+)/i;
const A_PARAM = /\bA"([^"]+)"/i;
const T_PARAM = /\bT(\d+)/i;
const PRINTING_OBJECT_COMMENT = /;\s*printing object\s+(.+?)\s*$/i;

/**
 * Extract the unique M486 object labels from a G-code string.
 * Returns the labels in ascending id order with deduplicated entries.
 * `declaredCount` is the value from `M486 T<n>` if present.
 */
export function parseM486Labels(gcode: string): {
  labels: M486Label[];
  declaredCount: number | null;
} {
  if (!gcode) return { labels: [], declaredCount: null };

  const seen = new Map<number, string>();
  let declaredCount: number | null = null;
  let pendingName: string | null = null;

  // Reading line-by-line on a (possibly large) gcode string is the cheapest
  // safe option — splitting on \n avoids regex backtracking on the whole blob.
  const lines = gcode.split('\n');
  for (const raw of lines) {
    const printingMatch = PRINTING_OBJECT_COMMENT.exec(raw);
    if (printingMatch) {
      pendingName = printingMatch[1].trim();
      continue;
    }

    const m486 = M486_LINE.exec(raw);
    if (!m486) continue;
    const args = m486[1];

    const tMatch = T_PARAM.exec(args);
    if (tMatch && declaredCount === null) declaredCount = Number(tMatch[1]);

    const sMatch = S_PARAM.exec(args);
    if (!sMatch) continue;
    const id = Number(sMatch[1]);
    if (id < 0) {
      // M486 S-1 marks non-object lines; clear any pending name so it doesn't
      // accidentally attach to the next real object.
      pendingName = null;
      continue;
    }

    const aMatch = A_PARAM.exec(args);
    const name = aMatch ? aMatch[1].trim() : pendingName ?? '';
    pendingName = null;

    // Keep the first non-empty name we see for any given id; later occurrences
    // (e.g. inside the body of a multi-pass object) shouldn't overwrite it.
    if (!seen.has(id) || (!seen.get(id) && name)) {
      seen.set(id, name);
    }
  }

  const labels: M486Label[] = Array.from(seen.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id - b.id);

  return { labels, declaredCount };
}
