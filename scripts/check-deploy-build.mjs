import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicConfigPath = path.join(repoRoot, 'public/staticwebapp.config.json');
const distConfigPath = path.join(repoRoot, 'dist/staticwebapp.config.json');
const legacyRootConfigPath = path.join(repoRoot, 'staticwebapp.config.json');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Unable to read ${path.relative(repoRoot, filePath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function getScriptSrc(csp) {
  return csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('script-src '));
}

if (existsSync(legacyRootConfigPath)) {
  fail('Duplicate Static Web Apps config detected at repository root. Keep public/staticwebapp.config.json as the single deploy source.');
}

if (!existsSync(publicConfigPath)) {
  fail('Missing public/staticwebapp.config.json.');
}

if (!existsSync(distConfigPath)) {
  fail('Missing dist/staticwebapp.config.json. Run npm run build before npm run deploy:check.');
}

const publicConfig = readJson(publicConfigPath);
const distConfig = readJson(distConfigPath);

if (normalize(publicConfig) !== normalize(distConfig)) {
  fail('dist/staticwebapp.config.json does not match public/staticwebapp.config.json. Rebuild before deploying.');
}

const csp = distConfig?.globalHeaders?.['Content-Security-Policy'];
if (typeof csp !== 'string') {
  fail('dist/staticwebapp.config.json is missing globalHeaders.Content-Security-Policy.');
}

const scriptSrc = getScriptSrc(csp);
if (!scriptSrc) {
  fail('Content-Security-Policy is missing a script-src directive.');
}

for (const token of ["'wasm-unsafe-eval'", "'unsafe-eval'"]) {
  if (!scriptSrc.includes(token)) {
    fail(`Content-Security-Policy script-src is missing ${token}. OpenCascade requires it in production.`);
  }
}

console.log('Deploy build checks passed.');
