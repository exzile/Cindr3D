#!/usr/bin/env node
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const config = {
  repo: process.env.DESIGNCAD_REPO ?? 'exzile/DesignCAD',
  port: Number(process.env.DESIGNCAD_UPDATER_PORT ?? 8787),
  host: process.env.DESIGNCAD_UPDATER_HOST ?? '127.0.0.1',
  webRoot: process.env.DESIGNCAD_WEB_ROOT ?? '/var/www/designcad',
  stateFile: process.env.DESIGNCAD_STATE_FILE ?? '/var/lib/designcad-updater/state.json',
  tokenFile: process.env.DESIGNCAD_TOKEN_FILE ?? '/etc/designcad-updater/token',
};

let installRunning = false;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function github(path, headers = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DesignCAD-Updater',
      ...headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub ${response.status}: ${detail}`);
  }
  return response.json();
}

async function latestRelease() {
  try {
    const release = await github(`/repos/${config.repo}/releases/latest`);
    const installableAsset = release.assets?.find((asset) =>
      /(designcad|dist|site).*\.(zip|tar\.gz|tgz)$/i.test(asset.name),
    );
    return {
      tag: release.tag_name,
      name: release.name ?? release.tag_name,
      publishedAt: release.published_at,
      hasInstallableAsset: Boolean(installableAsset),
      asset: installableAsset ? {
        name: installableAsset.name,
        url: installableAsset.browser_download_url,
      } : null,
    };
  } catch (err) {
    if (String(err).includes('GitHub 404')) return null;
    throw err;
  }
}

async function updateStatus() {
  const installed = await readJsonFile(config.stateFile, {});
  const release = await latestRelease();
  return {
    ok: true,
    repo: config.repo,
    installed,
    releaseUpdate: release ? {
      tag: release.tag,
      name: release.name,
      publishedAt: release.publishedAt,
      hasInstallableAsset: release.hasInstallableAsset,
      available: installed.releaseTag !== release.tag,
    } : null,
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(' ')} failed (${code})\n${stderr || stdout}`));
    });
  });
}

async function syncDist(distDir, installed) {
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error(`No index.html found in ${distDir}`);
  }
  const version = {
    ...installed,
    repo: config.repo,
    installedAt: new Date().toISOString(),
  };
  await writeFile(join(distDir, 'version.json'), `${JSON.stringify(version, null, 2)}\n`, 'utf8');
  await run('rsync', ['-a', '--delete', `${distDir}/`, `${config.webRoot}/`]);
  await run('chown', ['-R', 'www-data:www-data', config.webRoot]);
  await writeJsonFile(config.stateFile, version);
  return version;
}

async function download(url, destination) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'DesignCAD-Updater',
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, buffer);
}

async function installRelease() {
  const release = await latestRelease();
  if (!release) throw new Error('No GitHub release found.');
  if (!release.asset) {
    throw new Error('Latest release has no installable dist asset. Attach a designcad-dist.zip release asset.');
  }

  const workDir = await mkdtemp(join(tmpdir(), 'designcad-release-'));
  try {
    const archive = join(workDir, basename(release.asset.name));
    await download(release.asset.url, archive);
    const extractDir = join(workDir, 'extract');
    await mkdir(extractDir, { recursive: true });
    if (/\.zip$/i.test(archive)) {
      await run('unzip', ['-q', archive, '-d', extractDir]);
    } else {
      await run('tar', ['-xzf', archive, '-C', extractDir]);
    }
    const candidates = [extractDir, join(extractDir, 'dist'), join(extractDir, 'designcad-dist')];
    const distDir = candidates.find((candidate) => existsSync(join(candidate, 'index.html')));
    if (!distDir) throw new Error('Release asset did not contain index.html at the root or in dist/.');
    const installed = await syncDist(distDir, {
      channel: 'release',
      releaseTag: release.tag,
      releaseName: release.name,
    });
    return { ok: true, message: `Installed release ${release.tag}`, installed };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function requireToken(req) {
  const expected = (await readFile(config.tokenFile, 'utf8')).trim();
  const received = req.headers['x-designcad-updater-key'];
  if (!expected || received !== expected) {
    const error = new Error('Updater key is missing or invalid.');
    error.statusCode = 401;
    throw error;
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/status') {
      json(res, 200, await updateStatus());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/apply') {
      await requireToken(req);
      if (installRunning) {
        json(res, 409, { ok: false, error: 'An update is already running.' });
        return;
      }
      installRunning = true;
      try {
        const body = await readBody(req);
        if (body.channel && body.channel !== 'release') {
          json(res, 400, { ok: false, error: 'Only release updates are supported.' });
          return;
        }
        json(res, 200, await installRelease());
      } finally {
        installRunning = false;
      }
      return;
    }
    json(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    json(res, err.statusCode ?? 500, { ok: false, error: err.message ?? String(err) });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`DesignCAD updater listening on http://${config.host}:${config.port}`);
});
