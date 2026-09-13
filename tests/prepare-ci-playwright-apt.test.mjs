import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCiPlaywrightApt, validateChromeSource, validateChromeDeb822Source, prepareCiUbuntuMirrors, withoutAzureUbuntuMirror } from '../scripts/prepare-ci-playwright-apt.mjs';

const source = '/etc/apt/sources.list.d/google-chrome.list';
const valid = '# Managed by system Chrome\ndeb [arch=amd64] https://dl.google.com/linux/chrome-stable/deb/ stable main\n';
const deb822 = 'Types: deb\nURIs: https://dl.google.com/linux/chrome-stable/deb/\nSuites: stable\nComponents: main\nArchitectures: amd64\nSigned-By: /usr/share/keyrings/google-chrome.gpg\n';
// Shape emitted by official Chromium gen_sources_content() in:
// https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/installer/linux/common/apt.include
const officialDeb822 = '### THIS FILE IS AUTOMATICALLY CONFIGURED ###\n# Changes to this file will not be preserved.\n# This file will not be recreated if removed.\nX-Repolib-Name: Google Chrome\n' + deb822;
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
test('accepts the complete official current Chrome stanza including inert X-Repolib-Name', () => {
  const f = fixture({ files: { 'google-chrome.sources': officialDeb822 } });
  assert.deepEqual(prepareCiPlaywrightApt(f.fs), { disabled: 1, files: ['google-chrome.sources'] });
  assert.deepEqual(f.moves, [['/etc/apt/sources.list.d/google-chrome.sources', '/etc/apt/sources.list.d/google-chrome.sources.playwright-disabled']]);
  assert.throws(() => validateChromeDeb822Source(officialDeb822.replace('dl.google.com/', 'dl.google.com.evil/')), /UNEXPECTED_CONTENT/);
  assert.throws(() => validateChromeDeb822Source(officialDeb822 + 'X-Repolib-Name: Duplicate\n'), /UNEXPECTED_CONTENT/);
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

const mirrorsPath = '/etc/apt/apt-mirrors.txt';
const officialMirrors = '# Runner mirrors\nhttp://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
const httpsMirrors = '# Runner mirrors\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
function mirrorFixture(options = {}) {
  const writes = [];
  const renames = [];
  const fs = {
    lstatSync(target) {
      if (options.missing && target === mirrorsPath) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { isSymbolicLink: () => Boolean(options.link), isDirectory: () => !options.directoryFile,
        isFile: () => !options.directoryFile, size: options.size || 144 };
    },
    realpathSync: target => options.redirect ? target + '-elsewhere' : target,
    readFileSync: () => options.content ?? officialMirrors,
    writeFileSync(target, content, settings) {
      if (options.backup && target.endsWith('.playwright-original')) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      if (options.pending && target.endsWith('.playwright-pending')) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      writes.push([target, content, settings]);
    },
    renameSync: (...args) => renames.push(args)
  };
  return { fs, writes, renames };
}

test('runner Ubuntu mirror preparation removes only Azure and preserves HTTPS sources and comments', () => {
  const f = mirrorFixture();
  assert.deepEqual(prepareCiUbuntuMirrors(f.fs), { changed: true });
  assert.deepEqual(f.writes, [
    [mirrorsPath + '.playwright-original', officialMirrors, { flag: 'wx', mode: 0o644 }],
    [mirrorsPath + '.playwright-pending', httpsMirrors, { flag: 'wx', mode: 0o644 }]
  ]);
  assert.deepEqual(f.renames, [[mirrorsPath + '.playwright-pending', mirrorsPath]]);
  assert.equal(withoutAzureUbuntuMirror(officialMirrors.replaceAll('\n', '\r\n')), httpsMirrors.replaceAll('\n', '\r\n'));
});

test('already configured Ubuntu HTTPS mirrors are an idempotent no-op', () => {
  const f = mirrorFixture({ content: httpsMirrors });
  assert.deepEqual(prepareCiUbuntuMirrors(f.fs), { changed: false });
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.renames, []);
});

test('an existing pending mirror file cannot replace the active mirror list', () => {
  const f = mirrorFixture({ pending: true });
  assert.throws(() => prepareCiUbuntuMirrors(f.fs), { code: 'EEXIST' });
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0][0], mirrorsPath + '.playwright-original');
  assert.deepEqual(f.renames, []);
});

for (const content of ['', '# no mirrors\n', officialMirrors.replace('archive.ubuntu.com/ubuntu/\tpriority:2', 'archive.ubuntu.com.evil/ubuntu/\tpriority:2'),
  officialMirrors + 'https://archive.ubuntu.com/ubuntu/\tpriority:4\n',
  officialMirrors.replace('https://security.ubuntu.com/ubuntu/\tpriority:3\n', ''),
  officialMirrors.replace('priority:2', 'trusted:yes'), officialMirrors + 'https://example.com/ubuntu/\tpriority:4\n']) {
  test(`unexpected Ubuntu mirror content prevents all writes: ${content.slice(-45)}`, () => {
    const f = mirrorFixture({ content });
    assert.throws(() => prepareCiUbuntuMirrors(f.fs), /CI_UBUNTU_MIRRORS_/);
    assert.deepEqual(f.writes, []);
  });
}

for (const options of [{ link: true }, { redirect: true }, { directoryFile: true }, { size: 5000 }, { missing: true }, { backup: true }]) {
  test(`unsafe or missing Ubuntu mirror file is preserved: ${JSON.stringify(options)}`, () => {
    const f = mirrorFixture(options);
    assert.throws(() => prepareCiUbuntuMirrors(f.fs));
    assert.deepEqual(f.writes, []);
  });
}
