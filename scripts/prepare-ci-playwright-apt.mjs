// CI runners already contain system Chrome. Playwright uses its own browsers,
// so its Ubuntu dependency installation must not depend on Google's apt index.
// Disable only the validated, dedicated source file; never weaken apt checks.
import { lstatSync, readFileSync, readdirSync, realpathSync, renameSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE_DIRECTORY = '/etc/apt/sources.list.d';
const CHROME_URL = /^https?:\/\/dl\.google\.com\/linux\/chrome(?:-stable)?\/deb\/?$/;
const CHROME_REFERENCE = /(?:^|\s)https?:\/\/dl\.google\.com\/linux\/chrome(?:-stable)?\/deb\/?(?=\s|$)/m;

export function validateChromeSource(content) {
  const active = String(content).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (!active.length || !active.every(line => /^deb(?:\s+\[[^\]\r\n]*\])?\s+https?:\/\/dl\.google\.com\/linux\/chrome(?:-stable)?\/deb\/?\s+stable\s+main\s*(?:#.*)?$/.test(line))) {
    throw new Error('CI_CHROME_SOURCE_UNEXPECTED_CONTENT');
  }
  return true;
}

export function validateChromeDeb822Source(content) {
  const allowed = new Set(['types', 'uris', 'suites', 'components', 'architectures', 'signed-by', 'enabled', 'x-repolib-name']);
  let activeCount = 0;
  for (const paragraph of String(content).replace(/^[ \t]*#.*$/gm, '').trim().split(/\r?\n\s*\r?\n/)) {
    if (!paragraph.trim()) continue;
    const fields = new Map();
    let previous;
    for (const line of paragraph.split(/\r?\n/)) {
      if (/^[ \t]/.test(line) && previous) { fields.set(previous, fields.get(previous) + ' ' + line.trim()); continue; }
      const field = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
      if (!field || !allowed.has(field[1].toLowerCase()) || fields.has(field[1].toLowerCase())) throw new Error('CI_CHROME_SOURCE_UNEXPECTED_CONTENT');
      previous = field[1].toLowerCase();
      fields.set(previous, field[2].trim());
    }
    if (fields.has('enabled') && !['yes', 'no'].includes(fields.get('enabled').toLowerCase())) throw new Error('CI_CHROME_SOURCE_UNEXPECTED_CONTENT');
    if (fields.get('enabled')?.toLowerCase() === 'no') continue;
    const urls = String(fields.get('uris') || '').trim().split(/\s+/);
    if (fields.get('types') !== 'deb' || fields.get('suites') !== 'stable' || fields.get('components') !== 'main'
        || !urls.length || !urls.every(url => CHROME_URL.test(url))) throw new Error('CI_CHROME_SOURCE_UNEXPECTED_CONTENT');
    activeCount++;
  }
  if (!activeCount) throw new Error('CI_CHROME_SOURCE_UNEXPECTED_CONTENT');
  return true;
}

// Injectable filesystem permits non-root tests; the CLI cannot override targets.
export function prepareCiPlaywrightApt(fs = { lstatSync, readFileSync, readdirSync, realpathSync, renameSync }) {
  const directory = fs.lstatSync(SOURCE_DIRECTORY);
  if (directory.isSymbolicLink() || !directory.isDirectory() || fs.realpathSync(SOURCE_DIRECTORY) !== SOURCE_DIRECTORY) {
    throw new Error('CI_CHROME_SOURCE_UNSAFE_DIRECTORY');
  }
  const targets = [];
  for (const name of fs.readdirSync(SOURCE_DIRECTORY).sort()) {
    if (!/\.(list|sources)$/.test(name)) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.(list|sources)$/.test(name)) throw new Error('CI_CHROME_SOURCE_UNSAFE_NAME');
    const source = path.posix.join(SOURCE_DIRECTORY, name);
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink() || !stat.isFile() || fs.realpathSync(source) !== source || stat.size > 16384) throw new Error('CI_CHROME_SOURCE_UNSAFE_FILE');
    const content = fs.readFileSync(source, 'utf8');
    const uncommented = String(content).split(/\r?\n/).filter(line => !line.trim().startsWith('#')).join('\n');
    if (!CHROME_REFERENCE.test(uncommented)) continue;
    if (name.endsWith('.sources')) validateChromeDeb822Source(content);
    else validateChromeSource(content);
    const disabled = source + '.playwright-disabled';
    try { fs.lstatSync(disabled); throw new Error('CI_CHROME_SOURCE_BACKUP_EXISTS'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    targets.push({ source, disabled, name });
  }
  if (targets.length > 2) throw new Error('CI_CHROME_SOURCE_TOO_MANY_TARGETS');
  // Same-directory rename preserves contents and is recoverable. The suffix is
  // not .list/.sources, so apt will leave it inactive while retaining Ubuntu.
  for (const { source, disabled } of targets) fs.renameSync(source, disabled);
  return { disabled: targets.length, files: targets.map(target => target.name) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.platform !== 'linux' || process.argv.length !== 2) throw new Error('CI_CHROME_SOURCE_LINUX_ONLY');
  const result = prepareCiPlaywrightApt();
  console.log(`Playwright CI apt preparation: ${result.disabled} dedicated Chrome source(s) disabled${result.files.length ? ': ' + result.files.join(', ') : ''}.`);
}
