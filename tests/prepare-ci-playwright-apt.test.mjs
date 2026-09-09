import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCiPlaywrightApt, validateChromeSource } from '../scripts/prepare-ci-playwright-apt.mjs';

const source = '/etc/apt/sources.list.d/google-chrome.list';
const valid = '# Managed by system Chrome\ndeb [arch=amd64] https://dl.google.com/linux/chrome-stable/deb/ stable main\n';
function fixture(options = {}) {
  const moves = [];
  const missing = () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };
  const fs = {
    lstatSync(target) {
      if (target === '/etc/apt/sources.list.d') return { isDirectory: () => true, isSymbolicLink: () => Boolean(options.directoryLink) };
      if (target.endsWith('.playwright-disabled')) return options.backup ? {} : missing();
      assert.equal(target, source);
      if (options.missing) return missing();
      return { size: options.size || 100, isFile: () => !options.directory, isSymbolicLink: () => Boolean(options.link) };
    },
    realpathSync: target => options.redirect ? target + '-elsewhere' : target,
    readFileSync(target) { assert.equal(target, source); return options.content ?? valid; },
    renameSync: (...args) => moves.push(args)
  };
  return { fs, moves };
}

test('dedicated Chrome source moves to a recoverable ignored extension exactly once', () => {
  const f = fixture();
  assert.deepEqual(prepareCiPlaywrightApt(f.fs), { disabled: 1 });
  assert.deepEqual(f.moves, [[source, source + '.playwright-disabled']]);
});
test('missing dedicated source is a no-op', () => {
  const f = fixture({ missing: true });
  assert.deepEqual(prepareCiPlaywrightApt(f.fs), { disabled: 0 });
  assert.deepEqual(f.moves, []);
});
for (const options of [{ link: true }, { directoryLink: true }, { directory: true }, { redirect: true }, { backup: true }, { size: 20000 }]) {
  test(`unsafe source cannot be moved: ${JSON.stringify(options)}`, () => {
    const f = fixture(options);
    assert.throws(() => prepareCiPlaywrightApt(f.fs), /CI_CHROME_SOURCE_/);
    assert.deepEqual(f.moves, []);
  });
}
for (const content of ['', '# comments only', valid + 'deb https://archive.ubuntu.com/ubuntu noble main', 'deb https://dl.google.com.evil/linux/chrome-stable/deb stable main', 'deb https://dl.google.com/linux/chrome-stable/deb/other stable main', 'deb http://dl.google.com/linux/chrome-beta/deb stable main', 'deb https://dl.google.com/linux/chrome-stable/deb stable main contrib']) {
  test(`unexpected source contents fail closed: ${content.slice(0, 45)}`, () => {
    const f = fixture({ content });
    assert.throws(() => prepareCiPlaywrightApt(f.fs), /UNEXPECTED_CONTENT/);
    assert.deepEqual(f.moves, []);
  });
}
test('dedicated source permits the standard signed-by option without changing apt trust', () => {
  assert.equal(validateChromeSource('deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome-stable/deb stable main'), true);
});
for (const scheme of ['http', 'https']) {
  for (const directory of ['chrome', 'chrome-stable']) {
    test(`only disables the exact official source variant ${scheme}/${directory}`, () => {
      const f = fixture({ content: `deb [arch=amd64] ${scheme}://dl.google.com/linux/${directory}/deb/ stable main` });
      assert.deepEqual(prepareCiPlaywrightApt(f.fs), { disabled: 1 });
      assert.deepEqual(f.moves, [[source, source + '.playwright-disabled']]);
    });
  }
}
