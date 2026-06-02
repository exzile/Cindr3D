const SAFE_DATA_IMAGE_PREFIX = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i;
const SAFE_BASE64 = /^[A-Za-z0-9+/]+=*$/;

export function safeImageUrl(input: string): string {
  const value = input.trim();
  if (!value) return '';

  // Explicit denylist: block javascript:/vbscript: before any other check.
  // Strip control characters and whitespace that browsers normalize before parsing.
  const normalized = Array.from(value.toLowerCase())
    .filter((char) => char.charCodeAt(0) > 0x20)
    .join('');
  if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')) return '';

  // data: URIs: validate MIME prefix and base64 payload, then reconstruct.
  const prefixMatch = value.match(SAFE_DATA_IMAGE_PREFIX);
  if (prefixMatch) {
    const base64 = value.slice(prefixMatch[0].length);
    if (!SAFE_BASE64.test(base64)) return '';
    return prefixMatch[0] + base64;
  }

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
