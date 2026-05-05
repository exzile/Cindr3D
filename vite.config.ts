import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod/v4'
import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

// Proxies /duet-proxy/<host>/path → http://<host>/path, bypassing browser CORS.
function duetProxyPlugin(): Plugin {
  return {
    name: 'duet-proxy',
    configureServer(server) {
      server.middlewares.use('/duet-proxy', (req, res) => {
        const match = req.url?.match(/^\/([^/?]+)([/?].*)?$/);
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

function parseAuthParams(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  const rest = header.replace(/^\s*\w+\s+/, '');
  const pattern = /(\w+)=(?:"([^"]*)"|([^,]*))(?:,\s*|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rest)) !== null) {
    params[match[1]] = match[2] ?? match[3] ?? '';
  }
  return params;
}

function md5(value: string): string {
  return crypto.createHash('md5').update(value).digest('hex');
}

function digestAuthHeader(
  challenge: string,
  target: URL,
  method: string,
  username: string,
  password: string,
): string {
  const params = parseAuthParams(challenge);
  const realm = params.realm ?? '';
  const nonce = params.nonce ?? '';
  const qop = (params.qop ?? '').split(',').map((item) => item.trim()).find((item) => item === 'auth');
  const opaque = params.opaque;
  const algorithm = params.algorithm || 'MD5';
  const uri = `${target.pathname}${target.search}`;
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);
  const parts = [
    `username="${username.replace(/"/g, '\\"')}"`,
    `realm="${realm.replace(/"/g, '\\"')}"`,
    `nonce="${nonce.replace(/"/g, '\\"')}"`,
    `uri="${uri.replace(/"/g, '\\"')}"`,
    `response="${response}"`,
    `algorithm=${algorithm}`,
  ];
  if (opaque) parts.push(`opaque="${opaque.replace(/"/g, '\\"')}"`);
  if (qop) {
    parts.push(`qop=${qop}`);
    parts.push(`nc=${nc}`);
    parts.push(`cnonce="${cnonce}"`);
  }
  return `Digest ${parts.join(', ')}`;
}

function cameraProxyPlugin(): Plugin {
  return {
    name: 'camera-proxy',
    configureServer(server) {
      server.middlewares.use('/camera-proxy', (req, res) => {
        const parsedReq = new URL(req.url ?? '/', 'http://localhost');
        const target = parsedReq.searchParams.get('url');
        const username = parsedReq.searchParams.get('username') ?? '';
        const password = parsedReq.searchParams.get('password') ?? '';
        if (!target) { res.statusCode = 400; res.end('missing ?url'); return; }

        let targetUrl: URL;
        try { targetUrl = new URL(target); }
        catch { res.statusCode = 400; res.end('bad url'); return; }
        if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
          res.statusCode = 400; res.end('unsupported protocol'); return;
        }

        const requestUpstream = (authorization?: string) => {
          const mod = targetUrl.protocol === 'https:' ? https : http;
          const headers: http.OutgoingHttpHeaders = {
            Accept: req.headers.accept ?? 'multipart/x-mixed-replace,image/*,*/*',
            'User-Agent': 'Cindr3D-camera-proxy',
            host: targetUrl.host,
          };
          if (authorization) headers.Authorization = authorization;
          const upstreamReq = mod.request(targetUrl, { method: 'GET', headers });
          upstreamReq.setTimeout(5000, () => {
            upstreamReq.destroy(new Error('Camera connection timed out'));
          });
          return upstreamReq;
        };

        const pipeResponse = (upstream: http.IncomingMessage) => {
          const headers = { ...upstream.headers };
          delete headers['content-length'];
          headers['access-control-allow-origin'] = '*';
          res.writeHead(upstream.statusCode ?? 200, headers);
          upstream.pipe(res);
        };

        const firstReq = requestUpstream();
        firstReq.on('response', (firstRes) => {
          firstReq.setTimeout(0);
          const challenge = firstRes.headers['www-authenticate'];
          const challengeText = Array.isArray(challenge) ? challenge[0] : challenge;
          if (firstRes.statusCode !== 401 || !challengeText || !username) {
            pipeResponse(firstRes);
            return;
          }

          firstRes.resume();
          const lowerChallenge = challengeText.toLowerCase();
          const authorization = lowerChallenge.startsWith('digest')
            ? digestAuthHeader(challengeText, targetUrl, 'GET', username, password)
            : lowerChallenge.startsWith('basic')
              ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
              : '';
          if (!authorization) {
            res.statusCode = 401;
            res.end('unsupported camera authentication');
            return;
          }

          const secondReq = requestUpstream(authorization);
          secondReq.on('response', (secondRes) => {
            secondReq.setTimeout(0);
            pipeResponse(secondRes);
          });
          secondReq.on('error', (err) => {
            console.error(`[camera-proxy] upstream auth error GET ${targetUrl.origin}${targetUrl.pathname}: ${err.message}`);
            if (!res.headersSent) {
              res.statusCode = 502;
              res.setHeader('content-type', 'text/plain');
              res.end(`Upstream error: ${err.message}`);
            } else {
              res.end();
            }
          });
          secondReq.end();
        });
        firstReq.on('error', (err) => {
          console.error(`[camera-proxy] upstream error GET ${targetUrl.origin}${targetUrl.pathname}: ${err.message}`);
          if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader('content-type', 'text/plain');
            res.end(`Upstream error: ${err.message}`);
          } else {
            res.end();
          }
        });
        firstReq.end();
      });
    },
  };
}

// Proxies /github-proxy?url=<encoded URL> → the upstream URL on GitHub,
// following redirects (github.com → objects.githubusercontent.com).
// Browsers block those asset-CDN URLs because they don't send CORS headers;
// this dev-only proxy re-emits the bytes with ACAO:* so firmware updates work.
type HlsBridgeSession = {
  dir: string;
  indexPath: string;
  process: ChildProcessWithoutNullStreams;
  lastAccess: number;
};
type HlsBridgeQuality = 'native' | '1080p' | '720p' | '480p';
type RtspRecordingSession = {
  createdAt: number;
  filePath: string;
  kind: string;
  process: ChildProcessWithoutNullStreams;
  target: string;
};
type CameraBackendSource =
  | { kind: 'rtsp'; target: string }
  | { kind: 'usb'; target: string };

type MiddlewareHost = {
  middlewares: {
    use: (
      path: string,
      handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>,
    ) => void;
  };
  httpServer?: {
    once: (event: 'close', listener: () => void) => void;
  } | null;
};

function contentTypeForHlsFile(filePath: string): string {
  if (filePath.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (filePath.endsWith('.ts')) return 'video/mp2t';
  return 'application/octet-stream';
}

function localFfmpegPath(): string {
  const envPath = process.env.FFMPEG_PATH?.trim();
  if (envPath) return envPath;
  try {
    const bundled = require('@ffmpeg-installer/ffmpeg') as { path?: string };
    if (bundled.path) return bundled.path;
  } catch (error) {
    throw new Error(`Bundled FFmpeg package is unavailable: ${(error as Error).message}`);
  }
  throw new Error('Bundled FFmpeg package did not expose an executable path.');
}

function normalizeBridgeQuality(value: string | null): HlsBridgeQuality {
  return value === 'native' || value === '1080p' || value === '720p' || value === '480p'
    ? value
    : '1080p';
}

function scaleFilterForQuality(quality: HlsBridgeQuality): string[] {
  if (quality === 'native') return [];
  const height = quality === '1080p' ? 1080 : quality === '720p' ? 720 : 480;
  return ['-vf', `scale=-2:min(${height}\\,ih)`];
}

function backendSourceId(source: CameraBackendSource, quality: HlsBridgeQuality): string {
  return crypto.createHash('sha1').update(`${source.kind}|${source.target}|${quality}`).digest('hex').slice(0, 16);
}

function parseBackendCameraSource(parsedReq: URL): CameraBackendSource | null {
  const source = parsedReq.searchParams.get('source') ?? 'rtsp';
  const target = parsedReq.searchParams.get(source === 'usb' ? 'device' : 'url');
  if (!target) return null;
  if (source === 'usb') return { kind: 'usb', target };
  try {
    const targetUrl = new URL(target);
    return targetUrl.protocol === 'rtsp:' ? { kind: 'rtsp', target } : null;
  } catch {
    return null;
  }
}

function ffmpegInputArgs(source: CameraBackendSource): string[] {
  if (source.kind === 'rtsp') {
    return ['-rtsp_transport', 'tcp', '-fflags', 'nobuffer', '-flags', 'low_delay', '-i', source.target];
  }

  if (process.platform === 'win32') {
    return ['-f', 'dshow', '-i', source.target.startsWith('video=') ? source.target : `video=${source.target}`];
  }
  if (process.platform === 'darwin') {
    return ['-f', 'avfoundation', '-i', source.target || '0'];
  }
  return ['-f', 'v4l2', '-framerate', '30', '-i', source.target || '/dev/video0'];
}

function redactCameraTarget(target: string): string {
  return target.replace(/\/\/.*@/, '//***@');
}

function rtspHlsBridgePlugin(): Plugin {
  const sessions = new Map<string, HlsBridgeSession>();
  const root = path.join(os.tmpdir(), 'cindr3d-camera-hls');
  const ffmpegPath = localFfmpegPath();

  function stopSession(id: string): void {
    const session = sessions.get(id);
    if (!session) return;
    session.process.kill('SIGTERM');
    sessions.delete(id);
    try {
      fs.rmSync(session.dir, { recursive: true, force: true });
    } catch {
      /* temp cleanup best effort */
    }
  }

  function bridgeSessionId(source: CameraBackendSource, quality: HlsBridgeQuality): string {
    return backendSourceId(source, quality);
  }

  function ensureSession(source: CameraBackendSource, quality: HlsBridgeQuality): HlsBridgeSession {
    const id = bridgeSessionId(source, quality);
    const existing = sessions.get(id);
    if (existing && !existing.process.killed) {
      existing.lastAccess = Date.now();
      return existing;
    }

    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    const indexPath = path.join(dir, 'index.m3u8');
    const segmentPattern = path.join(dir, 'segment_%05d.ts');
    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      ...ffmpegInputArgs(source),
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      ...scaleFilterForQuality(quality),
      '-f', 'hls',
      '-hls_time', '1',
      '-hls_list_size', '5',
      '-hls_flags', 'delete_segments+append_list+omit_endlist',
      '-hls_segment_filename', segmentPattern,
      indexPath,
    ];
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    child.stderr.on('data', (chunk) => {
      console.warn(`[camera-rtsp-hls] ${String(chunk).trim()}`);
    });
    child.on('exit', () => {
      sessions.delete(id);
    });

    const session = { dir, indexPath, process: child, lastAccess: Date.now() };
    sessions.set(id, session);
    return session;
  }

  return {
    name: 'camera-rtsp-hls',
    configureServer(server) {
      register(server);
    },
    configurePreviewServer(server) {
      register(server);
    },
  };

  function register(server: MiddlewareHost): void {
      const cleanupTimer = setInterval(() => {
        const staleBefore = Date.now() - 5 * 60 * 1000;
        for (const [id, session] of sessions) {
          if (session.lastAccess < staleBefore) stopSession(id);
        }
      }, 60 * 1000);

      server.httpServer?.once('close', () => {
        clearInterval(cleanupTimer);
        for (const id of sessions.keys()) stopSession(id);
      });

      server.middlewares.use('/camera-rtsp-hls', async (req, res) => {
        const parsedReq = new URL(req.url ?? '/', 'http://localhost');
        const quality = normalizeBridgeQuality(parsedReq.searchParams.get('quality'));
        const source = parseBackendCameraSource(parsedReq);

        if (source) {
          const id = bridgeSessionId(source, quality);
          const session = ensureSession(source, quality);
          const waitStarted = Date.now();
          while (!fs.existsSync(session.indexPath) && Date.now() - waitStarted < 8000) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          const playlist = fs.existsSync(session.indexPath)
            ? fs.readFileSync(session.indexPath, 'utf8').split(/\r?\n/).map((line) => (
              line && !line.startsWith('#') ? `/camera-rtsp-hls/${id}/${line}` : line
            )).join('\n')
            : '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n';
          res.writeHead(200, {
            'access-control-allow-origin': '*',
            'cache-control': 'no-cache, no-store, must-revalidate',
            'content-type': contentTypeForHlsFile(session.indexPath),
          });
          res.end(playlist);
          return;
        }

        const match = parsedReq.pathname.match(/^\/([a-f0-9]{16})\/([^/]+)$/);
        if (!match) {
          res.statusCode = 400;
          res.end('missing ?url');
          return;
        }
        const [, id, fileName] = match;
        const session = sessions.get(id);
        if (!session) {
          res.statusCode = 404;
          res.end('stream not running');
          return;
        }
        session.lastAccess = Date.now();
        const filePath = path.join(session.dir, fileName);
        if (!filePath.startsWith(session.dir) || !fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end('segment not ready');
          return;
        }
        res.writeHead(200, {
          'access-control-allow-origin': '*',
          'cache-control': 'no-cache',
          'content-type': contentTypeForHlsFile(filePath),
        });
        fs.createReadStream(filePath).pipe(res);
      });
  }
}

function rtspRecordingPlugin(): Plugin {
  const recordings = new Map<string, RtspRecordingSession>();
  const root = path.join(os.tmpdir(), 'cindr3d-camera-recordings');
  const ffmpegPath = localFfmpegPath();

  function recordingId(seed: string): string {
    return crypto.createHash('sha1').update(`${seed}|${Date.now()}|${crypto.randomBytes(8).toString('hex')}`).digest('hex').slice(0, 18);
  }

  function stopRecordingProcess(id: string): Promise<RtspRecordingSession | null> {
    const session = recordings.get(id);
    if (!session) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        recordings.delete(id);
        resolve(session);
      };
      session.process.once('exit', finish);
      session.process.kill('SIGINT');
      setTimeout(() => {
        if (!settled) {
          session.process.kill('SIGTERM');
          finish();
        }
      }, 5000);
    });
  }

  function register(server: MiddlewareHost): void {
    server.httpServer?.once('close', () => {
      for (const [id, session] of recordings) {
        session.process.kill('SIGTERM');
        recordings.delete(id);
      }
    });

    server.middlewares.use('/camera-rtsp-record', async (req, res) => {
      const parsedReq = new URL(req.url ?? '/', 'http://localhost');
      const action = parsedReq.searchParams.get('action') ?? 'status';

      if (action === 'status') {
        const sessions = Array.from(recordings.entries()).map(([id, session]) => ({
          id,
          createdAt: session.createdAt,
          durationMs: Date.now() - session.createdAt,
          kind: session.kind,
          target: redactCameraTarget(session.target),
        }));
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
        res.end(JSON.stringify({ recordings: sessions }));
        return;
      }

      if (action === 'start') {
        const source = parseBackendCameraSource(parsedReq);
        const kind = parsedReq.searchParams.get('kind') ?? 'clip';
        const quality = normalizeBridgeQuality(parsedReq.searchParams.get('quality'));
        if (!source) {
          res.statusCode = 400;
          res.end('missing or unsupported camera source');
          return;
        }

        fs.mkdirSync(root, { recursive: true });
        const id = recordingId(`${source.kind}|${source.target}`);
        const filePath = path.join(root, `${id}.mp4`);
        const args = [
          '-hide_banner',
          '-loglevel', 'warning',
          ...ffmpegInputArgs(source),
          '-an',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-tune', 'zerolatency',
          '-pix_fmt', 'yuv420p',
          ...scaleFilterForQuality(quality),
          '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
          '-f', 'mp4',
          filePath,
        ];
        const child = spawn(ffmpegPath, args, { windowsHide: true });
        child.stderr.on('data', (chunk) => {
          console.warn(`[camera-rtsp-record] ${String(chunk).trim()}`);
        });
        child.on('exit', () => {
          recordings.delete(id);
        });
        const createdAt = Date.now();
        recordings.set(id, { createdAt, filePath, kind, process: child, target: `${source.kind}:${source.target}` });
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
        res.end(JSON.stringify({ id, createdAt, kind }));
        return;
      }

      if (action === 'stop') {
        const id = parsedReq.searchParams.get('id');
        if (!id) { res.statusCode = 400; res.end('missing id'); return; }
        const session = await stopRecordingProcess(id);
        if (!session) {
          res.statusCode = 404;
          res.end('recording not running');
          return;
        }
        if (!fs.existsSync(session.filePath)) {
          res.statusCode = 500;
          res.end('recording file was not created');
          return;
        }
        const stat = fs.statSync(session.filePath);
        res.writeHead(200, {
          'access-control-allow-origin': '*',
          'cache-control': 'no-cache, no-store, must-revalidate',
          'content-disposition': `attachment; filename="${id}.mp4"`,
          'content-length': String(stat.size),
          'content-type': 'video/mp4',
          'x-recording-created-at': String(session.createdAt),
          'x-recording-duration-ms': String(Math.max(0, Date.now() - session.createdAt)),
          'x-recording-kind': session.kind,
        });
        fs.createReadStream(session.filePath)
          .on('close', () => {
            fs.rm(session.filePath, { force: true }, () => {});
          })
          .pipe(res);
        return;
      }

      res.statusCode = 400;
      res.end('unknown action');
    });
  }

  return {
    name: 'camera-rtsp-record',
    configureServer(server) {
      register(server);
    },
    configurePreviewServer(server) {
      register(server);
    },
  };
}

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
              'User-Agent': 'Cindr3D-dev-proxy',
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

// Send `Cache-Control: no-cache` for dev-mode static assets that the
// browser would otherwise hold onto across reloads — `.wasm`, `.js`,
// `.ts`, `.tsx`, `.css`, and the bare `/` HTML entry. `no-cache`
// (NOT `no-store` — we want disk cache + ETag revalidation) makes
// every fetch validate against the server. Effects:
//
//   • Rebuilt `.wasm` (after `wasm/build.ps1`) arrives within the
//     next slice, no hard-reload needed.
//   • Edits to source `.ts`/`.tsx` always reach the running tab —
//     the long-tail cache-stale problems we kept hitting (purple
//     colour, profile migration, etc.) become impossible because
//     the browser cannot serve stale source from disk.
//
// Only applies to the dev middleware (`apply: 'serve'`); production
// assets are content-hashed by `rollupOptions.output` and need
// long cache headers, so we don't touch them.
function noCacheDevAssetsPlugin(): Plugin {
  return {
    name: 'no-cache-dev-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) { next(); return; }
        const url = req.url;
        const noCache =
          /\.(wasm|js|mjs|cjs|ts|tsx|jsx|css)(\?|$)/.test(url)
          || url === '/'
          || url === '/index.html'
          || url.startsWith('/@');  // Vite virtual modules
        if (noCache) {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
        next();
      });
    },
  };
}

const MCP_DEFAULT_PORT = 5174;
const MCP_HEARTBEAT_TIMEOUT_MS = 15_000;
const MCP_AUDIT_LIMIT = 80;
const MCP_RATE_LIMIT_MAX_CALLS = 12;
const MCP_RATE_LIMIT_WINDOW_MS = 10_000;

type JsonBodyRequest = http.IncomingMessage & { body?: unknown };
type McpTransportSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};
type McpAuditEntry = {
  args?: unknown;
  callId: string;
  message?: string;
  status: 'queued' | 'ok' | 'error' | 'timeout' | 'rate-limited';
  timestamp: string;
  tool: string;
};

function isLocalhostHost(host: string | undefined): boolean {
  const value = (host ?? '').toLowerCase();
  return value.startsWith('localhost:')
    || value.startsWith('127.0.0.1:')
    || value.startsWith('[::1]:')
    || value === 'localhost'
    || value === '127.0.0.1'
    || value === '[::1]';
}

function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && (
      parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '::1'
    );
  } catch {
    return false;
  }
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

// ── Browser Relay ─────────────────────────────────────────────────────────────
// Bridges tool calls from the MCP server (Node.js) to the in-browser CAD store.
// The browser connects via GET /mcp-control/relay (SSE) and posts results via
// POST /mcp-control/relay-result.
const RELAY_TIMEOUT_MS = 30_000;

class BrowserRelay {
  private connections = new Set<http.ServerResponse>();
  private audit: McpAuditEntry[] = [];
  private pending = new Map<string, {
    resolve: (r: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    tool: string;
  }>();
  private rateWindows = new Map<string, number[]>();

  addConnection(res: http.ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(':\n\n'); // SSE comment to establish connection
    this.connections.add(res);
    res.on('close', () => this.connections.delete(res));
  }

  get browserConnected(): boolean {
    return this.connections.size > 0;
  }

  getAudit(): McpAuditEntry[] {
    return [...this.audit].reverse();
  }

  clearAudit(): void {
    this.audit = [];
  }

  private record(entry: Omit<McpAuditEntry, 'timestamp'>): void {
    this.audit.push({ ...entry, timestamp: new Date().toISOString() });
    if (this.audit.length > MCP_AUDIT_LIMIT) {
      this.audit.splice(0, this.audit.length - MCP_AUDIT_LIMIT);
    }
  }

  private rateLimit(tool: string, callId: string): void {
    const now = Date.now();
    const recent = (this.rateWindows.get(tool) ?? []).filter((time) => now - time < MCP_RATE_LIMIT_WINDOW_MS);
    if (recent.length >= MCP_RATE_LIMIT_MAX_CALLS) {
      this.rateWindows.set(tool, recent);
      const message = `Rate limit exceeded for ${tool}: ${MCP_RATE_LIMIT_MAX_CALLS} calls per ${MCP_RATE_LIMIT_WINDOW_MS / 1000}s.`;
      this.record({ callId, tool, status: 'rate-limited', message });
      throw new Error(message);
    }
    recent.push(now);
    this.rateWindows.set(tool, recent);
  }

  call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const callId = crypto.randomUUID();
    this.rateLimit(tool, callId);
    if (!this.browserConnected) {
      this.record({ callId, tool, args, status: 'error', message: 'No Cindr3D tab connected.' });
      return Promise.reject(new Error('No Cindr3D tab connected. Open Cindr3D in a browser tab first.'));
    }
    this.record({ callId, tool, args, status: 'queued' });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        this.record({ callId, tool, status: 'timeout', message: `Timed out after ${RELAY_TIMEOUT_MS / 1000}s.` });
        reject(new Error(`Tool call '${tool}' timed out after ${RELAY_TIMEOUT_MS / 1000}s.`));
      }, RELAY_TIMEOUT_MS);
      this.pending.set(callId, { resolve, reject, timer, tool });
      const event = `data: ${JSON.stringify({ callId, tool, args })}\n\n`;
      for (const res of this.connections) {
        try { res.write(event); } catch { /* connection dead, will be cleaned up on close */ }
      }
    });
  }

  resolveCall(callId: string, result: unknown): boolean {
    const pending = this.pending.get(callId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(callId);
    this.record({ callId, tool: pending.tool, status: 'ok' });
    pending.resolve(result);
    return true;
  }

  rejectCall(callId: string, message: string): boolean {
    const pending = this.pending.get(callId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(callId);
    this.record({ callId, tool: pending.tool, status: 'error', message });
    pending.reject(new Error(message));
    return true;
  }

  closeAll(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('MCP server stopped.'));
    }
    this.pending.clear();
    for (const res of this.connections) {
      try { res.end(); } catch { /* already closed */ }
    }
    this.connections.clear();
  }
}

// ── Tool helpers ───────────────────────────────────────────────────────────────
function textOk(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

type McpJsonInputSpec = {
  description?: string;
  items?: McpJsonInputSpec;
  type?: 'array' | 'boolean' | 'number' | 'string';
};

function mcpInputSchema(shape: Record<string, McpJsonInputSpec>) {
  const entries = Object.entries(shape).map(([name, spec]) => {
    let schema: z.ZodType;
    if (spec.type === 'array') {
      const itemSchema = spec.items?.type === 'number'
        ? z.number()
        : spec.items?.type === 'array'
          ? z.array(z.number())
          : z.string();
      schema = z.array(itemSchema);
    } else if (spec.type === 'boolean') {
      schema = z.boolean();
    } else if (spec.type === 'number') {
      schema = z.number();
    } else {
      schema = z.string();
    }
    if (spec.description) schema = schema.describe(spec.description);
    if (spec.description?.toLowerCase().includes('optional')) schema = schema.optional();
    return [name, schema];
  });
  return Object.fromEntries(entries);
}

async function relayTool(relay: BrowserRelay, tool: string, args: Record<string, unknown>) {
  const result = await relay.call(tool, args);
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  return textOk(text);
}

function createCindr3dMcpServer(relay: BrowserRelay): McpServer {
  const server = new McpServer({ name: 'cindr3d', version: '0.1.0' });

  // ── Status ──
  server.registerTool('cindr3d_status', {
    title: 'Cindr3D Status',
    description: 'Reports whether the Cindr3D browser tab is connected to this MCP server.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => textOk(relay.browserConnected
    ? 'Cindr3D browser tab is connected and ready.'
    : 'MCP server is running but no Cindr3D tab is connected yet. Open Cindr3D in a browser.'));

  // ── Document / scene ──────────────────────────────────────────────────────
  server.registerTool('list_objects', {
    title: 'List Objects',
    description: 'Returns all features/bodies in the active document: id, kind, name, visible, suppressed.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'list_objects', {}));

  server.registerTool('get_object_properties', {
    title: 'Get Object Properties',
    description: 'Returns full details for one feature (params, sketchId, bodyKind, bbox if mesh present).',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: mcpInputSchema({ id: { type: 'string', description: 'Feature id returned by list_objects' } }),
  }, ({ id }: { id: string }) => relayTool(relay, 'get_object_properties', { id }));

  server.registerTool('select_objects', {
    title: 'Select Objects',
    description: 'Selects features by id (clears previous selection). Pass empty array to deselect all.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({ ids: { type: 'array', items: { type: 'string' }, description: 'Feature ids to select' } }),
  }, ({ ids }: { ids: string[] }) => relayTool(relay, 'select_objects', { ids }));

  server.registerTool('snapshot_view', {
    title: 'Snapshot View',
    description: 'Captures a PNG of the 3-D viewport. Returns the image so the model can see its work.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const result = await relay.call('snapshot_view', {}) as { dataUrl: string } | string;
    const dataUrl = typeof result === 'string' ? result : result.dataUrl;
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    return { content: [{ type: 'image' as const, data: base64, mimeType: 'image/png' as const }] };
  });

  // ── Primitives ────────────────────────────────────────────────────────────
  server.registerTool('create_box', {
    title: 'Create Box',
    description: 'Inserts a box primitive. All dimensions in mm.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      x: { type: 'number', description: 'Width (X)' },
      y: { type: 'number', description: 'Depth (Y)' },
      z: { type: 'number', description: 'Height (Z)' },
      px: { type: 'number', description: 'X position (optional, default 0)' },
      py: { type: 'number', description: 'Y position (optional, default 0)' },
      pz: { type: 'number', description: 'Z position (optional, default 0)' },
    }),
  }, (args: { x: number; y: number; z: number; px?: number; py?: number; pz?: number }) =>
    relayTool(relay, 'create_box', args as unknown as Record<string, unknown>));

  server.registerTool('create_cylinder', {
    title: 'Create Cylinder',
    description: 'Inserts a cylinder primitive. Dimensions in mm.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      radius: { type: 'number', description: 'Radius in mm' },
      height: { type: 'number', description: 'Height in mm' },
      px: { type: 'number', description: 'X position (optional)' },
      py: { type: 'number', description: 'Y position (optional)' },
      pz: { type: 'number', description: 'Z position (optional)' },
    }),
  }, (args: { radius: number; height: number; px?: number; py?: number; pz?: number }) =>
    relayTool(relay, 'create_cylinder', args as unknown as Record<string, unknown>));

  server.registerTool('create_sphere', {
    title: 'Create Sphere',
    description: 'Inserts a sphere primitive. Dimensions in mm.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      radius: { type: 'number', description: 'Radius in mm' },
      px: { type: 'number', description: 'X position (optional)' },
      py: { type: 'number', description: 'Y position (optional)' },
      pz: { type: 'number', description: 'Z position (optional)' },
    }),
  }, (args: { radius: number; px?: number; py?: number; pz?: number }) =>
    relayTool(relay, 'create_sphere', args as unknown as Record<string, unknown>));

  server.registerTool('create_cone', {
    title: 'Create Cone',
    description: 'Inserts a cone primitive (r1=bottom radius, r2=top radius). Set r2=0 for a sharp cone.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      r1: { type: 'number', description: 'Bottom radius in mm' },
      r2: { type: 'number', description: 'Top radius in mm (0 = sharp tip)' },
      height: { type: 'number', description: 'Height in mm' },
      px: { type: 'number', description: 'X position (optional)' },
      py: { type: 'number', description: 'Y position (optional)' },
      pz: { type: 'number', description: 'Z position (optional)' },
    }),
  }, (args: { r1: number; r2: number; height: number; px?: number; py?: number; pz?: number }) =>
    relayTool(relay, 'create_cone', args as unknown as Record<string, unknown>));

  // ── Sketches ──────────────────────────────────────────────────────────────
  server.registerTool('start_sketch', {
    title: 'Start Sketch',
    description: 'Begins a new sketch on a named plane (XY, XZ, or YZ).',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({ plane: { type: 'string', description: '"XY" | "XZ" | "YZ"' } }),
  }, ({ plane }: { plane: string }) => relayTool(relay, 'start_sketch', { plane }));

  server.registerTool('sketch_rect', {
    title: 'Sketch Rectangle',
    description: 'Adds a rectangle to the active sketch. Coordinates in sketch-plane units (mm by default).',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      x: { type: 'number', description: 'Left X or center X (if centered)' },
      y: { type: 'number', description: 'Bottom Y or center Y (if centered)' },
      w: { type: 'number', description: 'Width' },
      h: { type: 'number', description: 'Height' },
      centered: { type: 'boolean', description: 'Treat x,y as center (optional, default false)' },
    }),
  }, (args: { x: number; y: number; w: number; h: number; centered?: boolean }) =>
    relayTool(relay, 'sketch_rect', args as unknown as Record<string, unknown>));

  server.registerTool('sketch_circle', {
    title: 'Sketch Circle',
    description: 'Adds a circle to the active sketch.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      cx: { type: 'number', description: 'Center X' },
      cy: { type: 'number', description: 'Center Y' },
      radius: { type: 'number', description: 'Radius' },
    }),
  }, (args: { cx: number; cy: number; radius: number }) =>
    relayTool(relay, 'sketch_circle', args as unknown as Record<string, unknown>));

  server.registerTool('sketch_polygon', {
    title: 'Sketch Polygon',
    description: 'Adds a closed polyline from the given points to the active sketch.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      points: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Array of [x, y] pairs' },
    }),
  }, (args: { points: [number, number][] }) =>
    relayTool(relay, 'sketch_polygon', args as unknown as Record<string, unknown>));

  server.registerTool('sketch_dimension', {
    title: 'Sketch Dimension',
    description: 'Applies a dimension constraint to an entity in the active sketch.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      entityId: { type: 'string', description: 'Entity id to dimension' },
      value: { type: 'number', description: 'Dimension value in mm' },
    }),
  }, (args: { entityId: string; value: number }) =>
    relayTool(relay, 'sketch_dimension', args as unknown as Record<string, unknown>));

  server.registerTool('finish_sketch', {
    title: 'Finish Sketch',
    description: 'Commits and closes the active sketch. Returns the new sketch id.',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'finish_sketch', {}));

  // ── Features ──────────────────────────────────────────────────────────────
  server.registerTool('extrude_sketch', {
    title: 'Extrude Sketch',
    description: 'Extrudes a sketch into a solid. depth in mm, direction: "one-side" | "symmetric" | "two-sides".',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      sketchId: { type: 'string', description: 'Id of sketch to extrude' },
      depth: { type: 'number', description: 'Extrude depth in mm' },
      direction: { type: 'string', description: '"one-side" | "symmetric" | "two-sides" (optional, default "one-side")' },
      operation: { type: 'string', description: '"new-body" | "join" | "cut" | "intersect" (optional, default "new-body")' },
    }),
  }, (args: { sketchId: string; depth: number; direction?: string; operation?: string }) =>
    relayTool(relay, 'extrude_sketch', args as unknown as Record<string, unknown>));

  server.registerTool('revolve_sketch', {
    title: 'Revolve Sketch',
    description: 'Revolves a sketch around an axis by angle degrees.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      sketchId: { type: 'string', description: 'Id of sketch to revolve' },
      axis: { type: 'string', description: '"X" | "Y" | "Z" axis of revolution' },
      angle: { type: 'number', description: 'Degrees to revolve (optional, default 360)' },
    }),
  }, (args: { sketchId: string; axis: string; angle?: number }) =>
    relayTool(relay, 'revolve_sketch', args as unknown as Record<string, unknown>));

  server.registerTool('fillet_edges', {
    title: 'Fillet Edges',
    description: 'Applies a constant-radius fillet to selected edge ids on an object.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      objectId: { type: 'string', description: 'Feature id' },
      edgeIds: { type: 'array', items: { type: 'string' }, description: 'Edge ids to fillet' },
      radius: { type: 'number', description: 'Fillet radius in mm' },
    }),
  }, (args: { objectId: string; edgeIds: string[]; radius: number }) =>
    relayTool(relay, 'fillet_edges', args as unknown as Record<string, unknown>));

  server.registerTool('chamfer_edges', {
    title: 'Chamfer Edges',
    description: 'Applies a chamfer to selected edge ids on an object.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      objectId: { type: 'string', description: 'Feature id' },
      edgeIds: { type: 'array', items: { type: 'string' }, description: 'Edge ids to chamfer' },
      distance: { type: 'number', description: 'Chamfer distance in mm' },
    }),
  }, (args: { objectId: string; edgeIds: string[]; distance: number }) =>
    relayTool(relay, 'chamfer_edges', args as unknown as Record<string, unknown>));

  server.registerTool('hole', {
    title: 'Hole',
    description: 'Creates a simple drilled hole on a feature.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      objectId: { type: 'string', description: 'Feature id to place hole on' },
      x: { type: 'number', description: 'X position in model space' },
      y: { type: 'number', description: 'Y position in model space' },
      z: { type: 'number', description: 'Z position in model space' },
      diameter: { type: 'number', description: 'Hole diameter in mm' },
      depth: { type: 'number', description: 'Hole depth in mm' },
      throughAll: { type: 'boolean', description: 'Through-all hole (optional, default false)' },
    }),
  }, (args: { objectId: string; x: number; y: number; z: number; diameter: number; depth: number; throughAll?: boolean }) =>
    relayTool(relay, 'hole', args as unknown as Record<string, unknown>));

  // ── Booleans + transforms ─────────────────────────────────────────────────
  server.registerTool('boolean_union', {
    title: 'Boolean Union',
    description: 'Joins two features into one solid body.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      targetId: { type: 'string', description: 'Id of target feature (keeps name)' },
      toolId: { type: 'string', description: 'Id of tool feature (consumed)' },
    }),
  }, (args: { targetId: string; toolId: string }) =>
    relayTool(relay, 'boolean_union', args as unknown as Record<string, unknown>));

  server.registerTool('boolean_subtract', {
    title: 'Boolean Subtract',
    description: 'Subtracts the tool feature from the target feature.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      targetId: { type: 'string', description: 'Id of feature to cut from' },
      toolId: { type: 'string', description: 'Id of cutting tool feature' },
    }),
  }, (args: { targetId: string; toolId: string }) =>
    relayTool(relay, 'boolean_subtract', args as unknown as Record<string, unknown>));

  server.registerTool('boolean_intersect', {
    title: 'Boolean Intersect',
    description: 'Keeps only the intersection of two features.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      targetId: { type: 'string', description: 'Id of first feature' },
      toolId: { type: 'string', description: 'Id of second feature' },
    }),
  }, (args: { targetId: string; toolId: string }) =>
    relayTool(relay, 'boolean_intersect', args as unknown as Record<string, unknown>));

  server.registerTool('transform', {
    title: 'Transform',
    description: 'Translates or scales a feature mesh in 3-D space.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      id: { type: 'string', description: 'Feature id' },
      tx: { type: 'number', description: 'Translate X (mm, optional)' },
      ty: { type: 'number', description: 'Translate Y (mm, optional)' },
      tz: { type: 'number', description: 'Translate Z (mm, optional)' },
      sx: { type: 'number', description: 'Scale X (optional, default 1)' },
      sy: { type: 'number', description: 'Scale Y (optional, default 1)' },
      sz: { type: 'number', description: 'Scale Z (optional, default 1)' },
    }),
  }, (args: { id: string; tx?: number; ty?: number; tz?: number; sx?: number; sy?: number; sz?: number }) =>
    relayTool(relay, 'transform', args as unknown as Record<string, unknown>));

  server.registerTool('mirror', {
    title: 'Mirror',
    description: 'Mirrors a feature across a named plane (XY, XZ, or YZ).',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      id: { type: 'string', description: 'Feature id' },
      plane: { type: 'string', description: '"XY" | "XZ" | "YZ"' },
    }),
  }, (args: { id: string; plane: string }) =>
    relayTool(relay, 'mirror', args as unknown as Record<string, unknown>));

  server.registerTool('linear_pattern', {
    title: 'Linear Pattern',
    description: 'Creates a linear pattern of a feature along an axis.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      id: { type: 'string', description: 'Feature id to pattern' },
      axis: { type: 'string', description: '"X" | "Y" | "Z"' },
      count: { type: 'number', description: 'Total number of instances (including original)' },
      spacing: { type: 'number', description: 'Spacing between instances in mm' },
    }),
  }, (args: { id: string; axis: string; count: number; spacing: number }) =>
    relayTool(relay, 'linear_pattern', args as unknown as Record<string, unknown>));

  server.registerTool('circular_pattern', {
    title: 'Circular Pattern',
    description: 'Creates a circular pattern of a feature around an axis.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      id: { type: 'string', description: 'Feature id to pattern' },
      axis: { type: 'string', description: '"X" | "Y" | "Z" rotation axis' },
      count: { type: 'number', description: 'Total number of instances' },
      totalAngle: { type: 'number', description: 'Total angle span in degrees (default 360)' },
    }),
  }, (args: { id: string; axis: string; count: number; totalAngle?: number }) =>
    relayTool(relay, 'circular_pattern', args as unknown as Record<string, unknown>));

  // ── Export / save ─────────────────────────────────────────────────────────
  server.registerTool('save_session', {
    title: 'Save Session',
    description: 'Saves the current design to a .dznd file (triggers browser download).',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'save_session', {}));

  server.registerTool('export_stl', {
    title: 'Export STL',
    description: 'Exports the design (or selected objects) as binary STL (triggers browser download).',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      ids: { type: 'array', items: { type: 'string' }, description: 'Optional list of feature ids; omit for all' },
    }),
  }, (args: { ids?: string[] }) => relayTool(relay, 'export_stl', args as unknown as Record<string, unknown>));

  server.registerTool('export_step', {
    title: 'Export STEP',
    description: 'Exports the design (or selected objects) as STEP (triggers browser download).',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      ids: { type: 'array', items: { type: 'string' }, description: 'Optional list of feature ids; omit for all' },
    }),
  }, (args: { ids?: string[] }) => relayTool(relay, 'export_step', args as unknown as Record<string, unknown>));

  server.registerTool('export_gcode', {
    title: 'Export G-code',
    description: 'Slices the design and exports G-code using the active printer profile.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      profileId: { type: 'string', description: 'Printer profile id (optional; uses active profile)' },
    }),
  }, (args: { profileId?: string }) => relayTool(relay, 'export_gcode', args as unknown as Record<string, unknown>));

  // ── Slicer ────────────────────────────────────────────────────────────────
  server.registerTool('slicer_get_settings', {
    title: 'Get Slicer Settings',
    description: 'Return the active print profile (layer height, infill, speeds, support, etc.) and active printer/material names.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_get_settings', {}));

  server.registerTool('slicer_set_setting', {
    title: 'Set Slicer Setting',
    description: 'Update one field in the active print profile. Fetch current values with slicer_get_settings first.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      key: { type: 'string', description: 'Print profile field name (e.g. "layerHeight", "infillDensity", "supportEnabled")' },
      value: { type: 'string', description: 'New value — numbers, booleans, and enum strings all accepted as JSON' },
    }),
  }, ({ key, value }: { key: string; value: string }) => {
    let parsed: unknown = value;
    try { parsed = JSON.parse(value); } catch { /* keep as string */ }
    return relayTool(relay, 'slicer_set_setting', { key, value: parsed });
  });

  server.registerTool('slicer_list_profiles', {
    title: 'List Slicer Profiles',
    description: 'List all printer, material, and print profiles with their IDs and active status.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_list_profiles', {}));

  server.registerTool('slicer_set_active_profile', {
    title: 'Set Active Profile',
    description: 'Switch the active printer, material, or print profile.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      kind: { type: 'string', description: '"printer" | "material" | "print"' },
      id: { type: 'string', description: 'Profile ID from slicer_list_profiles' },
    }),
  }, ({ kind, id }: { kind: string; id: string }) => relayTool(relay, 'slicer_set_active_profile', { kind, id }));

  server.registerTool('slicer_list_plate_objects', {
    title: 'List Plate Objects',
    description: 'List all objects on the build plate with position, rotation, and scale.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_list_plate_objects', {}));

  server.registerTool('slicer_start_slice', {
    title: 'Start Slice',
    description: 'Start slicing the current build plate. Returns immediately; poll with slicer_get_status.',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_start_slice', {}));

  server.registerTool('slicer_get_status', {
    title: 'Get Slice Status',
    description: 'Poll slice state (idle/slicing/done/error), progress percent, and result (print time, filament, layers).',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_get_status', {}));

  // ── Slicer: printer + material settings ───────────────────────────────────
  server.registerTool('slicer_get_printer_settings', {
    title: 'Get Printer Settings',
    description: 'Return key active printer profile fields: build volume, nozzle, filament diameter, G-code flavor, speed/temp limits.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_get_printer_settings', {}));

  server.registerTool('slicer_set_printer_setting', {
    title: 'Set Printer Setting',
    description: 'Update one field in the active printer profile (e.g. "nozzleDiameter", "gcodeFlavorType").',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      key: { type: 'string', description: 'Printer profile field name' },
      value: { type: 'string', description: 'New value as JSON' },
    }),
  }, ({ key, value }: { key: string; value: string }) => {
    let parsed: unknown = value;
    try { parsed = JSON.parse(value); } catch { /* keep string */ }
    return relayTool(relay, 'slicer_set_printer_setting', { key, value: parsed });
  });

  server.registerTool('slicer_get_material_settings', {
    title: 'Get Material Settings',
    description: 'Return active material profile: nozzle/bed temperatures, fan speeds, retraction, flow rate, density, cost.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_get_material_settings', {}));

  server.registerTool('slicer_set_material_setting', {
    title: 'Set Material Setting',
    description: 'Update one field in the active material profile (e.g. "nozzleTemp", "bedTemp", "retractionDistance").',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      key: { type: 'string', description: 'Material profile field name' },
      value: { type: 'string', description: 'New value as JSON' },
    }),
  }, ({ key, value }: { key: string; value: string }) => {
    let parsed: unknown = value;
    try { parsed = JSON.parse(value); } catch { /* keep string */ }
    return relayTool(relay, 'slicer_set_material_setting', { key, value: parsed });
  });

  // ── Slicer: plate transforms ──────────────────────────────────────────────
  server.registerTool('slicer_transform_plate_object', {
    title: 'Transform Plate Object',
    description: 'Move, rotate, or scale a plate object. All position/rotation/scale axes are optional.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      id: { type: 'string', description: 'Plate object ID' },
      x: { type: 'number', description: 'Position X mm (optional)' },
      y: { type: 'number', description: 'Position Y mm (optional)' },
      z: { type: 'number', description: 'Position Z mm (optional)' },
      rotX: { type: 'number', description: 'Rotation X degrees (optional)' },
      rotY: { type: 'number', description: 'Rotation Y degrees (optional)' },
      rotZ: { type: 'number', description: 'Rotation Z degrees (optional)' },
      scaleX: { type: 'number', description: 'Scale X (optional, 1=100%)' },
      scaleY: { type: 'number', description: 'Scale Y (optional)' },
      scaleZ: { type: 'number', description: 'Scale Z (optional)' },
    }),
  }, (args: Record<string, unknown>) => relayTool(relay, 'slicer_transform_plate_object', args));

  server.registerTool('slicer_auto_orient_object', {
    title: 'Auto-orient Plate Object',
    description: 'Auto-orient an object to minimise support material.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({ id: { type: 'string', description: 'Plate object ID' } }),
  }, ({ id }: { id: string }) => relayTool(relay, 'slicer_auto_orient_object', { id }));

  server.registerTool('slicer_drop_to_bed', {
    title: 'Drop Plate Object to Bed',
    description: 'Drop an object so its lowest face rests on Z=0.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({ id: { type: 'string', description: 'Plate object ID' } }),
  }, ({ id }: { id: string }) => relayTool(relay, 'slicer_drop_to_bed', { id }));

  server.registerTool('slicer_center_object', {
    title: 'Centre Plate Object',
    description: 'Centre an object in XY on the build plate.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({ id: { type: 'string', description: 'Plate object ID' } }),
  }, ({ id }: { id: string }) => relayTool(relay, 'slicer_center_object', { id }));

  server.registerTool('slicer_scale_to_height', {
    title: 'Scale Plate Object to Height',
    description: 'Uniformly scale an object so its Z height equals the target.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      id: { type: 'string', description: 'Plate object ID' },
      targetHeight: { type: 'number', description: 'Target height mm' },
    }),
  }, ({ id, targetHeight }: { id: string; targetHeight: number }) => relayTool(relay, 'slicer_scale_to_height', { id, targetHeight }));

  server.registerTool('slicer_auto_arrange', {
    title: 'Auto-arrange Plate',
    description: 'Auto-arrange all plate objects to fit the build volume with minimal overlap.',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_auto_arrange', {}));

  server.registerTool('slicer_remove_plate_object', {
    title: 'Remove Plate Object',
    description: 'Remove one object from the build plate.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({ id: { type: 'string', description: 'Plate object ID' } }),
  }, ({ id }: { id: string }) => relayTool(relay, 'slicer_remove_plate_object', { id }));

  // ── Slicer: per-object settings + utilities ───────────────────────────────
  server.registerTool('slicer_set_per_object_setting', {
    title: 'Set Per-object Setting',
    description: 'Override a print setting for one plate object (e.g. infillDensity, wallCount, supportEnabled). Other objects keep global values.',
    annotations: { readOnlyHint: false, openWorldHint: false },
    inputSchema: mcpInputSchema({
      id: { type: 'string', description: 'Plate object ID' },
      key: { type: 'string', description: 'Print profile field to override' },
      value: { type: 'string', description: 'New value as JSON' },
    }),
  }, ({ id, key, value }: { id: string; key: string; value: string }) => {
    let parsed: unknown = value;
    try { parsed = JSON.parse(value); } catch { /* keep string */ }
    return relayTool(relay, 'slicer_set_per_object_setting', { id, key, value: parsed });
  });

  server.registerTool('slicer_run_printability_check', {
    title: 'Run Printability Check',
    description: 'Analyse the plate for overhangs, thin walls, and mesh issues. Results appear in the slicer overlay.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_run_printability_check', {}));

  server.registerTool('slicer_download_gcode', {
    title: 'Download G-code',
    description: 'Trigger a browser download of the sliced G-code. Requires a completed slice.',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_download_gcode', {}));

  // ── Camera tools ──────────────────────────────────────────────────────────
  server.registerTool('slicer_set_camera_preset', {
    title: 'Set Camera Preset',
    description: 'Snap the slicer viewport camera to a preset angle.',
    inputSchema: { preset: z.enum(['iso', 'top', 'front', 'right']).describe('Camera preset') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ preset }) => relayTool(relay, 'slicer_set_camera_preset', { preset }));

  server.registerTool('slicer_fit_to_plate', {
    title: 'Fit Camera to Plate',
    description: 'Frame the camera to show all objects currently on the build plate.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_fit_to_plate', {}));

  server.registerTool('slicer_focus_object', {
    title: 'Focus Object',
    description: 'Frame the camera to show a single plate object by ID.',
    inputSchema: { id: z.string().describe('Plate object ID from slicer_list_plate_objects') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ id }) => relayTool(relay, 'slicer_focus_object', { id }));

  // ── Preview / layer control ───────────────────────────────────────────────
  server.registerTool('slicer_set_preview_mode', {
    title: 'Set Preview Mode',
    description: "Switch the viewport between 3D model view ('model') and G-code layer preview ('preview').",
    inputSchema: { mode: z.enum(['model', 'preview']).describe('Viewport mode') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ mode }) => relayTool(relay, 'slicer_set_preview_mode', { mode }));

  server.registerTool('slicer_set_preview_layer', {
    title: 'Set Preview Layer',
    description: 'Set the active layer shown in the G-code layer preview. Mode must be preview.',
    inputSchema: { layer: z.number().describe('Layer index (0-based, clamped to total layer count)') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ layer }) => relayTool(relay, 'slicer_set_preview_layer', { layer }));

  server.registerTool('slicer_set_preview_layer_range', {
    title: 'Set Preview Layer Range',
    description: 'Set the start and end layers of the range shown in the G-code preview.',
    inputSchema: {
      start: z.number().describe('Start layer index'),
      end: z.number().describe('End layer index'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ start, end }) => relayTool(relay, 'slicer_set_preview_layer_range', { start, end }));

  // ── Plate history ─────────────────────────────────────────────────────────
  server.registerTool('slicer_undo', {
    title: 'Undo Plate Operation',
    description: 'Undo the last plate operation (move, rotate, scale, add, remove, etc.).',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_undo', {}));

  server.registerTool('slicer_redo', {
    title: 'Redo Plate Operation',
    description: 'Redo the previously undone plate operation.',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_redo', {}));

  server.registerTool('slicer_duplicate_plate_object', {
    title: 'Duplicate Plate Object',
    description: 'Duplicate a plate object and place the copy offset from the original.',
    inputSchema: { id: z.string().describe('Plate object ID to duplicate') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ id }) => relayTool(relay, 'slicer_duplicate_plate_object', { id }));

  // ── Selection ─────────────────────────────────────────────────────────────
  server.registerTool('slicer_select_plate_object', {
    title: 'Select Plate Object',
    description: 'Set the active selection to one plate object. Pass "null" to deselect all.',
    inputSchema: { id: z.string().describe('Plate object ID, or "null" to clear selection') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ id }) => relayTool(relay, 'slicer_select_plate_object', { id }));

  server.registerTool('slicer_clear_selection', {
    title: 'Clear Plate Selection',
    description: 'Deselect all plate objects.',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_clear_selection', {}));

  server.registerTool('slicer_get_selection', {
    title: 'Get Plate Selection',
    description: 'Return the IDs of all currently selected plate objects.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_get_selection', {}));

  server.registerTool('slicer_duplicate_selected', {
    title: 'Duplicate Selected Objects',
    description: 'Duplicate all currently selected plate objects.',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_duplicate_selected', {}));

  // ── Object properties ─────────────────────────────────────────────────────
  server.registerTool('slicer_set_object_locked', {
    title: 'Lock/Unlock Plate Object',
    description: 'Lock or unlock a plate object to prevent accidental moves.',
    inputSchema: {
      id: z.string().describe('Plate object ID'),
      locked: z.string().describe('"true" or "false"'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ id, locked }) => relayTool(relay, 'slicer_set_object_locked', { id, locked }));

  server.registerTool('slicer_set_object_hidden', {
    title: 'Hide/Show Plate Object',
    description: 'Hide or show a plate object. Hidden objects are excluded from slicing.',
    inputSchema: {
      id: z.string().describe('Plate object ID'),
      hidden: z.string().describe('"true" or "false"'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ id, hidden }) => relayTool(relay, 'slicer_set_object_hidden', { id, hidden }));

  server.registerTool('slicer_set_object_color', {
    title: 'Set Object Color',
    description: 'Set a per-object color override. Pass empty string to reset to default.',
    inputSchema: {
      id: z.string().describe('Plate object ID'),
      color: z.string().describe('CSS color string (e.g. "#ff4400") or empty string to reset'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ id, color }) => relayTool(relay, 'slicer_set_object_color', { id, color }));

  // ── Plate operations ──────────────────────────────────────────────────────
  server.registerTool('slicer_clear_plate', {
    title: 'Clear Build Plate',
    description: 'Remove all objects from the build plate.',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_clear_plate', {}));

  server.registerTool('slicer_resolve_overlaps', {
    title: 'Resolve Overlaps',
    description: 'Nudge a plate object to eliminate collisions with other objects.',
    inputSchema: { id: z.string().describe('Plate object ID') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ id }) => relayTool(relay, 'slicer_resolve_overlaps', { id }));

  // ── Geometry tools ────────────────────────────────────────────────────────
  server.registerTool('slicer_hollow_object', {
    title: 'Hollow Object',
    description: 'Shell a plate object, leaving only walls of the specified thickness.',
    inputSchema: {
      id: z.string().describe('Plate object ID'),
      wallThickness: z.number().describe('Wall thickness mm'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ id, wallThickness }) => relayTool(relay, 'slicer_hollow_object', { id, wallThickness }));

  server.registerTool('slicer_cut_object_by_plane', {
    title: 'Cut Object by Plane',
    description: 'Split a plate object at a plane. Use axis + offset for simple cuts, or pointX/Y/Z + normalX/Y/Z for arbitrary planes.',
    inputSchema: {
      id: z.string().describe('Plate object ID'),
      axis: z.enum(['X', 'Y', 'Z']).optional().describe('Shorthand axis for the cut normal'),
      offset: z.number().optional().describe('Plane offset along the axis mm'),
      pointX: z.number().optional(), pointY: z.number().optional(), pointZ: z.number().optional(),
      normalX: z.number().optional(), normalY: z.number().optional(), normalZ: z.number().optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, (args) => relayTool(relay, 'slicer_cut_object_by_plane', args as Record<string, unknown>));

  // ── Preview visualization ─────────────────────────────────────────────────
  server.registerTool('slicer_set_preview_color_mode', {
    title: 'Set Preview Color Mode',
    description: 'Set the G-code preview color scheme.',
    inputSchema: { mode: z.enum(['type', 'speed', 'flow', 'width', 'layer-time', 'wall-quality', 'seam']).describe('Color mode') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ mode }) => relayTool(relay, 'slicer_set_preview_color_mode', { mode }));

  server.registerTool('slicer_set_preview_render_mode', {
    title: 'Set Preview Render Mode',
    description: "Switch the G-code preview between solid and wireframe.",
    inputSchema: { mode: z.enum(['solid', 'wireframe']).describe('Render mode') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ mode }) => relayTool(relay, 'slicer_set_preview_render_mode', { mode }));

  server.registerTool('slicer_set_preview_show_travel', {
    title: 'Show/Hide Travel Moves',
    description: 'Show or hide travel move lines in the G-code preview.',
    inputSchema: { show: z.string().describe('"true" or "false"') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ show }) => relayTool(relay, 'slicer_set_preview_show_travel', { show }));

  server.registerTool('slicer_set_preview_show_retractions', {
    title: 'Show/Hide Retraction Markers',
    description: 'Show or hide retraction/prime markers in the G-code preview.',
    inputSchema: { show: z.string().describe('"true" or "false"') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ show }) => relayTool(relay, 'slicer_set_preview_show_retractions', { show }));

  server.registerTool('slicer_toggle_preview_feature_type', {
    title: 'Toggle Preview Feature Type',
    description: 'Toggle visibility of a specific feature type in the G-code preview.',
    inputSchema: {
      type: z.enum(['wall-outer', 'wall-inner', 'gap-fill', 'infill', 'top-bottom', 'support', 'skirt', 'brim', 'raft', 'bridge', 'ironing']).describe('Feature type'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ type }) => relayTool(relay, 'slicer_toggle_preview_feature_type', { type }));

  server.registerTool('slicer_set_section_plane', {
    title: 'Set Section Plane',
    description: 'Control the cross-section clipping plane in the slicer viewport.',
    inputSchema: {
      enabled: z.string().describe('"true" or "false"'),
      z: z.number().optional().describe('Section plane Z height mm'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ enabled, z: zVal }) => relayTool(relay, 'slicer_set_section_plane', { enabled, z: zVal }));

  // ── Nozzle simulation ─────────────────────────────────────────────────────
  server.registerTool('slicer_set_sim_enabled', {
    title: 'Enable/Disable Nozzle Simulation',
    description: 'Enable or disable the nozzle travel simulation overlay.',
    inputSchema: { enabled: z.string().describe('"true" or "false"') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ enabled }) => relayTool(relay, 'slicer_set_sim_enabled', { enabled }));

  server.registerTool('slicer_set_sim_playing', {
    title: 'Play/Pause Simulation',
    description: 'Play or pause the nozzle simulation.',
    inputSchema: { playing: z.string().describe('"true" or "false"') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ playing }) => relayTool(relay, 'slicer_set_sim_playing', { playing }));

  server.registerTool('slicer_set_sim_time', {
    title: 'Scrub Simulation Time',
    description: 'Scrub the nozzle simulation to a specific elapsed time in seconds.',
    inputSchema: { time: z.number().describe('Elapsed time seconds') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ time }) => relayTool(relay, 'slicer_set_sim_time', { time }));

  server.registerTool('slicer_set_sim_speed', {
    title: 'Set Simulation Speed',
    description: 'Set the nozzle simulation playback speed multiplier.',
    inputSchema: { speed: z.number().describe('Speed multiplier (1 = real-time, 10 = 10× faster)') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ speed }) => relayTool(relay, 'slicer_set_sim_speed', { speed }));

  // ── Analytics ─────────────────────────────────────────────────────────────
  server.registerTool('slicer_get_slice_stats', {
    title: 'Get Slice Statistics',
    description: 'Return per-feature filament/time breakdown and detected print quality issues. Requires a completed slice.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'slicer_get_slice_stats', {}));

  // ── Physical printer machine control ─────────────────────────────────────
  server.registerTool('printer_get_status', {
    title: 'Get Printer Status',
    description: 'Return live machine status: connection state, temperatures, axis positions, active job progress, speed factor, and fan speeds.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'printer_get_status', {}));

  server.registerTool('printer_connect', {
    title: 'Connect to Printer',
    description: 'Connect to the active printer using its saved configuration.',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'printer_connect', {}));

  server.registerTool('printer_disconnect', {
    title: 'Disconnect Printer',
    description: 'Disconnect from the active printer.',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'printer_disconnect', {}));

  server.registerTool('printer_send_gcode', {
    title: 'Send G-code',
    description: 'Send a raw G-code command to the printer and return the response.',
    inputSchema: { code: z.string().describe('G-code command (e.g. "M114" or "G28 X Y")') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ code }) => relayTool(relay, 'printer_send_gcode', { code }));

  server.registerTool('printer_set_tool_temp', {
    title: 'Set Tool Temperature',
    description: 'Set the active temperature for a tool heater.',
    inputSchema: {
      tool: z.number().describe('Tool index (0-based)'),
      heater: z.number().describe('Heater index within the tool (usually 0)'),
      temp: z.number().describe('Active temperature °C'),
      standby: z.number().optional().describe('Standby temperature °C'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ tool, heater, temp, standby }) => relayTool(relay, 'printer_set_tool_temp', { tool, heater, temp, standby }));

  server.registerTool('printer_set_bed_temp', {
    title: 'Set Bed Temperature',
    description: 'Set the heated bed target temperature.',
    inputSchema: { temp: z.number().describe('Target temperature °C (0 = off)') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ temp }) => relayTool(relay, 'printer_set_bed_temp', { temp }));

  server.registerTool('printer_set_chamber_temp', {
    title: 'Set Chamber Temperature',
    description: 'Set the chamber heater target temperature.',
    inputSchema: { temp: z.number().describe('Target temperature °C (0 = off)') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ temp }) => relayTool(relay, 'printer_set_chamber_temp', { temp }));

  server.registerTool('printer_home_axes', {
    title: 'Home Axes',
    description: 'Home one or more axes. Omit axes to home all.',
    inputSchema: {
      axes: z.array(z.string()).optional().describe('Axes to home, e.g. ["X","Y","Z"]. Omit to home all.'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ axes }) => relayTool(relay, 'printer_home_axes', { axes }));

  server.registerTool('printer_move_axis', {
    title: 'Move Axis',
    description: 'Jog an axis by a relative distance.',
    inputSchema: {
      axis: z.string().describe('Axis letter (X, Y, Z, E, etc.)'),
      distance: z.number().describe('Distance mm (negative = opposite direction)'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ axis, distance }) => relayTool(relay, 'printer_move_axis', { axis, distance }));

  server.registerTool('printer_extrude', {
    title: 'Extrude / Retract',
    description: 'Extrude or retract filament on the active tool.',
    inputSchema: {
      amount: z.number().describe('Amount mm (negative = retract)'),
      feedrate: z.number().describe('Feed rate mm/min'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ amount, feedrate }) => relayTool(relay, 'printer_extrude', { amount, feedrate }));

  server.registerTool('printer_set_baby_step', {
    title: 'Set Baby Step',
    description: 'Apply a live Z baby-step offset (M290).',
    inputSchema: { offset: z.number().describe('Z offset mm') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ offset }) => relayTool(relay, 'printer_set_baby_step', { offset }));

  server.registerTool('printer_set_speed_factor', {
    title: 'Set Speed Factor',
    description: 'Set the global print speed override percentage (M220). 100 = normal speed.',
    inputSchema: { percent: z.number().describe('Speed percentage (e.g. 80 for 80%)') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ percent }) => relayTool(relay, 'printer_set_speed_factor', { percent }));

  server.registerTool('printer_set_flow_factor', {
    title: 'Set Flow Factor',
    description: 'Set the extrusion flow factor (M221). Use extruder=-1 for a global override.',
    inputSchema: {
      extruder: z.number().describe('Extruder index (0-based), or -1 for global'),
      percent: z.number().describe('Flow percentage (e.g. 100 for 100%)'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ extruder, percent }) => relayTool(relay, 'printer_set_flow_factor', { extruder, percent }));

  server.registerTool('printer_set_fan_speed', {
    title: 'Set Fan Speed',
    description: 'Set a fan speed (0.0 = off, 1.0 = full).',
    inputSchema: {
      fan: z.number().describe('Fan index'),
      speed: z.number().describe('Speed 0.0–1.0'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ fan, speed }) => relayTool(relay, 'printer_set_fan_speed', { fan, speed }));

  server.registerTool('printer_start_print', {
    title: 'Start Print',
    description: 'Start printing a G-code file from the printer SD card.',
    inputSchema: { filename: z.string().describe('Full SD path, e.g. "0:/gcodes/benchy.gcode"') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ filename }) => relayTool(relay, 'printer_start_print', { filename }));

  server.registerTool('printer_pause_print', {
    title: 'Pause Print',
    description: 'Pause the current print (M25).',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'printer_pause_print', {}));

  server.registerTool('printer_resume_print', {
    title: 'Resume Print',
    description: 'Resume a paused print (M24).',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'printer_resume_print', {}));

  server.registerTool('printer_cancel_print', {
    title: 'Cancel Print',
    description: 'Cancel the current print and stop all movement (M0).',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'printer_cancel_print', {}));

  server.registerTool('printer_emergency_stop', {
    title: 'Emergency Stop',
    description: 'Immediately halt all motion and heaters (M112). Use only in emergencies.',
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, () => relayTool(relay, 'printer_emergency_stop', {}));

  server.registerTool('printer_list_printers', {
    title: 'List Printers',
    description: 'List configured printers and identify the active printer.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'printer_list_printers', {}));

  server.registerTool('printer_select_printer', {
    title: 'Select Printer',
    description: 'Switch the active printer by printer ID before running printer-specific tools.',
    inputSchema: {
      id: z.string().describe('Printer ID from printer_list_printers.'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ id }) => relayTool(relay, 'printer_select_printer', { id }));

  server.registerTool('printer_list_files', {
    title: 'List Printer Files',
    description: "List G-code files on the printer's SD card.",
    inputSchema: {
      directory: z.string().optional().describe('Directory path (default: "0:/gcodes")'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ directory }) => relayTool(relay, 'printer_list_files', { directory }));

  server.registerTool('printer_delete_file', {
    title: 'Delete Printer File',
    description: "Delete a file from the printer's SD card.",
    inputSchema: { path: z.string().describe('Full file path on SD card') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ path }) => relayTool(relay, 'printer_delete_file', { path }));

  server.registerTool('printer_list_macros', {
    title: 'List Macros',
    description: 'List available macros from the printer macro directory.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => relayTool(relay, 'printer_list_macros', {}));

  server.registerTool('printer_run_macro', {
    title: 'Run Macro',
    description: 'Execute a macro file on the printer.',
    inputSchema: { filename: z.string().describe('Macro filename (without path prefix)') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ filename }) => relayTool(relay, 'printer_run_macro', { filename }));

  server.registerTool('printer_load_filament', {
    title: 'Load Filament',
    description: 'Load a filament profile on a tool (runs the load macro).',
    inputSchema: {
      tool: z.number().describe('Tool index'),
      name: z.string().describe('Filament name from 0:/filaments/'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ tool, name }) => relayTool(relay, 'printer_load_filament', { tool, name }));

  server.registerTool('printer_unload_filament', {
    title: 'Unload Filament',
    description: 'Unload filament from a tool (runs the unload macro).',
    inputSchema: { tool: z.number().describe('Tool index') },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, ({ tool }) => relayTool(relay, 'printer_unload_filament', { tool }));

  // ── Vision / AI print monitoring ─────────────────────────────────────────
  server.registerTool('vision_check_print', {
    title: 'Check Print With Vision',
    description: 'Capture a camera frame, combine it with printer telemetry and slicer geometry, and classify likely print failures.',
    inputSchema: {
      cameraId: z.string().optional().describe('Optional camera ID. Defaults to the active camera.'),
      confidenceThreshold: z.number().optional().describe('Failure confidence threshold from 0 to 1. Defaults to 0.82.'),
      autoPauseEnabled: z.boolean().optional().describe('Pause when confidence is above threshold. Defaults to false.'),
      requireUserConfirmation: z.boolean().optional().describe('Require confirmation before auto-pause. Defaults to true.'),
      saveSettings: z.boolean().optional().describe('Persist the supplied threshold and auto-pause settings.'),
      confirmAutoAction: z.boolean().optional().describe('Set true only after the user confirms the suggested auto-pause.'),
      notes: z.string().optional().describe('Optional operator notes to include in the diagnosis context.'),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, (args) => relayTool(relay, 'vision_check_print', args as Record<string, unknown>));

  server.registerTool('diagnose_print', {
    title: 'Diagnose Print',
    description: 'Diagnose the active print from recent camera frames, printer telemetry, filament state, and slicer expected-vs-actual layer timing.',
    inputSchema: {
      cameraId: z.string().optional().describe('Optional camera ID. Defaults to the active camera.'),
      frameCount: z.number().optional().describe('Number of recent frames to include, 1 to 5. Defaults to 3.'),
      notes: z.string().optional().describe('Optional operator notes to include in the diagnosis context.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, (args) => relayTool(relay, 'diagnose_print', args as Record<string, unknown>));

  server.registerTool('tuning_analyze_tower', {
    title: 'Analyze Tuning Tower',
    description: 'Analyze calibration tower camera frames and recommend tuning values without applying them.',
    inputSchema: {
      kind: z.enum(['pressure-advance', 'retraction', 'temperature', 'first-layer-squish', 'input-shaper']).describe('Tuning wizard kind.'),
      cameraId: z.string().optional().describe('Optional camera ID. Defaults to the active camera.'),
      frameCount: z.number().optional().describe('Number of recent frames to include, 1 to 5. Defaults to 3.'),
      startValue: z.number().optional().describe('Tower start value, when applicable.'),
      stepPerMm: z.number().optional().describe('Tower setting increment per mm, when applicable.'),
      towerHeightMm: z.number().optional().describe('Visible/measured tower height in mm, when applicable.'),
      axis: z.enum(['X', 'Y']).optional().describe('Axis for input shaper analysis.'),
      notes: z.string().optional().describe('Optional operator notes to include in the tuning analysis.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, (args) => relayTool(relay, 'tuning_analyze_tower', args as Record<string, unknown>));

  // ── Phase 3: Resources ────────────────────────────────────────────────────
  server.resource('document_summary', 'cindr3d://document/summary', {
    title: 'Document Summary',
    description: 'Name, units, object count, and plate state of the active document.',
    mimeType: 'application/json',
  }, () => relay.call('resource_document_summary', {}).then((r) => ({
    contents: [{ uri: 'cindr3d://document/summary', text: typeof r === 'string' ? r : JSON.stringify(r, null, 2), mimeType: 'application/json' }],
  })));

  server.resource('document_objects', 'cindr3d://document/objects', {
    title: 'Document Objects',
    description: 'Full object list for the active document as JSON.',
    mimeType: 'application/json',
  }, () => relay.call('resource_document_objects', {}).then((r) => ({
    contents: [{ uri: 'cindr3d://document/objects', text: typeof r === 'string' ? r : JSON.stringify(r, null, 2), mimeType: 'application/json' }],
  })));

  server.resource(
    'document_feature',
    new ResourceTemplate('cindr3d://document/feature/{id}', { list: undefined }),
    {
      title: 'Feature Tree',
      description: 'Full feature tree for a single object by ID — params, sketch entities, dimensions, face IDs, and bounding box.',
      mimeType: 'application/json',
    },
    (uri, variables) => relay.call('resource_feature_tree', { id: variables['id'] as string }).then((r) => ({
      contents: [{ uri: uri.href, text: typeof r === 'string' ? r : JSON.stringify(r, null, 2), mimeType: 'application/json' }],
    })),
  );

  server.resource('active_printer', 'cindr3d://printer/active', {
    title: 'Active Printer',
    description: 'Selected printer and machine config (helps the model choose build-volume-appropriate sizes).',
    mimeType: 'application/json',
  }, () => relay.call('resource_active_printer', {}).then((r) => ({
    contents: [{ uri: 'cindr3d://printer/active', text: typeof r === 'string' ? r : JSON.stringify(r, null, 2), mimeType: 'application/json' }],
  })));

  return server;
}

function cindr3dMcpPlugin(): Plugin {
  let token = crypto.randomBytes(18).toString('base64url');
  let lastHeartbeat = 0;
  let mcpHttpServer: http.Server | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const sessions: Record<string, McpTransportSession> = {};
  const port = Number.parseInt(process.env.CINDR3D_MCP_PORT ?? '', 10) || MCP_DEFAULT_PORT;
  const endpoint = `http://localhost:${port}/mcp`;
  const relay = new BrowserRelay();

  const pairingLine = () => `claude mcp add cindr3d ${endpoint}?token=${token}`;

  const closeSessions = async () => {
    const entries = Object.entries(sessions);
    for (const [sessionId, session] of entries) {
      delete sessions[sessionId];
      await session.transport.close().catch(() => undefined);
      await session.server.close().catch(() => undefined);
    }
  };

  const stopMcpServer = async () => {
    relay.closeAll();
    await closeSessions();
    const serverToClose = mcpHttpServer;
    mcpHttpServer = null;
    if (!serverToClose) return;
    await new Promise<void>((resolve) => serverToClose.close(() => resolve()));
  };

  const authorize = (req: http.IncomingMessage, parsedUrl: URL, res: http.ServerResponse): boolean => {
    if (!isLocalhostHost(req.headers.host)) {
      sendJson(res, 403, { error: 'MCP server only accepts localhost hosts.' });
      return false;
    }
    if (!isAllowedLocalOrigin(req.headers.origin)) {
      sendJson(res, 403, { error: 'MCP server only accepts localhost origins.' });
      return false;
    }
    const bearerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (parsedUrl.searchParams.get('token') !== token && bearerToken !== token) {
      sendJson(res, 401, { error: 'Missing or invalid Cindr3D MCP pairing token.' });
      return false;
    }
    return true;
  };

  const handleMcpRequest = async (req: JsonBodyRequest, res: http.ServerResponse) => {
    const parsedUrl = new URL(req.url ?? '/', endpoint);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (!authorize(req, parsedUrl, res)) return;
    if (parsedUrl.pathname !== '/mcp') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    try {
      if (req.method === 'POST') {
        req.body = await readJsonBody(req);
      }
      const sessionId = req.headers['mcp-session-id'];
      const sessionKey = Array.isArray(sessionId) ? sessionId[0] : sessionId;
      if (sessionKey && sessions[sessionKey]) {
        await sessions[sessionKey].transport.handleRequest(req, res, req.body);
        return;
      }
      if (req.method === 'POST' && !sessionKey && isInitializeRequest(req.body)) {
        const server = createCindr3dMcpServer(relay);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (newSessionId) => {
            sessions[newSessionId] = { server, transport };
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) delete sessions[sid];
        };
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }
      sendJson(res, 400, { error: 'Invalid or missing MCP session.' });
    } catch (error) {
      console.error('[cindr3d-mcp] request failed:', error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal MCP server error.' });
      else res.end();
    }
  };

  const startMcpServer = async () => {
    lastHeartbeat = Date.now();
    if (mcpHttpServer) return;
    mcpHttpServer = http.createServer((req, res) => {
      const origin = req.headers.origin;
      if (isAllowedLocalOrigin(origin)) {
        res.setHeader('access-control-allow-origin', origin ?? 'http://localhost:5173');
        res.setHeader('vary', 'origin');
      }
      res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type,mcp-session-id,last-event-id,authorization');
      void handleMcpRequest(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      mcpHttpServer?.once('error', reject);
      mcpHttpServer?.listen(port, '127.0.0.1', () => resolve());
    });
    console.info(`[cindr3d-mcp] listening at ${endpoint}`);
  };

  const controlResponse = () => ({
    running: Boolean(mcpHttpServer?.listening),
    endpoint,
    pairingLine: pairingLine(),
    port,
  });

  return {
    name: 'cindr3d-mcp',
    apply: 'serve',
    configureServer(server) {
      heartbeatTimer = setInterval(() => {
        if (mcpHttpServer && Date.now() - lastHeartbeat > MCP_HEARTBEAT_TIMEOUT_MS) {
          void stopMcpServer();
        }
      }, 5_000);
      server.middlewares.use('/mcp-control', async (req, res) => {
        const parsedUrl = new URL(req.url ?? '/', 'http://localhost/mcp-control');
        const action = parsedUrl.pathname.replace(/^\//, '') || 'status';

        // Browser relay: GET /mcp-control/relay → SSE stream of tool calls
        if (action === 'relay' && req.method === 'GET') {
          await startMcpServer();
          relay.addConnection(res);
          return;
        }

        // Browser relay: POST /mcp-control/relay-result → resolve a pending tool call
        if (action === 'relay-result' && req.method === 'POST') {
          try {
            const body = await readJsonBody(req) as { callId: string; result?: unknown; error?: string };
            if (body.error) relay.rejectCall(body.callId, body.error);
            else relay.resolveCall(body.callId, body.result);
            sendJson(res, 200, { ok: true });
          } catch {
            sendJson(res, 400, { error: 'Bad relay-result body.' });
          }
          return;
        }

        try {
          if (action === 'start' || action === 'heartbeat') await startMcpServer();
          else if (action === 'audit') {
            sendJson(res, 200, { entries: relay.getAudit() });
            return;
          } else if (action === 'clear-audit') {
            relay.clearAudit();
            sendJson(res, 200, { ok: true });
            return;
          }
          else if (action === 'stop') await stopMcpServer();
          else if (action === 'rotate') {
            token = crypto.randomBytes(18).toString('base64url');
            await closeSessions();
            await startMcpServer();
          } else if (action !== 'status') {
            sendJson(res, 404, { error: 'Unknown MCP control action.' });
            return;
          }
          sendJson(res, 200, controlResponse());
        } catch (error) {
          console.error('[cindr3d-mcp] control request failed:', error);
          sendJson(res, 500, { error: (error as Error).message });
        }
      });
      server.httpServer?.once('close', () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        void stopMcpServer();
      });
    },
  };
}

// Strips the deprecation warn() from THREE.Clock so the console stays clean.
// react-three-fiber still uses THREE.Clock internally and cannot be configured
// to use THREE.Timer instead; removing just the warn() is the minimal fix.
function silenceThreeClockPlugin(): Plugin {
  return {
    name: 'silence-three-clock',
    transform(code, id) {
      if (!id.includes('three') || !code.includes('THREE.Clock:')) return null;
      // Remove the warn line:  warn( 'THREE.Clock: This module has been deprecated...' );
      return {
        code: code.replace(/warn\s*\(\s*['"]THREE\.Clock:[^'"]*['"]\s*\);?/g, ''),
        map: null,
      };
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [silenceThreeClockPlugin(), react(), wasm(), duetProxyPlugin(), cameraProxyPlugin(), rtspHlsBridgePlugin(), rtspRecordingPlugin(), githubProxyPlugin(), cindr3dMcpPlugin(), noCacheDevAssetsPlugin()],
  resolve: {
    alias: {
      module: fileURLToPath(new URL('./src/shims/nodeModule.ts', import.meta.url)),
    },
  },
  build: {
    // Disable CSS minification — lightningcss crashes on @keyframes in
    // some versions of the Vite 8 / rolldown stack.
    cssMinify: false,
    chunkSizeWarningLimit: 4096,
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
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    strictPort: false,
    // Bind all interfaces so the dev server is reachable from desktop
    // browsers when it's running on a Pi / Orange Pi over the LAN.
    host: true,
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
