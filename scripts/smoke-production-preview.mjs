import { createServer } from 'node:http';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(repoRoot, 'dist');
const configPath = path.join(distRoot, 'staticwebapp.config.json');

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json'],
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function findOpenCascadeAsset() {
  const assetsDir = path.join(distRoot, 'assets');
  const entries = await fs.readdir(assetsDir);
  const asset = entries.find((entry) => /^opencascade-.*\.js$/.test(entry));
  if (!asset) fail('Unable to find built OpenCascade JS asset in dist/assets.');
  return `/assets/${asset}`;
}

async function createStaticServer(headers) {
  const server = createServer(async (request, response) => {
    try {
      for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);

      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const requestedPath = decodeURIComponent(url.pathname);
      const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
      let filePath = path.resolve(distRoot, relativePath);

      if (!filePath.startsWith(distRoot)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      if (!existsSync(filePath) || (await fs.stat(filePath)).isDirectory()) {
        filePath = path.join(distRoot, 'index.html');
      }

      const ext = path.extname(filePath);
      response.setHeader('Content-Type', mimeTypes.get(ext) ?? 'application/octet-stream');
      response.writeHead(200);
      response.end(await fs.readFile(filePath));
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function run() {
  if (!existsSync(configPath)) fail('Missing dist/staticwebapp.config.json. Run npm run build before the smoke test.');

  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const headers = config.globalHeaders ?? {};
  const csp = headers['Content-Security-Policy'];
  if (typeof csp !== 'string') fail('Missing production Content-Security-Policy header in dist config.');

  const openCascadeAsset = await findOpenCascadeAsset();
  const server = await createStaticServer(headers);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const failures = [];

  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    failures.push(`request failed: ${request.url()} ${failure?.errorText ?? ''}`.trim());
  });

  try {
    await page.goto(`${origin}/design/`, { waitUntil: 'networkidle0', timeout: 60_000 });
    await page.evaluate(async (assetPath) => {
      await import(assetPath);
    }, openCascadeAsset);
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  const blockingFailures = failures.filter((failure) => /content security policy|unsafe-eval|evalerror|opencascade/i.test(failure));
  if (blockingFailures.length > 0) {
    fail(`Production preview smoke test failed:\n${blockingFailures.join('\n')}`);
  }

  console.log('Production preview smoke test passed.');
}

await run();
