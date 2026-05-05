import type { PlateObject } from '../types/slicer';

const PRINT_URL_CACHE = 'cindr3d-print-url-cache-v1';
const SUPPORTED_EXTENSIONS = ['.stl', '.obj', '.3mf', '.amf', '.step', '.stp'];

export type PrintUrlSourceSite = NonNullable<PlateObject['sourceMetadata']>['sourceSite'];

export interface PrintUrlImportResult {
  file: File;
  sourceMetadata: NonNullable<PlateObject['sourceMetadata']>;
  fromCache: boolean;
}

function detectSourceSite(url: URL): PrintUrlSourceSite {
  const host = url.hostname.toLowerCase();
  if (host.includes('printables.com')) return 'printables';
  if (host.includes('makerworld.com')) return 'makerworld';
  if (host.includes('thingiverse.com')) return 'thingiverse';
  return SUPPORTED_EXTENSIONS.some((extension) => url.pathname.toLowerCase().endsWith(extension))
    ? 'direct'
    : 'unknown';
}

export function isSupportedModelUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return SUPPORTED_EXTENSIONS.some((extension) => url.pathname.toLowerCase().endsWith(extension));
  } catch {
    return false;
  }
}

export function filenameFromModelUrl(input: string, contentDisposition?: string | null): string {
  const dispositionName = contentDisposition?.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i)?.[1];
  if (dispositionName) return decodeURIComponent(dispositionName);

  const url = new URL(input);
  const pathName = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? 'model.stl');
  return SUPPORTED_EXTENSIONS.some((extension) => pathName.toLowerCase().endsWith(extension))
    ? pathName
    : 'model.stl';
}

async function matchCached(request: Request): Promise<Response | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return (await caches.open(PRINT_URL_CACHE).then((cache) => cache.match(request))) ?? null;
  } catch {
    return null;
  }
}

async function putCached(request: Request, response: Response): Promise<void> {
  if (typeof caches === 'undefined') return;
  const cacheControl = response.headers.get('cache-control')?.toLowerCase() ?? '';
  if (cacheControl.includes('no-store') || cacheControl.includes('private')) return;
  try {
    const cache = await caches.open(PRINT_URL_CACHE);
    await cache.put(request, response);
  } catch {
    // Browser cache is an optimization; failed writes should not block import.
  }
}

export async function fetchModelUrlToFile(input: string): Promise<PrintUrlImportResult> {
  const url = new URL(input.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Use an http or https model URL.');
  }
  const sourceSite = detectSourceSite(url);
  if (!isSupportedModelUrl(url.href)) {
    const siteLabel = sourceSite === 'unknown' ? 'that page' : sourceSite;
    throw new Error(`Paste a direct STL/OBJ/3MF/AMF/STEP file URL. Browser import cannot read ${siteLabel} model pages yet.`);
  }

  const request = new Request(url.href, { method: 'GET', mode: 'cors' });
  let response = await matchCached(request);
  let fromCache = true;
  if (!response) {
    fromCache = false;
    response = await fetch(request);
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    await putCached(request, response.clone());
  }

  const filename = filenameFromModelUrl(url.href, response.headers.get('content-disposition'));
  const blob = await response.blob();
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  return {
    file,
    fromCache,
    sourceMetadata: {
      url: url.href,
      sourceSite,
      fetchedAt: Date.now(),
    },
  };
}
