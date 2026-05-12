/**
 * Minimal QOI (Quite OK Image) decoder.
 *
 * Duet boards running RRF 3.4+ embed thumbnails in QOI format for better
 * compression.  Browsers don't support QOI natively, so we decode to a
 * canvas and export PNG.
 *
 * Spec: https://qoiformat.org/qoi-specification.pdf
 */

const QOI_MAGIC = 0x716F6966; // "qoif"

function qoiHash(r: number, g: number, b: number, a: number): number {
  return (r * 3 + g * 5 + b * 7 + a * 11) % 64;
}

/**
 * Decode raw QOI bytes to an HTMLCanvasElement, or return null on failure.
 */
function decodeQOIBytes(bytes: Uint8Array): HTMLCanvasElement | null {
  if (bytes.length < 22) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== QOI_MAGIC) return null;

  const width  = view.getUint32(4);
  const height = view.getUint32(8);
  if (width === 0 || height === 0 || width > 4096 || height > 4096) return null;

  const pixelCount = width * height;
  const pixels     = new Uint8ClampedArray(pixelCount * 4);

  // 64-entry RGBA color cache
  const cache = new Uint8Array(64 * 4); // default 0,0,0,0

  let pr = 0, pg = 0, pb = 0, pa = 255; // previous pixel
  let pos    = 14;                       // skip 14-byte header
  let pxIdx  = 0;
  const stop = bytes.length - 8;        // stop before 8-byte end marker

  const commit = (r: number, g: number, b: number, a: number) => {
    const base = pxIdx * 4;
    pixels[base]     = r;
    pixels[base + 1] = g;
    pixels[base + 2] = b;
    pixels[base + 3] = a;
    pxIdx++;
    pr = r; pg = g; pb = b; pa = a;
    const h = qoiHash(r, g, b, a) * 4;
    cache[h] = r; cache[h + 1] = g; cache[h + 2] = b; cache[h + 3] = a;
  };

  while (pos < stop && pxIdx < pixelCount) {
    const b0 = bytes[pos++];

    if (b0 === 0xFF) {
      // QOI_OP_RGBA
      commit(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
      pos += 4;
    } else if (b0 === 0xFE) {
      // QOI_OP_RGB
      commit(bytes[pos], bytes[pos + 1], bytes[pos + 2], pa);
      pos += 3;
    } else {
      const tag = b0 >> 6;
      if (tag === 0) {
        // QOI_OP_INDEX
        const h = (b0 & 0x3F) * 4;
        commit(cache[h], cache[h + 1], cache[h + 2], cache[h + 3]);
      } else if (tag === 1) {
        // QOI_OP_DIFF  — dr/dg/db each 2 bits, bias −2
        commit(
          (pr + ((b0 >> 4) & 0x3) - 2) & 0xFF,
          (pg + ((b0 >> 2) & 0x3) - 2) & 0xFF,
          (pb + ( b0       & 0x3) - 2) & 0xFF,
          pa,
        );
      } else if (tag === 2) {
        // QOI_OP_LUMA  — dg 6 bits bias −32; dr/db relative to dg, 4 bits bias −8
        const b1 = bytes[pos++];
        const dg = (b0 & 0x3F) - 32;
        commit(
          (pr + dg + ((b1 >> 4) & 0x0F) - 8) & 0xFF,
          (pg + dg)                            & 0xFF,
          (pb + dg + ( b1       & 0x0F) - 8) & 0xFF,
          pa,
        );
      } else {
        // QOI_OP_RUN  — run length stored as (run − 1), 6 bits; max 62
        const run = (b0 & 0x3F) + 1;
        const base = pxIdx * 4;
        for (let i = 0; i < run && pxIdx < pixelCount; i++) {
          const off = base + i * 4;
          pixels[off]     = pr;
          pixels[off + 1] = pg;
          pixels[off + 2] = pb;
          pixels[off + 3] = pa;
          pxIdx++;
        }
        // RUN does NOT update the color cache
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas;
}

/**
 * Normalise a thumbnail data-URL that may contain raw QOI bytes mislabelled
 * as image/png.  Returns a proper PNG data-URL, or the original string if it
 * isn't QOI (i.e. it really is PNG/JPEG and can be used directly).
 * Returns null if decoding fails.
 */
export function normalizeThumbDataUrl(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const b64 = dataUrl.slice(comma + 1);

  // Decode just the first 4 bytes to check for the QOI magic "qoif".
  // 4 bytes needs ceil(4/3)*4 = 8 base64 chars; we take a few extra to ensure
  // clean padding.
  let prefix: string;
  try {
    prefix = atob(b64.slice(0, 8));
  } catch {
    return null;
  }

  if (
    prefix.charCodeAt(0) !== 0x71 || // q
    prefix.charCodeAt(1) !== 0x6F || // o
    prefix.charCodeAt(2) !== 0x69 || // i
    prefix.charCodeAt(3) !== 0x66    // f
  ) {
    // Not QOI — PNG/JPEG/etc. can be used as-is.
    return dataUrl;
  }

  // Decode full QOI payload.
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const canvas = decodeQOIBytes(bytes);
  return canvas ? canvas.toDataURL('image/png') : null;
}
