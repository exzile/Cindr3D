import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const imageName = process.env.WASM_DOCKER_IMAGE ?? 'cindr3d-wasm';
const expectedArtifacts = [
  'wasm/dist/clipper2.js',
  'wasm/dist/clipper2.wasm',
  'wasm/dist/clipper2.d.ts',
  'wasm/dist/voronoi.js',
  'wasm/dist/voronoi.wasm',
  'wasm/dist/voronoi.d.ts',
];
const dryRun = process.argv.includes('--dry-run');

function run(command, args, options = {}) {
  const printable = [command, ...args].join(' ');
  console.log(`$ ${printable}`);
  if (dryRun) return;

  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function assertExists(path) {
  if (!existsSync(join(repoRoot, path))) {
    console.error(`Missing expected WASM build artifact: ${path}`);
    process.exit(1);
  }
}

if (!existsSync(join(repoRoot, 'wasm/Dockerfile')) || !existsSync(join(repoRoot, 'wasm/build.sh'))) {
  console.error('Missing wasm/Dockerfile or wasm/build.sh; cannot verify reproducible WASM build.');
  process.exit(1);
}

run('docker', ['build', '-t', imageName, '-f', 'wasm/Dockerfile', 'wasm']);
run('docker', [
  'run',
  '--rm',
  '-v',
  `${repoRoot.replaceAll('\\', '/')}:/repo`,
  '-w',
  '/repo',
  imageName,
  'bash',
  'wasm/build.sh',
]);

for (const artifact of expectedArtifacts) {
  assertExists(artifact);
}

run('npm', ['run', 'check:wasm-budget']);

if (dryRun) {
  console.log('Dry run complete.');
  process.exit(0);
}

const status = spawnSync('git', ['status', '--porcelain', '--', 'wasm/dist'], {
  cwd: repoRoot,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
if (status.status !== 0) {
  process.stderr.write(status.stderr);
  process.exit(status.status ?? 1);
}

if (status.stdout.trim().length > 0) {
  console.error('WASM build artifacts are not reproducible. Commit the regenerated wasm/dist outputs.');
  console.error(status.stdout.trim());
  process.exit(1);
}

for (const artifact of expectedArtifacts) {
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', artifact], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (tracked.status !== 0) {
    console.error(`WASM build artifact is not tracked by git: ${artifact}`);
    console.error('Commit wasm/dist outputs so CI can verify reproducible checked-in artifacts.');
    process.exit(1);
  }
}

console.log('WASM build artifacts are reproducible.');
