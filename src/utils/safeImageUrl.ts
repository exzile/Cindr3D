const SAFE_DATA_IMAGE_PREFIX = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i;

export function safeImageUrl(input: string): string {
  const value = input.trim();
  if (!value) return '';
  if (SAFE_DATA_IMAGE_PREFIX.test(value)) return value;

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
