export type StructuredPayload = {
  kind: 'json' | 'xml';
  formatted: string;
  value?: unknown;
};

function formatXml(xml: string): string {
  const normalized = xml.replace(/>\s*</g, '><').replace(/(>)(<)(\/*)/g, '$1\n$2$3');
  let indent = 0;
  return normalized
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      if (/^<\//.test(trimmed)) indent = Math.max(0, indent - 1);
      const formatted = `${'  '.repeat(indent)}${trimmed}`;
      if (/^<[^!?/][^>]*[^/]?>$/.test(trimmed) && !trimmed.includes(`</`)) indent++;
      return formatted;
    })
    .join('\n');
}

function findJsonPayload(content: string): StructuredPayload | null {
  let index = 0;
  while (index < content.length) {
    const brace = content.indexOf('{', index);
    const bracket = content.indexOf('[', index);
    const next = brace === -1 ? bracket : bracket === -1 ? brace : Math.min(brace, bracket);
    if (next === -1) break;

    try {
      const value = JSON.parse(content.slice(next));
      return { kind: 'json', formatted: JSON.stringify(value, null, 2), value };
    } catch {
      index = next + 1;
    }
  }

  return null;
}

function findXmlPayload(content: string): StructuredPayload | null {
  const start = content.indexOf('<');
  if (start === -1) return null;
  const candidate = content.slice(start).trim();
  if (!candidate.endsWith('>')) return null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(candidate, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    return { kind: 'xml', formatted: formatXml(candidate) };
  } catch {
    return null;
  }
}

export function getStructuredPayload(content: string): StructuredPayload | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  return findJsonPayload(trimmed) ?? findXmlPayload(trimmed);
}
