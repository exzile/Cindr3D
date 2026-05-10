/* ── HTML escape ────────────────────────────────────────────────────────────── */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── GCode syntax highlighter ───────────────────────────────────────────────── */
//
// Works on RAW (un-escaped) text and emits HTML with inline colour spans.
// Uses a single left-to-right tokeniser so later passes never accidentally
// match inside already-emitted <span> tags.

type TokenKind =
  | 'gcode'        // G28, G1, G92.1 …
  | 'mcode'        // M569, M584 …
  | 'param-letter' // X, Y, P, S …
  | 'param-value'  // the number that follows a param letter
  | 'string'       // "filename" or quoted pin names
  | 'number'       // bare/colon-separated numbers
  | 'comment'      // ; to end of line
  | 'other';       // whitespace, colons, punctuation

const COLORS: Record<TokenKind, string> = {
  gcode:          '#4dd0e1',  // cyan
  mcode:          '#ffd54f',  // amber
  'param-letter': '#c792ea',  // purple
  'param-value':  '#ffab40',  // orange
  string:         '#a5d6a7',  // light green
  number:         '#81d4fa',  // light blue
  comment:        '#66bb6a',  // green
  other:          '',
};

function tok(kind: TokenKind, raw: string): string {
  const color = COLORS[kind];
  const safe  = escapeHtml(raw);
  return color ? `<span style="color:${color}">${safe}</span>` : safe;
}

function highlightLine(line: string): string {
  let out = '';
  let i   = 0;

  while (i < line.length) {
    const ch   = line[i];
    const next = line[i + 1] ?? '';

    /* ── Comment: ; to end of line ── */
    if (ch === ';') {
      out += tok('comment', line.slice(i));
      break;
    }

    /* ── G-code: G/g followed by digit ── */
    if ((ch === 'G' || ch === 'g') && /\d/.test(next)) {
      let j = i + 1;
      while (j < line.length && /[\d.]/.test(line[j])) j++;
      out += tok('gcode', line.slice(i, j));
      i = j;
      continue;
    }

    /* ── M-code: M/m followed by digit ── */
    if ((ch === 'M' || ch === 'm') && /\d/.test(next)) {
      let j = i + 1;
      while (j < line.length && /[\d.]/.test(line[j])) j++;
      out += tok('mcode', line.slice(i, j));
      i = j;
      continue;
    }

    /* ── Parameter letter + quoted string value ── */
    if (/[A-Za-z]/.test(ch) && next === '"') {
      out += tok('param-letter', ch);
      i++;
      // consume the quoted value
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j++;
      if (j < line.length) j++; // include closing quote
      out += tok('string', line.slice(i, j));
      i = j;
      continue;
    }

    /* ── Parameter letter + numeric value (possibly negative) ── */
    if (
      /[A-Za-z]/.test(ch) &&
      (/\d/.test(next) || (next === '-' && /\d/.test(line[i + 2] ?? '')))
    ) {
      out += tok('param-letter', ch);
      i++;
      let j = i;
      if (line[j] === '-') j++;
      while (j < line.length && /[\d.]/.test(line[j])) j++;
      out += tok('param-value', line.slice(i, j));
      i = j;
      continue;
    }

    /* ── Bare quoted string (not preceded by a letter) ── */
    if (ch === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j++;
      if (j < line.length) j++;
      out += tok('string', line.slice(i, j));
      i = j;
      continue;
    }

    /* ── Standalone number (incl. negative) ── */
    if (/\d/.test(ch) || (ch === '-' && /\d/.test(next))) {
      let j = i;
      if (line[j] === '-') j++;
      while (j < line.length && /[\d.]/.test(line[j])) j++;
      out += tok('number', line.slice(i, j));
      i = j;
      continue;
    }

    /* ── Everything else: whitespace, colons, slashes, bare letters ── */
    out += escapeHtml(ch);
    i++;
  }

  return out;
}

export function highlightGCode(rawContent: string): string {
  return rawContent.split('\n').map(highlightLine).join('\n');
}

/* ── File size formatter ────────────────────────────────────────────────────── */

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
