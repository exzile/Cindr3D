import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import http from 'node:http'
import https from 'node:https'

// Proxies /duet-proxy/<host>/path → http://<host>/path, bypassing browser CORS.
function duetProxyPlugin(): Plugin {
  return {
    name: 'duet-proxy',
    configureServer(server) {
      server.middlewares.use('/duet-proxy', (req, res) => {
        const match = req.url?.match(/^\/([^/?]+)([\/?].*)?$/);
        if (!match) { res.statusCode = 400; res.end('Bad proxy URL'); return; }
        const [, host, rest = '/'] = match;
        const targetUrl = `http://${host}${rest}`;
        const parsed = new URL(targetUrl);
        const mod = parsed.protocol === 'https:' ? https : http;
        const proxyReq = mod.request(
          targetUrl,
          { method: req.method, headers: { ...req.headers, host: parsed.host } },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
            proxyRes.pipe(res);
          }
        );
        proxyReq.on('error', (err) => {
          console.error(`[duet-proxy] upstream error ${req.method} ${targetUrl}: ${err.message}`);
          if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader('content-type', 'text/plain');
            res.end(`Upstream error: ${err.message}`);
          } else {
            res.end();
          }
        });
        req.pipe(proxyReq);
      });
    },
  };
}

// Proxies /github-proxy?url=<encoded URL> → the upstream URL on GitHub,
// following redirects (github.com → objects.githubusercontent.com).
// Browsers block those asset-CDN URLs because they don't send CORS headers;
// this dev-only proxy re-emits the bytes with ACAO:* so firmware updates work.
function githubProxyPlugin(): Plugin {
  const ALLOW_HOSTS = new Set([
    'api.github.com',
    'github.com',
    'objects.githubusercontent.com',
    'codeload.github.com',
  ]);

  return {
    name: 'github-proxy',
    configureServer(server) {
      server.middlewares.use('/github-proxy', async (req, res) => {
        try {
          const parsed = new URL(req.url ?? '/', 'http://dummy');
          const target = parsed.searchParams.get('url');
          if (!target) {
            res.statusCode = 400; res.end('missing ?url'); return;
          }
          let targetUrl: URL;
          try { targetUrl = new URL(target); }
          catch { res.statusCode = 400; res.end('bad url'); return; }
          if (!ALLOW_HOSTS.has(targetUrl.hostname)) {
            res.statusCode = 403; res.end('host not allowed'); return;
          }

          const acceptHdr = req.headers.accept;
          const upstream = await fetch(targetUrl, {
            method: req.method ?? 'GET',
            headers: {
              'User-Agent': 'DesignCAD-dev-proxy',
              ...(typeof acceptHdr === 'string' ? { Accept: acceptHdr } : {}),
            },
            redirect: 'follow',
          });

          const hdrs: Record<string, string> = {
            'access-control-allow-origin': '*',
            'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
          };
          // NOTE: do NOT forward content-length. undici's fetch transparently
          // decompresses gzip/deflate responses (common on api.github.com),
          // but the upstream content-length reflects the *compressed* size.
          // If we copy it over, the browser reads only that many bytes of our
          // decoded stream and truncates the JSON ("Unterminated string…").
          res.writeHead(upstream.status, hdrs);

          if (!upstream.body) { res.end(); return; }
          const reader = upstream.body.getReader();
          const pump = async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) res.write(Buffer.from(value));
            }
            res.end();
          };
          await pump();
        } catch (err) {
          res.statusCode = 502;
          res.end((err as Error).message);
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), wasm(), duetProxyPlugin(), githubProxyPlugin()],
  build: {
    // Disable CSS minification — lightningcss crashes on @keyframes in
    // some versions of the Vite 8 / rolldown stack.
    cssMinify: false,
    assetsInlineLimit: (filePath) => filePath.endsWith('.wasm') ? false : undefined,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) =>
          assetInfo.names.some((name) => name.endsWith('.wasm'))
            ? 'assets/wasm/[name]-[hash][extname]'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // wasm/.toolchain/ holds emsdk + Boost + Clipper2 + CuraEngine
      // sources (~1.5GB total, gitignored). Rolldown's file watcher
      // would otherwise enumerate them on every dev start, blowing
      // memory and triggering needless HMR cycles. Exclude here and
      // the .toolchain churn stops mattering.
      ignored: [
        '**/wasm/.toolchain/**',
        '**/wasm/.toolchain',
      ],
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
})
