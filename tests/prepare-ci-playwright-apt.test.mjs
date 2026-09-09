import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCiPlaywrightApt, validateChromeSource, validateChromeDeb822Source } from '../scripts/prepare-ci-playwright-apt.mjs';

const source = '/etc/apt/sources.list.d/google-chrome.list';
const valid = '# Managed by system Chrome\ndeb [arch=amd64] https://dl.google.com/linux/chrome-stable/deb/ stable main\n';
const deb822 = 'Types: deb\nURIs: https://dl.google.com/linux/chrome-stable/deb/\nSuites: stable\nComponents: main\nArchitectures: amd64\nSigned-By: /usr/share/keyrings/google-chrome.gpg\n';
function fixture(options = {}) {
  const moves = [];
  const files = options.files || { 'google-chrome.list': options.content ?? valid };
  const missing = () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };
  const fs = {
    readdirSync: () => options.missing ? [] : Object.keys(files),
    lstatSync(target) {
      if (target === '/etc/apt/sources.list.d') return { isDirectory: () => true, isSymbolicLink: () => Boolean(options.directoryLink) };
      if (target.endsWith('.playwright-disabled')) return options.backup ? {} : missing();
      assert.ok(target.startsWith('/etc/apt/sources.list.d/'));
      if (options.missing) return missing();
      return { size: options.size || 100, isFile: () => !options.directory, isSymbolicLink: () => Boolean(options.link) };
    },
    realpathSync: target => options.redirect ? target + '-elsewhere' : target,
    readFileSync(target) { return files[target.slice('/etc/apt/sources.list.d/'.length)] ?? missing(); },
    renameSync: (...args) => moves.push(args)
  };
  return { fs, moves };
}

test('dedicated Chrome source moves to a recoverable ignored extension exactly once', () => {
  const f = fixture();
  assert.deepEqual(prepareCiPlaywrightApt(f.fs), { disabled: 1, files: ['google-chrome.list'] });
  assert.deepEqual(f.moves, [[source, source + '.playwright-disabled']]);
});
test('missing dedicated source is a no-op', () => {
  const f = fixture({ missing: true });
  assert.deepEqual(prepareCiPlaywrightApt(f.fs), { disabled: 0, files: [] });
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
    assert.throws(() => validateChromeSource(content), /UNEXPECTED_CONTENT/);
  });
}
test('dedicated source permits the standard signed-by option without changing apt trust', () => {
  assert.equal(validateChromeSource('deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome-stable/deb stable main'), true);
});
for (const scheme of ['http', 'https']) {
  for (const directory of ['chrome', 'chrome-stable']) {
    test(`only disables the exact official source variant ${scheme}/${directory}`, () => {
      const f = fixture({ content: `deb [arch=amd64] ${scheme}://dl.google.com/linux/${directory}/deb/ stable main` });
      assert.deepEqual(prepareCiPlaywrightApt(f.fs), { disabled: 1, files: ['google-chrome.list'] });
      assert.deepEqual(f.moves, [[source, source + '.playwright-disabled']]);
    });
  }
}

test('discovers alternative runner names and Deb822, leaving other apt sources untouched', () => {
  const f = fixture({ files: { 'google-chrome-stable.list': valid, 'chrome.sources': deb822,
    'ubuntu.sources': 'Types: deb\nURIs: http://archive.ubuntu.com/ubuntu\nSuites: noble\nComponents: main',
    'microsoft-prod.list': 'deb https://packages.microsoft.com/ubuntu/24.04/prod noble main' } });
  assert.deepEqual(prepareCiPlaywrightApt(f.fs), { disabled: 2, files: ['chrome.sources', 'google-chrome-stable.list'] });
  assert.equal(f.moves.length, 2);
  assert.ok(f.moves.every(([from, to]) => to === from + '.playwright-disabled'));
});
test('all matching source files validate before any rename', () => {
  const f = fixture({ files: { 'a-chrome.list': valid, 'b-chrome.sources': deb822 + '\nTypes: deb\nURIs: https://archive.ubuntu.com/ubuntu\nSuites: noble\nComponents: main\n' } });
  assert.throws(() => prepareCiPlaywrightApt(f.fs), /UNEXPECTED_CONTENT/);
  assert.deepEqual(f.moves, []);
});
test('three matching sources exceed the target cap without modifying files', () => {
  const f = fixture({ files: { 'a.list': valid, 'b.list': valid, 'c.sources': deb822 } });
  assert.throws(() => prepareCiPlaywrightApt(f.fs), /TOO_MANY_TARGETS/);
  assert.deepEqual(f.moves, []);
});
for (const [label, content] of [
  ['mixed URIs', deb822.replace('URIs: ', 'URIs: https://archive.ubuntu.com/ubuntu ')],
  ['lookalike URI', deb822.replace('dl.google.com/', 'dl.google.com.evil/')],
  ['unexpected types', deb822.replace('Types: deb', 'Types: deb deb-src')],
  ['unexpected suites', deb822.replace('Suites: stable', 'Suites: stable beta')],
  ['unexpected components', deb822.replace('Components: main', 'Components: main contrib')],
  ['duplicate field', deb822 + 'URIs: https://archive.ubuntu.com/ubuntu\n'],
  ['unknown setting', deb822 + 'Trusted: yes\n'],
  ['malformed enabled', deb822 + 'Enabled: maybe\n']
]) test(`Deb822 fails closed: ${label}`, () => assert.throws(() => validateChromeDeb822Source(content), /UNEXPECTED_CONTENT/));
test('Deb822 URI continuation remains constrained to exact Chrome origins', () => {
  assert.equal(validateChromeDeb822Source(deb822.replace('URIs: https:', 'URIs:\n https:')), true);
  assert.throws(() => validateChromeDeb822Source(deb822.replace('Suites:', ' https://archive.ubuntu.com/ubuntu\nSuites:')), /UNEXPECTED_CONTENT/);
});
