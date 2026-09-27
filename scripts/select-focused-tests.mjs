import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generatedBuildOutput } from './local-validation-evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function matches(pattern, file) {
  if (pattern.endsWith('/**')) return file === pattern.slice(0, -3) || file.startsWith(pattern.slice(0, -2));
  return file === pattern;
}

export function selectFocusedTests(changedFiles, map) {
  const files = [...new Set(changedFiles.map(file => String(file).replaceAll('\\', '/')).filter(Boolean))].sort();
  const modules = map.modules.filter(module => files.some(file => module.paths.some(pattern => matches(pattern, file))));
  const unknown = files.filter(file => !map.modules.some(module => module.paths.some(pattern => matches(pattern, file))));
  const commands = [];
  const add = command => { if (!commands.includes(command)) commands.push(command); };
  for (const module of modules) for (const command of module.commands) add(command);
  if (unknown.length || !commands.length) for (const command of map.fallbackCommands) add(command);
  return { files, modules: modules.map(module => module.id), unknown, commands };
}

export function changedFilesFromGit(cwd = root, base = 'origin/main') {
  const read = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean);
  let mergeBase;
  try { mergeBase = execFileSync('git', ['merge-base', base, 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch {
    const remotes = execFileSync('git', ['remote'], { cwd, encoding: 'utf8' }).trim().split(/\r?\n/);
    if (base !== 'origin/main' || remotes.includes('origin')) throw new Error('FOCUSED_BASE_UNAVAILABLE: fetch origin/main before selecting committed changes.');
    mergeBase = 'HEAD';
  }
  const files = [...new Set([
    ...read(['diff', '--name-only', '-z', '--no-renames', '--relative', mergeBase]),
    ...read(['ls-files', '-z', '--others', '--exclude-standard']),
  ])];
  return files.filter(file => {
    if (generatedBuildOutput(file)) return false;
    if (!releaseMarkerFiles.has(file)) return true;
    try {
      const before = execFileSync('git', ['show', `${mergeBase}:${file}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });
      return !releaseMarkerOnly(file, before, readFileSync(path.join(cwd, file), 'utf8'));
    } catch { return true; }
  });
}

const releaseMarkerFiles = new Set(['package.json', 'package-lock.json', 'index.html', 'manifest.json', 'sw.js', 'scripts/build-live-shell.mjs']);
export function releaseMarkerOnly(file, before, after) {
  if (!releaseMarkerFiles.has(file)) return false;
  if (file === 'package.json' || file === 'package-lock.json') {
    const old = JSON.parse(before), next = JSON.parse(after);
    if (!/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(old.version) || !/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(next.version)) return false;
    old.version = next.version;
    if (file === 'package-lock.json') old.packages[''].version = next.packages[''].version;
    return JSON.stringify(old) === JSON.stringify(next);
  }
  const markers = {
    'index.html': /window\.__APP_SHELL_VERSION__\s*=\s*['"]([^'"]+)['"]/,
    'manifest.json': /"version"\s*:\s*"([^"]+)"/,
    'sw.js': /const APP_SHELL_BUILD\s*=\s*['"]([^'"]+)['"]/,
    'scripts/build-live-shell.mjs': /const RELEASE\s*=\s*['"]([^'"]+)['"]/,
  };
  const previous = before.match(markers[file])?.[1], next = after.match(markers[file])?.[1];
  return /^V\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(previous || '') && /^V\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(next || '')
    && before.replaceAll(previous, next).replaceAll('\r\n', '\n') === after.replaceAll('\r\n', '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const json = process.argv.includes('--json');
  const explicit = process.argv.slice(2).filter(argument => argument !== '--json');
  const map = JSON.parse(readFileSync(path.join(root, 'live-src', 'change-impact.json'), 'utf8'));
  if (map.schemaVersion !== 'gnc-change-impact-v1') throw new Error('Unsupported change-impact schema.');
  const result = selectFocusedTests(explicit.length ? explicit : changedFilesFromGit(), map);
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    console.log(`Affected modules: ${result.modules.join(', ') || 'fallback'}`);
    if (result.unknown.length) console.log(`Unknown paths: ${result.unknown.join(', ')}`);
    console.log('Focused commands:');
    for (const command of result.commands) console.log(`- ${command}`);
  }
}
