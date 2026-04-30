/**
 * Per-page-load worker cache-busting helper.
 *
 * Web workers are bundled by Vite from `new Worker(new URL('./...', import.meta.url))`
 * call sites — the static analyzer captures the bundle dependency at
 * parse time. The browser, however, can cache the resulting worker
 * script across page reloads, so a hard-refresh after a code change
 * (or a WASM rebuild) sometimes re-uses the previous worker bundle and
 * the user sees stale slicer behavior.
 *
 * `freshWorkerUrl` appends a unique-per-page-load query string to the
 * worker URL. Vite's dev server ignores extra query params on file
 * URLs, so the worker still loads correctly; the browser, however,
 * sees a different URL on every page load and is forced to re-fetch.
 *
 * The nonce is a module-level constant so multiple `freshWorkerUrl()`
 * calls within ONE page lifetime return the same URL (allowing
 * worker-reuse logic in `getSlicerWorker`). When the page reloads, the
 * JS module re-evaluates and a new nonce is picked.
 */
const PAGE_LOAD_NONCE = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function freshWorkerUrl(base: URL | string): string {
  const href = typeof base === 'string' ? base : base.href;
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}fresh=${PAGE_LOAD_NONCE}`;
}
