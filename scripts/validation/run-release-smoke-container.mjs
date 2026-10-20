import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const PLAYWRIGHT_PIN = '1.62.1';

export function ensureValidationDependencies({ execute = spawnSync, rootDir = root } = {}) {
  const modules = path.join(rootDir, 'node_modules');
  const lock = path.join(rootDir, 'package-lock.json');
  const stamp = path.join(modules, '.gnc-validation-lock-sha256');
  const expected = createHash('sha256').update(readFileSync(lock)).digest('hex');
  const playwrightPackage = path.join(modules, '@playwright', 'test', 'package.json');
  let installedPin = '';
  try { installedPin = JSON.parse(readFileSync(playwrightPackage, 'utf8')).version; } catch {}
  const browserMarker = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || '/ms-playwright', `.gnc-playwright-${PLAYWRIGHT_PIN}`);
  if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === expected
    && installedPin === PLAYWRIGHT_PIN && existsSync(browserMarker)) return false;

  const result = execute('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: { ...process.env, HUSKY: '0' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`VALIDATION_NPM_CI_FAILED:${result.status}`);
  writeFileSync(stamp, `${expected}\n`);
  if (!existsSync(browserMarker)) throw new Error(`VALIDATION_PLAYWRIGHT_BROWSER_CACHE_PIN_MISSING:${PLAYWRIGHT_PIN}`);
  return true;
}

export function runValidationSmoke({ execute = spawnSync, rootDir = root, env = process.env } = {}) {
  ensureValidationDependencies({ execute, rootDir });
  const result = execute(process.execPath, ['scripts/run-release-smoke.mjs'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: { ...env, CI: '1', HUSKY: '0' },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = runValidationSmoke(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
