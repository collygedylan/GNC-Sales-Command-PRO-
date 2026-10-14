import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stagedPaths, syntaxCheck, precommit } from '../scripts/precommit.mjs';
import { repoRoot } from '../scripts/tooling-process.mjs';

test('staged selection preserves spaces and deleted paths without shell parsing', () => {
  let command;
  const files = stagedPaths(repoRoot, (bin, args) => {
    command = [bin, args];
    return 'old path.ts\0new path.ts\0deleted.ts\0';
  });
  assert.deepEqual(files, ['old path.ts', 'new path.ts', 'deleted.ts']);
  assert.equal(command[0], 'git');
  assert.ok(command[1].includes('--no-renames'));
  assert.ok(command[1].includes('-z'));
});

test('pre-commit checks syntax only for supplied staged paths', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'gnc staged syntax '));
  try {
    writeFileSync(path.join(fixture, 'staged.ts'), 'export const value: number = 4;\n');
    writeFileSync(path.join(fixture, 'staged.d.ts'), 'export declare const declaredValue: number;\n');
    writeFileSync(path.join(fixture, 'unstaged.ts'), 'export const value: = 4;\n');
    writeFileSync(path.join(fixture, 'staged.json'), '{"ok":true}\n');
    writeFileSync(path.join(fixture, 'staged.yml'), 'ready: true\n');
    writeFileSync(path.join(fixture, 'staged.html'), '<script>const inlineReady = true;</script><script type="application/json">const data = ;</script><script id="app-script-source" type="text/plain">const bootstrap = true;</script><script src="external.js">const ignored = ;</script>');
    assert.doesNotThrow(() => precommit({ root: fixture, files: ['staged.ts', 'staged.d.ts', 'staged.json', 'staged.yml', 'staged.html'] }));
  } finally {
    const allowed = path.resolve(tmpdir()) + path.sep;
    assert.ok(path.resolve(fixture).startsWith(allowed));
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('pre-commit rejects malformed staged source and configuration syntax', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'gnc invalid staged syntax '));
  try {
    writeFileSync(path.join(fixture, 'bad.ts'), 'export const value: = 4;\n');
    assert.throws(() => syntaxCheck(['bad.ts'], fixture));
    writeFileSync(path.join(fixture, 'bad.json'), '{not json}\n');
    assert.throws(() => syntaxCheck(['bad.json'], fixture));
    writeFileSync(path.join(fixture, 'bad.yml'), 'key: [unterminated\n');
    assert.throws(() => syntaxCheck(['bad.yml'], fixture));
    writeFileSync(path.join(fixture, 'bad.html'), '<script>const brokenInline = ;</script>');
    assert.throws(() => syntaxCheck(['bad.html'], fixture), /inline script did not parse/);
    writeFileSync(path.join(fixture, 'bad-bootstrap.html'), '<script id="app-script-source" type="text/plain">const brokenBootstrap = ;</script>');
    assert.throws(() => syntaxCheck(['bad-bootstrap.html'], fixture), /inline script did not parse/);
  } finally {
    const allowed = path.resolve(tmpdir()) + path.sep;
    assert.ok(path.resolve(fixture).startsWith(allowed));
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('pre-commit selects TypeScript grammar for typed modules and JSX grammar for components', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'gnc typed staged syntax '));
  try {
    const files = ['typed.ts', 'typed.mts', 'typed.cts'];
    for (const file of files) {
      writeFileSync(path.join(fixture, file), 'export const identity = <T>(value: T): T => value;\nexport const label = <string>"ready";\n');
    }
    writeFileSync(path.join(fixture, 'component.tsx'), 'export const View = (props: { label: string }) => <div>{props.label}</div>;\n');
    writeFileSync(path.join(fixture, 'component.jsx'), 'export const View = () => <div>Ready</div>;\n');
    assert.doesNotThrow(() => syntaxCheck([...files, 'component.tsx', 'component.jsx'], fixture));
    writeFileSync(path.join(fixture, 'broken.tsx'), 'export const View = () => <div>;\n');
    assert.throws(() => syntaxCheck(['broken.tsx'], fixture));
  } finally {
    const allowed = path.resolve(tmpdir()) + path.sep;
    assert.ok(path.resolve(fixture).startsWith(allowed));
    rmSync(fixture, { recursive: true, force: true });
  }
});
