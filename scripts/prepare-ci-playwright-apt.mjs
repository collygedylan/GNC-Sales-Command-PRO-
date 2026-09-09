// CI runners already contain system Chrome. Playwright uses its own browsers,
// so its Ubuntu dependency installation must not depend on Google's apt index.
// Disable only the validated, dedicated source file; never weaken apt checks.
import { lstatSync, readFileSync, realpathSync, renameSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE_DIRECTORY = '/etc/apt/sources.list.d';
const SOURCE_NAME = 'google-chrome.list';

export function validateChromeSource(content) {
  const active = String(content).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (!active.length || !active.every(line => /^deb(?:\s+\[[^\]\r\n]*\])?\s+https?:\/\/dl\.google\.com\/linux\/chrome(?:-stable)?\/deb\/?\s+stable\s+main\s*(?:#.*)?$/.test(line))) {
    throw new Error('CI_CHROME_SOURCE_UNEXPECTED_CONTENT');
  }
  return true;
}

// Injectable filesystem permits non-root tests; the CLI cannot override targets.
export function prepareCiPlaywrightApt(fs = { lstatSync, readFileSync, realpathSync, renameSync }) {
  const directory = fs.lstatSync(SOURCE_DIRECTORY);
  if (directory.isSymbolicLink() || !directory.isDirectory() || fs.realpathSync(SOURCE_DIRECTORY) !== SOURCE_DIRECTORY) {
    throw new Error('CI_CHROME_SOURCE_UNSAFE_DIRECTORY');
  }
  const source = path.posix.join(SOURCE_DIRECTORY, SOURCE_NAME);
  const disabled = source + '.playwright-disabled';
  let stat;
  try { stat = fs.lstatSync(source); }
  catch (error) { if (error.code === 'ENOENT') return { disabled: 0 }; throw error; }
  if (stat.isSymbolicLink() || !stat.isFile() || fs.realpathSync(source) !== source || stat.size > 16384) {
    throw new Error('CI_CHROME_SOURCE_UNSAFE_FILE');
  }
  validateChromeSource(fs.readFileSync(source, 'utf8'));
  try {
    fs.lstatSync(disabled);
    throw new Error('CI_CHROME_SOURCE_BACKUP_EXISTS');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Same-directory rename preserves contents and is recoverable. The suffix is
  // not .list/.sources, so apt will leave it inactive while retaining Ubuntu.
  fs.renameSync(source, disabled);
  return { disabled: 1 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.platform !== 'linux' || process.argv.length !== 2) throw new Error('CI_CHROME_SOURCE_LINUX_ONLY');
  const result = prepareCiPlaywrightApt();
  console.log(`Playwright CI apt preparation: ${result.disabled ? 'dedicated Chrome source disabled' : 'no dedicated Chrome source present'}.`);
}
