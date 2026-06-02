const SAFE_DATA_IMAGE_PREFIX = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i;
const SAFE_BASE64 = /^[A-Za-z0-9+/]+=*$/;

export function safeImageUrl(input: string): string {
  const value = input.trim();
  if (!value) return '';

  // Strip control characters and whitespace that browsers normalize before parsing.
  const normalized = Array.from(value.toLowerCase())
    .filter((char) => char.charCodeAt(0) > 0x20)
    .join('');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized)?.[1];

  // data: URIs: validate MIME prefix and base64 payload, then reconstruct.
  if (scheme === 'data') {
    const prefixMatch = value.match(SAFE_DATA_IMAGE_PREFIX);
    if (!prefixMatch) return '';
    const base64 = value.slice(prefixMatch[0].length);
    if (!SAFE_BASE64.test(base64)) return '';
    return prefixMatch[0] + base64;
  }

  if (scheme && scheme !== 'http' && scheme !== 'https' && scheme !== 'blob') return '';

  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'blob:') {
      return url.href;
    }
  } catch {
    return '';
  }

  return '';
}

export function isSafeRasterImageFile(file: File): boolean {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'].includes(file.type);
}
