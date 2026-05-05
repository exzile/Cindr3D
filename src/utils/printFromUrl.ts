import type { PlateObject } from '../types/slicer';

const PRINT_URL_CACHE = 'cindr3d-print-url-cache-v1';
const SUPPORTED_EXTENSIONS = ['.stl', '.obj', '.3mf', '.amf', '.step', '.stp'];
const MARKETPLACE_SITES: PrintUrlSourceSite[] = ['printables', 'makerworld', 'thingiverse'];

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

function isMarketplacePageUrl(url: URL): boolean {
  return MARKETPLACE_SITES.includes(detectSourceSite(url));
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

function textFromMeta(document: Document, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.getAttribute('content')?.trim();
    if (value) return value;
  }
  return undefined;
}

function extractJsonLdText(document: Document, keys: string[]): string | undefined {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    try {
      const raw = script.textContent?.trim();
      if (!raw) continue;
      const entries = [JSON.parse(raw)].flat();
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        for (const key of keys) {
          const value = (entry as Record<string, unknown>)[key];
          if (typeof value === 'string' && value.trim()) return value.trim();
          if (value && typeof value === 'object') {
            const nestedName = (value as Record<string, unknown>).name;
            if (typeof nestedName === 'string' && nestedName.trim()) return nestedName.trim();
          }
        }
      }
    } catch {
      // Ignore malformed structured data; marketplace pages frequently carry multiple app blobs.
    }
  }
  return undefined;
}

function extractPageMetadata(document: Document): Pick<PrintUrlImportResult['sourceMetadata'], 'author' | 'license'> {
  return {
    author: textFromMeta(document, [
      'meta[name="author"]',
      'meta[property="article:author"]',
      'meta[property="profile:username"]',
    ]) ?? extractJsonLdText(document, ['author', 'creator']),
    license: textFromMeta(document, [
      'meta[name="license"]',
      'meta[property="license"]',
      'meta[property="cc:license"]',
    ]) ?? extractJsonLdText(document, ['license']),
  };
}

function findModelLink(document: Document, pageUrl: string): string | null {
  const links = Array.from(document.querySelectorAll('a[href], link[href]'));
  for (const link of links) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const resolved = new URL(href, pageUrl);
    if (isSupportedModelUrl(resolved.href)) return resolved.href;
  }

  const text = document.documentElement.textContent ?? '';
  const escapedExtensions = SUPPORTED_EXTENSIONS.map((extension) => extension.slice(1)).join('|');
  const match = text.match(new RegExp(`https?:\\/\\/[^\\s"'<>]+\\.(${escapedExtensions})(?:\\?[^\\s"'<>]*)?`, 'i'));
  return match?.[0] ?? null;
}

async function resolveMarketplacePage(
  inputUrl: URL,
): Promise<{ modelUrl: string; pageMetadata: Pick<PrintUrlImportResult['sourceMetadata'], 'author' | 'license'> }> {
  const response = await fetch(inputUrl.href, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Marketplace page lookup failed (${response.status})`);
  const html = await response.text();
  const document = new DOMParser().parseFromString(html, 'text/html');
  const modelUrl = findModelLink(document, inputUrl.href);
  if (!modelUrl) {
    throw new Error('No STL/OBJ/3MF/AMF/STEP download link was found on that marketplace page.');
  }
  return {
    modelUrl,
    pageMetadata: extractPageMetadata(document),
  };
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
    await cache.put(request, response.clone());
  } catch {
    // Browser cache is an optimization; failed writes should not block import.
  }
}

export async function fetchModelUrlToFile(input: string): Promise<PrintUrlImportResult> {
  const originalUrl = new URL(input.trim());
  let url = originalUrl;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Use an http or https model URL.');
  }
  const sourceSite = detectSourceSite(url);
  let pageMetadata: Pick<PrintUrlImportResult['sourceMetadata'], 'author' | 'license'> = {};
  if (!isSupportedModelUrl(url.href)) {
    if (!isMarketplacePageUrl(url)) {
      throw new Error('Paste a direct model URL or a Printables, MakerWorld, or Thingiverse model page.');
    }
    const resolved = await resolveMarketplacePage(url);
    url = new URL(resolved.modelUrl);
    pageMetadata = resolved.pageMetadata;
  }

  const request = new Request(url.href, { method: 'GET', mode: 'cors' });
  let response = await matchCached(request);
  let fromCache = true;
  if (!response) {
    fromCache = false;
    response = await fetch(request);
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    await putCached(request, response);
  }

  const filename = filenameFromModelUrl(url.href, response.headers.get('content-disposition'));
  const blob = await response.blob();
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  return {
    file,
    fromCache,
    sourceMetadata: {
      url: originalUrl.href,
      sourceSite,
      fetchedAt: Date.now(),
      ...pageMetadata,
    },
  };
}
